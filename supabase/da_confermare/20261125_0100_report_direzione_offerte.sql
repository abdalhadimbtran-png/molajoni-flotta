-- 0100 Report Direzione › Centralino: apre con le OFFERTE (stesse parole della pagina Direzione, src/lib/centralino/testiDirezione.ts).
-- KPI offerte · per persona · motivi · offerte non accettate (per il controllo qualità) · poi chiamate e richieste.
create or replace function privato.offerte_periodo(p_ini timestamptz, p_fin timestamptz)
 returns table (pratica_id bigint, gestione text, gestita_da text, arrivata_il timestamptz, scadenza timestamptz, inviata_il timestamptz,
   esito text, motivo text, motivo_nota text, motivo_ritardo text, cliente_nome text, canale text, in_tempo boolean, in_rit boolean)
 language sql stable security definer set search_path to ''
as $f$
  select o.pratica_id, o.gestione, o.gestita_da, o.arrivata_il, o.scadenza, o.inviata_il, o.esito, o.motivo, o.motivo_nota, o.motivo_ritardo,
         p.cliente_nome, p.canale, (o.inviata_il is not null and o.inviata_il <= o.scadenza), (o.inviata_il is not null and o.inviata_il > o.scadenza)
    from public.pratiche_offerta o join public.pratiche p on p.id = o.pratica_id
   where o.arrivata_il >= p_ini and o.arrivata_il < p_fin;
