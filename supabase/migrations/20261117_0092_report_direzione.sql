-- Report Direzione settimanale e mensile (email HTML + PDF), sostituisce il riepilogo giornaliero delle 18:00.
-- Modulare: una funzione per sezione (privato.report_sez_<codice>(ini, fin) → jsonb a forma standard),
-- registro public.report_sezioni, aggregatore privato.report_direzione(tipo, rif).
-- Forma standard di una sezione:
--   {codice, titolo, kpi:[{label,valore,unita,confronta}], tabelle:[{titolo,colonne:[],righe:[[]]}],
--    serie:[{titolo,punti:[{label,valore}]}], attenzione:[{testo,livello}]}
-- Il delta % rispetto al periodo precedente lo calcola l'aggregatore (stessa label), non la sezione.
-- Additiva: nuova tabella, nuove colonne, nuove funzioni; il vecchio digest diventa no-op e il suo job viene tolto.

create table if not exists public.report_sezioni (
  codice text primary key,
  titolo text not null,
  ordine int not null default 100,
  attiva boolean not null default true,
  funzione text not null  -- nome in schema privato, firma (timestamptz, timestamptz) returns jsonb
);
alter table public.report_sezioni enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'report_sezioni' and policyname = 'report_sez_legge') then
    create policy report_sez_legge on public.report_sezioni for select using ((select public.is_direzione()));
  end if; end $$;
revoke insert, update, delete on public.report_sezioni from anon, authenticated;

insert into public.report_sezioni (codice, titolo, ordine, attiva, funzione)
values ('centralino', 'Centralino', 10, true, 'report_sez_centralino')
on conflict (codice) do nothing;

alter table public.direzione_preferenze add column if not exists report_attivo boolean not null default false;
alter table public.direzione_preferenze add column if not exists ultimo_settimana text;
alter table public.direzione_preferenze add column if not exists ultimo_mese text;
alter table public.email_in_uscita add column if not exists allegati jsonb;  -- solo metadati: [{nome, byte}]

