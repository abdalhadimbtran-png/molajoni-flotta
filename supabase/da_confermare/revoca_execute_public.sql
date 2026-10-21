-- DA ESEGUIRE SOLO CON CONFERMA ESPLICITA (contiene REVOKE: il gate automatico annulla le
-- migrazioni con REVOKE, quindi NON è nella cartella migrations).
--
-- Perché: in Postgres ogni nuova funzione è eseguibile da PUBLIC (quindi anche da `anon`).
-- `alter default privileges in schema public revoke ...` della 0001 non toglie questo permesso
-- predefinito. Tutte le funzioni hr_* / dipendente_* / admin_* hanno la guardia nel corpo
-- (richiedi_hr / richiedi_admin / token), quindi oggi NON c'è un buco: questo script toglie
-- solo la superficie inutile (advisor "anon_security_definer_function_executable").
--
-- 1. Da qui in avanti le nuove funzioni non saranno più eseguibili da PUBLIC:
alter default privileges revoke execute on functions from public;
-- 2. Funzioni HR/admin: solo utenti autenticati (le dipendente_* restano ad anon: servono al login con PIN)
revoke execute on function
  public.hr_richieste(text, date, date, text, bigint), public.hr_impatto_richiesta(bigint),
  public.hr_decidi_richiesta(bigint, text, text), public.hr_anteprima(bigint, text, date, date, time, time, boolean),
  public.hr_inserisci_richiesta(bigint, text, date, date, time, time, boolean, text, boolean),
  public.hr_annulla_richiesta(bigint, text), public.hr_saldi(int, text, bigint, date),
  public.hr_rettifica_saldo(bigint, int, text, numeric, text), public.hr_calendario(date, date, text, bigint),
  public.hr_report(text, date, date, text, bigint), public.hr_genera_festivita(int),
  public.hr_genera_pin(bigint), public.hr_imposta_pin(bigint, text), public.hr_sblocca_accesso(bigint),
  public.admin_collega_dipendente(uuid, bigint), public.admin_auto_decisioni(date, date),
  public.is_hr(), public.richiedi_hr()
  from public, anon;
