-- 0038 Importazione mensile interventi da Taylor (pagina /interventi). Non distruttiva.
-- Tabelle nuove, separate da public.interventi (piano giornaliero). Accesso: solo is_responsabile() (include l'amministratore).

create table if not exists public.tecnici_sigle (
  sigla text primary key check (sigla ~ '^[A-Z0-9]{2,8}$'),
  dipendente_id bigint references public.dipendenti(id),
  attiva boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.tecnici_sigle is 'Sigle tecnico di Taylor (TECA…) collegate ai dipendenti.';

create table if not exists public.cap_zone (
  cap text primary key check (cap ~ '^\d{5}$'),
  zona int not null,
  tecnico_sigla text references public.tecnici_sigle(sigla)
);
comment on table public.cap_zone is 'Zone di Roma: CAP → zona e tecnico di riferimento (base per i suggerimenti).';

create table if not exists public.importazioni (
  id bigint generated always as identity primary key,
  file_nome text not null,
  mese date,
  righe int not null default 0, nuovi int not null default 0, aggiornati int not null default 0,
  scartati int not null default 0, fuori_lazio int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.interventi_importati (
  id bigint generated always as identity primary key,
  id_intervento text not null unique,          -- chiave Taylor (colonna "ID intervento"), nascosta in UI
  numero text, data_riferimento date,
  tecnico_sigla text, tecnico_id bigint references public.dipendenti(id),
  impianto text, cod_cliente text, cliente text,
  comune text, cap text check (cap is null or cap ~ '^\d{5}$'), prov text,
  indirizzo_originale text, via text, civico text, civico_geo text, note text,
  componenti int, tipo text, famiglie text[] not null default '{}',
  fuori_lazio boolean not null default false,
  lat double precision, lon double precision,
  geo_qualita text check (geo_qualita in ('esatto', 'via', 'centro_cap', 'centro_comune', 'manuale')),
  geo_indirizzo text, geo_dubbio boolean not null default false, geo_tentato_at timestamptz,
  stato text not null default 'da_pianificare' check (stato in ('da_pianificare', 'pianificato', 'eseguito', 'annullato')),
  durata_minuti int check (durata_minuti is null or durata_minuti > 0),
  importazione_id bigint references public.importazioni(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists interventi_importati_mese on public.interventi_importati (data_riferimento);
create index if not exists interventi_importati_geo on public.interventi_importati (geo_tentato_at) where lat is null;

create table if not exists public.geocache (
  chiave text primary key,
  lat double precision, lon double precision, qualita text, dettaglio jsonb,
  created_at timestamptz not null default now()
);
comment on table public.geocache is 'Cache Nominatim per indirizzo normalizzato (solo funzione geocodifica).';

create table if not exists public.regole_durata (
  famiglia text primary key,
  minuti_base int, minuti_per_componente numeric,
  updated_at timestamptz not null default now()
);
comment on table public.regole_durata is 'Regole durata per famiglia di servizio. Vuota: la compila l''ingegnere.';

-- tecnico_id dalla sigla
create or replace function privato.interventi_importati_tecnico() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' or new.tecnico_sigla is distinct from old.tecnico_sigla then
    new.tecnico_id := (select s.dipendente_id from public.tecnici_sigle s where s.sigla = new.tecnico_sigla);
  end if;
  return new;
end $$;
create or replace trigger interventi_importati_tecnico before insert or update on public.interventi_importati
  for each row execute function privato.interventi_importati_tecnico();

create or replace function privato.tecnici_sigle_propaga() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.dipendente_id is distinct from old.dipendente_id then
    update public.interventi_importati set tecnico_id = new.dipendente_id where tecnico_sigla = new.sigla;
  end if;
  return new;
end $$;
create or replace trigger tecnici_sigle_propaga before update on public.tecnici_sigle
  for each row execute function privato.tecnici_sigle_propaga();

-- RLS
alter table public.tecnici_sigle enable row level security;
alter table public.cap_zone enable row level security;
alter table public.importazioni enable row level security;
alter table public.interventi_importati enable row level security;
alter table public.geocache enable row level security;      -- nessuna policy: solo service role
alter table public.regole_durata enable row level security;
grant select, insert, update on public.tecnici_sigle, public.cap_zone, public.importazioni, public.interventi_importati, public.regole_durata to authenticated;
grant delete on public.regole_durata to authenticated;
create policy tecnici_sigle_resp on public.tecnici_sigle for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
create policy cap_zone_resp on public.cap_zone for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
create policy importazioni_resp on public.importazioni for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
create policy interventi_importati_resp on public.interventi_importati for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
create policy regole_durata_resp on public.regole_durata for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));

-- Importazione: UPSERT per id_intervento. Su aggiornamento: se cambia l'indirizzo si azzera la posizione;
-- se il file non ha tecnico si tiene quello assegnato a mano; lo stato resta quello del portale.
create or replace function public.importa_interventi(p_file text, p_mese date, p_scartati int, p_righe jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare v_imp bigint; v_nuovi int; v_tot int; v_fuori int;
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  insert into public.importazioni (file_nome, mese, scartati) values (p_file, p_mese, coalesce(p_scartati, 0)) returning id into v_imp;
  create temp table _r on commit drop as
    select * from jsonb_to_recordset(p_righe) as x(id_intervento text, numero text, data_riferimento date, tecnico_sigla text, impianto text,
      cod_cliente text, cliente text, comune text, cap text, prov text, indirizzo_originale text, via text, civico text, civico_geo text,
      note text, componenti int, tipo text, famiglie text[], fuori_lazio boolean);
  select count(*), count(*) filter (where fuori_lazio) into v_tot, v_fuori from _r;
  select count(*) into v_nuovi from _r where not exists (select 1 from public.interventi_importati i where i.id_intervento = _r.id_intervento);
  insert into public.tecnici_sigle (sigla) select distinct tecnico_sigla from _r where tecnico_sigla ~ '^[A-Z0-9]{2,8}$' on conflict do nothing;
  insert into public.interventi_importati as i (id_intervento, numero, data_riferimento, tecnico_sigla, impianto, cod_cliente, cliente, comune, cap, prov,
      indirizzo_originale, via, civico, civico_geo, note, componenti, tipo, famiglie, fuori_lazio, importazione_id)
    select id_intervento, numero, data_riferimento, nullif(tecnico_sigla, ''), impianto, cod_cliente, cliente, comune, cap, prov,
      indirizzo_originale, via, civico, civico_geo, note, componenti, tipo, coalesce(famiglie, '{}'), coalesce(fuori_lazio, false), v_imp from _r
  on conflict (id_intervento) do update set
    numero = excluded.numero, data_riferimento = excluded.data_riferimento,
    tecnico_sigla = coalesce(excluded.tecnico_sigla, i.tecnico_sigla),
    impianto = excluded.impianto, cod_cliente = excluded.cod_cliente, cliente = excluded.cliente,
    comune = excluded.comune, cap = excluded.cap, prov = excluded.prov, indirizzo_originale = excluded.indirizzo_originale,
    via = excluded.via, civico = excluded.civico, civico_geo = excluded.civico_geo, note = excluded.note,
    componenti = excluded.componenti, tipo = excluded.tipo, famiglie = excluded.famiglie, fuori_lazio = excluded.fuori_lazio,
    importazione_id = excluded.importazione_id,
    lat = case when i.geo_qualita = 'manuale' or (i.via, i.civico, i.cap, i.comune) is not distinct from (excluded.via, excluded.civico, excluded.cap, excluded.comune) then i.lat end,
    lon = case when i.geo_qualita = 'manuale' or (i.via, i.civico, i.cap, i.comune) is not distinct from (excluded.via, excluded.civico, excluded.cap, excluded.comune) then i.lon end,
    geo_qualita = case when i.geo_qualita = 'manuale' or (i.via, i.civico, i.cap, i.comune) is not distinct from (excluded.via, excluded.civico, excluded.cap, excluded.comune) then i.geo_qualita end,
    geo_tentato_at = case when i.geo_qualita = 'manuale' or (i.via, i.civico, i.cap, i.comune) is not distinct from (excluded.via, excluded.civico, excluded.cap, excluded.comune) then i.geo_tentato_at end;
  update public.importazioni set righe = v_tot, nuovi = v_nuovi, aggiornati = v_tot - v_nuovi, fuori_lazio = v_fuori where id = v_imp;
  return jsonb_build_object('importazione_id', v_imp, 'righe', v_tot, 'nuovi', v_nuovi, 'aggiornati', v_tot - v_nuovi, 'scartati', coalesce(p_scartati, 0), 'fuori_lazio', v_fuori);
end $$;
revoke execute on function public.importa_interventi(text, date, int, jsonb) from public, anon;
grant execute on function public.importa_interventi(text, date, int, jsonb) to authenticated;

-- Dati iniziali: sigle e zone CAP di Roma
insert into public.tecnici_sigle (sigla) values ('TECA'), ('TECB'), ('TECE'), ('TECI'), ('TECF'), ('TECC'), ('TECH') on conflict do nothing;
insert into public.cap_zone (cap, zona, tecnico_sigla)
select c, z, t from (values
  (1, 'TECB', array['00185']), (1, 'TECI', array['00187']),
  (2, 'TECB', array['00153', '00193']), (2, 'TECI', array['00184', '00186']),
  (3, 'TECB', array['00192', '00195', '00196', '00197', '00198']),
  (4, 'TECA', array['00135']), (4, 'TECE', array['00137', '00138', '00139', '00141', '00188', '00189', '00191']), (4, 'TECB', array['00194', '00199']),
  (5, 'TECB', array['00136']), (5, 'TECA', array['00146', '00148', '00149', '00151', '00152', '00163', '00164', '00165', '00166', '00167', '00168']),
  (6, 'TECA', array['00119', '00121', '00122', '00123', '00124', '00125', '00126', '00127', '00128', '00134', '00142', '00143', '00144', '00145', '00147', '00154']),
  (7, 'TECE', array['00118', '00132', '00133', '00169', '00171', '00172', '00173', '00174', '00175', '00176', '00177', '00178', '00179', '00181', '00182', '00183', '00043']),
  (8, 'TECE', array['00131', '00155', '00156', '00157', '00158', '00159', '00161', '00162'])
) v(z, t, caps), unnest(caps) c
on conflict (cap) do nothing;
