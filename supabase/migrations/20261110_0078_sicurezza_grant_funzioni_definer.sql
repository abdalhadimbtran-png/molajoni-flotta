-- 0078 — Sicurezza: privilegi EXECUTE sulle funzioni SECURITY DEFINER dello schema public.
-- Classi:
--   (a) pubbliche (anon): portale tecnico/dipendente via token o login con PIN, QR km;
--       + helper booleani is_* usati da policy/trigger valutati anche come anon (ritornano false senza sessione).
--   (b) solo utenti autenticati: tutte le altre funzioni chiamate dal pannello (con controllo ruolo interno).
--   (c) interne: trigger, cron, edge function (service_role): nessun grant ai client.
-- Inoltre: controlli_tecnico ora richiede il responsabile (prima qualsiasi utente autenticato
-- poteva leggere il motivo di assenza di qualsiasi tecnico).

create or replace function public.controlli_tecnico(p_tecnico bigint, p_data date default null::date)
 returns table(livello text, messaggio text)
 language plpgsql stable security definer
 set search_path to ''
as $function$
declare t public.tecnici; d date := coalesce(p_data, public.oggi()); mot text;
begin
  perform public.richiedi_responsabile();
  select * into t from public.tecnici where id = p_tecnico;
  if not found then return; end if;
  if not t.attivo then livello := 'ko'; messaggio := 'Tecnico non attivo'; return next; end if;
  select a.motivo into mot from public.assenze a where a.tecnico_id = t.id and d between a.dal and a.al limit 1;
  if mot is not null then livello := 'ko'; messaggio := 'Assente: ' || mot; return next; end if;
  if t.patente_scadenza is null then livello := 'warn'; messaggio := 'Scadenza patente non registrata'; return next;
  elsif t.patente_scadenza < d then livello := 'ko'; messaggio := 'Patente scaduta il ' || to_char(t.patente_scadenza,'DD/MM/YYYY') || ': non può guidare'; return next;
  elsif t.patente_scadenza <= d + 30 then livello := 'warn'; messaggio := 'Patente in scadenza il ' || to_char(t.patente_scadenza,'DD/MM/YYYY'); return next;
  end if;
end $function$;

do $$
declare
  classe_a text[] := array[
    'dipendente_annulla_richiesta','dipendente_anteprima','dipendente_attestati_proposti','dipendente_attestati_richiesti',
    'dipendente_carta','dipendente_corsi','dipendente_home','dipendente_invia_richiesta','dipendente_login','dipendente_logout',
    'dipendente_notifica_letta','dipendente_notifiche','dipendente_proponi_attestato','dipendente_richieste','dipendente_saldi',
    'dipendente_salva_push',
    'tecnico_documenti','tecnico_elenco_veicoli','tecnico_giornata','tecnico_giornata_finita','tecnico_home','tecnico_login',
    'tecnico_logout','tecnico_movimento','tecnico_notifica_letta','tecnico_notifiche','tecnico_salva_push',
    'tecnico_segnala_ritardo','tecnico_segnalazione','tecnico_urgenza_letta','tecnico_veicolo',
    'is_centralino','is_centralino_lettura','is_direzione','is_formazione','is_hr'];
  classe_c text[] := array[
    '_tecnico_da_token','centralino_chiamata_girata','dipendente_carica_attestato','dipendente_id_token',
    'dipendente_percorso_attestato','email_avvia_coda','email_segreto_valido','genera_notifiche_scadenze',
    'hr_storico_dipendente','tecnico_percorso_documento','tecnico_puo_caricare_foto'];
  f record; nb int := 0; nc int := 0; na int := 0;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname, p.prorettype = 'trigger'::regtype as trg,
           exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') as sp
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef
  loop
    if not f.sp then raise exception 'Funzione definer senza search_path: %', f.sig; end if;
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname = any(classe_a) then
      execute format('grant execute on function %s to anon, authenticated', f.sig);
      na := na + 1;
    elsif f.trg or f.proname = any(classe_c) then
      execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
      nc := nc + 1;
    else
      execute format('grant execute on function %s to authenticated', f.sig);
      execute format('revoke execute on function %s from public, anon', f.sig);
      nb := nb + 1;
    end if;
  end loop;
  raise notice 'definer: a=% b=% c=%', na, nb, nc;
end $$;

-- Funzioni future create da postgres in public: niente EXECUTE automatico a public/anon/authenticated.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;
