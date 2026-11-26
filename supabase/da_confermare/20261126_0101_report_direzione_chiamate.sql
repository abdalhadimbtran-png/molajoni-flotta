-- 0101 Report Direzione › Centralino: apre con «Chiamate e richieste del periodo» (ricevute, completate, ancora aperte, passate a un collega;
-- per tipo, per canale, per giorno lun–ven), poi le OFFERTE (come 0100). Solo CREATE OR REPLACE, sola lettura.
-- Forma estesa (render.ts la legge, le vecchie chiavi restano): kpi[].def/hero/sotto/blocco, blocchi[], barre[], tabelle[].blocco.
-- Ogni numero porta la sua definizione (kpi[].def): la tabella «Cosa significano i numeri» non serve più.
-- Stesse parole di src/lib/centralino/testiDirezione.ts (REPORT_CHIAMATE, KPI_OFFERTE).
create or replace function privato.report_sez_centralino(p_ini timestamptz, p_fin timestamptz)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  tipi text[] := array['manutenzione','sopralluogo','offerta_piccola','offerta_grande','offerta_tablet','modifica','informazione'];
  rif timestamptz := least(p_fin, now());
  oggi date := (now() at time zone 'Europe/Rome')::date;
  g_ini date := (p_ini at time zone 'Europe/Rome')::date;
  g_fin date := least(((p_fin - interval '1 second') at time zone 'Europe/Rome')::date, oggi);
  n_arr int; n_tempo int; n_rit int; n_da int; n_da_scad int; n_inv int; n_acc int; n_non int; n_ann int; n_jen int; n_col int;
  tot int; n_chiuse int; n_comp int; n_aperte int; n_coll int; n_altre int;
  b_tipo jsonb; b_canale jsonb; b_giorni jsonb;
  per_persona jsonb; motivi jsonb; ritardi jsonb; non_acc jsonb; per_canale_off jsonb; serie jsonb; da_fare jsonb;
  att jsonb := '[]';
