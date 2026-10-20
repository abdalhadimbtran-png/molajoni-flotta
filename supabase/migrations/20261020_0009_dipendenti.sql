-- =====================================================================
-- Portale unico · Fase 1 — Archivio unico del personale + ruolo HR
-- (documento di progetto del 20/10/2026)
--
-- 1. La tabella `tecnici` diventa `dipendenti`: un solo archivio per TUTTO il personale.
--    Nuovi campi HR: categoria (TEC, UFFICIO, MAGAZZINO, ALTRO), reparto, date, contratto,
--    ore giornaliere, giorni di riposo.
-- 2. `tecnici` resta come VISTA dei soli dipendenti con categoria TEC: tutte le funzioni,
--    i report e le schermate della flotta continuano a funzionare e vedono solo i tecnici.
--    Le chiavi esterne (movimenti, assegnazioni, assenze, ...) puntano a `dipendenti`.
-- 3. Area HR: i responsabili hanno ora un'`area` ('flotta' o 'hr'). `is_responsabile()` è vero
--    per admin e responsabili flotta; `is_hr()` per admin e responsabili HR (Roberta).
--    (Scelta senza DROP: il vincolo esistente su `ruolo` resta invariato.)
-- 4. Il responsabile flotta vede e gestisce solo i dipendenti TEC; HR e admin vedono tutti.
-- =====================================================================

-- 1. Archivio unico ----------------------------------------------------
alter table public.tecnici rename to dipendenti;

alter table public.dipendenti
  add column categoria text not null default 'TEC'
    constraint dipendenti_categoria_check check (categoria in ('TEC', 'UFFICIO', 'MAGAZZINO', 'ALTRO')),
  add column reparto text,
  add column data_assunzione date,
  add column data_cessazione date,
  add column contratto text
    constraint dipendenti_contratto_check check (contratto is null or contratto in ('full-time', 'part-time')),
  add column ore_giornaliere numeric(4, 2) not null default 8
    constraint dipendenti_ore_check check (ore_giornaliere > 0 and ore_giornaliere <= 12),
  add column giorni_riposo text not null default '0000011'
    constraint dipendenti_riposo_check check (giorni_riposo ~ '^[01]{7}$' and giorni_riposo <> '1111111');

alter table public.dipendenti
  add constraint dipendenti_date_check check (data_cessazione is null or data_assunzione is null or data_cessazione >= data_assunzione);

comment on table public.dipendenti is 'Archivio unico del personale Molajoni (tutte le categorie). Il codice è la matricola.';
comment on column public.dipendenti.categoria is 'TEC = tecnico in campo (flotta e piano); UFFICIO, MAGAZZINO, ALTRO = solo area personale.';
comment on column public.dipendenti.giorni_riposo is '7 caratteri da lunedì a domenica: 1 = giorno di riposo. Standard 0000011 (sabato e domenica).';

create index dipendenti_categoria_idx on public.dipendenti (categoria) where attivo;

-- 2. Vista dei tecnici (compatibilità totale con la flotta) ---------------
create view public.tecnici with (security_invoker = true) as
  select id, codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo,
         pin_hash, ha_pin, tentativi_falliti, bloccato_fino, creato_il, aggiornato_il, email
    from public.dipendenti
   where categoria = 'TEC'
  with local check option;

comment on view public.tecnici is 'Dipendenti con categoria TEC. Usata da flotta, piano, app tecnico e report. Scrivibile: i nuovi record nascono TEC.';

-- stessi permessi di colonna che aveva la tabella (pin_hash mai leggibile dal pannello)
grant select (id, codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo,
              ha_pin, tentativi_falliti, bloccato_fino, creato_il, aggiornato_il, email) on public.tecnici to authenticated;
grant insert (codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo, email) on public.tecnici to authenticated;
grant update (codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo, email,
              tentativi_falliti, bloccato_fino) on public.tecnici to authenticated;

