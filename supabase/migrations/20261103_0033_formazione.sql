-- 0033 Formazione: corsi, corsi dei dipendenti, attestati, ruolo «formazione».
--
-- Ruolo: `responsabili.area` ha un CHECK ('flotta','hr') che non si può cambiare senza DROP (vietato).
-- Percorso non distruttivo: nuova colonna `responsabili.formazione`. Un account formazione è
-- ruolo='responsabile', area='flotta', formazione=true; is_responsabile() esclude questi account,
-- quindi NON vedono la flotta. L'area «effettiva» è esposta da public.area_responsabile().

-- 1. Ruolo ---------------------------------------------------------------------
alter table public.responsabili add column if not exists formazione boolean not null default false;
comment on column public.responsabili.formazione is 'Vero = responsabile formazione (area effettiva «formazione»; area resta flotta per il CHECK esistente). Non entra nel pannello flotta.';
grant select (formazione) on public.responsabili to authenticated;

create or replace function public.is_responsabile()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'flotta' and not r.formazione)));
$function$;

create or replace function public.is_formazione()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.formazione)));
$function$;
grant execute on function public.is_formazione() to authenticated;

create or replace function privato.richiedi_formazione()
 returns void language plpgsql stable set search_path to ''
as $function$
begin
  if not public.is_formazione() then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
end $function$;

-- p_ruolo: 'admin' | 'responsabile' (flotta) | 'hr' | 'formazione'
create or replace function public.admin_imposta_responsabile(p_user uuid, p_ruolo text, p_attivo boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform public.richiedi_admin();
  if p_user = auth.uid() then raise exception 'Non puoi modificare il tuo stesso account'; end if;
  if p_ruolo not in ('admin', 'responsabile', 'hr', 'formazione') then raise exception 'Ruolo non valido'; end if;
  update public.responsabili
     set ruolo = case when p_ruolo = 'admin' then 'admin' else 'responsabile' end,
         area = case when p_ruolo = 'hr' then 'hr' else 'flotta' end,
         formazione = (p_ruolo = 'formazione'),
         attivo = p_attivo
   where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
end $function$;

-- notifiche «flotta»: non agli account formazione
create or replace function privato.notifica_responsabili(p_area text, p_titolo text, p_testo text, p_dati jsonb, p_livello text, p_link text)
 returns void language plpgsql set search_path to ''
as $function$
declare n int;
begin
  insert into public.notifiche (user_id, tipo, dati, link)
  select r.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
           'titolo', p_titolo, 'testo', p_testo) || coalesce(p_dati, '{}'::jsonb), p_link
    from public.responsabili r
   where r.attivo and case when p_area = 'flotta' then r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'flotta' and not r.formazione)
                           else r.ruolo = 'responsabile' and r.area = 'hr' end;
  get diagnostics n = row_count;
  if n = 0 and p_area = 'hr' then
    insert into public.notifiche (user_id, tipo, dati, link)
    select r.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
             'titolo', p_titolo, 'testo', p_testo) || coalesce(p_dati, '{}'::jsonb), p_link
      from public.responsabili r where r.attivo and r.ruolo = 'admin';
  end if;
end $function$;

