-- Azzera dati di prova di PERSONALE e FLOTTA (solo admin): dipendenti/tecnici, veicoli e tutto ciò che dipende da loro.
-- Mappa FK (pg_constraint, 17/11/2026): tutte le FK verso dipendenti/veicoli sono NO ACTION → ordine esplicito.
-- CANCELLA: dipendenti, veicoli, assegnazioni, movimenti (km/QR), segnalazioni(+foto), multe, rifornimenti, dotazioni, documenti,
--   carte_assegnazioni, interventi (piano), percorsi, giornate_lavoro, ritardi, da_ripianificare, urgenze, variazioni_da_inviare,
--   notifiche_piano, piano_inviato, assenze_manuali, richieste_assenza(+giorni, assenze_da_richieste), saldi_iniziali,
--   rettifiche_saldo, spettanze_dipendente, corsi_dipendente(+attestati, avvisi, richieste_attestato), attestati_proposti,
--   sessioni_tecnico (token/PIN), push_iscrizioni, notifiche dei tecnici.
-- SCOLLEGA (resta il dato): pratiche centralino (tecnico/assegnato → null), interventi_importati Taylor (tecnico_id → null),
--   tecnici_sigle (dipendente_id → null; zone CAP intatte), responsabili.dipendente_id → null, carte_carburante.veicolo_id → null.
-- NON TOCCA: auth.users, responsabili (account ufficio), referenti, clienti, pratiche, modelli email, cap_zone, listino, impostazioni.
-- I file (attestati, foto, documenti) li rimuove il client prima della RPC con i percorsi restituiti dai conteggi.

create table if not exists public.azzeramenti_personale_flotta (
  id bigint generated always as identity primary key,
  creato_il timestamptz not null default now(),
  utente uuid default auth.uid(),
  conteggi jsonb not null
);
alter table public.azzeramenti_personale_flotta enable row level security;
drop policy if exists azz_pf_sel on public.azzeramenti_personale_flotta;
create policy azz_pf_sel on public.azzeramenti_personale_flotta for select to authenticated using (public.is_admin());
revoke all on public.azzeramenti_personale_flotta from anon, public;

-- L'admin può cancellare i file di attestati e foto segnalazioni (documenti: già coperto da is_responsabile).
drop policy if exists attestati_admin_cancella on storage.objects;
create policy attestati_admin_cancella on storage.objects for delete to authenticated using (bucket_id = 'attestati' and public.is_admin());
drop policy if exists foto_admin_cancella on storage.objects;
create policy foto_admin_cancella on storage.objects for delete to authenticated using (bucket_id = 'foto' and public.is_admin());

create or replace function public.admin_personale_flotta_conteggi() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare out jsonb := '{}'::jsonb; t text; n bigint;
begin
  if not public.is_admin() then raise exception 'Solo amministratore' using errcode = '42501'; end if;
  foreach t in array array['dipendenti','veicoli','assegnazioni','movimenti','segnalazioni','segnalazioni_foto','multe','rifornimenti',
    'dotazioni','documenti','carte_assegnazioni','interventi','percorsi','giornate_lavoro','ritardi','da_ripianificare','urgenze',
    'variazioni_da_inviare','notifiche_piano','piano_inviato','assenze_manuali','richieste_assenza','richieste_assenza_giorni',
    'assenze_da_richieste','saldi_iniziali','rettifiche_saldo','spettanze_dipendente','corsi_dipendente','corsi_attestati',
    'formazione_avvisi_inviati','richieste_attestato','attestati_proposti','sessioni_tecnico'] loop
    execute format('select count(*) from public.%I', t) into n;
    out := out || jsonb_build_object(t, n);
  end loop;
  out := out || jsonb_build_object(
    'notifiche', (select count(*) from public.notifiche where tecnico_id is not null),
    'push_iscrizioni', (select count(*) from public.push_iscrizioni where tecnico_id is not null),
    'scollega_pratiche', (select count(*) from public.pratiche where tecnico_dipendente_id is not null or assegnato_dipendente_id is not null),
    'scollega_interventi_importati', (select count(*) from public.interventi_importati where tecnico_id is not null),
    'scollega_sigle', (select count(*) from public.tecnici_sigle where dipendente_id is not null),
    'scollega_carte', (select count(*) from public.carte_carburante where veicolo_id is not null),
    'file', jsonb_build_object(
      'attestati', coalesce((select jsonb_agg(distinct p) from (
          select path p from public.corsi_attestati union all select attestato_path from public.corsi_dipendente
          union all select path from public.attestati_proposti union all select path from public.richieste_attestato) x where p is not null and p <> ''), '[]'::jsonb),
      'foto', coalesce((select jsonb_agg(distinct path) from public.segnalazioni_foto where path is not null), '[]'::jsonb),
      'documenti', coalesce((select jsonb_agg(distinct path) from public.documenti where path is not null), '[]'::jsonb)));
  return out;
