-- Area Direzione: riepilogo giornaliero via email (facoltativo, 18:00 ora di Roma, lun–ven).
-- Non distruttiva: nuova tabella, nuove funzioni, un job pg_cron.
-- La direzione resta in sola lettura sui dati: l'unica scrittura è la propria preferenza, solo via RPC.

create table if not exists public.direzione_preferenze (
  user_id uuid primary key references auth.users(id) on delete cascade,
  digest_attivo boolean not null default false,
  ultimo_invio date,
  updated_at timestamptz not null default now()
);
alter table public.direzione_preferenze enable row level security;
drop policy if exists dir_pref_legge on public.direzione_preferenze;
create policy dir_pref_legge on public.direzione_preferenze for select using (user_id = (select auth.uid()) and (select public.is_direzione()));
-- nessuna policy di scrittura: solo RPC
revoke insert, update, delete on public.direzione_preferenze from anon, authenticated;

create or replace function public.direzione_digest_imposta(p_attivo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_direzione() then raise exception 'Permesso negato per questa operazione.'; end if;
  insert into public.direzione_preferenze (user_id, digest_attivo) values (auth.uid(), coalesce(p_attivo, false))
  on conflict (user_id) do update set digest_attivo = excluded.digest_attivo, updated_at = now();
end $$;
revoke all on function public.direzione_digest_imposta(boolean) from public, anon;
grant execute on function public.direzione_digest_imposta(boolean) to authenticated;

create or replace function public.direzione_digest_stato() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_direzione() then raise exception 'Permesso negato per questa operazione.'; end if;
  return jsonb_build_object(
    'attivo', coalesce((select digest_attivo from public.direzione_preferenze where user_id = auth.uid()), false),
    'ultimo', (select ultimo_invio from public.direzione_preferenze where user_id = auth.uid()),
    'email', (select email from auth.users where id = auth.uid()));
end $$;
revoke all on function public.direzione_digest_stato() from public, anon;
grant execute on function public.direzione_digest_stato() to authenticated;

-- Testo del riepilogo (giorno di Roma)
create or replace function privato.direzione_digest_testo(p_giorno date) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  ini timestamptz := (p_giorno::timestamp at time zone 'Europe/Rome');
  fin timestamptz := ((p_giorno + 1)::timestamp at time zone 'Europe/Rome');
  n_oggi int; n_aperte int; n_scadute int; n_sla_ok int; n_sla int; n_comm int; n_chiuse int; n_trasf int;
begin
  select count(*) into n_oggi from public.pratiche where created_at >= ini and created_at < fin;
  select count(*) filter (where esito = 'aperta'), count(*) filter (where esito = 'aperta' and sla_scadenza < now())
    into n_aperte, n_scadute from public.pratiche where esito = 'aperta';
  select count(*) filter (where sla_rispettato), count(*) filter (where sla_rispettato is not null)
    into n_sla_ok, n_sla from public.pratiche where created_at >= ini and created_at < fin;
  select count(*) into n_chiuse from public.pratiche where closed_at >= ini and closed_at < fin and esito <> 'annullata';
  select count(*) into n_trasf from public.chiamate_trasferite where at >= ini and at < fin;
  select count(*) into n_comm from public.chiamate_trasferite
   where solo_commerciale and richiamato_at is null and richiamo_scadenza < now();
  return 'Riepilogo del centralino – ' || to_char(p_giorno, 'DD/MM/YYYY') || E'\n\n'
    || 'Contatti oggi: ' || n_oggi || E'\n'
    || 'Pratiche chiuse oggi: ' || n_chiuse || E'\n'
    || 'Pratiche aperte: ' || n_aperte || E'\n'
    || 'Pratiche scadute (in ritardo): ' || n_scadute || E'\n'
    || 'SLA rispettati oggi: ' || case when n_sla = 0 then '—' else round(100.0 * n_sla_ok / n_sla) || '% (' || n_sla_ok || ' su ' || n_sla || ')' end || E'\n'
    || 'Chiamate trasferite oggi: ' || n_trasf || E'\n'
    || 'Richiami dei commerciali scaduti: ' || n_comm || E'\n\n'
    || 'Dettagli nell''area Direzione del portale (sola lettura). Gli appunti privati non sono mai inclusi.';
end $$;

-- Accoda il riepilogo per chi l'ha attivato. p_forza = true salta il controllo dell'ora (prove).
create or replace function privato.direzione_digest(p_forza boolean default false) returns int
language plpgsql security definer set search_path = '' as $$
declare g date := (now() at time zone 'Europe/Rome')::date; t text; n int := 0; r record;
begin
  if not p_forza and extract(hour from now() at time zone 'Europe/Rome') <> 18 then return 0; end if;
  t := privato.direzione_digest_testo(g);
  for r in select p.user_id, u.email from public.direzione_preferenze p join auth.users u on u.id = p.user_id
            where p.digest_attivo and u.email is not null and (p.ultimo_invio is null or p.ultimo_invio < g) loop
    insert into public.email_in_uscita (destinatario, oggetto, html, testo, dati, stato)
    values (lower(r.email), 'Centralino – riepilogo del ' || to_char(g, 'DD/MM/YYYY'),
            '<pre style="font-family:Arial,Helvetica,sans-serif;font-size:14px;white-space:pre-wrap">' || replace(replace(t, '&', '&amp;'), '<', '&lt;') || '</pre>',
            t, jsonb_build_object('categoria', 'direzione_digest'), 'in_coda');
    update public.direzione_preferenze set ultimo_invio = g where user_id = r.user_id;
    n := n + 1;
  end loop;
  if n > 0 then perform privato.email_avvia(); end if;
  return n;
end $$;
revoke all on function privato.direzione_digest(boolean) from public, anon, authenticated;
revoke all on function privato.direzione_digest_testo(date) from public, anon, authenticated;

-- 16:00 e 17:00 UTC: una delle due è sempre le 18:00 di Roma (ora legale / solare)
do $$
begin
  if exists (select 1 from cron.job where jobname = 'direzione_digest') then perform cron.unschedule('direzione_digest'); end if;
  perform cron.schedule('direzione_digest', '0 16,17 * * 1-5', 'select privato.direzione_digest()');
end $$;
