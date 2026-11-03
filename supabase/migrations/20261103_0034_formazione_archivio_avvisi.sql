-- 0034 Formazione: più attestati per corso (archivio), avvisi di scadenza (campanella + email giornaliera),
-- dati per KPI/report, percorso attestato per l'app dipendente (edge function /attestato).

-- 1. Attestati (più file per registrazione) -----------------------------------------
create table if not exists public.corsi_attestati (
  id bigint generated always as identity primary key,
  corso_dipendente_id bigint not null references public.corsi_dipendente(id),
  path text not null unique,
  nome_file text,
  mime text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists corsi_attestati_cd on public.corsi_attestati (corso_dipendente_id);
alter table public.corsi_attestati enable row level security;
grant select, insert, delete on public.corsi_attestati to authenticated;
create policy ca_leggi on public.corsi_attestati for select to authenticated
  using ((select public.is_formazione()) or (select public.is_hr()));
create policy ca_gestisci on public.corsi_attestati for all to authenticated
  using ((select public.is_formazione())) with check ((select public.is_formazione()));
comment on column public.corsi_dipendente.attestato_path is 'Superato da corsi_attestati (copiato lì dalla 0034).';
insert into public.corsi_attestati (corso_dipendente_id, path, nome_file, created_by)
select id, attestato_path, 'attestato', created_by from public.corsi_dipendente where attestato_path is not null
on conflict (path) do nothing;

-- 2. Impostazioni avvisi -------------------------------------------------------------
create table if not exists public.formazione_impostazioni (
  id int primary key default 1 check (id = 1),
  soglie_mesi int[] not null default '{6}' check (soglie_mesi <@ array[6, 3, 1]),
  email boolean not null default true,
  aggiornato_il timestamptz not null default now()
);
insert into public.formazione_impostazioni (id) values (1) on conflict (id) do nothing;
alter table public.formazione_impostazioni enable row level security;
grant select, update (soglie_mesi, email, aggiornato_il) on public.formazione_impostazioni to authenticated;
create policy fi_leggi on public.formazione_impostazioni for select to authenticated using ((select public.is_formazione()));
create policy fi_modifica on public.formazione_impostazioni for update to authenticated
  using ((select public.is_formazione())) with check ((select public.is_formazione()));

-- avvisi già inviati: una riga per registrazione e soglia (idempotenza)
create table if not exists public.formazione_avvisi_inviati (
  corso_dipendente_id bigint not null references public.corsi_dipendente(id),
  soglia_mesi int not null,
  creato_il timestamptz not null default now(),
  primary key (corso_dipendente_id, soglia_mesi)
);
alter table public.formazione_avvisi_inviati enable row level security;
-- email riepilogo: al massimo una al giorno
create table if not exists public.formazione_email_giorni (giorno date primary key, avvisi int not null, creato_il timestamptz not null default now());
alter table public.formazione_email_giorni enable row level security;

-- 3. Controllo scadenze (giornaliero + all'apertura) ---------------------------------
create or replace function privato.formazione_controlla() returns int
language plpgsql security definer set search_path = '' as $$
declare imp public.formazione_impostazioni; n int := 0; righe jsonb; dest record; html text; testo text; oggi date := public.oggi();
begin
  select * into imp from public.formazione_impostazioni where id = 1;
  if imp is null or coalesce(cardinality(imp.soglie_mesi), 0) = 0 then return 0; end if;

  with att as (
    select distinct on (cd.dipendente_id, cd.corso_id) cd.id, cd.dipendente_id, cd.corso_id, cd.data_scadenza
      from public.corsi_dipendente cd
     order by cd.dipendente_id, cd.corso_id, cd.data_conseguimento desc, cd.id desc),
  cand as (
    select a.*, s.soglia from att a join public.dipendenti d on d.id = a.dipendente_id and d.attivo
      cross join unnest(imp.soglie_mesi) s(soglia)
     where a.data_scadenza is not null and a.data_scadenza <= (oggi + make_interval(months => s.soglia))::date),
  nuovi as (
    insert into public.formazione_avvisi_inviati (corso_dipendente_id, soglia_mesi)
    select id, soglia from cand on conflict do nothing returning corso_dipendente_id)
  select jsonb_agg(jsonb_build_object('id', a.id, 'dipendente_id', a.dipendente_id, 'nome', d.cognome || ' ' || d.nome,
           'corso', c.nome, 'scadenza', a.data_scadenza, 'giorni', a.data_scadenza - oggi) order by a.data_scadenza)
    into righe
    from att a join public.dipendenti d on d.id = a.dipendente_id join public.corsi c on c.id = a.corso_id
   where a.id in (select distinct corso_dipendente_id from nuovi);
  n := coalesce(jsonb_array_length(righe), 0);
  if n = 0 then return 0; end if;

  -- campanella: responsabili formazione attivi (se nessuno, gli amministratori)
  insert into public.notifiche (user_id, tipo, dati, link)
  select u.user_id, 'avviso',
         jsonb_build_object('categoria', 'formazione', 'livello', case when (x->>'giorni')::int < 0 then 'ko' else 'warn' end,
           'titolo', case when (x->>'giorni')::int < 0 then 'Corso scaduto' else 'Corso in scadenza' end,
           'testo', (x->>'nome') || ' · ' || (x->>'corso') || ' · ' ||
             case when (x->>'giorni')::int < 0 then 'scaduto il ' else 'scade il ' end || to_char((x->>'scadenza')::date, 'DD/MM/YYYY')),
         '/formazione/dipendenti?d=' || (x->>'dipendente_id')
    from jsonb_array_elements(righe) x
   cross join (select r.user_id from public.responsabili r where r.attivo and r.ruolo = 'responsabile' and r.formazione
               union select r.user_id from public.responsabili r where r.attivo and r.ruolo = 'admin'
                 and not exists (select 1 from public.responsabili z where z.attivo and z.ruolo = 'responsabile' and z.formazione)) u;

  -- email riepilogo: una al giorno, solo a chi ha un'email
  if imp.email and not exists (select 1 from public.formazione_email_giorni where giorno = oggi) then
    insert into public.formazione_email_giorni (giorno, avvisi) values (oggi, n);
    select string_agg(format('<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">%s</td><td style="padding:6px 8px;border-bottom:1px solid #eee">%s</td><td style="padding:6px 8px;border-bottom:1px solid #eee">%s</td></tr>',
             replace(replace(x->>'nome', '<', '&lt;'), '>', '&gt;'), replace(replace(x->>'corso', '<', '&lt;'), '>', '&gt;'),
             to_char((x->>'scadenza')::date, 'DD/MM/YYYY')), ''),
           string_agg((x->>'nome') || ' - ' || (x->>'corso') || ' - ' || to_char((x->>'scadenza')::date, 'DD/MM/YYYY'), E'\n')
      into html, testo from jsonb_array_elements(righe) x;
    html := '<!doctype html><html lang="it"><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f4f4;margin:0;padding:24px">'
         || '<div style="max-width:640px;margin:auto;background:#fff;border-radius:8px;padding:24px"><h2 style="margin:0 0 12px">Corsi in scadenza</h2>'
         || '<p>Questi corsi sono scaduti o scadono entro le soglie impostate:</p><table style="border-collapse:collapse;width:100%;font-size:14px">'
         || '<tr><th align="left" style="padding:6px 8px">Dipendente</th><th align="left" style="padding:6px 8px">Corso</th><th align="left" style="padding:6px 8px">Scadenza</th></tr>'
         || html || '</table><p style="margin-top:16px">Apri il portale, area Formazione, per rinnovarli.</p></div></body></html>';
    for dest in
      select distinct coalesce(nullif(r.email, ''), u.email) as email
        from public.responsabili r left join auth.users u on u.id = r.user_id
       where r.attivo and r.ruolo = 'responsabile' and r.formazione and coalesce(nullif(r.email, ''), u.email) is not null
    loop
      insert into public.email_in_uscita (destinatario, oggetto, html, testo, dati)
      values (dest.email, 'Formazione: ' || n || case when n = 1 then ' corso in scadenza' else ' corsi in scadenza' end, html,
              'Corsi in scadenza' || E'\n\n' || testo, jsonb_build_object('categoria', 'formazione'));
    end loop;
    perform privato.email_avvia();
  end if;
  return n;
end $$;

create or replace function public.formazione_controlla() returns int
language plpgsql security definer set search_path = '' as $$
begin
  perform privato.richiedi_formazione();
  return privato.formazione_controlla();
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('formazione_scadenze_giornaliere', '17 6 * * *', 'select privato.formazione_controlla()');
  end if;
end $$;

-- nuove soglie: si riparte (gli avvisi per le soglie aggiunte arriveranno al prossimo controllo)

-- 4. Dati per cruscotto, archivio e report ------------------------------------------
create or replace function public.formazione_dati() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
  return jsonb_build_object('oggi', public.oggi(),
    'righe', coalesce((select jsonb_agg(to_jsonb(r)) from privato.formazione_righe() r), '[]'),
    'registrazioni', coalesce((select jsonb_agg(jsonb_build_object(
        'id', cd.id, 'dipendente_id', cd.dipendente_id, 'nome', d.cognome || ' ' || d.nome, 'categoria', d.categoria, 'attivo', d.attivo,
        'corso_id', cd.corso_id, 'corso', c.nome, 'data_conseguimento', cd.data_conseguimento, 'data_scadenza', cd.data_scadenza,
        'ente', cd.ente, 'ore', cd.ore,
        'n_attestati', (select count(*) from public.corsi_attestati a where a.corso_dipendente_id = cd.id),
        'attuale', not exists (select 1 from public.corsi_dipendente y where y.dipendente_id = cd.dipendente_id and y.corso_id = cd.corso_id
                                 and (y.data_conseguimento, y.id) > (cd.data_conseguimento, cd.id))))
      from public.corsi_dipendente cd join public.dipendenti d on d.id = cd.dipendente_id join public.corsi c on c.id = cd.corso_id), '[]'));
end $$;

-- 5. App dipendente: corsi con attestati; percorso del proprio attestato (per la edge function)
create or replace function public.dipendente_corsi(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('corso', r.corso, 'data_conseguimento', r.data_conseguimento,
      'data_scadenza', r.data_scadenza, 'stato', r.stato, 'obbligatorio', r.obbligatorio,
      'attestati', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nome', coalesce(a.nome_file, 'Attestato')) order by a.id)
                               from public.corsi_attestati a join public.corsi_dipendente cd on cd.id = a.corso_dipendente_id
                              where cd.dipendente_id = did and cd.corso_id = r.corso_id
                                and cd.data_conseguimento = r.data_conseguimento), '[]')) order by r.corso)
    from privato.formazione_righe() r where r.dipendente_id = did), '[]');
