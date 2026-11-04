-- 0040 Coordinate permanenti per impianto (cod. cliente + impianto). Non distruttiva.
-- Ogni importazione riusa le coordinate: si geocodificano solo impianti nuovi o con indirizzo cambiato.
-- Le correzioni manuali (verificato = true) non vengono mai sovrascritte da importazioni o geocodifiche.

alter table public.interventi_importati add column if not exists geo_fonte text check (geo_fonte in ('photon', 'nominatim', 'manuale', 'import', 'impianto'));

create or replace function privato.chiave_impianto(p_cod text, p_imp text) returns text
language sql immutable set search_path = '' as $$
  select case when nullif(trim(p_imp), '') is null then null
    else lower(regexp_replace(coalesce(p_cod, ''), '\s+', '', 'g')) || '|' || lower(regexp_replace(p_imp, '\s+', '', 'g')) end
$$;
create or replace function privato.norm_indirizzo(p_via text, p_civico text, p_cap text, p_comune text) returns text
language sql immutable set search_path = '' as $$
  select trim(regexp_replace(lower(concat_ws(' ', p_via, p_civico, p_cap, p_comune)), '[^a-z0-9]+', ' ', 'g'))
$$;

create table if not exists public.impianti_posizione (
  chiave text primary key,
  cod_cliente text, impianto text not null,
  indirizzo_normalizzato text, cap text, comune text,
  lat double precision not null, lon double precision not null,
  geo_qualita text check (geo_qualita in ('esatto', 'via', 'centro_cap', 'centro_comune', 'manuale')),
  fonte text not null check (fonte in ('photon', 'nominatim', 'manuale', 'import')),
  verificato boolean not null default false,
  aggiornato_da uuid default auth.uid(),
  aggiornato_at timestamptz not null default now()
);
comment on table public.impianti_posizione is 'Coordinate permanenti per impianto (Cod. cli. + Imp. num/serie). verificato = corretto a mano, mai sovrascritto.';
alter table public.impianti_posizione enable row level security;
grant select, insert, update on public.impianti_posizione to authenticated;
create policy impianti_posizione_resp on public.impianti_posizione for all to authenticated
  using ((select public.is_responsabile())) with check ((select public.is_responsabile()));

-- Quando un intervento riceve coordinate (geocodifica, import, manuale) → salva/aggiorna la posizione dell'impianto.
create or replace function privato.interventi_salva_impianto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text := privato.chiave_impianto(new.cod_cliente, new.impianto);
  man boolean := new.geo_qualita = 'manuale';
  f text := case when new.geo_qualita = 'manuale' then 'manuale' else coalesce(nullif(new.geo_fonte, 'impianto'), 'photon') end;
begin
  if k is null or new.lat is null or new.lon is null or new.geo_fonte = 'impianto' then return null; end if;
  insert into public.impianti_posizione as p (chiave, cod_cliente, impianto, indirizzo_normalizzato, cap, comune, lat, lon, geo_qualita, fonte, verificato, aggiornato_da)
  values (k, new.cod_cliente, new.impianto, privato.norm_indirizzo(new.via, new.civico, new.cap, new.comune), new.cap, new.comune, new.lat, new.lon, new.geo_qualita, f, man, auth.uid())
  on conflict (chiave) do update set
    indirizzo_normalizzato = excluded.indirizzo_normalizzato, cap = excluded.cap, comune = excluded.comune,
    lat = excluded.lat, lon = excluded.lon, geo_qualita = excluded.geo_qualita, fonte = excluded.fonte,
    verificato = excluded.verificato, aggiornato_da = excluded.aggiornato_da, aggiornato_at = now()
  where excluded.verificato or not p.verificato;   -- una posizione verificata cambia solo con un'altra correzione manuale
  return null;
end $$;
create or replace trigger interventi_salva_impianto after insert or update of lat, lon, geo_qualita on public.interventi_importati
  for each row execute function privato.interventi_salva_impianto();

-- Applica le posizioni note: verificate sempre; le altre se l'indirizzo non è cambiato.
create or replace function privato.applica_posizioni_impianti(p_importazione bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.interventi_importati i set lat = p.lat, lon = p.lon,
      geo_qualita = case when p.verificato then 'manuale' else p.geo_qualita end, geo_fonte = 'impianto',
      geo_dubbio = case when p.verificato then false else p.geo_qualita in ('centro_cap', 'centro_comune') end,
      geo_indirizzo = coalesce(i.geo_indirizzo, p.indirizzo_normalizzato), geo_tentato_at = now()
    from public.impianti_posizione p
   where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto)
     and i.lat is null and not i.fuori_lazio
     and (p_importazione is null or i.importazione_id = p_importazione)
     and (p.verificato or p.indirizzo_normalizzato = privato.norm_indirizzo(i.via, i.civico, i.cap, i.comune));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function privato.applica_posizioni_impianti(bigint) from public, anon, authenticated;

-- Importazione (security definer, controllo is_responsabile interno): come 0038 + coordinate dal file (lat/lon, fonte 'import') + riuso posizioni impianto.
create or replace function public.importa_interventi(p_file text, p_mese date, p_scartati int, p_righe jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_imp bigint; v_nuovi int; v_tot int; v_fuori int; v_riuso int;
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  insert into public.importazioni (file_nome, mese, scartati, created_by) values (p_file, p_mese, coalesce(p_scartati, 0), auth.uid()) returning id into v_imp;
  create temp table _r on commit drop as
    select * from jsonb_to_recordset(p_righe) as x(id_intervento text, numero text, data_riferimento date, tecnico_sigla text, impianto text,
      cod_cliente text, cliente text, comune text, cap text, prov text, indirizzo_originale text, via text, civico text, civico_geo text,
      note text, componenti int, tipo text, famiglie text[], fuori_lazio boolean, lat double precision, lon double precision);
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
    geo_fonte = case when i.geo_qualita = 'manuale' or (i.via, i.civico, i.cap, i.comune) is not distinct from (excluded.via, excluded.civico, excluded.cap, excluded.comune) then i.geo_fonte end,
    geo_tentato_at = case when i.geo_qualita = 'manuale' or (i.via, i.civico, i.cap, i.comune) is not distinct from (excluded.via, excluded.civico, excluded.cap, excluded.comune) then i.geo_tentato_at end;
  -- coordinate presenti nel file (mai sopra una correzione manuale)
  update public.interventi_importati i set lat = r.lat, lon = r.lon, geo_qualita = 'esatto', geo_fonte = 'import', geo_dubbio = false, geo_tentato_at = now()
    from _r r where r.id_intervento = i.id_intervento and r.lat between 35 and 48 and r.lon between 6 and 19
      and coalesce(i.geo_qualita, '') <> 'manuale'
      and not exists (select 1 from public.impianti_posizione p where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto) and p.verificato);
  v_riuso := privato.applica_posizioni_impianti(v_imp);
  update public.importazioni set righe = v_tot, nuovi = v_nuovi, aggiornati = v_tot - v_nuovi, fuori_lazio = v_fuori where id = v_imp;
  return jsonb_build_object('importazione_id', v_imp, 'righe', v_tot, 'nuovi', v_nuovi, 'aggiornati', v_tot - v_nuovi,
    'scartati', coalesce(p_scartati, 0), 'fuori_lazio', v_fuori, 'posizioni_riusate', v_riuso);
end $$;
revoke execute on function public.importa_interventi(text, date, int, jsonb) from public, anon;
grant execute on function public.importa_interventi(text, date, int, jsonb) to authenticated;
