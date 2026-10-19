-- Centro report: una funzione che restituisce le righe di ogni tipo di report per un periodo,
-- con filtro facoltativo per veicolo e per tecnico. Solo responsabili e amministratori.

create or replace function public.report_dati(p_tipo text, p_da date, p_a date, p_veicolo bigint, p_tecnico bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  perform public.richiedi_responsabile();
  if p_da is null or p_a is null or p_a < p_da then raise exception 'Periodo non valido'; end if;
  if p_a - p_da > 731 then raise exception 'Periodo troppo lungo: massimo 2 anni'; end if;

  if p_tipo = 'km_veicoli' then
    select coalesce(jsonb_agg(x order by x->>'targa'), '[]') into r from (
      select jsonb_build_object(
        'targa', v.targa, 'modello', v.marca_modello, 'tipo', v.tipo, 'proprieta', v.proprieta,
        'km_inizio', (select m.km_precedenti from public.movimenti m where m.veicolo_id = v.id and (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a order by m.creato_il limit 1),
        'km_fine', (select m.km from public.movimenti m where m.veicolo_id = v.id and (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a order by m.creato_il desc limit 1),
        'km_percorsi', coalesce(sum(greatest(m.km - coalesce(m.km_precedenti, m.km), 0)) filter (where m.tipo <> 'rettifica'), 0),
        'giorni_uso', count(distinct (m.creato_il at time zone 'Europe/Rome')::date),
        'prese', count(*) filter (where m.tipo = 'presa'),
        'tecnici', count(distinct m.tecnico_id),
        'km_giorno', case when count(distinct (m.creato_il at time zone 'Europe/Rome')::date) > 0
          then round(coalesce(sum(greatest(m.km - coalesce(m.km_precedenti, m.km), 0)) filter (where m.tipo <> 'rettifica'), 0)::numeric / count(distinct (m.creato_il at time zone 'Europe/Rome')::date), 1) end,
        'km_attuali', v.km_attuali) x
      from public.veicoli v
      left join public.movimenti m on m.veicolo_id = v.id and (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a
        and (p_tecnico is null or m.tecnico_id = p_tecnico)
      where not v.dismesso and (p_veicolo is null or v.id = p_veicolo)
      group by v.id) t;

  elsif p_tipo = 'movimenti' then
    select coalesce(jsonb_agg(x order by x->>'targa', x->>'quando'), '[]') into r from (
      select jsonb_build_object(
        'targa', v.targa, 'modello', v.marca_modello, 'quando', m.creato_il,
        'tipo', case m.tipo when 'presa' then 'Presa in carico' when 'riconsegna' then 'Riconsegna' when 'lettura_km' then 'Lettura km' else 'Rettifica' end,
        'tecnico', coalesce(t.nome || ' ' || t.cognome, case when m.registrato_da = 'responsabile' then 'Responsabile' end),
        'km_prima', m.km_precedenti, 'km', m.km,
        'km_percorsi', case when m.tipo <> 'rettifica' then greatest(m.km - coalesce(m.km_precedenti, m.km), 0) end,
        'carburante', m.carburante, 'danni', case when m.danni_dichiarati then 'Sì' else '' end, 'note', m.note) x
      from public.movimenti m join public.veicoli v on v.id = m.veicolo_id left join public.tecnici t on t.id = m.tecnico_id
      where (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a
        and (p_veicolo is null or m.veicolo_id = p_veicolo) and (p_tecnico is null or m.tecnico_id = p_tecnico)) t;

  elsif p_tipo = 'km_tecnici' then
    select coalesce(jsonb_agg(x order by x->>'tecnico'), '[]') into r from (
      select jsonb_build_object(
        'tecnico', t.nome || ' ' || t.cognome, 'codice', t.codice, 'ruolo', t.ruolo,
        'km_percorsi', coalesce(sum(greatest(m.km - coalesce(m.km_precedenti, m.km), 0)) filter (where m.tipo <> 'rettifica'), 0),
        'giorni_guida', count(distinct (m.creato_il at time zone 'Europe/Rome')::date),
        'prese', count(*) filter (where m.tipo = 'presa'),
        'riconsegne', count(*) filter (where m.tipo = 'riconsegna'),
        'veicoli', coalesce(string_agg(distinct v.targa, ', '), ''),
        'segnalazioni', (select count(*) from public.segnalazioni s where s.tecnico_id = t.id and (s.creato_il at time zone 'Europe/Rome')::date between p_da and p_a),
        'multe', (select count(*) from public.multe x where x.tecnico_id = t.id and (x.data_ora_infrazione at time zone 'Europe/Rome')::date between p_da and p_a)) x
      from public.tecnici t
      left join public.movimenti m on m.tecnico_id = t.id and (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a
        and (p_veicolo is null or m.veicolo_id = p_veicolo)
      left join public.veicoli v on v.id = m.veicolo_id
      where t.attivo and (p_tecnico is null or t.id = p_tecnico)
      group by t.id) t;

  elsif p_tipo = 'giornaliero' then
    select coalesce(jsonb_agg(x order by x->>'data', x->>'tecnico'), '[]') into r from (
      select jsonb_build_object(
        'data', d.d, 'tecnico', t.nome || ' ' || t.cognome,
        'veicolo', (select v.targa from public.assegnazioni g join public.veicoli v on v.id = g.veicolo_id where g.tecnico_id = t.id and g.data = d.d),
        'assenza', (select a.motivo from public.assenze a where a.tecnico_id = t.id and d.d between a.dal and a.al limit 1),
        'interventi', (select string_agg(coalesce(to_char(i.ora, 'HH24:MI') || ' ', '') || i.luogo || ' – ' || i.attivita, ' | ' order by i.ora nulls last, i.id)
                       from public.interventi i where i.tecnico_id = t.id and i.data = d.d),
        'n_interventi', (select count(*) from public.interventi i where i.tecnico_id = t.id and i.data = d.d),
        'piano', case when exists (select 1 from public.piani p where p.data = d.d) then 'Confermato' else 'Non confermato' end,
        'km_giorno', (select sum(greatest(m.km - coalesce(m.km_precedenti, m.km), 0)) from public.movimenti m
                      where m.tecnico_id = t.id and m.tipo <> 'rettifica' and (m.creato_il at time zone 'Europe/Rome')::date = d.d)) x
      from generate_series(p_da, p_a, interval '1 day') g(ts), lateral (select g.ts::date as d) d, public.tecnici t
      where t.attivo and extract(isodow from d.d) < 6 and (p_tecnico is null or t.id = p_tecnico)
        and (p_veicolo is null or exists (select 1 from public.assegnazioni g2 where g2.tecnico_id = t.id and g2.data = d.d and g2.veicolo_id = p_veicolo))) t;

  elsif p_tipo = 'segnalazioni' then
    select coalesce(jsonb_agg(x order by x->>'aperta_il'), '[]') into r from (
      select jsonb_build_object(
        'aperta_il', s.creato_il, 'targa', v.targa, 'tecnico', coalesce(t.nome || ' ' || t.cognome, 'Responsabile'),
        'categoria', case s.categoria when 'guasto_meccanico' then 'Guasto meccanico' when 'spia_accesa' then 'Spia accesa' when 'pneumatici' then 'Pneumatici'
          when 'danno_carrozzeria' then 'Danno carrozzeria' when 'incidente' then 'Incidente' when 'dotazioni' then 'Dotazioni di bordo' when 'pulizia' then 'Pulizia' else 'Altro' end,
        'gravita', case s.gravita when 'fermo' then 'Veicolo fermo' when 'da_verificare' then 'Da verificare' else 'Utilizzabile' end,
        'descrizione', s.descrizione,
        'stato', case s.stato when 'aperta' then 'Aperta' when 'in_lavorazione' then 'In lavorazione' else 'Risolta' end,
        'chiusa_il', s.chiusa_il,
        'ore_risoluzione', case when s.chiusa_il is not null then round((extract(epoch from s.chiusa_il - s.creato_il) / 3600)::numeric, 1) end,
        'nota_chiusura', s.nota_chiusura) x
      from public.segnalazioni s join public.veicoli v on v.id = s.veicolo_id left join public.tecnici t on t.id = s.tecnico_id
      where (s.creato_il at time zone 'Europe/Rome')::date between p_da and p_a
        and (p_veicolo is null or s.veicolo_id = p_veicolo) and (p_tecnico is null or s.tecnico_id = p_tecnico)) t;

  elsif p_tipo = 'scadenze' then
    -- scadenze che cadono entro la fine del periodo (comprese quelle già superate)
    select coalesce(jsonb_agg(x order by x->>'scadenza'), '[]') into r from (
      select jsonb_build_object('oggetto', v.targa || ' · ' || v.marca_modello, 'tipo', s.tipo, 'scadenza', s.d,
        'giorni', s.d - (now() at time zone 'Europe/Rome')::date,
        'stato', case when s.d < (now() at time zone 'Europe/Rome')::date then 'Scaduta' when s.d - (now() at time zone 'Europe/Rome')::date <= 30 then 'Entro 30 giorni' else 'In programma' end) x
      from public.veicoli v,
        lateral (values ('Assicurazione', v.scad_assicurazione), ('Revisione', v.scad_revisione), ('Bollo', v.scad_bollo)) s(tipo, d)
      where not v.dismesso and s.d is not null and s.d <= p_a and (p_veicolo is null or v.id = p_veicolo) and p_tecnico is null
      union all
      select jsonb_build_object('oggetto', v.targa || ' · ' || coalesce(d.descrizione, d.tipo), 'tipo', 'Dotazione: ' || replace(d.tipo, '_', ' '), 'scadenza', d.scadenza,
        'giorni', d.scadenza - (now() at time zone 'Europe/Rome')::date,
        'stato', case when d.scadenza < (now() at time zone 'Europe/Rome')::date then 'Scaduta' when d.scadenza - (now() at time zone 'Europe/Rome')::date <= 30 then 'Entro 30 giorni' else 'In programma' end)
      from public.dotazioni d join public.veicoli v on v.id = d.veicolo_id
      where d.attiva and not v.dismesso and d.scadenza is not null and d.scadenza <= p_a and (p_veicolo is null or v.id = p_veicolo) and p_tecnico is null
      union all
      select jsonb_build_object('oggetto', t.nome || ' ' || t.cognome, 'tipo', 'Patente ' || coalesce(t.patente_categoria, ''), 'scadenza', t.patente_scadenza,
        'giorni', t.patente_scadenza - (now() at time zone 'Europe/Rome')::date,
        'stato', case when t.patente_scadenza < (now() at time zone 'Europe/Rome')::date then 'Scaduta' when t.patente_scadenza - (now() at time zone 'Europe/Rome')::date <= 30 then 'Entro 30 giorni' else 'In programma' end)
      from public.tecnici t
      where t.attivo and t.patente_scadenza is not null and t.patente_scadenza <= p_a and p_veicolo is null and (p_tecnico is null or t.id = p_tecnico)) t;

  elsif p_tipo = 'carburante' then
    select coalesce(jsonb_agg(x order by x->>'targa', x->>'data'), '[]') into r from (
      select jsonb_build_object('data', f.data, 'targa', v.targa, 'conducente', (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = (public.conducente_alle(v.id, (f.data + time '12:00') at time zone 'Europe/Rome')->>'tecnico_id')::bigint),
        'prodotto', f.prodotto, 'fornitore', f.fornitore, 'litri', f.litri, 'importo', f.importo, 'km', f.km,
        'eur_litro', case when f.litri > 0 then round(f.importo / f.litri, 3) end) x
      from public.rifornimenti f join public.veicoli v on v.id = f.veicolo_id
      where f.data between p_da and p_a and (p_veicolo is null or f.veicolo_id = p_veicolo)) t;

  elsif p_tipo = 'costi_veicoli' then
    select coalesce(jsonb_agg(x order by x->>'targa'), '[]') into r from (
      select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'proprieta', v.proprieta,
        'km_percorsi', k.km, 'litri', f.litri, 'carburante', f.eur,
        'l_100km', case when k.km > 0 and f.litri > 0 then round(f.litri / k.km * 100, 1) end,
        'eur_km', case when k.km > 0 and f.eur > 0 then round(f.eur / k.km, 3) end,
        'multe', mu.n, 'multe_eur', mu.eur, 'totale', f.eur + mu.eur,
        'segnalazioni', (select count(*) from public.segnalazioni s where s.veicolo_id = v.id and (s.creato_il at time zone 'Europe/Rome')::date between p_da and p_a)) x
      from public.veicoli v,
        lateral (select coalesce(sum(greatest(m.km - coalesce(m.km_precedenti, m.km), 0)), 0) km from public.movimenti m
                 where m.veicolo_id = v.id and m.tipo <> 'rettifica' and (m.creato_il at time zone 'Europe/Rome')::date between p_da and p_a) k,
        lateral (select coalesce(sum(r2.litri), 0) litri, coalesce(sum(r2.importo), 0) eur from public.rifornimenti r2 where r2.veicolo_id = v.id and r2.data between p_da and p_a) f,
        lateral (select count(*) n, coalesce(sum(x2.importo), 0) eur from public.multe x2 where x2.veicolo_id = v.id and (x2.data_ora_infrazione at time zone 'Europe/Rome')::date between p_da and p_a) mu
      where not v.dismesso and (p_veicolo is null or v.id = p_veicolo)) t;

  elsif p_tipo = 'multe' then
    select coalesce(jsonb_agg(x order by x->>'data'), '[]') into r from (
      select jsonb_build_object('data', m.data_ora_infrazione, 'targa', v.targa, 'conducente', t.nome || ' ' || t.cognome, 'luogo', m.luogo, 'ente', m.ente,
        'verbale', m.numero_verbale, 'importo', m.importo, 'punti', case when m.decurtazione_punti then 'Sì' else 'No' end,
        'scadenza_comunicazione', m.scadenza_comunicazione,
        'stato', case m.stato when 'da_identificare' then 'Conducente da identificare' when 'da_comunicare' then 'Da comunicare' when 'comunicata' then 'Comunicata'
          when 'pagata' then 'Pagata' when 'contestata' then 'Contestata' else 'Chiusa' end) x
      from public.multe m join public.veicoli v on v.id = m.veicolo_id left join public.tecnici t on t.id = m.tecnico_id
      where (m.data_ora_infrazione at time zone 'Europe/Rome')::date between p_da and p_a
        and (p_veicolo is null or m.veicolo_id = p_veicolo) and (p_tecnico is null or m.tecnico_id = p_tecnico)) t;

  elsif p_tipo = 'avvisi' then
    select coalesce(jsonb_agg(x order by x->>'inviato'), '[]') into r from (
      select jsonb_build_object('inviato', n.creato_il, 'tecnico', t.nome || ' ' || t.cognome,
        'livello', case n.dati->>'livello' when 'urgente' then 'Urgente' when 'importante' then 'Importante' else 'Informazione' end,
        'titolo', n.dati->>'titolo', 'dove', n.dati->>'luogo', 'letto', n.letta_il,
        'minuti_lettura', case when n.letta_il is not null then round((extract(epoch from n.letta_il - n.creato_il) / 60)::numeric) end) x
      from public.notifiche n join public.tecnici t on t.id = n.tecnico_id
      where n.tipo = 'avviso' and (n.creato_il at time zone 'Europe/Rome')::date between p_da and p_a and (p_tecnico is null or n.tecnico_id = p_tecnico)) t;

  elsif p_tipo = 'assenze' then
    select coalesce(jsonb_agg(x order by x->>'dal'), '[]') into r from (
      select jsonb_build_object('tecnico', t.nome || ' ' || t.cognome, 'motivo', a.motivo, 'dal', a.dal, 'al', a.al,
        'giorni_lavorativi', (select count(*) from generate_series(greatest(a.dal, p_da), least(a.al, p_a), interval '1 day') g where extract(isodow from g) < 6)) x
      from public.assenze a join public.tecnici t on t.id = a.tecnico_id
      where a.dal <= p_a and a.al >= p_da and (p_tecnico is null or a.tecnico_id = p_tecnico)) t;

  elsif p_tipo = 'flotta' then
    select coalesce(jsonb_agg(x order by x->>'targa'), '[]') into r from (
      select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'tipo', v.tipo, 'proprieta', v.proprieta, 'km', v.km_attuali,
        'stato', case vv.stato when 'disponibile' then 'Disponibile' when 'in_uso' then 'In uso' when 'fermo' then 'Fermo' when 'non_utilizzabile' then 'Non utilizzabile' else coalesce(vv.stato, '') end,
        'in_carico', vv.in_carico_nome, 'assicurazione', v.scad_assicurazione, 'revisione', v.scad_revisione, 'bollo', v.scad_bollo,
        'prossimo_tagliando_km', v.km_prossimo_tagliando) x
      from public.veicoli v join public.v_veicoli vv on vv.id = v.id
      where not v.dismesso and (p_veicolo is null or v.id = p_veicolo)) t;

  elsif p_tipo = 'tecnici' then
    select coalesce(jsonb_agg(x order by x->>'tecnico'), '[]') into r from (
      select jsonb_build_object('tecnico', t.nome || ' ' || t.cognome, 'codice', t.codice, 'ruolo', t.ruolo, 'telefono', t.telefono, 'email', t.email,
        'patente', t.patente_categoria, 'scadenza_patente', t.patente_scadenza,
        'app', case when t.pin_hash is null then 'PIN da impostare' when t.bloccato_fino > now() then 'Bloccato' else 'Attivo' end,
        'veicolo_in_carico', (select string_agg(v.targa, ', ') from public.veicoli v where v.tecnico_in_carico = t.id)) x
      from public.tecnici t where t.attivo and (p_tecnico is null or t.id = p_tecnico)) t;

  else
    raise exception 'Tipo di report non valido';
  end if;
  return jsonb_build_object('righe', r, 'generato_il', now());
end $$;

revoke execute on function public.report_dati(text, date, date, bigint, bigint) from public, anon;
grant execute on function public.report_dati(text, date, date, bigint, bigint) to authenticated;