end $function$;

create or replace function public.dipendente_percorso_attestato(p_token text, p_id bigint) returns text
language plpgsql stable security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); p text;
begin
  select a.path into p from public.corsi_attestati a join public.corsi_dipendente cd on cd.id = a.corso_dipendente_id
   where a.id = p_id and cd.dipendente_id = did;
  return p;
end $$;

-- 6. Attestati caricati dal dipendente (da verificare) ----------------------------------
create table if not exists public.attestati_proposti (
  id bigint generated always as identity primary key,
  dipendente_id bigint not null references public.dipendenti(id),
  corso_id bigint references public.corsi(id),
  corso_testo text check (corso_testo is null or length(corso_testo) <= 120),
  data_conseguimento date not null,
  path text not null unique,
  nome_file text, mime text,
  stato text not null default 'da_verificare' check (stato in ('da_verificare', 'approvato', 'rifiutato')),
  motivo text,
  corso_dipendente_id bigint references public.corsi_dipendente(id),
  creato_il timestamptz not null default now(),
  deciso_da uuid, deciso_il timestamptz,
  check (corso_id is not null or corso_testo is not null)
);
comment on table public.attestati_proposti is 'Attestati caricati dal dipendente dall''app: non valgono finché il responsabile formazione non approva. Audit: creato_il (dipendente), deciso_da/deciso_il.';
alter table public.attestati_proposti enable row level security;
grant select on public.attestati_proposti to authenticated;
create policy ap_leggi on public.attestati_proposti for select to authenticated
  using ((select public.is_formazione()) or (select public.is_hr()));
