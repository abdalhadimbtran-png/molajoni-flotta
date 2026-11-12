-- 0082 · Audit finale Centralino: prestazioni sotto carico (solo aggiunte).
-- Prova a 20k pratiche / 100k eventi / 12k clienti (transazione annullata):
--   ricerca globale 185–192 ms → indici trigram; registro del giorno 167 ms → filtri per intervallo.

create extension if not exists pg_trgm with schema extensions;

-- Ricerca globale (comune.ts › cerca: numero, cliente, contatto, email, codice, telefono con ilike '%…%')
create index if not exists pratiche_trgm_cliente_nome on public.pratiche using gin (cliente_nome extensions.gin_trgm_ops);
create index if not exists pratiche_trgm_contatto_nome on public.pratiche using gin (contatto_nome extensions.gin_trgm_ops);
create index if not exists pratiche_trgm_telefono on public.pratiche using gin (telefono extensions.gin_trgm_ops);
create index if not exists pratiche_trgm_email on public.pratiche using gin (email extensions.gin_trgm_ops);
create index if not exists pratiche_trgm_numero on public.pratiche using gin (numero extensions.gin_trgm_ops);
create index if not exists pratiche_trgm_cliente_codice on public.pratiche using gin (cliente_codice extensions.gin_trgm_ops);

-- Autocompletamento clienti (centralino_clienti: nome, codice, telefono, email)
create index if not exists clienti_trgm_nome on public.clienti using gin (nome extensions.gin_trgm_ops);
create index if not exists clienti_trgm_cod on public.clienti using gin (cod_cliente extensions.gin_trgm_ops);
create index if not exists clienti_trgm_telefono on public.clienti using gin (telefono extensions.gin_trgm_ops);
create index if not exists clienti_trgm_email on public.clienti using gin (email extensions.gin_trgm_ops);

-- Registro del giorno / Direzione: filtri per data
create index if not exists centralino_chiamate_info_at on public.centralino_chiamate_info (at);
create index if not exists clienti_contatti_storia_at on public.clienti_contatti_storia (at);

-- Registro del giorno: stessi conteggi, ma con intervalli sul giorno di Roma (usano gli indici su created_at / closed_at / at)
create or replace function public.centralino_registro_giorno(p_data date default null)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare g date := coalesce(p_data, (now() at time zone 'Europe/Rome')::date);
        v_da timestamptz := (g::timestamp at time zone 'Europe/Rome');
        v_a timestamptz := ((g + 1)::timestamp at time zone 'Europe/Rome');
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return (
    with pr as (select * from public.pratiche where created_at >= v_da and created_at < v_a and tipo not in ('amministrazione', 'fornitori')),
         ci as (select * from public.centralino_chiamate_info where at >= v_da and at < v_a and categoria is null),
         ca as (select distinct contatto_id from public.clienti_contatti_storia where at >= v_da and at < v_a and campo <> 'nuovo')
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
      'chiuse', (select count(*) from public.pratiche where closed_at >= v_da and closed_at < v_a and esito <> 'annullata' and tipo not in ('amministrazione', 'fornitori'))));
end
$function$;

-- Ricerca globale via RPC: con la RLS (policy pr_leggi) gli operatori ilike non possono usare gli indici,
-- quindi la query diretta scorre tutta la tabella (~190 ms a 20k pratiche). Stessa logica di comune.ts › cerca.
create or replace function public.centralino_cerca(p_q text)
 returns setof public.pratiche
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare x text := btrim(regexp_replace(left(coalesce(p_q, ''), 100), '[,()*%\\]', ' ', 'g'));
        tel text; pat text; pat_tel text;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  if length(x) < 2 then return; end if;
  tel := regexp_replace(x, '[\s./-]', '', 'g');
  pat := '%' || replace(x, '_', '\_') || '%';
  pat_tel := case when tel ~ '^\+?\d{3,}$' then '%' || right(tel, 6) || '%' else pat end;
  -- SQL dinamico con letterali: il pianificatore vede il testo cercato e sceglie gli indici trigram
  return query execute format(
    'select p.* from public.pratiche p
      where p.numero ilike %1$L or p.cliente_nome ilike %1$L or p.contatto_nome ilike %1$L or p.email ilike %1$L
         or p.cliente_codice ilike %1$L or p.telefono ilike %2$L
      order by p.created_at desc limit 30', pat, pat_tel);
end
$function$;
revoke all on function public.centralino_cerca(text) from public, anon;
grant execute on function public.centralino_cerca(text) to authenticated;

-- Allegati: il client invia sempre il tipo esatto (pdf, jpg, png, docx, xlsx, eml, msg); application/octet-stream
-- permetteva di caricare qualunque file chiamando direttamente lo storage. Solo restrizione.
update storage.buckets set allowed_mime_types = array_remove(allowed_mime_types, 'application/octet-stream')
 where id = 'pratiche' and 'application/octet-stream' = any(allowed_mime_types);
