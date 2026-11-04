-- 0039 Geocodifica dal browser (riserva quando i fornitori bloccano il server) + ripristino dei tentativi falliti. Non distruttiva.

create or replace function public.geocache_leggi(p_chiave text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; trovato boolean;
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  select true, g.dettaglio into trovato, v from public.geocache g where g.chiave = p_chiave;
  return jsonb_build_object('trovato', coalesce(trovato, false), 'v', v);
end $$;

create or replace function public.geocache_scrivi(p_chiave text, p_dettaglio jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_responsabile() then raise exception 'Non autorizzato'; end if;
  if length(p_chiave) > 500 or pg_column_size(p_dettaglio) > 200000 then raise exception 'Dati troppo grandi'; end if;
  insert into public.geocache (chiave, dettaglio) values (p_chiave, p_dettaglio)
  on conflict (chiave) do update set dettaglio = excluded.dettaglio;
end $$;

revoke execute on function public.geocache_leggi(text), public.geocache_scrivi(text, jsonb) from public, anon;
grant execute on function public.geocache_leggi(text), public.geocache_scrivi(text, jsonb) to authenticated;

-- I primi tentativi sono falliti per errore del servizio (Nominatim blocca il server): si riprovano.
update public.interventi_importati set geo_tentato_at = null where lat is null and geo_tentato_at is not null;