-- 2. Tabelle -------------------------------------------------------------------
create table if not exists public.corsi (
  id bigint generated always as identity primary key,
  nome text not null unique check (length(btrim(nome)) between 2 and 120),
  descrizione text,
  validita_mesi int check (validita_mesi is null or validita_mesi between 1 and 240),
  obbligatorio_per_tec boolean not null default false,
  attivo boolean not null default true,
  ordine int not null default 100,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
comment on table public.corsi is 'Catalogo corsi. validita_mesi null = nessuna scadenza.';

create table if not exists public.corsi_dipendente (
  id bigint generated always as identity primary key,
  dipendente_id bigint not null references public.dipendenti(id),
  corso_id bigint not null references public.corsi(id),
  data_conseguimento date not null,
  data_scadenza date,
  ente text,
  ore numeric(6,1) check (ore is null or ore >= 0),
  note text,
  attestato_path text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  check (data_scadenza is null or data_scadenza >= data_conseguimento)
);
comment on table public.corsi_dipendente is 'Ogni corso fatto. Il rinnovo è una NUOVA riga (storico); quello attuale è l''ultimo per dipendente+corso.';
create index if not exists corsi_dipendente_dc on public.corsi_dipendente (dipendente_id, corso_id, data_conseguimento desc, id desc);

create or replace function privato.tg_corso_dipendente()
 returns trigger language plpgsql set search_path to ''
as $function$
declare m int;
begin
  select validita_mesi into m from public.corsi where id = new.corso_id;
  if TG_OP = 'INSERT' then
    if new.data_scadenza is null and m is not null then
      new.data_scadenza := (new.data_conseguimento + make_interval(months => m))::date;
    end if;
  else
    new.updated_at := now();
    if new.data_conseguimento is distinct from old.data_conseguimento and new.data_scadenza is not distinct from old.data_scadenza then
      new.data_scadenza := case when m is null then null else (new.data_conseguimento + make_interval(months => m))::date end;
    end if;
  end if;
  return new;
end $function$;
create trigger corsi_dipendente_scadenza before insert or update on public.corsi_dipendente
  for each row execute function privato.tg_corso_dipendente();

alter table public.corsi enable row level security;
alter table public.corsi_dipendente enable row level security;
grant select, insert, update on public.corsi to authenticated;
grant select, insert, update, delete on public.corsi_dipendente to authenticated;

create policy corsi_leggi on public.corsi for select to authenticated
  using ((select public.is_formazione()) or (select public.is_hr()) or (select public.is_responsabile()));
create policy corsi_gestisci on public.corsi for all to authenticated
  using ((select public.is_formazione())) with check ((select public.is_formazione()));
create policy cd_leggi on public.corsi_dipendente for select to authenticated
  using ((select public.is_formazione()) or (select public.is_hr()));
create policy cd_gestisci on public.corsi_dipendente for all to authenticated
  using ((select public.is_formazione())) with check ((select public.is_formazione()));

-- Il responsabile formazione deve vedere tutti i dipendenti (sola lettura)
create policy dip_formazione_leggi on public.dipendenti for select to authenticated
  using ((select public.is_formazione()));

-- 3. Stato ---------------------------------------------------------------------
create or replace function privato.stato_corso(p_scadenza date)
 returns text language sql stable set search_path to ''
as $function$
  select case when p_scadenza is null then 'valido'
              when p_scadenza < public.oggi() then 'scaduto'
              when p_scadenza <= public.oggi() + 60 then 'in_scadenza'
              else 'valido' end;
$function$;

-- Corso attuale per dipendente+corso, con stato (security_invoker: rispetta RLS)
create or replace view public.corsi_attuali with (security_invoker = true) as
  select distinct on (cd.dipendente_id, cd.corso_id)
         cd.id, cd.dipendente_id, cd.corso_id, c.nome as corso, cd.data_conseguimento, cd.data_scadenza,
         cd.ente, cd.ore, cd.note, cd.attestato_path,
         case when cd.data_scadenza is null then 'valido'
              when cd.data_scadenza < (now() at time zone 'Europe/Rome')::date then 'scaduto'
              when cd.data_scadenza <= (now() at time zone 'Europe/Rome')::date + 60 then 'in_scadenza'
              else 'valido' end as stato
    from public.corsi_dipendente cd join public.corsi c on c.id = cd.corso_id
   order by cd.dipendente_id, cd.corso_id, cd.data_conseguimento desc, cd.id desc;
grant select on public.corsi_attuali to authenticated;

-- Righe «attuali» + obbligatori mancanti per i TEC attivi (uso interno)
create or replace function privato.formazione_righe()
 returns table (dipendente_id bigint, nome text, categoria text, corso_id bigint, corso text, obbligatorio boolean,
                data_conseguimento date, data_scadenza date, ente text, ore numeric, stato text, giorni int)
 language sql stable set search_path to ''
as $function$
  with att as (
    select distinct on (cd.dipendente_id, cd.corso_id) cd.*
      from public.corsi_dipendente cd
     order by cd.dipendente_id, cd.corso_id, cd.data_conseguimento desc, cd.id desc)
  select d.id, d.cognome || ' ' || d.nome, d.categoria, c.id, c.nome, c.obbligatorio_per_tec,
         a.data_conseguimento, a.data_scadenza, a.ente, a.ore,
         privato.stato_corso(a.data_scadenza), (a.data_scadenza - public.oggi())::int
    from att a join public.dipendenti d on d.id = a.dipendente_id join public.corsi c on c.id = a.corso_id
   where d.attivo
  union all
  select d.id, d.cognome || ' ' || d.nome, d.categoria, c.id, c.nome, true, null, null, null, null, 'mancante', null
    from public.dipendenti d cross join public.corsi c
   where d.attivo and d.categoria = 'TEC' and c.attivo and c.obbligatorio_per_tec
     and not exists (select 1 from public.corsi_dipendente x where x.dipendente_id = d.id and x.corso_id = c.id);
$function$;

-- 4. RPC -----------------------------------------------------------------------
create or replace function public.formazione_cruscotto()
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
  return (select jsonb_build_object(
    'validi', count(*) filter (where stato = 'valido'),
    'in_scadenza', count(*) filter (where stato = 'in_scadenza'),
    'scaduti', count(*) filter (where stato = 'scaduto'),
    'mancanti', count(*) filter (where stato = 'mancante'),
    'lista', coalesce(jsonb_agg(to_jsonb(r) order by case stato when 'scaduto' then 0 when 'mancante' then 1 else 2 end, data_scadenza nulls last, nome)
                        filter (where stato <> 'valido'), '[]'))
    from privato.formazione_righe() r);
end $function$;

create or replace function public.formazione_scadenze(p_giorni int default 60)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.data_scadenza, r.nome)
    from privato.formazione_righe() r
   where r.data_scadenza is not null and r.data_scadenza <= public.oggi() + greatest(coalesce(p_giorni, 60), 0)), '[]');