alter table public.corsi_attestati add column if not exists caricato_da_dipendente boolean not null default false;

-- id del dipendente dal token (per la edge function: cartella dip/<id>/)
create or replace function public.dipendente_id_token(p_token text) returns bigint
language sql stable security definer set search_path = '' as $$ select privato.dipendente_da_token(p_token) $$;

create or replace function privato.notifica_formazione(p_titolo text, p_testo text, p_link text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifiche (user_id, tipo, dati, link)
  select u.user_id, 'avviso', jsonb_build_object('categoria', 'formazione', 'livello', 'info', 'titolo', p_titolo, 'testo', p_testo), p_link
    from (select r.user_id from public.responsabili r where r.attivo and r.ruolo = 'responsabile' and r.formazione
          union select r.user_id from public.responsabili r where r.attivo and r.ruolo = 'admin'
            and not exists (select 1 from public.responsabili z where z.attivo and z.ruolo = 'responsabile' and z.formazione)) u;
$$;

create or replace function public.dipendente_proponi_attestato(p_token text, p_corso bigint, p_corso_testo text, p_data date,
  p_path text, p_nome text, p_mime text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token); nid bigint; d public.dipendenti;
begin
  if p_path is null or p_path not like 'dip/' || did || '/%' then raise exception 'File non valido'; end if;
  if p_data is null or p_data > public.oggi() then raise exception 'Indica una data valida (non nel futuro).'; end if;
  if p_corso is null and nullif(btrim(p_corso_testo), '') is null then raise exception 'Scegli il corso o scrivi il nome.'; end if;
  if p_corso is not null and not exists (select 1 from public.corsi where id = p_corso and attivo) then raise exception 'Corso non trovato'; end if;
  insert into public.attestati_proposti (dipendente_id, corso_id, corso_testo, data_conseguimento, path, nome_file, mime)
  values (did, p_corso, case when p_corso is null then left(btrim(p_corso_testo), 120) end, p_data, p_path, left(p_nome, 120), left(p_mime, 60))
  returning id into nid;
  select * into d from public.dipendenti where id = did;
  perform privato.notifica_formazione('Attestato da verificare',
    d.cognome || ' ' || d.nome || ' ha caricato un attestato: ' || coalesce((select nome from public.corsi where id = p_corso), btrim(p_corso_testo)),
    '/formazione?verifica=' || nid);
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

create or replace function public.dipendente_attestati_proposti(p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'corso', coalesce(c.nome, p.corso_testo), 'data_conseguimento', p.data_conseguimento,
      'stato', p.stato, 'motivo', p.motivo, 'creato_il', p.creato_il) order by p.creato_il desc)
    from public.attestati_proposti p left join public.corsi c on c.id = p.corso_id where p.dipendente_id = did), '[]');