-- nuovi campi dell'archivio: leggibili e modificabili dal pannello (le policy decidono chi)
grant select (categoria, reparto, data_assunzione, data_cessazione, contratto, ore_giornaliere, giorni_riposo)
  on public.dipendenti to authenticated;
grant insert (categoria, reparto, data_assunzione, data_cessazione, contratto, ore_giornaliere, giorni_riposo)
  on public.dipendenti to authenticated;
grant update (categoria, reparto, data_assunzione, data_cessazione, contratto, ore_giornaliere, giorni_riposo)
  on public.dipendenti to authenticated;

-- 3. Area HR ---------------------------------------------------------------
alter table public.responsabili
  add column area text not null default 'flotta'
    constraint responsabili_area_check check (area in ('flotta', 'hr'));
comment on column public.responsabili.area is 'Per ruolo responsabile: flotta = pianificazione e veicoli; hr = ferie, permessi e personale.';

create or replace function public.is_responsabile()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'flotta')));
$function$;

create or replace function public.is_hr()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'hr')));
$function$;
grant execute on function public.is_hr() to authenticated;

create or replace function public.richiedi_hr()
 returns void language plpgsql stable set search_path to ''
as $function$
begin
  if not public.is_hr() then
    raise exception 'Accesso riservato all''ufficio HR' using errcode = '42501';
  end if;
end $function$;

-- p_ruolo: 'admin' | 'responsabile' (area flotta) | 'hr' (responsabile con area hr)
create or replace function public.admin_imposta_responsabile(p_user uuid, p_ruolo text, p_attivo boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform public.richiedi_admin();
  if p_user = auth.uid() then raise exception 'Non puoi modificare il tuo stesso account'; end if;
  if p_ruolo not in ('admin', 'responsabile', 'hr') then raise exception 'Ruolo non valido'; end if;
  update public.responsabili
     set ruolo = case when p_ruolo = 'admin' then 'admin' else 'responsabile' end,
         area = case when p_ruolo = 'hr' then 'hr' else 'flotta' end,
         attivo = p_attivo
   where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
end $function$;

-- 4. Chi vede chi nell'archivio --------------------------------------------
alter policy resp_tecnici on public.dipendenti
  using ((select public.is_responsabile()) and categoria = 'TEC')
  with check ((select public.is_responsabile()) and categoria = 'TEC');
alter policy resp_tecnici on public.dipendenti rename to dip_resp_tecnici;
create policy dip_hr_admin on public.dipendenti for all to authenticated
  using ((select public.is_hr())) with check ((select public.is_hr()));

-- 5. Correzioni dopo la prova -------------------------------------------------
-- a) GROUP BY su una vista non usa la chiave primaria: le query aggregate leggono `dipendenti` (TEC).
-- b) La vista non contiene pin_hash (con security_invoker il pannello non vedeva più i tecnici):
--    le funzioni che usano il PIN lavorano su `dipendenti` (categoria TEC in questa fase).
--    Applicate con le migrazioni `fix_group_by_su_vista_tecnici` e `vista_tecnici_senza_pin`
--    (sostituzioni puntuali nel testo delle funzioni proponi_assegnazioni, report_dati,
--    tecnico_login, genera_pin, imposta_pin, analisi_admin) e con:
alter view public.tecnici rename to tecnici_v1_da_eliminare;   -- prima versione, da eliminare con conferma
create view public.tecnici with (security_invoker = true) as
  select id, codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo,
         ha_pin, tentativi_falliti, bloccato_fino, creato_il, aggiornato_il, email
    from public.dipendenti
   where categoria = 'TEC'
  with local check option;
grant select (id, codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo,
              ha_pin, tentativi_falliti, bloccato_fino, creato_il, aggiornato_il, email) on public.tecnici to authenticated;
grant insert (codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo, email) on public.tecnici to authenticated;
grant update (codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo, email,
              tentativi_falliti, bloccato_fino) on public.tecnici to authenticated;
