-- 0097 Report Direzione › Centralino adattato al centralino semplificato (0095):
-- contatti per tipo, offerte Jennifer / Tecnico Commerciale, % offerte inviate entro 60 min, «da seguire» aperte.
create or replace function privato.report_sez_centralino(p_ini timestamptz, p_fin timestamptz)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare
  tipi text[] := array['manutenzione','sopralluogo','offerta_piccola','offerta_grande','offerta_tablet','modifica','informazione'];
  semplici text[] := array['manutenzione','sopralluogo','modifica','informazione'];
  tot int; n_chiuse int; n_ann int; n_jen int; n_com int; n_jen_inv int; n_jen_60 int; n_com_inv int; n_seg int; n_seg24 int; n_off_rit int;
  per_tipo jsonb; per_canale jsonb; serie jsonb; lista jsonb; passate jsonb;
  oggi date := (now() at time zone 'Europe/Rome')::date;
  g_ini date := (p_ini at time zone 'Europe/Rome')::date;
  g_fin date := least(((p_fin - interval '1 second') at time zone 'Europe/Rome')::date, oggi);
  rif timestamptz := least(p_fin, now());
  att jsonb := '[]';
begin
  select count(*) into tot from public.pratiche where tipo = any(tipi) and created_at >= p_ini and created_at < p_fin;

  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_tipo
  from (values (1,'Intervento',array['manutenzione']), (2,'Sopralluogo',array['sopralluogo']),
               (3,'Offerta',array['offerta_piccola','offerta_grande','offerta_tablet']),
               (4,'Modifiche / Disdetta',array['modifica']), (5,'Informazione',array['informazione'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(g.t) and p.created_at >= p_ini and p.created_at < p_fin) c on true;

  select count(*) filter (where esito in ('chiusa_ok','chiusa_ko')), count(*) filter (where esito = 'annullata')
    into n_chiuse, n_ann from public.pratiche where tipo = any(tipi) and closed_at >= p_ini and closed_at < p_fin;

  -- offerte richieste nel periodo
  select count(*) filter (where tipo in ('offerta_piccola','offerta_tablet')), count(*) filter (where tipo = 'offerta_grande'),
         count(*) filter (where tipo = 'offerta_piccola' and esito = 'chiusa_ok'),
         count(*) filter (where tipo = 'offerta_piccola' and esito = 'chiusa_ok' and closed_at <= created_at + interval '60 minutes'),
         count(*) filter (where tipo = 'offerta_grande' and esito = 'chiusa_ok')
    into n_jen, n_com, n_jen_inv, n_jen_60, n_com_inv
    from public.pratiche where created_at >= p_ini and created_at < p_fin;

  -- «da seguire» aperte a fine periodo (tipi senza email)
  select count(*), count(*) filter (where created_at < rif - interval '24 hours') into n_seg, n_seg24 from public.pratiche
   where tipo = any(semplici) and created_at < p_fin and (closed_at is null or closed_at >= p_fin) and esito <> 'annullata';
  select count(*) into n_off_rit from public.pratiche
   where tipo like 'offerta%' and esito = 'aperta' and sla_scadenza < rif and created_at < p_fin;

  select coalesce(jsonb_agg(jsonb_build_array(d, n) order by n desc, d), '[]') into passate from (
    select coalesce(nullif(assegnato_nome, ''), 'Nessuno') d, count(*) n from public.pratiche
     where tipo = any(semplici) and created_at >= p_ini and created_at < p_fin group by 1 order by 2 desc limit 8) x;

  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_canale
  from (values (1,'Telefono',array['telefono']), (2,'WhatsApp',array['whatsapp']), (3,'Email',array['email']),
               (4,'Tablet TMQ',array['tablet_tmq']), (5,'Altro',array['collega','altro'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi) and p.canale = any(g.t)
                      and p.created_at >= p_ini and p.created_at < p_fin) c on true;

  select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d, 'DD/MM'), 'valore', coalesce(c.n, 0)) order by d), '[]') into serie
  from generate_series(g_ini, greatest(g_ini, g_fin), interval '1 day') d
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi)
                      and (p.created_at at time zone 'Europe/Rome')::date = d::date) c on true;

  select coalesce(jsonb_agg(r order by o, n), '[]') into lista from (
    select * from (
      select 1 o, p.numero n, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Offerta in ritardo',
               'Scaduta il ' || to_char(p.sla_scadenza at time zone 'Europe/Rome', 'DD/MM HH24:MI')) r
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo like 'offerta%' and p.esito = 'aperta' and p.sla_scadenza < rif and p.created_at < p_fin
      union all
      select 2, p.numero, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Da seguire',
               'Dal ' || to_char(p.created_at at time zone 'Europe/Rome', 'DD/MM HH24:MI') || coalesce(' · ' || p.assegnato_nome, ''))
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo = any(semplici) and p.esito = 'aperta' and p.created_at < rif - interval '24 hours'
      union all
      select 3, p.numero, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Annullata',
               coalesce(left((select ev.testo from public.pratiche_eventi ev where ev.pratica_id = p.id and ev.tipo in ('chiusa','stato')
                                and ev.testo is not null order by ev.at desc limit 1), 120), '—'))
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo = any(tipi) and p.esito = 'annullata' and p.closed_at >= p_ini and p.closed_at < p_fin
    ) u order by o, n limit 15) x;

  if n_off_rit > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_off_rit || ' offerte in ritardo', 'livello', 'alto')); end if;
  if n_seg24 > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_seg24 || ' pratiche da seguire aperte da più di 24 ore', 'livello', 'medio')); end if;
  if n_ann > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_ann || ' pratiche annullate nel periodo', 'livello', 'medio')); end if;

  return jsonb_build_object('codice', 'centralino', 'titolo', 'Centralino',
    'kpi', jsonb_build_array(
      jsonb_build_object('label', 'Contatti ricevuti', 'valore', tot),
      jsonb_build_object('label', 'Offerte gestite da Jennifer', 'valore', n_jen),
      jsonb_build_object('label', 'Offerte inviate entro 60 min', 'valore', case when n_jen_inv = 0 then null else round(100.0 * n_jen_60 / n_jen_inv) end, 'unita', '%'),
      jsonb_build_object('label', 'Offerte al Tecnico Commerciale', 'valore', n_com),
      jsonb_build_object('label', 'Pratiche chiuse', 'valore', n_chiuse),
      jsonb_build_object('label', 'Da seguire aperte', 'valore', n_seg, 'confronta', false),
      jsonb_build_object('label', 'Annullate', 'valore', n_ann)),
    'tabelle', jsonb_build_array(
      jsonb_build_object('titolo', 'Contatti per tipo', 'colonne', jsonb_build_array('Tipo', 'N.'), 'righe', per_tipo),
      jsonb_build_object('titolo', 'Contatti per canale', 'colonne', jsonb_build_array('Canale', 'N.'), 'righe', per_canale),
      jsonb_build_object('titolo', 'Offerte', 'colonne', jsonb_build_array('Gestione', 'N.'), 'righe', jsonb_build_array(
        jsonb_build_array('Gestite da Jennifer', n_jen), jsonb_build_array('Inviate', n_jen_inv), jsonb_build_array('Inviate entro 60 min', n_jen_60),
        jsonb_build_array('Passate al Tecnico Commerciale', n_com), jsonb_build_array('Commerciale avvisato', n_com_inv))),
      jsonb_build_object('titolo', 'Altre richieste passate a', 'colonne', jsonb_build_array('Responsabile', 'N.'), 'righe', passate),
      jsonb_build_object('titolo', 'Offerte in ritardo, da seguire da più di 24 ore, annullate', 'larga', true,
        'colonne', jsonb_build_array('Numero', 'Cliente', 'Tipo', 'Stato', 'Dettaglio'), 'righe', lista)),
    'serie', jsonb_build_array(jsonb_build_object('titolo', 'Contatti al giorno', 'punti', serie)),
    'attenzione', att);
end $function$;
revoke all on function privato.report_sez_centralino(timestamptz, timestamptz) from public, anon, authenticated;
