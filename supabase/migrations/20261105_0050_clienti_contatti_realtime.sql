-- 0050 Rubrica contatti dei clienti (Taylor non ha telefoni/email) + storia delle modifiche + import; tempo reale per il centralino.
-- Solo dati di contatto aziendali necessari. Scrittura centralino/admin, lettura anche direzione.

create table if not exists public.clienti_contatti (
  id bigint generated always as identity primary key,
  cod_cliente text,
  cliente_nome text not null check (length(btrim(cliente_nome)) between 1 and 200),
  sede text,
  contatto_nome text,
  ruolo text,
  telefono text,
  cellulare text,
  email text check (email is null or email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  preferito boolean not null default false,
  note text,
  attivo boolean not null default true,
  fonte text not null default 'centralino' check (fonte in ('centralino', 'import', 'manuale')),
  aggiornato_da text,
  aggiornato_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
comment on table public.clienti_contatti is 'Contatti dei clienti (amministratore, portiere…), anche per sede. Solo dati di contatto aziendali.';
create index if not exists clienti_contatti_cod on public.clienti_contatti (cod_cliente);
create index if not exists clienti_contatti_nome on public.clienti_contatti (lower(cliente_nome));

create table if not exists public.clienti_contatti_storia (
  id bigint generated always as identity primary key,
  contatto_id bigint not null references public.clienti_contatti(id),
  campo text not null,
  da text,
  a text,
  motivo text,
  pratica_id bigint references public.pratiche(id),
  autore uuid default auth.uid(),
  autore_nome text,
  at timestamptz not null default now()
);
comment on table public.clienti_contatti_storia is 'Storia delle modifiche ai contatti: solo in aggiunta. Conta come «aggiornamento anagrafica».';
create trigger clienti_contatti_storia_solo_aggiunta before update or delete on public.clienti_contatti_storia
  for each row execute function privato.tg_solo_aggiunta();

alter table public.clienti_contatti enable row level security;
alter table public.clienti_contatti_storia enable row level security;
create policy cc_contatti_leggi on public.clienti_contatti for select to authenticated using ((select public.is_centralino_lettura()));
create policy cc_storia_leggi on public.clienti_contatti_storia for select to authenticated using ((select public.is_centralino_lettura()));
grant select on public.clienti_contatti, public.clienti_contatti_storia to authenticated;

-- telefono italiano: +39, solo cifre
create or replace function privato.ct_tel(p text) returns text
language plpgsql immutable set search_path = '' as $$
declare x text := regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g');
begin
  if x = '' then return null; end if;
  if x like '00%' then x := '+' || substr(x, 3); end if;
  if x !~ '^\+' then x := '+39' || x; end if;
  if x !~ '^\+[0-9]{6,15}$' then raise exception 'Numero di telefono non valido: %', p; end if;
  return x;
end $$;

-- salva (nuovo o modifica) con storia dei campi cambiati
create or replace function privato.ct_salva_contatto(p jsonb, p_fonte text, p_pratica bigint) returns bigint
language plpgsql set search_path = '' as $$
declare v public.clienti_contatti; nid bigint := nullif(p->>'id', '')::bigint; k text; em text; tel text; cel text; aut text := privato.ct_autore();
begin
  em := nullif(lower(btrim(coalesce(p->>'email', ''))), '');
  if em is not null and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida: %', em; end if;
  tel := privato.ct_tel(p->>'telefono'); cel := privato.ct_tel(p->>'cellulare');
  if nid is null then
    if nullif(btrim(coalesce(p->>'cliente_nome', '')), '') is null then raise exception 'Indica il cliente del contatto'; end if;
    -- stesso cliente + stesso contatto/telefono/email: aggiorna invece di duplicare
    select c.id into nid from public.clienti_contatti c
     where c.attivo and (c.cod_cliente = nullif(btrim(coalesce(p->>'cod_cliente', '')), '') or (c.cod_cliente is null and lower(c.cliente_nome) = lower(btrim(p->>'cliente_nome'))))
       and ((em is not null and c.email = em) or (tel is not null and (c.telefono = tel or c.cellulare = tel)) or (cel is not null and (c.cellulare = cel or c.telefono = cel))
            or (nullif(btrim(coalesce(p->>'contatto_nome', '')), '') is not null and lower(c.contatto_nome) = lower(btrim(p->>'contatto_nome'))))
     order by c.aggiornato_at desc limit 1;
  end if;
  if nid is null then
    insert into public.clienti_contatti (cod_cliente, cliente_nome, sede, contatto_nome, ruolo, telefono, cellulare, email, preferito, note, fonte, aggiornato_da)
    values (nullif(btrim(coalesce(p->>'cod_cliente', '')), ''), btrim(p->>'cliente_nome'), nullif(btrim(coalesce(p->>'sede', '')), ''),
      nullif(btrim(coalesce(p->>'contatto_nome', '')), ''), nullif(btrim(coalesce(p->>'ruolo', '')), ''), tel, cel, em,
      coalesce((p->>'preferito')::boolean, false), nullif(btrim(coalesce(p->>'note', '')), ''), p_fonte, aut)
    returning id into nid;
    insert into public.clienti_contatti_storia (contatto_id, campo, da, a, motivo, pratica_id, autore_nome)
    values (nid, 'nuovo', null, concat_ws(' · ', p->>'contatto_nome', tel, cel, em), coalesce(p->>'motivo', 'Nuovo contatto'), p_pratica, aut);
    return nid;
  end if;
  select * into v from public.clienti_contatti where id = nid for update;
  if v.id is null then raise exception 'Contatto non trovato'; end if;
  update public.clienti_contatti set
    contatto_nome = case when p ? 'contatto_nome' and nullif(btrim(coalesce(p->>'contatto_nome', '')), '') is not null then btrim(p->>'contatto_nome') else contatto_nome end,
    ruolo = case when p ? 'ruolo' then nullif(btrim(coalesce(p->>'ruolo', '')), '') else ruolo end,
    sede = case when p ? 'sede' and nullif(btrim(coalesce(p->>'sede', '')), '') is not null then btrim(p->>'sede') else sede end,
    telefono = coalesce(tel, telefono), cellulare = coalesce(cel, cellulare), email = coalesce(em, email),
    preferito = case when p ? 'preferito' then coalesce((p->>'preferito')::boolean, false) else preferito end,
    note = case when p ? 'note' then nullif(btrim(coalesce(p->>'note', '')), '') else note end,
    attivo = case when p ? 'attivo' then coalesce((p->>'attivo')::boolean, true) else attivo end,
    aggiornato_da = aut, aggiornato_at = now()
   where id = nid;
  foreach k in array array['contatto_nome', 'ruolo', 'sede', 'telefono', 'cellulare', 'email', 'preferito', 'note', 'attivo'] loop
    if (select to_jsonb(c) ->> k from public.clienti_contatti c where c.id = nid) is distinct from (to_jsonb(v) ->> k) then
      insert into public.clienti_contatti_storia (contatto_id, campo, da, a, motivo, pratica_id, autore_nome)
      values (nid, k, to_jsonb(v) ->> k, (select to_jsonb(c) ->> k from public.clienti_contatti c where c.id = nid), nullif(btrim(coalesce(p->>'motivo', '')), ''), p_pratica, aut);
    end if;
  end loop;
  -- un solo preferito per cliente
  if coalesce((p->>'preferito')::boolean, false) then
    update public.clienti_contatti set preferito = false
     where id <> nid and preferito and (cod_cliente = v.cod_cliente or (v.cod_cliente is null and lower(cliente_nome) = lower(v.cliente_nome)));
  end if;
  return nid;
end $$;

create or replace function public.centralino_salva_contatto(p jsonb) returns bigint
language plpgsql security definer set search_path = '' as $$
begin
  perform privato.richiedi_centralino();
  return privato.ct_salva_contatto(p, coalesce(nullif(p->>'fonte', ''), 'manuale'), nullif(p->>'pratica_id', '')::bigint);
end $$;

create or replace function public.centralino_contatti(p_codice text, p_nome text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(to_jsonb(c) order by c.preferito desc, c.aggiornato_at desc) from public.clienti_contatti c
    where c.attivo and ((nullif(p_codice, '') is not null and c.cod_cliente = p_codice)
                        or (nullif(btrim(coalesce(p_nome, '')), '') is not null and lower(c.cliente_nome) = lower(btrim(p_nome))))), '[]'::jsonb);
end $$;

-- import da Excel/CSV (righe già lette e mappate nel browser)
create or replace function public.centralino_importa_contatti(p_righe jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb; ok int := 0; ko int := 0; errori jsonb := '[]'; i int := 0;
begin
  perform privato.richiedi_centralino();
  if jsonb_array_length(coalesce(p_righe, '[]')) > 5000 then raise exception 'Massimo 5000 righe per volta'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_righe, '[]')) loop
    i := i + 1;
    begin
      perform privato.ct_salva_contatto(r || jsonb_build_object('motivo', 'Import'), 'import', null);
      ok := ok + 1;
    exception when others then
      ko := ko + 1; if jsonb_array_length(errori) < 50 then errori := errori || jsonb_build_object('riga', i, 'errore', sqlerrm); end if;
    end;
  end loop;
  return jsonb_build_object('importati', ok, 'scartati', ko, 'errori', errori);