end $function$;

-- p_tipo: 'per_dipendente' | 'scadenze'
create or replace function public.formazione_report(p_tipo text, p_categoria text default null, p_dipendente bigint default null, p_giorni int default 60)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso riservato al responsabile formazione' using errcode = '42501';
  end if;
  if p_tipo not in ('per_dipendente', 'scadenze') then raise exception 'Report non valido'; end if;
  return jsonb_build_object('righe', coalesce((select jsonb_agg(jsonb_build_object(
      'dipendente', r.nome, 'categoria', r.categoria, 'corso', r.corso, 'obbligatorio', case when r.obbligatorio then 'Sì' else '' end,
      'data_conseguimento', r.data_conseguimento, 'data_scadenza', r.data_scadenza, 'ente', r.ente, 'ore', r.ore,
      'stato', case r.stato when 'valido' then 'Valido' when 'in_scadenza' then 'In scadenza' when 'scaduto' then 'Scaduto' else 'Mancante' end,
      'giorni', r.giorni)
      order by case when p_tipo = 'scadenze' then r.data_scadenza end, r.nome, r.corso)
    from privato.formazione_righe() r
   where (p_categoria is null or r.categoria = p_categoria) and (p_dipendente is null or r.dipendente_id = p_dipendente)
     and (p_tipo = 'per_dipendente' or (r.data_scadenza is not null and r.data_scadenza <= public.oggi() + greatest(coalesce(p_giorni, 60), 0)))), '[]'));
end $function$;

