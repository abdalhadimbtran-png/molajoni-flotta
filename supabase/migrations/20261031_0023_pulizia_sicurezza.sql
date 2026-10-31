-- Pulizia dopo revisione finale (approvata dall'amministratore 31/10/2026)
revoke all on table public.carte_carburante, public.carte_assegnazioni from anon;
revoke truncate, references, trigger on table public.carte_carburante, public.carte_assegnazioni from authenticated;
drop function if exists public.dipendente_anteprima_v1_da_eliminare(text, text, date, date, time, time, boolean);
drop function if exists public.dipendente_invia_richiesta_v1_da_eliminare(text, text, date, date, time, time, boolean, text);
drop function if exists public.hr_anteprima_v1_da_eliminare(bigint, text, date, date, time, time, boolean);
drop function if exists public.hr_inserisci_richiesta_v1_da_eliminare(bigint, text, date, date, time, time, boolean, text, boolean);
drop view if exists public.tecnici_v1_da_eliminare;

-- + revoca EXECUTE da anon/public su hr_*, admin_*, funzioni carte carburante (migrazione revoca_anon_funzioni_hr_admin)
