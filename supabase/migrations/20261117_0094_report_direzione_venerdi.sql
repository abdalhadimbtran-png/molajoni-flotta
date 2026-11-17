-- Report Direzione: nuovo calendario (decisione di Hadi, 17/11/2026).
--   Settimanale: venerdì alle 16:00 (Roma), finestra lunedì 00:00 → venerdì 16:00 della settimana in corso;
--                se il venerdì è festivo si invia il giovedì (o l'ultimo giorno lavorativo precedente) alle 16:00.
--   Mensile:     ultimo giorno lavorativo del mese (lun–ven, non festivo, tabella public.festivita) alle 16:00,
--                finestra dal 1° del mese a quel momento.
--   Confronto: stessa finestra della settimana precedente / del mese precedente (stessa durata).
--   Download su richiesta: periodo in corso fino a «adesso».
-- Additiva: nuove funzioni; le vecchie firme diventano wrapper (nessun DROP). Idempotenza invariata (chiave del periodo).

create or replace function privato.report_lavorativo(d date) returns boolean
language sql stable set search_path = '' as $$
  select extract(isodow from d) between 1 and 5 and not exists (select 1 from public.festivita f where f.data = d and f.attiva);
$$;

create or replace function privato.report_periodo_finestra(p_tipo text, p_rif date, p_fino timestamptz default null) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  d0 date; inv date; ini timestamptz; fin_p timestamptz; fin timestamptz; pd0 date; pini timestamptz; pfin timestamptz; parz boolean;
  mesi text[] := array['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
  mb text[] := array['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
  gg text[] := array['lun','mar','mer','gio','ven','sab','dom'];
  fl timestamp; coda text; chiave text; file text; etich text; petich text;
begin
  if p_tipo = 'settimana' then
    d0 := date_trunc('week', p_rif)::date; inv := d0 + 4;
  elsif p_tipo = 'mese' then
    d0 := date_trunc('month', p_rif)::date; inv := (d0 + interval '1 month')::date - 1;
  else raise exception 'Periodo non valido'; end if;
  while inv > d0 and not privato.report_lavorativo(inv) loop inv := inv - 1; end loop;
  ini := d0::timestamp at time zone 'Europe/Rome';
  fin_p := (inv + time '16:00')::timestamp at time zone 'Europe/Rome';
  fin := least(fin_p, coalesce(p_fino, fin_p));
  if fin < ini then fin := ini; end if;
  parz := fin < fin_p;
  if p_tipo = 'settimana' then
    pini := (d0 - 7)::timestamp at time zone 'Europe/Rome'; pfin := ((fin at time zone 'Europe/Rome') - interval '7 days') at time zone 'Europe/Rome'; pd0 := d0 - 7;
  else
    pd0 := (d0 - interval '1 month')::date; pini := pd0::timestamp at time zone 'Europe/Rome';
    pfin := least((pd0::timestamp + ((fin at time zone 'Europe/Rome') - d0::timestamp)) at time zone 'Europe/Rome', ini);  -- stessa ora «da orologio» (ora legale)
  end if;
  fl := fin at time zone 'Europe/Rome';
  coda := case when parz then '(aggiornato a ' || gg[extract(isodow from fl)::int] || ' ' || extract(day from fl) || ' ' || mb[extract(month from fl)::int] || ', ' || to_char(fl, 'HH24:MI') || ')'
               else '(fino alle 16:00)' end;
  if p_tipo = 'settimana' then
    chiave := to_char(d0, 'IYYY-"W"IW');
    file := 'Report_Direzione_Settimana_' || chiave || '.pdf';
    etich := 'Settimana ' || to_char(d0, 'IW') || ' · lun ' || extract(day from d0) || ' – ' || gg[extract(isodow from inv)::int] || ' ' || extract(day from inv)
             || ' ' || mb[extract(month from inv)::int] || ' ' || extract(year from inv) || ' ' || coda;
    petich := 'Settimana ' || to_char(pd0, 'IW') || ' · stessa finestra (lun ' || extract(day from pd0) || ' ' || mb[extract(month from pd0)::int]
              || ' – ' || to_char(pfin at time zone 'Europe/Rome', 'DD/MM HH24:MI') || ')';
  else
    chiave := to_char(d0, 'YYYY-MM');
    file := 'Report_Direzione_' || mesi[extract(month from d0)::int] || '_' || extract(year from d0) || '.pdf';
    etich := mesi[extract(month from d0)::int] || ' ' || extract(year from d0) || ' · 1 – ' || gg[extract(isodow from inv)::int] || ' ' || extract(day from inv)
             || ' ' || mb[extract(month from inv)::int] || ' ' || coda;
    petich := mesi[extract(month from pd0)::int] || ' ' || extract(year from pd0) || ' · stessa finestra (1 – '
              || to_char(pfin at time zone 'Europe/Rome', 'DD/MM HH24:MI') || ')';
  end if;
  return jsonb_build_object('tipo', p_tipo, 'dal', d0, 'al', (fl)::date, 'invio', inv, 'ini', ini, 'fin', fin, 'parziale', parz,
    'chiave', chiave, 'etichetta', etich, 'file', file,
    'precedente', jsonb_build_object('tipo', p_tipo, 'dal', pd0, 'al', (pfin at time zone 'Europe/Rome')::date, 'ini', pini, 'fin', pfin, 'etichetta', petich,
                                     'chiave', '', 'file', ''));
end $$;

-- compatibilità: vecchia firma = finestra completa
create or replace function privato.report_periodo(p_tipo text, p_rif date) returns jsonb
language sql stable set search_path = '' as $$ select privato.report_periodo_finestra(p_tipo, p_rif, null); $$;

create or replace function privato.report_direzione_calcola(p_tipo text, p_rif date, p_fino timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare per jsonb := privato.report_periodo_finestra(p_tipo, p_rif, p_fino); s record; cur jsonb; old jsonb; k jsonb; ok jsonb;
  ini timestamptz := (per->>'ini')::timestamptz; fin timestamptz := (per->>'fin')::timestamptz;
  pini timestamptz := (per->'precedente'->>'ini')::timestamptz; pfin timestamptz := (per->'precedente'->>'fin')::timestamptz;
  sez jsonb := '[]'; kpi jsonb; v numeric; pv numeric;
begin
  for s in select * from public.report_sezioni where attiva order by ordine, codice loop
    begin
      execute format('select privato.%I($1, $2)', s.funzione) into cur using ini, fin;
      execute format('select privato.%I($1, $2)', s.funzione) into old using pini, pfin;
    exception when others then
      cur := jsonb_build_object('codice', s.codice, 'titolo', s.titolo, 'kpi', '[]'::jsonb, 'tabelle', '[]'::jsonb, 'serie', '[]'::jsonb,
               'attenzione', jsonb_build_array(jsonb_build_object('testo', 'Sezione ' || s.titolo || ' non disponibile: ' || sqlerrm, 'livello', 'medio')));
      old := null;
    end;
    kpi := '[]';
    for k in select * from jsonb_array_elements(coalesce(cur->'kpi', '[]')) loop
      ok := (select x from jsonb_array_elements(coalesce(old->'kpi', '[]')) x where x->>'label' = k->>'label' limit 1);
      v := (k->>'valore')::numeric; pv := (ok->>'valore')::numeric;
      k := k || jsonb_build_object('precedente', pv,
             'delta', case when coalesce((k->>'confronta')::boolean, true) and v is not null and pv is not null and pv <> 0
                           then round(100.0 * (v - pv) / abs(pv)) end);
      kpi := kpi || jsonb_build_array(k);
    end loop;
    sez := sez || jsonb_build_array(cur || jsonb_build_object('kpi', kpi, 'titolo', coalesce(cur->>'titolo', s.titolo)));
  end loop;
  return jsonb_build_object('periodo', per - 'precedente', 'precedente', per->'precedente', 'generato_il', now(), 'sezioni', sez);
end $$;
revoke all on function privato.report_direzione_calcola(text, date, timestamptz) from public, anon, authenticated;

create or replace function privato.report_direzione(p_tipo text, p_rif date) returns jsonb
language sql stable security definer set search_path = '' as $$ select privato.report_direzione_calcola(p_tipo, p_rif, null); $$;
revoke all on function privato.report_direzione(text, date) from public, anon, authenticated;

-- Download su richiesta: periodo in corso (o quello che contiene p_rif) fino ad adesso
create or replace function public.report_direzione_dati(p_tipo text, p_rif date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_direzione() then raise exception 'Permesso negato per questa operazione.'; end if;
  return privato.report_direzione_calcola(p_tipo, coalesce(p_rif, (now() at time zone 'Europe/Rome')::date), now());
end $$;

-- Avvio pianificato: ogni giorno feriale alle 14:00 e 15:00 UTC; parte solo se a Roma sono le 16 e oggi è il giorno d'invio
create or replace function privato.report_direzione_avvia(p_tipo text, p_forza boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r timestamp := now() at time zone 'Europe/Rome'; oggi date := (now() at time zone 'Europe/Rome')::date; u text;
begin
  if not p_forza then
    if extract(hour from r) <> 16 then return false; end if;
    if (privato.report_periodo_finestra(p_tipo, oggi)->>'invio')::date <> oggi then return false; end if;
  end if;
  select regexp_replace(valore, '/functions/v1/.*$', '/functions/v1') into u from public.config_privata where chiave = 'funzioni_url';
  if u is null then return false; end if;
  perform net.http_post(url := u || '/report-direzione',
    body := jsonb_build_object('azione', 'pianificato', 'tipo', p_tipo, 'rif', oggi),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-secret', privato.email_segreto()),
    timeout_milliseconds := 60000);
  return true;
end $$;
revoke all on function privato.report_direzione_avvia(text, boolean) from public, anon, authenticated;

-- cron.schedule con lo stesso nome aggiorna il job
select cron.schedule('report_direzione_settimana', '0 14,15 * * 1-5', $c$select privato.report_direzione_avvia('settimana')$c$);
select cron.schedule('report_direzione_mese', '2 14,15 * * 1-5', $c$select privato.report_direzione_avvia('mese')$c$);
