-- 0041 Indirizzo cambiato per lo stesso impianto: si rigeocodifica, si conserva lo storico, si segnala. Non distruttiva.
-- Chiave sempre per impianto (cod. cliente + impianto), mai per solo cliente: un cliente può avere molte sedi.

alter table public.interventi_importati add column if not exists indirizzo_cambiato boolean not null default false;

create table if not exists public.impianti_posizione_storico (
  id bigint generated always as identity primary key,
  chiave text not null, cod_cliente text, impianto text,
  indirizzo_normalizzato text, cap text, comune text, lat double precision, lon double precision,
  geo_qualita text, fonte text, verificato boolean,
  valido_fino timestamptz not null default now(), sostituito_da text
);
create index if not exists impianti_posizione_storico_chiave on public.impianti_posizione_storico (chiave);
alter table public.impianti_posizione_storico enable row level security;
grant select on public.impianti_posizione_storico to authenticated;
create policy impianti_storico_resp on public.impianti_posizione_storico for select to authenticated using ((select public.is_responsabile()));

create or replace function privato.interventi_salva_impianto() returns trigger
language plpgsql security definer set search_path = '' as $$
declare k text := privato.chiave_impianto(new.cod_cliente, new.impianto);
  man boolean := new.geo_qualita = 'manuale';
  f text := case when new.geo_qualita = 'manuale' then 'manuale' else coalesce(nullif(new.geo_fonte, 'impianto'), 'photon') end;
  ind text := privato.norm_indirizzo(new.via, new.civico, new.cap, new.comune);
  vecchio public.impianti_posizione;
begin
  if k is null or new.lat is null or new.lon is null or new.geo_fonte = 'impianto' then return null; end if;
  select * into vecchio from public.impianti_posizione where chiave = k;
  if found then
    -- verificata con lo stesso indirizzo: cambia solo con un'altra correzione manuale
    if vecchio.verificato and not man and vecchio.indirizzo_normalizzato is not distinct from ind then return null; end if;
    if vecchio.indirizzo_normalizzato is distinct from ind then
      insert into public.impianti_posizione_storico (chiave, cod_cliente, impianto, indirizzo_normalizzato, cap, comune, lat, lon, geo_qualita, fonte, verificato, sostituito_da)
      values (vecchio.chiave, vecchio.cod_cliente, vecchio.impianto, vecchio.indirizzo_normalizzato, vecchio.cap, vecchio.comune, vecchio.lat, vecchio.lon, vecchio.geo_qualita, vecchio.fonte, vecchio.verificato, ind);
    end if;
  end if;
  insert into public.impianti_posizione as p (chiave, cod_cliente, impianto, indirizzo_normalizzato, cap, comune, lat, lon, geo_qualita, fonte, verificato, aggiornato_da)
  values (k, new.cod_cliente, new.impianto, ind, new.cap, new.comune, new.lat, new.lon, new.geo_qualita, f, man, auth.uid())
  on conflict (chiave) do update set
    indirizzo_normalizzato = excluded.indirizzo_normalizzato, cap = excluded.cap, comune = excluded.comune,
    lat = excluded.lat, lon = excluded.lon, geo_qualita = excluded.geo_qualita, fonte = excluded.fonte,
    verificato = excluded.verificato, aggiornato_da = excluded.aggiornato_da, aggiornato_at = now();
  return null;
end $$;

-- Riuso: solo se l'indirizzo è lo stesso (anche per le verificate). Indirizzo diverso → si segnala e si rigeocodifica.
create or replace function privato.applica_posizioni_impianti(p_importazione bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.interventi_importati i set indirizzo_cambiato = true
    from public.impianti_posizione p
   where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto) and i.lat is null and not i.fuori_lazio
     and (p_importazione is null or i.importazione_id = p_importazione)
     and p.indirizzo_normalizzato is distinct from privato.norm_indirizzo(i.via, i.civico, i.cap, i.comune);
  update public.interventi_importati i set lat = p.lat, lon = p.lon,
      geo_qualita = case when p.verificato then 'manuale' else p.geo_qualita end, geo_fonte = 'impianto',
      geo_dubbio = case when p.verificato then false else p.geo_qualita in ('centro_cap', 'centro_comune') end,
      geo_indirizzo = coalesce(i.geo_indirizzo, p.indirizzo_normalizzato), geo_tentato_at = now(), indirizzo_cambiato = false
    from public.impianti_posizione p
   where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto)
     and i.lat is null and not i.fuori_lazio
     and (p_importazione is null or i.importazione_id = p_importazione)
     and p.indirizzo_normalizzato = privato.norm_indirizzo(i.via, i.civico, i.cap, i.comune);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function privato.applica_posizioni_impianti(bigint) from public, anon, authenticated;
