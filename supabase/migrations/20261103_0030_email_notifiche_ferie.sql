-- Email all'ufficio personale per ogni nuova richiesta di assenza in attesa (Resend, via Edge Function `notifica-email`).
--  * impostazioni_portale: email_hr, email_mittente (solo admin; HR legge email_hr)
--  * email_in_uscita: coda (outbox) riempita da un trigger differito (a fine transazione, quando i giorni sono già salvati)
--  * pg_net chiama la funzione con l'intestazione x-email-secret (segreto in Vault); gli errori non bloccano mai la richiesta
--  * MALATTIA: solo "Malattia", nessuna nota. Nessuna email per le richieste dell'utente HR/admin per sé stesso.

create table if not exists public.impostazioni_portale (
  chiave text primary key,
  valore text,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid
);
alter table public.impostazioni_portale enable row level security;
create policy impostazioni_admin on public.impostazioni_portale for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy impostazioni_hr_legge on public.impostazioni_portale for select
  using (chiave = 'email_hr' and (select public.is_hr()));

insert into public.impostazioni_portale (chiave, valore) values
  ('email_hr', 'abdalhadi.m.btran@gmail.com'),
  ('email_mittente', 'Molajoni Portale <onboarding@resend.dev>')
on conflict (chiave) do nothing;

create table if not exists public.email_in_uscita (
  id bigint generated always as identity primary key,
  destinatario text,
  oggetto text not null,
  html text,
  testo text,
  dati jsonb,
  richiesta_id bigint,
  stato text not null default 'in_coda'
    check (stato in ('in_coda', 'inviata', 'errore', 'in_attesa_configurazione', 'saltata')),
  tentativi int not null default 0,
  errore text,
  creato_il timestamptz not null default now(),
  inviato_il timestamptz
);
create index if not exists email_in_uscita_stato on public.email_in_uscita (stato) where stato <> 'inviata';
alter table public.email_in_uscita enable row level security;
create policy email_admin_legge on public.email_in_uscita for select using ((select public.is_admin()));

-- segreto condiviso funzione <-> database (Vault)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'email_notifiche_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'email_notifiche_secret', 'Intestazione x-email-secret per notifica-email');
  end if;
end $$;

create or replace function privato.email_segreto() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'email_notifiche_secret' limit 1;
$$;

-- usata dalla funzione (service role) per verificare l'intestazione; per tutti gli altri ruoli risponde false
create or replace function public.email_segreto_valido(p text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'service_role') then return false; end if;
  return p is not null and p = privato.email_segreto();
end $$;

-- avvia l'elaborazione della coda (asincrona, mai bloccante)
create or replace function privato.email_avvia() returns void
language plpgsql security definer set search_path = '' as $$
declare u text;
begin
  select valore into u from public.config_privata where chiave = 'funzioni_url';
  if u is null then return; end if;
  perform net.http_post(url := u || '/notifica-email', body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-email-secret', privato.email_segreto()),
    timeout_milliseconds := 10000);
exception when others then null;
end $$;

create or replace function privato.tg_richiesta_email() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.richieste_assenza; d public.dipendenti; t public.tipi_assenza;
  dest text; sal jsonb; n_int int := 0; date_int text; mal boolean; dati jsonb; ogg text;