end $$;

-- ogni pratica nuova salva il contatto in rubrica
create or replace function privato.tg_pratica_contatto() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.telefono, new.email, new.contatto_nome) is not null then
    begin
      perform privato.ct_salva_contatto(jsonb_build_object('cod_cliente', new.cliente_codice, 'cliente_nome', new.cliente_nome, 'sede', new.sede,
        'contatto_nome', new.contatto_nome, 'telefono', new.telefono, 'email', new.email, 'motivo', 'Dalla pratica ' || new.numero), 'centralino', new.id);
    exception when others then null; -- un telefono scritto male non blocca la pratica
    end;
  end if;
  return null;
end $$;
create trigger pratiche_contatto after insert on public.pratiche for each row execute function privato.tg_pratica_contatto();

grant execute on function public.centralino_salva_contatto(jsonb), public.centralino_contatti(text, text), public.centralino_importa_contatti(jsonb) to authenticated;

-- registro: gli aggiornamenti di contatti (modifiche, non i nuovi) contano come «aggiornamento anagrafica»
create or replace function public.centralino_registro_giorno(p_data date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g date := coalesce(p_data, (now() at time zone 'Europe/Rome')::date);
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return (
    with pr as (select * from public.pratiche where (created_at at time zone 'Europe/Rome')::date = g),
         ci as (select * from public.centralino_chiamate_info where (at at time zone 'Europe/Rome')::date = g),
         ca as (select distinct contatto_id from public.clienti_contatti_storia where (at at time zone 'Europe/Rome')::date = g and campo <> 'nuovo')
    select jsonb_build_object(
      'data', g,
      'telefonate', (select count(*) from pr where canale = 'telefono') + (select count(*) from ci where canale = 'telefono'),
      'whatsapp', (select count(*) from pr where canale = 'whatsapp') + (select count(*) from ci where canale = 'whatsapp'),
      'email', (select count(*) from pr where canale = 'email') + (select count(*) from ci where canale = 'email'),
      'offerte_tablet', (select count(*) from pr where tipo like 'offerta%' and canale = 'tablet_tmq'),
      'offerte_whatsapp', (select count(*) from pr where tipo like 'offerta%' and canale = 'whatsapp'),
      'offerte_cliente', (select count(*) from pr where tipo like 'offerta%' and canale in ('telefono', 'email', 'altro')),
      'aggiornamenti_anagrafica', (select count(*) from pr where tipo = 'modifica') + (select count(*) from ca),
      'contatti_aggiornati', (select count(*) from ca),
      'chiamate_info', (select count(*) from ci),
      'pratiche', (select count(*) from pr),
      'chiuse', (select count(*) from public.pratiche where (closed_at at time zone 'Europe/Rome')::date = g and esito <> 'annullata')));
end $$;

-- tempo reale (RLS valida anche qui)
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['pratiche', 'pratiche_eventi', 'chiamate_trasferite', 'notifiche'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- Anagrafica clienti da Taylor / Ad Hoc ----------------------------------------------------
create table if not exists public.clienti (
  id bigint generated always as identity primary key,
  cod_cliente text not null unique,
  nome text not null,
  indirizzo text, cap text, comune text, prov text,
  telefono text, cellulare text, email text, pec text, referente text,
  sedi jsonb not null default '[]',
  stato_cliente text check (stato_cliente is null or stato_cliente in ('nuovo', 'ex_cliente', 'attivo')),
  fonte text not null default 'import' check (fonte in ('import', 'manuale', 'centralino')),
  aggiornato_at timestamptz not null default now(),
  aggiornato_da text,
  aggiornato_manuale_at timestamptz
);
comment on table public.clienti is 'Anagrafica clienti importata da Taylor/Ad Hoc. Le modifiche manuali (aggiornato_manuale_at) non vengono sovrascritte da un file più vecchio senza «sovrascrivi».';
create table if not exists public.clienti_storia (
  id bigint generated always as identity primary key,
  cliente_id bigint not null references public.clienti(id),
  campo text not null, da text, a text, motivo text,
  importazione_id bigint, autore_nome text, at timestamptz not null default now()
);
create trigger clienti_storia_solo_aggiunta before update or delete on public.clienti_storia for each row execute function privato.tg_solo_aggiunta();
create table if not exists public.clienti_importazioni (
  id bigint generated always as identity primary key,
  file text, autore_nome text, at timestamptz not null default now(),
  nuovi int not null default 0, aggiornati int not null default 0, invariati int not null default 0, protetti int not null default 0, errori int not null default 0,
  dettaglio_errori jsonb not null default '[]'
);
alter table public.clienti enable row level security;
alter table public.clienti_storia enable row level security;
alter table public.clienti_importazioni enable row level security;
create policy clienti_leggi on public.clienti for select to authenticated using ((select public.is_centralino_lettura()));
create policy clienti_storia_leggi on public.clienti_storia for select to authenticated using ((select public.is_centralino_lettura()));
create policy clienti_imp_leggi on public.clienti_importazioni for select to authenticated using ((select public.is_centralino_lettura()));
grant select on public.clienti, public.clienti_storia, public.clienti_importazioni to authenticated;

insert into public.centralino_impostazioni (chiave, valore, descrizione) values
  ('mappa_import_clienti', '{}', 'Ultima corrispondenza colonne → campi usata per importare i clienti (si ripropone al prossimo file).')
on conflict (chiave) do nothing;

-- p_righe: [{cod_cliente, nome, indirizzo, cap, comune, prov, telefono, cellulare, email, pec, referente, sedi?}]
-- p_prova = true: nessuna scrittura, solo conteggi e differenze
create or replace function public.centralino_importa_clienti(p_righe jsonb, p_file text, p_prova boolean default true, p_sovrascrivi boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v public.clienti; i int := 0; n_nuovi int := 0; n_agg int := 0; n_inv int := 0; n_prot int := 0; n_err int := 0;
  errori jsonb := '[]'; diff jsonb := '[]'; cambi jsonb; k text; nuovo text; cod text; imp_id bigint; aut text := privato.ct_autore(); v_tel text; v_cel text; v_em text; v_pec text;
  campi text[] := array['nome', 'indirizzo', 'cap', 'comune', 'prov', 'telefono', 'cellulare', 'email', 'pec', 'referente'];
begin
  perform privato.richiedi_centralino();
  if jsonb_array_length(coalesce(p_righe, '[]')) > 20000 then raise exception 'Massimo 20.000 righe per volta'; end if;
  if not p_prova then
    insert into public.clienti_importazioni (file, autore_nome) values (p_file, aut) returning id into imp_id;
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_righe, '[]')) loop
    i := i + 1;
    begin
      cod := nullif(btrim(coalesce(r->>'cod_cliente', '')), '');
      if cod is null then raise exception 'Codice cliente mancante'; end if;
      if nullif(btrim(coalesce(r->>'nome', '')), '') is null then raise exception 'Ragione sociale mancante'; end if;
      v_tel := privato.ct_tel(r->>'telefono'); v_cel := privato.ct_tel(r->>'cellulare');
      v_em := nullif(lower(btrim(coalesce(r->>'email', ''))), ''); v_pec := nullif(lower(btrim(coalesce(r->>'pec', ''))), '');
      if v_em is not null and v_em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email non valida: %', v_em; end if;
      if v_pec is not null and v_pec !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'PEC non valida: %', v_pec; end if;
      r := r || jsonb_build_object('telefono', v_tel, 'cellulare', v_cel, 'email', v_em, 'pec', v_pec);
      select * into v from public.clienti where cod_cliente = cod;
      if v.id is null then
        n_nuovi := n_nuovi + 1;
        if not p_prova then
          insert into public.clienti (cod_cliente, nome, indirizzo, cap, comune, prov, telefono, cellulare, email, pec, referente, sedi, fonte, aggiornato_da, stato_cliente)
          values (cod, btrim(r->>'nome'), nullif(btrim(coalesce(r->>'indirizzo', '')), ''), nullif(btrim(coalesce(r->>'cap', '')), ''), nullif(btrim(coalesce(r->>'comune', '')), ''),
            nullif(btrim(coalesce(r->>'prov', '')), ''), v_tel, v_cel, v_em, v_pec, nullif(btrim(coalesce(r->>'referente', '')), ''), coalesce(r->'sedi', '[]'), 'import', aut,
            privato.ct_stato_cliente(cod, r->>'nome'))
          returning * into v;
          insert into public.clienti_storia (cliente_id, campo, a, motivo, importazione_id, autore_nome) values (v.id, 'nuovo', v.nome, 'Import ' || coalesce(p_file, ''), imp_id, aut);
        end if;
      elsif v.aggiornato_manuale_at is not null and not p_sovrascrivi then
        n_prot := n_prot + 1;
      else
        cambi := '{}';
        foreach k in array campi loop
          nuovo := nullif(btrim(coalesce(r->>k, '')), '');
          if nuovo is not null and nuovo is distinct from (to_jsonb(v) ->> k) then cambi := cambi || jsonb_build_object(k, jsonb_build_object('da', to_jsonb(v) ->> k, 'a', nuovo)); end if;
        end loop;
        if cambi = '{}'::jsonb then n_inv := n_inv + 1;
        else
          n_agg := n_agg + 1;
          if jsonb_array_length(diff) < 500 then diff := diff || jsonb_build_object('riga', i, 'cod_cliente', cod, 'nome', v.nome, 'cambi', cambi); end if;
          if not p_prova then
            update public.clienti set
              nome = coalesce(nullif(btrim(coalesce(r->>'nome', '')), ''), nome), indirizzo = coalesce(nullif(btrim(coalesce(r->>'indirizzo', '')), ''), indirizzo),
              cap = coalesce(nullif(btrim(coalesce(r->>'cap', '')), ''), cap), comune = coalesce(nullif(btrim(coalesce(r->>'comune', '')), ''), comune),
              prov = coalesce(nullif(btrim(coalesce(r->>'prov', '')), ''), prov), telefono = coalesce(v_tel, telefono), cellulare = coalesce(v_cel, cellulare),
              email = coalesce(v_em, email), pec = coalesce(v_pec, pec), referente = coalesce(nullif(btrim(coalesce(r->>'referente', '')), ''), referente),
              sedi = case when jsonb_array_length(coalesce(r->'sedi', '[]')) > 0 then r->'sedi' else sedi end,
              aggiornato_at = now(), aggiornato_da = aut, aggiornato_manuale_at = case when p_sovrascrivi then null else aggiornato_manuale_at end
             where id = v.id;
            insert into public.clienti_storia (cliente_id, campo, da, a, motivo, importazione_id, autore_nome)
            select v.id, e.key, e.value->>'da', e.value->>'a', 'Import ' || coalesce(p_file, ''), imp_id, aut from jsonb_each(cambi) e;
          end if;
        end if;
      end if;
      -- contatto principale anche in rubrica
      if not p_prova and coalesce(v_tel, v_cel, v_em) is not null then
        perform privato.ct_salva_contatto(jsonb_build_object('cod_cliente', cod, 'cliente_nome', r->>'nome', 'contatto_nome', r->>'referente', 'ruolo', 'referente',
          'telefono', v_tel, 'cellulare', v_cel, 'email', v_em, 'motivo', 'Import ' || coalesce(p_file, '')), 'import', null);
      end if;
    exception when others then
      n_err := n_err + 1;
      if jsonb_array_length(errori) < 1000 then errori := errori || jsonb_build_object('riga', i, 'cod_cliente', r->>'cod_cliente', 'errore', sqlerrm); end if;
    end;
  end loop;
  if not p_prova then
    update public.clienti_importazioni set nuovi = n_nuovi, aggiornati = n_agg, invariati = n_inv, protetti = n_prot, errori = n_err, dettaglio_errori = errori where id = imp_id;
  end if;
  return jsonb_build_object('prova', p_prova, 'nuovi', n_nuovi, 'aggiornati', n_agg, 'invariati', n_inv, 'protetti', n_prot, 'errori', n_err,
    'dettaglio_errori', errori, 'differenze', diff, 'importazione_id', imp_id);
end $$;
grant execute on function public.centralino_importa_clienti(jsonb, text, boolean, boolean) to authenticated;

-- modifica manuale di un cliente (protetta dagli import successivi)
create or replace function public.centralino_aggiorna_cliente(p_cod text, p jsonb, p_motivo text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.clienti; k text;
begin
  perform privato.richiedi_centralino();
  select * into v from public.clienti where cod_cliente = p_cod for update;
  if v.id is null then raise exception 'Cliente non trovato'; end if;
  update public.clienti set
    telefono = case when p ? 'telefono' then privato.ct_tel(p->>'telefono') else telefono end,
    cellulare = case when p ? 'cellulare' then privato.ct_tel(p->>'cellulare') else cellulare end,
    email = case when p ? 'email' then nullif(lower(btrim(coalesce(p->>'email', ''))), '') else email end,
    referente = case when p ? 'referente' then nullif(btrim(coalesce(p->>'referente', '')), '') else referente end,
    indirizzo = case when p ? 'indirizzo' then nullif(btrim(coalesce(p->>'indirizzo', '')), '') else indirizzo end,
    aggiornato_at = now(), aggiornato_manuale_at = now(), aggiornato_da = privato.ct_autore(), fonte = 'manuale'
   where id = v.id;
  foreach k in array array['telefono', 'cellulare', 'email', 'referente', 'indirizzo'] loop
    if (select to_jsonb(c) ->> k from public.clienti c where c.id = v.id) is distinct from (to_jsonb(v) ->> k) then
      insert into public.clienti_storia (cliente_id, campo, da, a, motivo, autore_nome)
      values (v.id, k, to_jsonb(v) ->> k, (select to_jsonb(c) ->> k from public.clienti c where c.id = v.id), p_motivo, privato.ct_autore());
    end if;
  end loop;
end $$;
grant execute on function public.centralino_aggiorna_cliente(text, jsonb, text) to authenticated;

-- suggerimenti: anche dall'anagrafica clienti importata
create or replace function public.centralino_clienti(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_q, '')); pat text; mesi int; lim date;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  select coalesce((valore #>> '{}')::int, 12) into mesi from public.centralino_impostazioni where chiave = 'mesi_cliente_attivo';
  lim := (now() - make_interval(months => coalesce(mesi, 12)))::date;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(x order by x->>'nome') from (
      select jsonb_build_object('codice', coalesce(c.cod_cliente, i.cod_cliente), 'nome', coalesce(c.nome, i.nome), 'sedi', coalesce(i.sedi, jsonb_array_length(c.sedi)), 'fonte', 'taylor',
               'indirizzo', c.indirizzo, 'cap', c.cap, 'comune', c.comune, 'telefono', coalesce(c.telefono, c.cellulare), 'email', c.email, 'contatto', c.referente,
               'stato_cliente', coalesce(c.stato_cliente, case when i.ultimo >= lim then 'attivo' when i.cod_cliente is not null then 'ex_cliente' end)) x
        from (select i2.cod_cliente, max(i2.cliente) nome, count(distinct i2.impianto)::int sedi, max(i2.data_riferimento) ultimo
                from public.interventi_importati i2 where i2.cod_cliente is not null and (i2.cliente ilike pat or i2.cod_cliente ilike pat) group by i2.cod_cliente) i
        full join (select * from public.clienti c2 where c2.nome ilike pat or c2.cod_cliente ilike pat or c2.telefono ilike pat or c2.email ilike pat) c on c.cod_cliente = i.cod_cliente
       limit 15) t), '[]'::jsonb)
    || coalesce((select jsonb_agg(y) from (
      select distinct on (lower(p.cliente_nome)) jsonb_build_object('codice', p.cliente_codice, 'nome', p.cliente_nome, 'contatto', p.contatto_nome,
               'telefono', p.telefono, 'email', p.email, 'indirizzo', p.indirizzo, 'cap', p.cap, 'comune', p.comune, 'fonte', 'pratiche', 'stato_cliente', p.stato_cliente) y
        from public.pratiche p
       where p.cliente_codice is null and (p.cliente_nome ilike pat or p.telefono ilike pat or p.contatto_nome ilike pat or p.email ilike pat)
       order by lower(p.cliente_nome), p.created_at desc limit 8) t), '[]'::jsonb);
end $$;