end $$;

create or replace function public.admin_azzera_personale_flotta() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c jsonb;
begin
  if not public.is_admin() then raise exception 'Solo amministratore' using errcode = '42501'; end if;
  c := public.admin_personale_flotta_conteggi() - 'file';
  -- scollega ciò che deve restare
  update public.pratiche set tecnico_dipendente_id = null, assegnato_dipendente_id = null
    where tecnico_dipendente_id is not null or assegnato_dipendente_id is not null;
  update public.interventi_importati set tecnico_id = null where tecnico_id is not null;
  update public.tecnici_sigle set dipendente_id = null where dipendente_id is not null;
  update public.responsabili set dipendente_id = null where dipendente_id is not null;
  update public.carte_carburante set veicolo_id = null where veicolo_id is not null;
  update public.veicoli set tecnico_in_carico = null where tecnico_in_carico is not null;
  -- figli di secondo livello
  delete from public.segnalazioni_foto where true;
  delete from public.urgenze where true;
  delete from public.corsi_attestati where true;
  delete from public.formazione_avvisi_inviati where true;
  delete from public.richieste_attestato where true;
  delete from public.attestati_proposti where true;
  delete from public.assenze_da_richieste where true;
  delete from public.richieste_assenza_giorni where true;
  update public.richieste_assenza set convertita_da = null, convertita_in = null where convertita_da is not null or convertita_in is not null;
  -- figli diretti
  delete from public.richieste_assenza where true;
  delete from public.corsi_dipendente where true;
  delete from public.segnalazioni where true;
  delete from public.assegnazioni where true;
  delete from public.movimenti where true;
  delete from public.multe where true;
  delete from public.rifornimenti where true;
  delete from public.dotazioni where true;
  delete from public.documenti where true;
  delete from public.carte_assegnazioni where true;
  delete from public.interventi where true;
  delete from public.percorsi where true;
  delete from public.giornate_lavoro where true;
  delete from public.ritardi where true;
  delete from public.da_ripianificare where true;
  delete from public.variazioni_da_inviare where true;
  delete from public.notifiche_piano where true;
  delete from public.piano_inviato where true;
  delete from public.assenze_manuali where true;
  delete from public.saldi_iniziali where true;
  delete from public.rettifiche_saldo where true;
  delete from public.spettanze_dipendente where true;
  delete from public.sessioni_tecnico where true;
  delete from public.push_iscrizioni where tecnico_id is not null;
  delete from public.notifiche where tecnico_id is not null;
  -- radici
  delete from public.veicoli where true;
  delete from public.dipendenti where true;
  insert into public.azzeramenti_personale_flotta (conteggi) values (c);
  insert into public.audit_log (tabella, azione, record_id, dopo, utente)
    values ('personale_flotta', 'AZZERA', 'tutti', c, auth.uid());
  return c;
end $$;

revoke all on function public.admin_personale_flotta_conteggi() from public, anon;
revoke all on function public.admin_azzera_personale_flotta() from public, anon;
grant execute on function public.admin_personale_flotta_conteggi() to authenticated;
grant execute on function public.admin_azzera_personale_flotta() to authenticated;

-- TEST (eseguire come blocco unico: l'eccezione finale annulla tutto, nessuna modifica resta)
-- do $t$ declare prima jsonb; dopo jsonb; rif text := 'NON rifiutato'; begin
--   perform set_config('request.jwt.claims', json_build_object('sub','00000000-0000-0000-0000-000000000000','role','authenticated')::text, true);
--   begin perform public.admin_azzera_personale_flotta(); exception when insufficient_privilege then rif := 'rifiutato'; end;
--   perform set_config('request.jwt.claims', json_build_object('sub',(select user_id from public.responsabili where ruolo='admin' and attivo limit 1),'role','authenticated')::text, true);
--   prima := public.admin_personale_flotta_conteggi() - 'file'; perform public.admin_azzera_personale_flotta();
--   dopo := public.admin_personale_flotta_conteggi() - 'file';
--   raise exception 'ROLLBACK non_admin=% prima=% dopo=% responsabili=% cap_zone=% pratiche=%', rif, prima, dopo,
--     (select count(*) from public.responsabili), (select count(*) from public.cap_zone), (select count(*) from public.pratiche);
-- end $t$;