begin
  begin
    if coalesce(current_setting('portale.senza_notifiche', true), '') = 'on' then return null; end if;
    select * into r from public.richieste_assenza where id = new.id;
    if r.id is null or r.stato <> 'in_attesa' then return null; end if;
    -- richieste dell'utente HR/admin per sé stesso: nessuna email
    if exists (select 1 from public.responsabili x where x.dipendente_id = r.dipendente_id and x.attivo
                 and (x.ruolo = 'admin' or x.area = 'hr')) then return null; end if;
    select * into d from public.dipendenti where id = r.dipendente_id;
    select * into t from public.tipi_assenza where codice = r.tipo;
    mal := r.tipo = 'MAL';
    select valore into dest from public.impostazioni_portale where chiave = 'email_hr';

    if t.con_saldo then
      sal := privato.saldo(r.dipendente_id, extract(year from r.primo_giorno)::int, r.tipo, null);
    end if;
    if d.categoria = 'TEC' then
      select count(*), string_agg(distinct to_char(i.data, 'DD/MM'), ', ') into n_int, date_int
        from public.interventi i
       where i.tecnico_id = r.dipendente_id and i.data between r.primo_giorno and r.ultimo_giorno;
    end if;

    dati := jsonb_build_object(
      'numero', r.numero, 'nome', d.nome, 'cognome', d.cognome, 'categoria', d.categoria,
      'tipo_codice', r.tipo, 'tipo', case when mal then 'Malattia' else coalesce(t.descrizione, r.tipo) end,
      'primo', r.primo_giorno, 'ultimo', r.ultimo_giorno,
      'rientro', case when r.ora_inizio is null and not r.mezza_giornata then privato.rientro_dopo(d.giorni_riposo, r.ultimo_giorno) end,
      'ora_inizio', to_char(r.ora_inizio, 'HH24:MI'), 'ora_fine', to_char(r.ora_fine, 'HH24:MI'),
      'mezza', r.mezza_giornata, 'meta', r.meta, 'quantita', r.quantita, 'unita', r.unita,
      'saldo_dopo', case when sal is not null and not mal then (sal->>'saldo_fine_anno_dopo_attesa')::numeric end,
      'note', case when mal then null else nullif(btrim(r.note), '') end,
      'interventi', n_int, 'date_interventi', date_int,
      'creata_da', r.creata_da);
    ogg := 'Nuova richiesta di ' || case when mal then 'malattia' else lower(coalesce(t.etichetta_piano, t.descrizione, r.tipo)) end
           || ' – ' || d.cognome || ' ' || d.nome;

    insert into public.email_in_uscita (destinatario, oggetto, dati, richiesta_id, stato)
    values (dest, ogg, dati, r.id, case when dest is null then 'in_attesa_configurazione' else 'in_coda' end);
    if dest is not null then perform privato.email_avvia(); end if;
  exception when others then
    null; -- l'email non deve mai bloccare la richiesta
  end;
  return null;
end $$;

create constraint trigger email_richieste after insert on public.richieste_assenza
  deferrable initially deferred for each row execute function privato.tg_richiesta_email();

create or replace function public.admin_get_impostazioni() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'Permesso negato per questa operazione.'; end if;
  return jsonb_build_object(
    'impostazioni', (select coalesce(jsonb_object_agg(chiave, valore), '{}'::jsonb) from public.impostazioni_portale),
    'ultime_email', (select coalesce(jsonb_agg(x order by x.id desc), '[]'::jsonb) from (
       select id, destinatario, oggetto, stato, errore, creato_il, inviato_il from public.email_in_uscita order by id desc limit 5) x));
end $$;

create or replace function public.admin_salva_impostazione(p_chiave text, p_valore text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(btrim(p_valore), '');
begin
  if not public.is_admin() then raise exception 'Permesso negato per questa operazione.'; end if;
  if p_chiave not in ('email_hr', 'email_mittente') then raise exception 'Impostazione non valida.'; end if;
  if p_chiave = 'email_hr' and (v is null or v !~* '^[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}$') then
    raise exception 'Indirizzo email non valido.';
  end if;
  if p_chiave = 'email_mittente' and (v is null or v !~* '[^@\s<>]+@[^@\s<>]+\.[a-z]{2,}>?$') then
    raise exception 'Indirizzo email non valido.';
  end if;
  insert into public.impostazioni_portale (chiave, valore, aggiornato_il, aggiornato_da)
  values (p_chiave, case when p_chiave = 'email_hr' then lower(v) else v end, now(), auth.uid())
  on conflict (chiave) do update set valore = case when p_chiave = 'email_hr' then lower(v) else v end,
    aggiornato_il = now(), aggiornato_da = auth.uid();
  if p_chiave = 'email_hr' then
    update public.email_in_uscita set destinatario = lower(v), stato = 'in_coda'
     where stato = 'in_attesa_configurazione' and destinatario is null;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.admin_invia_email_prova() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare dest text; nid bigint;
begin
  if not public.is_admin() then raise exception 'Permesso negato per questa operazione.'; end if;
  select valore into dest from public.impostazioni_portale where chiave = 'email_hr';
  if dest is null then raise exception 'Indirizzo email non valido.'; end if;
  insert into public.email_in_uscita (destinatario, oggetto, dati)
  values (dest, 'Prova notifiche – Molajoni Portale', jsonb_build_object('prova', true))
  returning id into nid;
  perform privato.email_avvia();
  return jsonb_build_object('ok', true, 'id', nid);
end $$;