-- ───────────────────────── Sezione Centralino ─────────────────────────
create or replace function privato.report_sez_centralino(p_ini timestamptz, p_fin timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  tipi text[] := array['manutenzione','sopralluogo','offerta_piccola','offerta_grande','offerta_tablet','modifica','informazione'];
  tot int; n_chiuse int; n_ann int; n_aperte int; n_sla_ok int; n_sla int; ore numeric;
  n_jen int; n_com int; n_rich int; n_trasf int; n_scad int;
  per_tipo jsonb; per_canale jsonb; esiti jsonb; serie jsonb; lista jsonb; trasf_dest jsonb;
  oggi date := (now() at time zone 'Europe/Rome')::date;
  g_ini date := (p_ini at time zone 'Europe/Rome')::date;
  g_fin date := least(((p_fin - interval '1 second') at time zone 'Europe/Rome')::date, oggi);
  att jsonb := '[]';
begin
  select count(*) into tot from public.pratiche where tipo = any(tipi) and created_at >= p_ini and created_at < p_fin;

  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_tipo
  from (values (1,'Intervento',array['manutenzione']), (2,'Sopralluogo',array['sopralluogo']),
               (3,'Offerta',array['offerta_piccola','offerta_grande','offerta_tablet']),
               (4,'Modifiche / Disdetta',array['modifica']), (5,'Informazione',array['informazione'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(g.t) and p.created_at >= p_ini and p.created_at < p_fin) c on true;

  select count(*) filter (where esito in ('chiusa_ok','chiusa_ko')), count(*) filter (where esito = 'annullata'),
         count(*) filter (where esito in ('chiusa_ok','chiusa_ko') and sla_rispettato),
         count(*) filter (where esito in ('chiusa_ok','chiusa_ko') and sla_rispettato is not null),
         avg(extract(epoch from closed_at - created_at) / 3600) filter (where esito in ('chiusa_ok','chiusa_ko'))
    into n_chiuse, n_ann, n_sla_ok, n_sla, ore
  from public.pratiche where tipo = any(tipi) and closed_at >= p_ini and closed_at < p_fin;

  select count(*) into n_aperte from public.pratiche
   where tipo = any(tipi) and created_at < p_fin and (closed_at is null or closed_at >= p_fin);
  select count(*) into n_scad from public.pratiche
   where tipo = any(tipi) and created_at < p_fin and (closed_at is null or closed_at >= p_fin) and sla_scadenza < least(p_fin, now());

  select count(*) filter (where tipo in ('offerta_piccola','offerta_tablet')), count(*) filter (where tipo = 'offerta_grande')
    into n_jen, n_com from public.pratiche where created_at >= p_ini and created_at < p_fin;
  select count(*) into n_rich from public.chiamate_trasferite
   where solo_commerciale and richiamo_scadenza < least(p_fin, now()) and (richiamato_at is null or richiamato_at >= p_fin);

  -- trasferite: escluse le richiamate automatiche del commerciale
  select count(*) into n_trasf from public.chiamate_trasferite where at >= p_ini and at < p_fin and not coalesce(solo_commerciale, false);
  select coalesce(jsonb_agg(jsonb_build_array(d, n) order by n desc, d), '[]') into trasf_dest from (
    select coalesce(nullif(destinatario_nome, ''), 'Non indicato') d, count(*) n from public.chiamate_trasferite
     where at >= p_ini and at < p_fin and not coalesce(solo_commerciale, false) group by 1 order by 2 desc limit 8) x;

  -- esiti delle Informazioni (ultimo esito registrato nella storia)
  select jsonb_build_array(
           jsonb_build_array('Risposto a voce', count(*) filter (where e = 'voce')),
           jsonb_build_array('Risposto via email', count(*) filter (where e = 'email')),
           jsonb_build_array('Girata al referente', count(*) filter (where e = 'girata')),
           jsonb_build_array('Senza esito (aperte)', count(*) filter (where e is null)))
    into esiti
  from (select (select ev.dati->>'esito_info' from public.pratiche_eventi ev
                 where ev.pratica_id = p.id and ev.dati ? 'esito_info' order by ev.at desc limit 1) e
          from public.pratiche p where p.tipo = 'informazione' and p.created_at >= p_ini and p.created_at < p_fin) s;

  select jsonb_agg(jsonb_build_array(g.nome, coalesce(c.n, 0)) order by g.o) into per_canale
  from (values (1,'Telefono',array['telefono']), (2,'WhatsApp',array['whatsapp']), (3,'Email',array['email']),
               (4,'Tablet TMQ',array['tablet_tmq']), (5,'Altro',array['collega','altro'])) g(o, nome, t)
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi) and p.canale = any(g.t)
                      and p.created_at >= p_ini and p.created_at < p_fin) c on true;

  select coalesce(jsonb_agg(jsonb_build_object('label', to_char(d, 'DD/MM'), 'valore', coalesce(c.n, 0)) order by d), '[]') into serie
  from generate_series(g_ini, greatest(g_ini, g_fin), interval '1 day') d
  left join lateral (select count(*) n from public.pratiche p where p.tipo = any(tipi)
                      and (p.created_at at time zone 'Europe/Rome')::date = d::date) c on true;

  -- pratiche ancora in ritardo o annullate nel periodo (max 15); il motivo è il testo dell'evento di chiusura, mai gli appunti privati
  select coalesce(jsonb_agg(r order by o, n), '[]') into lista from (
    select * from (
      select 1 o, p.numero n, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'In ritardo',
               'Scaduta il ' || to_char(p.sla_scadenza at time zone 'Europe/Rome', 'DD/MM HH24:MI')) r
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo = any(tipi) and p.esito = 'aperta' and p.sla_scadenza < least(p_fin, now()) and p.created_at < p_fin
      union all
      select 2, p.numero, jsonb_build_array(p.numero, coalesce(p.cliente_nome, '—'), coalesce(f.nome, p.tipo), 'Annullata',
               coalesce(left((select ev.testo from public.pratiche_eventi ev where ev.pratica_id = p.id and ev.tipo in ('chiusa','stato')
                                and ev.testo is not null order by ev.at desc limit 1), 120), '—'))
        from public.pratiche p left join public.pratiche_flussi f on f.tipo = p.tipo
       where p.tipo = any(tipi) and p.esito = 'annullata' and p.closed_at >= p_ini and p.closed_at < p_fin
    ) u order by o, n limit 15) x;

  if n_scad > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_scad || ' pratiche del centralino in ritardo sullo SLA', 'livello', 'alto')); end if;
  if n_rich > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_rich || ' richiami dei commerciali scaduti', 'livello', 'alto')); end if;
  if n_ann > 0 then att := att || jsonb_build_array(jsonb_build_object('testo', n_ann || ' pratiche annullate nel periodo', 'livello', 'medio')); end if;

  return jsonb_build_object('codice', 'centralino', 'titolo', 'Centralino',
    'kpi', jsonb_build_array(
      jsonb_build_object('label', 'Contatti ricevuti', 'valore', tot),
      jsonb_build_object('label', 'Pratiche chiuse', 'valore', n_chiuse),
      jsonb_build_object('label', 'Entro SLA', 'valore', case when n_sla = 0 then null else round(100.0 * n_sla_ok / n_sla) end, 'unita', '%'),
      jsonb_build_object('label', 'Tempo medio di gestione', 'valore', case when ore is null then null else round(ore, 1) end, 'unita', 'ore'),
      jsonb_build_object('label', 'Aperte a fine periodo', 'valore', n_aperte),
      jsonb_build_object('label', 'Annullate', 'valore', n_ann),
      jsonb_build_object('label', 'In ritardo', 'valore', n_scad, 'confronta', false),
      jsonb_build_object('label', 'Chiamate trasferite', 'valore', n_trasf)),
    'tabelle', jsonb_build_array(
      jsonb_build_object('titolo', 'Contatti per tipo', 'colonne', jsonb_build_array('Tipo', 'N.'), 'righe', per_tipo),
      jsonb_build_object('titolo', 'Contatti per canale', 'colonne', jsonb_build_array('Canale', 'N.'), 'righe', per_canale),
      jsonb_build_object('titolo', 'Offerte', 'colonne', jsonb_build_array('Gestione', 'N.'), 'righe', jsonb_build_array(
        jsonb_build_array('Gestita da Jennifer', n_jen), jsonb_build_array('Passata al Tecnico Commerciale', n_com),
        jsonb_build_array('Richiami commerciali scaduti', n_rich))),
      jsonb_build_object('titolo', 'Informazioni – esito', 'colonne', jsonb_build_array('Esito', 'N.'), 'righe', esiti),
      jsonb_build_object('titolo', 'Chiamate trasferite per destinatario', 'colonne', jsonb_build_array('Destinatario', 'N.'), 'righe', trasf_dest),
      jsonb_build_object('titolo', 'Pratiche in ritardo o annullate', 'larga', true,
        'colonne', jsonb_build_array('Numero', 'Cliente', 'Tipo', 'Stato', 'Motivo / scadenza'), 'righe', lista)),
    'serie', jsonb_build_array(jsonb_build_object('titolo', 'Contatti al giorno', 'punti', serie)),
    'attenzione', att);