end $$;

create or replace function public.formazione_approva_attestato(p_id bigint, p_corso bigint, p_data date, p_scadenza date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.attestati_proposti; r jsonb; cd bigint;
begin
  perform privato.richiedi_formazione();
  select * into p from public.attestati_proposti where id = p_id for update;
  if p is null then raise exception 'Attestato non trovato'; end if;
  if p.stato <> 'da_verificare' then raise exception 'Attestato già deciso'; end if;
  r := public.formazione_registra(p_corso, array[p.dipendente_id], coalesce(p_data, p.data_conseguimento), p_scadenza, null, null, 'Caricato dal dipendente', null);
  cd := (r->'id'->>0)::bigint;
  insert into public.corsi_attestati (corso_dipendente_id, path, nome_file, mime, caricato_da_dipendente) values (cd, p.path, p.nome_file, p.mime, true);
  update public.attestati_proposti set stato = 'approvato', corso_id = p_corso, corso_dipendente_id = cd, deciso_da = auth.uid(), deciso_il = now() where id = p_id;
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  values (p.dipendente_id, 'avviso', jsonb_build_object('categoria', 'formazione', 'livello', 'ok', 'titolo', 'Attestato approvato',
    'testo', (select nome from public.corsi where id = p_corso)), '/t/profilo');
  return jsonb_build_object('ok', true, 'corso_dipendente_id', cd);
end $$;

create or replace function public.formazione_rifiuta_attestato(p_id bigint, p_motivo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.attestati_proposti;
begin
  perform privato.richiedi_formazione();
  if nullif(btrim(p_motivo), '') is null then raise exception 'Scrivi il motivo del rifiuto.'; end if;
  select * into p from public.attestati_proposti where id = p_id for update;
  if p is null then raise exception 'Attestato non trovato'; end if;
  if p.stato <> 'da_verificare' then raise exception 'Attestato già deciso'; end if;
  update public.attestati_proposti set stato = 'rifiutato', motivo = left(btrim(p_motivo), 300), deciso_da = auth.uid(), deciso_il = now() where id = p_id;
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  values (p.dipendente_id, 'avviso', jsonb_build_object('categoria', 'formazione', 'livello', 'ko', 'titolo', 'Attestato non accettato',
    'testo', left(btrim(p_motivo), 300)), '/t/profilo');
  return jsonb_build_object('ok', true);
end $$;
