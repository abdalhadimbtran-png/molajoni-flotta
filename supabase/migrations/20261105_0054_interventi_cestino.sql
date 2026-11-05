-- 0054 Eliminazione reversibile (cestino 30 giorni) di importazioni e interventi importati. Non distruttiva.
-- Eliminare = eliminato_at valorizzato + stato 'annullato' (lo stato precedente si conserva e torna al ripristino),
-- così anche le funzioni che leggono interventi_importati per stato (giornata, centralino) li ignorano.
-- La cancellazione definitiva (svuota_cestino) è in supabase/da_confermare/: da applicare con conferma.
-- «Elimina anche le posizioni salvate» le nasconde (impianti_posizione.eliminato_at), non le cancella.

alter table public.interventi_importati
  add column if not exists eliminato_at timestamptz,
  add column if not exists eliminato_da uuid,
  add column if not exists motivo_eliminazione text,
  add column if not exists stato_prima_eliminazione text;
alter table public.importazioni
  add column if not exists eliminato_at timestamptz,
  add column if not exists eliminato_da uuid,
  add column if not exists motivo_eliminazione text;
alter table public.impianti_posizione add column if not exists eliminato_at timestamptz;
create index if not exists interventi_importati_eliminati on public.interventi_importati (eliminato_at) where eliminato_at is not null;

create table if not exists public.interventi_cestino_log (
  id bigint generated always as identity primary key,
  azione text not null check (azione in ('elimina_importazione', 'elimina_interventi', 'ripristina', 'svuota_cestino', 'ripristina_da_import')),
  importazione_id bigint, intervento_ids bigint[] not null default '{}', n int not null default 0,
  motivo text, posizioni_eliminate int not null default 0, dettagli jsonb,
  utente uuid default auth.uid(), created_at timestamptz not null default now()
);
alter table public.interventi_cestino_log enable row level security;
grant select on public.interventi_cestino_log to authenticated;
create policy interventi_cestino_log_resp on public.interventi_cestino_log for select to authenticated using ((select public.is_responsabile()));