end $$;

-- ───────────────────────── Periodo e aggregatore ─────────────────────────
-- p_tipo 'settimana' | 'mese'; p_rif = un giorno qualsiasi del periodo (ora di Roma)
create or replace function privato.report_periodo(p_tipo text, p_rif date) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare d0 date; d1 date; mesi text[] := array['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
begin
  if p_tipo = 'settimana' then
    d0 := date_trunc('week', p_rif)::date; d1 := d0 + 7;
    return jsonb_build_object('tipo', p_tipo, 'dal', d0, 'al', d1 - 1, 'fine_esclusa', d1,
      'chiave', to_char(d0, 'IYYY-"W"IW'), 'etichetta', 'Settimana ' || to_char(d0, 'IW') || ' · ' || to_char(d0, 'DD/MM') || ' – ' || to_char(d1 - 1, 'DD/MM/YYYY'),
      'file', 'Report_Direzione_Settimana_' || to_char(d0, 'IYYY-"W"IW') || '.pdf');
  elsif p_tipo = 'mese' then
    d0 := date_trunc('month', p_rif)::date; d1 := (d0 + interval '1 month')::date;
    return jsonb_build_object('tipo', p_tipo, 'dal', d0, 'al', d1 - 1, 'fine_esclusa', d1,
      'chiave', to_char(d0, 'YYYY-MM'), 'etichetta', mesi[extract(month from d0)::int] || ' ' || extract(year from d0),
      'file', 'Report_Direzione_' || mesi[extract(month from d0)::int] || '_' || extract(year from d0) || '.pdf');
  end if;
  raise exception 'Periodo non valido';
end $$;

create or replace function privato.report_direzione(p_tipo text, p_rif date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare per jsonb := privato.report_periodo(p_tipo, p_rif); prev jsonb; s record; cur jsonb; old jsonb; k jsonb; ok jsonb;
  ini timestamptz; fin timestamptz; pini timestamptz; pfin timestamptz; sez jsonb := '[]'; kpi jsonb; v numeric; pv numeric;
begin
  prev := privato.report_periodo(p_tipo, (per->>'dal')::date - 1);
  ini := ((per->>'dal')::date)::timestamp at time zone 'Europe/Rome';
  fin := ((per->>'fine_esclusa')::date)::timestamp at time zone 'Europe/Rome';
  pini := ((prev->>'dal')::date)::timestamp at time zone 'Europe/Rome';
  pfin := ini;
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
  return jsonb_build_object('periodo', per, 'precedente', prev, 'generato_il', now(), 'sezioni', sez);
end $$;
revoke all on function privato.report_direzione(text, date) from public, anon, authenticated;
revoke all on function privato.report_sez_centralino(timestamptz, timestamptz) from public, anon, authenticated;

-- Per la pagina Direzione e la funzione Edge (con JWT dell'utente): solo admin / direzione
create or replace function public.report_direzione_dati(p_tipo text, p_rif date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_direzione() then raise exception 'Permesso negato per questa operazione.'; end if;
  return privato.report_direzione(p_tipo, coalesce(p_rif, privato.report_ultimo_rif(p_tipo)));
end $$;

-- Ultimo periodo concluso (Roma): settimana scorsa / mese scorso
create or replace function privato.report_ultimo_rif(p_tipo text) returns date
language sql stable set search_path = '' as $$
  select case when p_tipo = 'settimana' then date_trunc('week', (now() at time zone 'Europe/Rome'))::date - 1
              else date_trunc('month', (now() at time zone 'Europe/Rome'))::date - 1 end;
$$;
revoke all on function public.report_direzione_dati(text, date) from public, anon;
grant execute on function public.report_direzione_dati(text, date) to authenticated, service_role;

-- Per l'invio pianificato (service_role): dati + destinatari prenotati (idempotente: ultimo_* aggiornato qui)
create or replace function public.report_direzione_prenota(p_tipo text, p_rif date, p_forza boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare per jsonb := privato.report_periodo(p_tipo, p_rif); dest jsonb;
begin
  with u as (
    update public.direzione_preferenze p set
      ultimo_settimana = case when p_tipo = 'settimana' then per->>'chiave' else ultimo_settimana end,
      ultimo_mese = case when p_tipo = 'mese' then per->>'chiave' else ultimo_mese end, updated_at = now()
    from auth.users au
    where au.id = p.user_id and p.report_attivo and au.email is not null
      and exists (select 1 from public.responsabili r where r.user_id = p.user_id and r.attivo and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.direzione)))
      and (p_forza or (case when p_tipo = 'settimana' then p.ultimo_settimana else p.ultimo_mese end) is distinct from per->>'chiave')
    returning lower(au.email) email)
  select coalesce(jsonb_agg(email), '[]') into dest from u;
  return jsonb_build_object('destinatari', dest, 'report', case when jsonb_array_length(dest) > 0 then privato.report_direzione(p_tipo, p_rif) end);
end $$;
revoke all on function public.report_direzione_prenota(text, date, boolean) from public, anon, authenticated;
grant execute on function public.report_direzione_prenota(text, date, boolean) to service_role;

-- Preferenza (sostituisce l'interruttore del riepilogo giornaliero)
create or replace function public.report_direzione_imposta(p_attivo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_direzione() then raise exception 'Permesso negato per questa operazione.'; end if;
  insert into public.direzione_preferenze (user_id, report_attivo) values (auth.uid(), coalesce(p_attivo, false))
  on conflict (user_id) do update set report_attivo = excluded.report_attivo, digest_attivo = false, updated_at = now();
end $$;
revoke all on function public.report_direzione_imposta(boolean) from public, anon;
grant execute on function public.report_direzione_imposta(boolean) to authenticated;

create or replace function public.report_direzione_stato() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_direzione() then raise exception 'Permesso negato per questa operazione.'; end if;
  return jsonb_build_object(
    'attivo', coalesce((select report_attivo from public.direzione_preferenze where user_id = auth.uid()), false),
    'ultimo_settimana', (select ultimo_settimana from public.direzione_preferenze where user_id = auth.uid()),
    'ultimo_mese', (select ultimo_mese from public.direzione_preferenze where user_id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()),
    'admin', public.is_admin());
end $$;
revoke all on function public.report_direzione_stato() from public, anon;
grant execute on function public.report_direzione_stato() to authenticated;

-- Avvio pianificato: chiama la funzione Edge report-direzione solo all'ora giusta di Roma (gestisce ora legale/solare)
create or replace function privato.report_direzione_avvia(p_tipo text, p_forza boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r timestamp := now() at time zone 'Europe/Rome'; u text;
begin
  if not p_forza then
    if extract(hour from r) <> 7 then return false; end if;
    if p_tipo = 'settimana' and extract(isodow from r) <> 1 then return false; end if;
    if p_tipo = 'mese' and extract(day from r) <> 1 then return false; end if;
  end if;
  select regexp_replace(valore, '/functions/v1/.*$', '/functions/v1') into u from public.config_privata where chiave = 'funzioni_url';
  if u is null then return false; end if;
  perform net.http_post(url := u || '/report-direzione',
    body := jsonb_build_object('azione', 'pianificato', 'tipo', p_tipo, 'rif', privato.report_ultimo_rif(p_tipo)),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-secret', privato.email_segreto()),
    timeout_milliseconds := 60000);
  return true;
end $$;
revoke all on function privato.report_direzione_avvia(text, boolean) from public, anon, authenticated;

-- Il vecchio riepilogo giornaliero diventa no-op (resta la firma per sicurezza)
create or replace function privato.direzione_digest(p_forza boolean default false) returns int
language plpgsql security definer set search_path = '' as $$ begin return 0; end $$;
revoke all on function privato.direzione_digest(boolean) from public, anon, authenticated;

-- cron.schedule con lo stesso nome aggiorna il job esistente
-- 05:30/06:30 UTC = 07:30 Roma (una delle due); 05:45/06:45 UTC = 07:45 Roma
do $$
begin
  perform cron.schedule('report_direzione_settimana', '30 5,6 * * 1', $c$select privato.report_direzione_avvia('settimana')$c$);
  perform cron.schedule('report_direzione_mese', '45 5,6 1 * *', $c$select privato.report_direzione_avvia('mese')$c$);
end $$;