-- Registra lo stesso corso per uno o più dipendenti (rinnovo = nuova riga)
create or replace function public.formazione_registra(p_corso bigint, p_dipendenti bigint[], p_data date,
  p_scadenza date default null, p_ente text default null, p_ore numeric default null, p_note text default null, p_attestato text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare ids bigint[];
begin
  perform privato.richiedi_formazione();
  if p_data is null then raise exception 'Indica la data del corso'; end if;
  if p_data > public.oggi() then raise exception 'La data del corso non può essere nel futuro'; end if;
  if coalesce(cardinality(p_dipendenti), 0) = 0 then raise exception 'Scegli almeno un dipendente'; end if;
  if not exists (select 1 from public.corsi where id = p_corso) then raise exception 'Corso non trovato'; end if;
  with ins as (
    insert into public.corsi_dipendente (dipendente_id, corso_id, data_conseguimento, data_scadenza, ente, ore, note, attestato_path, created_by)
    select d.id, p_corso, p_data, p_scadenza, nullif(btrim(p_ente), ''), p_ore, nullif(btrim(p_note), ''), p_attestato, auth.uid()
      from public.dipendenti d where d.id = any(p_dipendenti)
    returning id)
  select array_agg(id) into ids from ins;
  if coalesce(cardinality(ids), 0) <> cardinality(array(select distinct unnest(p_dipendenti))) then
    raise exception 'Dipendente non trovato';
  end if;
  return jsonb_build_object('ok', true, 'id', to_jsonb(ids));
end $function$;

-- Responsabile flotta: solo stato per tecnico (nessun attestato, nessun dettaglio)
create or replace function public.formazione_stato_tecnici()
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (public.is_responsabile() or public.is_formazione() or public.is_hr()) then
    raise exception 'Accesso non consentito' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('dipendente_id', g.dipendente_id, 'nome', g.nome, 'stato', g.stato) order by g.nome)
    from (select dipendente_id, nome, case when bool_or(stato in ('scaduto', 'mancante')) then 'scaduto' else 'valido' end as stato
            from privato.formazione_righe() where categoria = 'TEC' group by dipendente_id, nome) g), '[]');
end $function$;

-- App dipendente: i miei corsi (sola lettura, attuali)
create or replace function public.dipendente_corsi(p_token text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare did bigint := privato.dipendente_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('corso', r.corso, 'data_conseguimento', r.data_conseguimento,
      'data_scadenza', r.data_scadenza, 'stato', r.stato, 'obbligatorio', r.obbligatorio) order by r.corso)
    from privato.formazione_righe() r where r.dipendente_id = did), '[]');
end $function$;

-- 5. Attestati (bucket privato) ---------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attestati', 'attestati', false, 10485760, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy attestati_leggi on storage.objects for select to authenticated
  using (bucket_id = 'attestati' and ((select public.is_formazione()) or (select public.is_hr())));
create policy attestati_carica on storage.objects for insert to authenticated
  with check (bucket_id = 'attestati' and ((select public.is_formazione()) or (select public.is_hr())));
create policy attestati_modifica on storage.objects for update to authenticated
  using (bucket_id = 'attestati' and ((select public.is_formazione()) or (select public.is_hr())));

-- 6. Corsi di esempio (DA VERIFICARE da parte dell'azienda: durate indicative, nessun valore legale)
insert into public.corsi (nome, descrizione, validita_mesi, obbligatorio_per_tec, ordine) values
 ('Formazione generale sicurezza (D.Lgs. 81/08)', 'Esempio da verificare con il RSPP: durata e validità indicative.', 60, true, 10),
 ('Formazione specifica rischio alto', 'Esempio da verificare con il RSPP.', 60, true, 20),
 ('Addetto antincendio – rischio elevato', 'Esempio da verificare con il RSPP.', 60, false, 30),
 ('Primo soccorso', 'Esempio da verificare con il RSPP.', 36, false, 40),
 ('Lavori in quota e DPI III cat.', 'Esempio da verificare con il RSPP.', 60, true, 50),
 ('PLE – piattaforme elevabili', 'Esempio da verificare con il RSPP.', 60, false, 60),
 ('Carrello elevatore', 'Esempio da verificare con il RSPP.', 60, false, 70),
 ('Spazi confinati', 'Esempio da verificare con il RSPP.', 60, false, 80),
 ('Manutenzione estintori (UNI 9994-1)', 'Esempio da verificare: nessuna scadenza impostata.', null, true, 90)
on conflict (nome) do nothing;