begin

  select count(*), count(*) filter (where in_tempo), count(*) filter (where in_rit),
         count(*) filter (where inviata_il is null and esito = 'da_inviare'),
         count(*) filter (where inviata_il is null and esito = 'da_inviare' and scadenza < rif),
         count(*) filter (where inviata_il is not null),
         count(*) filter (where esito = 'accettata'), count(*) filter (where esito = 'non_accettata'), count(*) filter (where esito = 'annullata'),
         count(*) filter (where gestione = 'jennifer'), count(*) filter (where gestione = 'collega')
    into n_arr, n_tempo, n_rit, n_da, n_da_scad, n_inv, n_acc, n_non, n_ann, n_jen, n_col from privato.offerte_periodo(p_ini, p_fin) _off;

  select coalesce(jsonb_agg(jsonb_build_array(gestita_da, n, coalesce(t || ' (' || round(100.0 * t / n) || '%)', '0'),
           case when inv = 0 then '—' else acc || ' (' || round(100.0 * acc / inv) || '%)' end,
           case when med is null then '—' when med < 3600 then round(med / 60) || ' min' when med < 86400 then round(med / 3600.0, 1) || ' ore'
                else round(med / 86400.0, 1) || ' giorni' end) order by n desc), '[]') into per_persona
  from (select gestita_da, count(*) n, count(*) filter (where in_tempo) t, count(*) filter (where inviata_il is not null) inv,
               count(*) filter (where esito = 'accettata') acc, avg(extract(epoch from inviata_il - arrivata_il)) med
          from privato.offerte_periodo(p_ini, p_fin) _off group by 1) x;

  select coalesce(jsonb_agg(jsonb_build_array(motivo, n) order by n desc), '[]') into motivi
    from (select motivo, count(*) n from privato.offerte_periodo(p_ini, p_fin) _off where esito = 'non_accettata' group by 1) x;
  select coalesce(jsonb_agg(jsonb_build_array(m, n) order by n desc), '[]') into ritardi
    from (select coalesce(motivo_ritardo, 'Motivo non scritto') m, count(*) n from privato.offerte_periodo(p_ini, p_fin) _off where in_rit group by 1 order by 2 desc limit 10) x;
  select coalesce(jsonb_agg(jsonb_build_array(c, n) order by n desc), '[]') into per_canale_off
    from (select case canale when 'telefono' then 'Telefono' when 'whatsapp' then 'WhatsApp' when 'email' then 'Email' when 'tablet_tmq' then 'Tablet del tecnico' else 'Altro' end c, count(*) n from privato.offerte_periodo(p_ini, p_fin) _off group by 1) x;
  select coalesce(jsonb_agg(r order by a), '[]') into non_acc from (
    select arrivata_il a, jsonb_build_array(coalesce(cliente_nome, '—'), gestita_da, to_char(arrivata_il at time zone 'Europe/Rome', 'DD/MM'),
           motivo || coalesce(' – ' || left(motivo_nota, 80), '')) r
      from privato.offerte_periodo(p_ini, p_fin) _off where esito = 'non_accettata' order by arrivata_il limit 30) x;
  select coalesce(jsonb_agg(r order by s), '[]') into da_fare from (
    select scadenza s, jsonb_build_array(coalesce(cliente_nome, '—'), gestita_da, to_char(arrivata_il at time zone 'Europe/Rome', 'DD/MM HH24:MI'),
           to_char(scadenza at time zone 'Europe/Rome', 'DD/MM HH24:MI'), case when scadenza < rif then 'In ritardo' else 'Da inviare' end) r
      from privato.offerte_periodo(p_ini, p_fin) _off where inviata_il is null and esito = 'da_inviare' order by scadenza limit 20) x;

  -- chiamate e richieste
  select count(*) into tot from public.pratiche where tipo = any(tipi) and created_at >= p_ini and created_at < p_fin;
  -- Richieste chiuse: pratiche di tutti i tipi chiuse con esito positivo nel periodo (data di chiusura)
  select count(*) into n_chiuse from public.pratiche where tipo = any(tipi) and esito = 'chiusa_ok' and closed_at >= p_ini and closed_at < p_fin;
  -- Blocco chiamate: tutte le richieste RICEVUTE nel periodo (created_at), con lo stato di adesso
  select count(*) filter (where esito = 'chiusa_ok'),
         count(*) filter (where esito is null or esito = 'aperta'),
         count(*) filter (where coalesce(assegnato_nome, '') <> '' or stato_corrente like 'passat%'),
         count(*) filter (where esito in ('chiusa_ko', 'annullata'))
    into n_comp, n_aperte, n_coll, n_altre
    from public.pratiche where tipo = any(tipi) and created_at >= p_ini and created_at < p_fin;
  select jsonb_agg(jsonb_build_object('label', g.nome, 'valori', jsonb_build_array(coalesce(c.n, 0), coalesce(c.ok, 0))) order by g.o)
    into b_tipo
  from (values (1,'Intervento tecnico',array['manutenzione']), (2,'Sopralluogo',array['sopralluogo']),
               (3,'Offerta',array['offerta_piccola','offerta_grande','offerta_tablet']),
               (4,'Modifica dati o disdetta',array['modifica']), (5,'Informazione',array['informazione'])) g(o, nome, t)
  left join lateral (select count(*) n, count(*) filter (where p.esito = 'chiusa_ok') ok
                       from public.pratiche p where p.tipo = any(g.t) and p.created_at >= p_ini and p.created_at < p_fin) c on true;
  select jsonb_agg(jsonb_build_object('label', g.nome, 'valori', jsonb_build_array(coalesce(c.n, 0), coalesce(c.ok, 0))) order by g.o) into b_canale
  from (values (1,'Telefono',array['telefono']), (2,'WhatsApp',array['whatsapp']), (3,'Email',array['email']),
               (4,'Tablet del tecnico',array['tablet_tmq']), (5,'Altro',array['collega','altro'])) g(o, nome, t)
  left join lateral (select count(*) n, count(*) filter (where p.esito = 'chiusa_ok') ok from public.pratiche p
                      where p.tipo = any(tipi) and p.canale = any(g.t) and p.created_at >= p_ini and p.created_at < p_fin) c on true;
  -- Per giorno lun–ven: settimana = un giorno per barra; mese = somma per giorno della settimana
  if p_fin - p_ini <= interval '7 days 1 hour' then
    select coalesce(jsonb_agg(jsonb_build_object('label', (array['Lun','Mar','Mer','Gio','Ven'])[extract(isodow from d)::int] || ' ' || to_char(d, 'DD/MM'),
             'valori', jsonb_build_array(coalesce(c.n, 0))) order by d), '[]') into b_giorni
    from generate_series(g_ini, greatest(g_ini, g_fin), interval '1 day') d
    left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi) and (p.created_at at time zone 'Europe/Rome')::date = d::date) c on true
    where extract(isodow from d) <= 5;
  else
    select jsonb_agg(jsonb_build_object('label', g.nome, 'valori', jsonb_build_array(coalesce(c.n, 0))) order by g.o) into b_giorni
    from (values (1,'Lunedì'),(2,'Martedì'),(3,'Mercoledì'),(4,'Giovedì'),(5,'Venerdì')) g(o, nome)
    left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi) and p.created_at >= p_ini and p.created_at < p_fin
                        and extract(isodow from p.created_at at time zone 'Europe/Rome') = g.o) c on true;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d, 'DD/MM'), 'valore', coalesce(c.n, 0)) order by d), '[]') into serie
  from generate_series(g_ini, greatest(g_ini, g_fin), interval '1 day') d
  left join lateral (select count(*) n from public.pratiche_offerta o where (o.arrivata_il at time zone 'Europe/Rome')::date = d::date) c on true;

  if tot > 0 and n_aperte > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_aperte || ' richieste del periodo ancora aperte (da seguire o in corso)', 'livello', case when n_aperte * 3 > tot then 'alto' else 'medio' end)); end if;
  if n_da_scad > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_da_scad || ' offerte non inviate e oltre la scadenza', 'livello', 'alto')); end if;
  if n_rit > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_rit || ' offerte inviate in ritardo', 'livello', 'medio')); end if;
  if n_non > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_non || ' offerte non accettate: vedi elenco con il motivo', 'livello', 'medio')); end if;

  return jsonb_build_object('codice', 'centralino', 'titolo', 'Centralino e offerte',
    'blocchi', jsonb_build_array(
      jsonb_build_object('codice', 'chiamate', 'titolo', 'Chiamate e richieste del periodo', 'nota', 'Richieste ricevute nel periodo e il loro stato adesso.'),
      jsonb_build_object('codice', 'offerte', 'titolo', 'Offerte', 'nota', 'Offerte arrivate nel periodo: invio, tempi e risposta del cliente.')),
    'kpi', jsonb_build_array(
      jsonb_build_object('label', 'Richieste ricevute', 'valore', tot, 'meglio', 'neutro', 'hero', true, 'blocco', 'chiamate',
        'def', 'Chiamate, email e messaggi registrati al centralino nel periodo.'),
      jsonb_build_object('label', 'Completate', 'valore', case when tot = 0 then null else round(100.0 * n_comp / tot) end, 'unita', '%', 'hero', true, 'blocco', 'chiamate',
        'sotto', n_comp || ' su ' || tot, 'def', 'Richieste ricevute nel periodo e già completate (lavoro fatto). % sulle richieste ricevute.'),
      jsonb_build_object('label', 'Offerte inviate in tempo', 'valore', case when n_arr = 0 then null else round(100.0 * n_tempo / n_arr) end, 'unita', '%', 'hero', true, 'blocco', 'offerte',
        'sotto', n_tempo || ' su ' || n_arr, 'def', 'Inviate entro la scadenza: 60 minuti per Jennifer, 2 giorni lavorativi per i colleghi. % sulle offerte arrivate.'),
      jsonb_build_object('label', 'Offerte accettate', 'valore', case when n_inv = 0 then null else round(100.0 * n_acc / n_inv) end, 'unita', '%', 'hero', true, 'blocco', 'offerte',
        'sotto', n_acc || ' su ' || n_inv || ' inviate', 'def', 'Accettate dal cliente. % sulle offerte inviate.'),
      jsonb_build_object('label', 'Completate (numero)', 'valore', n_comp, 'blocco', 'chiamate',
        'def', 'Richieste ricevute nel periodo e già completate (lavoro fatto). % sulle richieste ricevute.'),
      jsonb_build_object('label', 'Ancora aperte', 'valore', n_aperte, 'meglio', 'giu', 'blocco', 'chiamate', 'sotto', coalesce(case when tot = 0 then null else round(100.0 * n_aperte / tot) end || '% delle ricevute', ''),
        'def', 'Richieste ricevute nel periodo ancora da seguire o in corso.'),
      jsonb_build_object('label', 'Passate a un collega', 'valore', n_coll, 'meglio', 'neutro', 'blocco', 'chiamate', 'sotto', coalesce(case when tot = 0 then null else round(100.0 * n_coll / tot) end || '% delle ricevute', ''),
        'def', 'Richieste ricevute nel periodo e affidate a un collega o a un responsabile.'),
      jsonb_build_object('label', 'Richieste chiuse', 'valore', n_chiuse, 'blocco', 'chiamate',
        'def', 'Richieste completate e chiuse nel periodo.'),
      jsonb_build_object('label', 'Offerte arrivate', 'valore', n_arr, 'blocco', 'offerte',
        'def', 'Richieste di offerta arrivate nel periodo (telefono, email, WhatsApp…).'),
      jsonb_build_object('label', 'Inviate in ritardo', 'valore', n_rit, 'meglio', 'giu', 'blocco', 'offerte', 'def', 'Inviate dopo la scadenza. % sulle offerte arrivate.'),
      jsonb_build_object('label', 'Ancora da inviare', 'valore', n_da, 'meglio', 'giu', 'confronta', false, 'blocco', 'offerte', 'def', 'Non ancora inviate al cliente. % sulle offerte arrivate.'),
      jsonb_build_object('label', 'Non accettate', 'valore', n_non, 'meglio', 'giu', 'blocco', 'offerte', 'def', 'Non accettate dal cliente. % sulle offerte inviate.')),
    'barre', jsonb_build_array(
      jsonb_build_object('titolo', 'Per tipo di richiesta', 'blocco', 'chiamate', 'orientamento', 'h', 'serie', jsonb_build_array('Ricevute', 'Completate'), 'voci', b_tipo),
      jsonb_build_object('titolo', 'Come è arrivata la richiesta', 'blocco', 'chiamate', 'orientamento', 'h', 'serie', jsonb_build_array('Ricevute', 'Completate'), 'voci', b_canale),
      jsonb_build_object('titolo', 'Richieste per giorno (lun–ven)', 'blocco', 'chiamate', 'orientamento', 'v', 'serie', jsonb_build_array('Ricevute'), 'voci', b_giorni)),
    'tabelle', jsonb_build_array(
      jsonb_build_object('titolo', 'Offerte: numeri del periodo', 'blocco', 'offerte', 'colonne', jsonb_build_array('Voce', 'N.', '%'), 'righe', jsonb_build_array(
        jsonb_build_array('Offerte arrivate', n_arr, ''),
        jsonb_build_array('Inviate in tempo', n_tempo, case when n_arr = 0 then '—' else round(100.0 * n_tempo / n_arr) || '%' end),
        jsonb_build_array('Inviate in ritardo', n_rit, case when n_arr = 0 then '—' else round(100.0 * n_rit / n_arr) || '%' end),
        jsonb_build_array('Ancora da inviare', n_da, case when n_arr = 0 then '—' else round(100.0 * n_da / n_arr) || '%' end),
        jsonb_build_array('Accettate', n_acc, case when n_inv = 0 then '—' else round(100.0 * n_acc / n_inv) || '%' end),
        jsonb_build_array('Non accettate', n_non, case when n_inv = 0 then '—' else round(100.0 * n_non / n_inv) || '%' end),
        jsonb_build_array('Annullate', n_ann, ''),
        jsonb_build_array('Gestite da Jennifer', n_jen, ''),
        jsonb_build_array('Gestite dai colleghi', n_col, ''))),
      jsonb_build_object('titolo', 'Cosa chiede il cliente (tipi di richiesta)', 'blocco', 'legenda', 'larga', true, 'colonne', jsonb_build_array('Tipo', 'Significato'), 'righe', jsonb_build_array(
        jsonb_build_array('Intervento tecnico', 'Il cliente chiede un tecnico: guasto, allarme o manutenzione da fare.'),
        jsonb_build_array('Sopralluogo', 'Visita per valutare un lavoro prima dell''offerta.'),
        jsonb_build_array('Offerta', 'Il cliente chiede un preventivo: offerta fatta da Jennifer, passata a un collega o da tablet del tecnico.'),
        jsonb_build_array('Modifica dati o disdetta', 'Cambio dati del cliente, del calendario o disdetta del contratto.'),
        jsonb_build_array('Informazione', 'Il cliente chiede solo un''informazione.'))),
      jsonb_build_object('titolo', 'Offerte per persona', 'blocco', 'offerte', 'larga', true,
        'colonne', jsonb_build_array('Persona', 'Arrivate', 'Inviate in tempo', 'Accettate', 'Tempo medio di invio'), 'righe', per_persona),
      jsonb_build_object('titolo', 'Perché non accettate', 'blocco', 'offerte', 'colonne', jsonb_build_array('Motivo', 'N.'), 'righe', motivi),
      jsonb_build_object('titolo', 'Perché in ritardo', 'blocco', 'offerte', 'colonne', jsonb_build_array('Motivo', 'N.'), 'righe', ritardi),
      jsonb_build_object('titolo', 'Offerte non accettate', 'blocco', 'offerte', 'larga', true,
        'colonne', jsonb_build_array('Cliente', 'Gestita da', 'Arrivata il', 'Motivo'), 'righe', non_acc),
      jsonb_build_object('titolo', 'Offerte ancora da inviare', 'blocco', 'offerte', 'larga', true,
        'colonne', jsonb_build_array('Cliente', 'Gestita da', 'Arrivata il', 'Scadenza invio', 'Stato'), 'righe', da_fare),
      jsonb_build_object('titolo', 'Da dove arrivano le offerte', 'blocco', 'offerte', 'colonne', jsonb_build_array('Canale', 'N.'), 'righe', per_canale_off)),
    'serie', jsonb_build_array(jsonb_build_object('titolo', 'Offerte arrivate al giorno', 'punti', serie)),
    'attenzione', att);
end $function$;
revoke all on function privato.report_sez_centralino(timestamptz, timestamptz) from public, anon, authenticated;