$f$;
revoke all on function privato.offerte_periodo(timestamptz, timestamptz) from public, anon, authenticated;

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
  tot int; n_reg int;
  per_persona jsonb; motivi jsonb; ritardi jsonb; non_acc jsonb; per_canale_off jsonb; per_tipo jsonb; per_canale jsonb; serie jsonb; da_fare jsonb;
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
  select count(*), count(*) filter (where registrata_dopo) into tot, n_reg from public.pratiche where tipo = any(tipi) and created_at >= p_ini and created_at < p_fin;
  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_tipo
  from (values (1,'Intervento tecnico',array['manutenzione']), (2,'Sopralluogo',array['sopralluogo']),
               (3,'Offerta',array['offerta_piccola','offerta_grande','offerta_tablet']),
               (4,'Modifica dati o disdetta',array['modifica']), (5,'Informazione',array['informazione'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(g.t) and p.created_at >= p_ini and p.created_at < p_fin) c on true;
  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_canale
  from (values (1,'Telefono',array['telefono']), (2,'WhatsApp',array['whatsapp']), (3,'Email',array['email']),
               (4,'Tablet del tecnico',array['tablet_tmq']), (5,'Altro',array['collega','altro'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi) and p.canale = any(g.t)
                      and p.created_at >= p_ini and p.created_at < p_fin) c on true;
  select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d, 'DD/MM'), 'valore', coalesce(c.n, 0)) order by d), '[]') into serie
  from generate_series(g_ini, greatest(g_ini, g_fin), interval '1 day') d
  left join lateral (select count(*) n from public.pratiche_offerta o where (o.arrivata_il at time zone 'Europe/Rome')::date = d::date) c on true;

  if n_da_scad > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_da_scad || ' offerte non inviate e oltre la scadenza', 'livello', 'alto')); end if;
  if n_rit > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_rit || ' offerte inviate in ritardo', 'livello', 'medio')); end if;
  if n_non > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_non || ' offerte non accettate: vedi elenco con il motivo', 'livello', 'medio')); end if;

  return jsonb_build_object('codice', 'centralino', 'titolo', 'Centralino e offerte',
    'kpi', jsonb_build_array(
      jsonb_build_object('label', 'Offerte arrivate', 'valore', n_arr),
      jsonb_build_object('label', 'Inviate in tempo', 'valore', case when n_arr = 0 then null else round(100.0 * n_tempo / n_arr) end, 'unita', '%'),
      jsonb_build_object('label', 'Inviate in ritardo', 'valore', n_rit),
      jsonb_build_object('label', 'Ancora da inviare', 'valore', n_da, 'confronta', false),
      jsonb_build_object('label', 'Accettate', 'valore', n_acc),
      jsonb_build_object('label', 'Non accettate', 'valore', n_non),
      jsonb_build_object('label', 'Richieste ricevute', 'valore', tot),
      jsonb_build_object('label', 'Chiamate registrate dopo', 'valore', n_reg)),
    'tabelle', jsonb_build_array(
      jsonb_build_object('titolo', 'Offerte: numeri del periodo', 'colonne', jsonb_build_array('Voce', 'N.', '%'), 'righe', jsonb_build_array(
        jsonb_build_array('Offerte arrivate', n_arr, ''),
        jsonb_build_array('Inviate in tempo', n_tempo, case when n_arr = 0 then '—' else round(100.0 * n_tempo / n_arr) || '%' end),
        jsonb_build_array('Inviate in ritardo', n_rit, case when n_arr = 0 then '—' else round(100.0 * n_rit / n_arr) || '%' end),
        jsonb_build_array('Ancora da inviare', n_da, case when n_arr = 0 then '—' else round(100.0 * n_da / n_arr) || '%' end),
        jsonb_build_array('Accettate', n_acc, case when n_inv = 0 then '—' else round(100.0 * n_acc / n_inv) || '%' end),
        jsonb_build_array('Non accettate', n_non, case when n_inv = 0 then '—' else round(100.0 * n_non / n_inv) || '%' end),
        jsonb_build_array('Annullate', n_ann, ''),
        jsonb_build_array('Gestite da Jennifer', n_jen, ''),
        jsonb_build_array('Gestite dai colleghi', n_col, ''))),
      jsonb_build_object('titolo', 'Cosa significano i numeri', 'larga', true, 'colonne', jsonb_build_array('Voce', 'Significato'), 'righe', jsonb_build_array(
        jsonb_build_array('Offerte arrivate', 'Richieste di offerta arrivate nel periodo (telefono, email, WhatsApp…).'),
        jsonb_build_array('Inviate in tempo', 'Inviate entro la scadenza: 60 minuti per Jennifer, 2 giorni lavorativi per i colleghi. % sulle offerte arrivate.'),
        jsonb_build_array('Inviate in ritardo', 'Inviate dopo la scadenza. % sulle offerte arrivate.'),
        jsonb_build_array('Ancora da inviare', 'Non ancora inviate al cliente. % sulle offerte arrivate.'),
        jsonb_build_array('Accettate', 'Accettate dal cliente. % sulle offerte inviate.'),
        jsonb_build_array('Non accettate', 'Non accettate dal cliente. % sulle offerte inviate.'),
        jsonb_build_array('Richieste ricevute', 'Chiamate, email e messaggi registrati al centralino nel periodo.'),
        jsonb_build_array('Chiamate registrate dopo', 'Chiamate inserite più tardi, non durante la telefonata.'))),
      jsonb_build_object('titolo', 'Cosa chiede il cliente (tipi di richiesta)', 'larga', true, 'colonne', jsonb_build_array('Tipo', 'Significato'), 'righe', jsonb_build_array(
        jsonb_build_array('Intervento tecnico', 'Il cliente chiede un tecnico: guasto, allarme o manutenzione da fare.'),
        jsonb_build_array('Sopralluogo', 'Visita per valutare un lavoro prima dell''offerta.'),
        jsonb_build_array('Offerta', 'Il cliente chiede un preventivo: offerta fatta da Jennifer, passata a un collega o da tablet del tecnico.'),
        jsonb_build_array('Modifica dati o disdetta', 'Cambio dati del cliente, del calendario o disdetta del contratto.'),
        jsonb_build_array('Informazione', 'Il cliente chiede solo un''informazione.'))),
      jsonb_build_object('titolo', 'Offerte per persona', 'larga', true,
        'colonne', jsonb_build_array('Persona', 'Arrivate', 'Inviate in tempo', 'Accettate', 'Tempo medio di invio'), 'righe', per_persona),
      jsonb_build_object('titolo', 'Perché non accettate', 'colonne', jsonb_build_array('Motivo', 'N.'), 'righe', motivi),
      jsonb_build_object('titolo', 'Perché in ritardo', 'colonne', jsonb_build_array('Motivo', 'N.'), 'righe', ritardi),
      jsonb_build_object('titolo', 'Offerte non accettate', 'larga', true,
        'colonne', jsonb_build_array('Cliente', 'Gestita da', 'Arrivata il', 'Motivo'), 'righe', non_acc),
      jsonb_build_object('titolo', 'Offerte ancora da inviare', 'larga', true,
        'colonne', jsonb_build_array('Cliente', 'Gestita da', 'Arrivata il', 'Scadenza invio', 'Stato'), 'righe', da_fare),
      jsonb_build_object('titolo', 'Da dove arrivano le offerte', 'colonne', jsonb_build_array('Canale', 'N.'), 'righe', per_canale_off),
      jsonb_build_object('titolo', 'Cosa ha chiesto il cliente', 'colonne', jsonb_build_array('Tipo', 'N.'), 'righe', per_tipo),
      jsonb_build_object('titolo', 'Come è arrivata la richiesta', 'colonne', jsonb_build_array('Canale', 'N.'), 'righe', per_canale)),
    'serie', jsonb_build_array(jsonb_build_object('titolo', 'Offerte arrivate al giorno', 'punti', serie)),
    'attenzione', att);
end $function$;
revoke all on function privato.report_sez_centralino(timestamptz, timestamptz) from public, anon, authenticated;