-- Interventi "pianificati": stato pianificato/eseguito o collegati a un giorno (urgenze non annullate).
create or replace function privato.intervento_pianificato(p_id bigint, p_stato text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_stato in ('pianificato', 'eseguito')
      or exists (select 1 from public.urgenze u where u.importato_id = p_id and u.stato <> 'annullata')
$$;

create or replace function privato.elimina_ids(p_ids bigint[], p_motivo text, p_posizioni boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int; np int := 0; chiavi text[];
begin
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Motivo obbligatorio'; end if;
  select array_agg(distinct privato.chiave_impianto(cod_cliente, impianto)) filter (where impianto is not null) into chiavi
    from public.interventi_importati where id = any(p_ids) and eliminato_at is null;
  update public.interventi_importati set eliminato_at = now(), eliminato_da = auth.uid(), motivo_eliminazione = p_motivo,
         stato_prima_eliminazione = stato, stato = 'annullato'
   where id = any(p_ids) and eliminato_at is null;
  get diagnostics n = row_count;
  if p_posizioni and chiavi is not null then
    -- solo le posizioni non più usate da interventi attivi
    update public.impianti_posizione p set eliminato_at = now() where p.chiave = any(chiavi) and p.eliminato_at is null
      and not exists (select 1 from public.interventi_importati i where i.eliminato_at is null and privato.chiave_impianto(i.cod_cliente, i.impianto) = p.chiave);
    get diagnostics np = row_count;
  end if;
  return jsonb_build_object('eliminati', n, 'posizioni_eliminate', np);
end $$;

create or replace function public.anteprima_elimina_importazione(p_importazione bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  return (select jsonb_build_object('totale', count(*), 'pianificati', count(*) filter (where privato.intervento_pianificato(id, stato)),
            'posizioni', count(distinct privato.chiave_impianto(cod_cliente, impianto)) filter (where impianto is not null))
            from public.interventi_importati where importazione_id = p_importazione and eliminato_at is null);
end $$;

create or replace function public.elimina_importazione(p_importazione bigint, p_motivo text, p_anche_pianificati boolean, p_posizioni boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ids bigint[]; r jsonb; rest int;
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  select array_agg(id) into ids from public.interventi_importati
   where importazione_id = p_importazione and eliminato_at is null and (p_anche_pianificati or not privato.intervento_pianificato(id, stato));
  r := privato.elimina_ids(coalesce(ids, '{}'), p_motivo, p_posizioni);
  select count(*) into rest from public.interventi_importati where importazione_id = p_importazione and eliminato_at is null;
  if rest = 0 then
    update public.importazioni set eliminato_at = now(), eliminato_da = auth.uid(), motivo_eliminazione = p_motivo where id = p_importazione and eliminato_at is null;
  end if;
  insert into public.interventi_cestino_log (azione, importazione_id, intervento_ids, n, motivo, posizioni_eliminate, dettagli)
  values ('elimina_importazione', p_importazione, coalesce(ids, '{}'), (r->>'eliminati')::int, p_motivo, (r->>'posizioni_eliminate')::int,
          jsonb_build_object('anche_pianificati', p_anche_pianificati, 'rimasti', rest));
  return r || jsonb_build_object('rimasti', rest);
end $$;

create or replace function public.elimina_interventi(p_ids bigint[], p_motivo text, p_posizioni boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  r := privato.elimina_ids(p_ids, p_motivo, p_posizioni);
  insert into public.interventi_cestino_log (azione, intervento_ids, n, motivo, posizioni_eliminate)
  values ('elimina_interventi', p_ids, (r->>'eliminati')::int, p_motivo, (r->>'posizioni_eliminate')::int);
  return r;
end $$;

-- Ripristino: per importazione (tutti i suoi eliminati) o per elenco di id. Entro 30 giorni.
create or replace function public.ripristina_interventi(p_importazione bigint, p_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n int; ids bigint[];
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  with u as (
    update public.interventi_importati set eliminato_at = null, eliminato_da = null, motivo_eliminazione = null,
           stato = coalesce(stato_prima_eliminazione, 'da_pianificare'), stato_prima_eliminazione = null
     where eliminato_at is not null and eliminato_at > now() - interval '30 days'
       and ((p_importazione is not null and importazione_id = p_importazione) or (p_ids is not null and id = any(p_ids)))
    returning id, importazione_id)
  select array_agg(id), count(*) into ids, n from u;
  update public.importazioni m set eliminato_at = null, eliminato_da = null, motivo_eliminazione = null
   where m.eliminato_at is not null and (m.id = p_importazione
      or exists (select 1 from public.interventi_importati i where i.importazione_id = m.id and i.id = any(coalesce(ids, '{}'))));
  insert into public.interventi_cestino_log (azione, importazione_id, intervento_ids, n) values ('ripristina', p_importazione, coalesce(ids, '{}'), n);
  return jsonb_build_object('ripristinati', n);
end $$;

revoke execute on function public.anteprima_elimina_importazione(bigint), public.elimina_importazione(bigint, text, boolean, boolean),
  public.elimina_interventi(bigint[], text, boolean), public.ripristina_interventi(bigint, bigint[]) from public, anon;
grant execute on function public.anteprima_elimina_importazione(bigint), public.elimina_importazione(bigint, text, boolean, boolean),
  public.elimina_interventi(bigint[], text, boolean), public.ripristina_interventi(bigint, bigint[]) to authenticated;
revoke execute on function privato.elimina_ids(bigint[], text, boolean), privato.intervento_pianificato(bigint, text) from public, anon, authenticated;

-- Importazione con scelta sugli eliminati in precedenza: per default si saltano (e si contano); con p_ripristina tornano attivi.
create or replace function public.importa_interventi_v2(p_file text, p_mese date, p_scartati int, p_righe jsonb, p_ripristina boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_imp bigint; v_nuovi int; v_tot int; v_fuori int; v_riuso int; v_elim int; v_ripr bigint[];
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  insert into public.importazioni (file_nome, mese, scartati, created_by) values (p_file, p_mese, coalesce(p_scartati, 0), auth.uid()) returning id into v_imp;
  select count(*) into v_elim from jsonb_to_recordset(p_righe) as x(id_intervento text)
   where exists (select 1 from public.interventi_importati i where i.id_intervento = x.id_intervento and i.eliminato_at is not null);
  create temp table _r on commit drop as
    select * from jsonb_to_recordset(p_righe) as x(id_intervento text, numero text, data_riferimento date, tecnico_sigla text, impianto text,
      cod_cliente text, cliente text, comune text, cap text, prov text, indirizzo_originale text, via text, civico text, civico_geo text,
      note text, componenti int, tipo text, famiglie text[], fuori_lazio boolean, lat double precision, lon double precision)
     where p_ripristina or not exists (select 1 from public.interventi_importati i where i.id_intervento = x.id_intervento and i.eliminato_at is not null);
  if p_ripristina then
    with u as (update public.interventi_importati i set eliminato_at = null, eliminato_da = null, motivo_eliminazione = null,
                 stato = coalesce(stato_prima_eliminazione, 'da_pianificare'), stato_prima_eliminazione = null
                from _r where i.id_intervento = _r.id_intervento and i.eliminato_at is not null returning i.id)
    select array_agg(id) into v_ripr from u;
    if v_ripr is not null then
      insert into public.interventi_cestino_log (azione, importazione_id, intervento_ids, n) values ('ripristina_da_import', v_imp, v_ripr, cardinality(v_ripr));
    end if;
  end if;
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
  update public.interventi_importati i set lat = r.lat, lon = r.lon, geo_qualita = 'esatto', geo_fonte = 'import', geo_dubbio = false, geo_tentato_at = now()
    from _r r where r.id_intervento = i.id_intervento and r.lat between 35 and 48 and r.lon between 6 and 19
      and coalesce(i.geo_qualita, '') <> 'manuale'
      and not exists (select 1 from public.impianti_posizione p where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto) and p.verificato);
  v_riuso := privato.applica_posizioni_impianti(v_imp);
  update public.importazioni set righe = v_tot, nuovi = v_nuovi, aggiornati = v_tot - v_nuovi, fuori_lazio = v_fuori where id = v_imp;
  return jsonb_build_object('importazione_id', v_imp, 'righe', v_tot, 'nuovi', v_nuovi, 'aggiornati', v_tot - v_nuovi,
    'scartati', coalesce(p_scartati, 0), 'fuori_lazio', v_fuori, 'posizioni_riusate', v_riuso,
    'eliminati_saltati', case when p_ripristina then 0 else v_elim end, 'ripristinati', coalesce(cardinality(v_ripr), 0));
end $$;
revoke execute on function public.importa_interventi_v2(text, date, int, jsonb, boolean) from public, anon;
grant execute on function public.importa_interventi_v2(text, date, int, jsonb, boolean) to authenticated;

-- La versione precedente non deve più far rivivere gli eliminati: delega alla v2 (salta gli eliminati).
create or replace function public.importa_interventi(p_file text, p_mese date, p_scartati int, p_righe jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select public.importa_interventi_v2(p_file, p_mese, p_scartati, p_righe, false)
$$;

-- Posizioni nascoste: non si riusano; una nuova coordinata per lo stesso impianto le riattiva.
create or replace function privato.applica_posizioni_impianti(p_importazione bigint) returns int
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.interventi_importati i set indirizzo_cambiato = true
    from public.impianti_posizione p
   where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto) and p.eliminato_at is null and i.lat is null and not i.fuori_lazio
     and (p_importazione is null or i.importazione_id = p_importazione)
     and p.indirizzo_normalizzato is distinct from privato.norm_indirizzo(i.via, i.civico, i.cap, i.comune);
  update public.interventi_importati i set lat = p.lat, lon = p.lon,
      geo_qualita = case when p.verificato then 'manuale' else p.geo_qualita end, geo_fonte = 'impianto',
      geo_dubbio = case when p.verificato then false else p.geo_qualita in ('centro_cap', 'centro_comune') end,
      geo_indirizzo = coalesce(i.geo_indirizzo, p.indirizzo_normalizzato), geo_tentato_at = now(), indirizzo_cambiato = false
    from public.impianti_posizione p
   where p.chiave = privato.chiave_impianto(i.cod_cliente, i.impianto) and p.eliminato_at is null
     and i.lat is null and not i.fuori_lazio
     and (p_importazione is null or i.importazione_id = p_importazione)
     and p.indirizzo_normalizzato = privato.norm_indirizzo(i.via, i.civico, i.cap, i.comune);
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function privato.applica_posizioni_impianti(bigint) from public, anon, authenticated;

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
    if vecchio.verificato and not man and vecchio.indirizzo_normalizzato is not distinct from ind and vecchio.eliminato_at is null then return null; end if;
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
    verificato = excluded.verificato, aggiornato_da = excluded.aggiornato_da, aggiornato_at = now(), eliminato_at = null;
  return null;
end $$;
