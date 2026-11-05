-- 0043 Centralino (front office, procedura «Jennifer MARCHETTI Rev.01/2027») + Direzione in sola lettura.
--
-- Ruoli: come per la formazione, `responsabili.area` ha un CHECK che non si cambia → colonne booleane
--   responsabili.centralino  (gestisce le pratiche)          → is_centralino()  = admin o responsabile con centralino
--   responsabili.direzione   (vede tutto, non modifica)      → is_direzione()   = admin o responsabile con direzione
-- Un account centralino/direzione è ruolo='responsabile', area='flotta' e NON entra nel pannello flotta
-- (is_responsabile() lo esclude). Un account dell'ufficio personale (area 'hr', es. Simona) può avere
-- anche il centralino come aggiunta (admin_imposta_centralino).
--
-- Scritture solo da RPC (security definer): le tabelle hanno solo policy di lettura.
-- Storia (pratiche_eventi) solo in aggiunta: trigger che vieta UPDATE/DELETE.
-- Nessun DROP/REVOKE/DELETE/TRUNCATE.

-- 1. Ruoli ------------------------------------------------------------------------
alter table public.responsabili add column if not exists centralino boolean not null default false;
alter table public.responsabili add column if not exists direzione boolean not null default false;
comment on column public.responsabili.centralino is 'Vero = centralino / front office (pratiche clienti). Con area flotta non entra nel pannello flotta; con area hr si aggiunge all''ufficio personale.';
comment on column public.responsabili.direzione is 'Vero = direzione: sola lettura di centralino e KPI. Non entra nel pannello flotta.';
grant select (centralino, direzione) on public.responsabili to authenticated;

create or replace function public.is_responsabile()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'flotta'
                         and not r.formazione and not r.centralino and not r.direzione)));
$function$;

create or replace function public.is_centralino()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.centralino)));
$function$;

create or replace function public.is_direzione()
 returns boolean language sql stable security definer set search_path to ''
as $function$
  select exists (select 1 from public.responsabili r
                  where r.user_id = auth.uid() and r.attivo
                    and (r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.direzione)));
$function$;

create or replace function public.is_centralino_lettura()
 returns boolean language sql stable security definer set search_path to ''
as $function$ select public.is_centralino() or public.is_direzione(); $function$;

grant execute on function public.is_centralino() to authenticated;
grant execute on function public.is_direzione() to authenticated;
grant execute on function public.is_centralino_lettura() to authenticated;

create or replace function privato.richiedi_centralino()
 returns void language plpgsql stable set search_path to ''
as $function$
begin
  if not public.is_centralino() then
    raise exception 'Accesso riservato al centralino' using errcode = '42501';
  end if;
end $function$;

-- p_ruolo: 'admin' | 'responsabile' (flotta) | 'hr' | 'formazione' | 'centralino' | 'direzione'
create or replace function public.admin_imposta_responsabile(p_user uuid, p_ruolo text, p_attivo boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  perform public.richiedi_admin();
  if p_user = auth.uid() then raise exception 'Non puoi modificare il tuo stesso account'; end if;
  if p_ruolo not in ('admin', 'responsabile', 'hr', 'formazione', 'centralino', 'direzione') then raise exception 'Ruolo non valido'; end if;
  update public.responsabili
     set ruolo = case when p_ruolo = 'admin' then 'admin' else 'responsabile' end,
         area = case when p_ruolo = 'hr' then 'hr' else 'flotta' end,
         formazione = (p_ruolo = 'formazione'),
         -- ufficio personale: il centralino aggiuntivo resta com'era
         centralino = case when p_ruolo = 'centralino' then true when p_ruolo = 'hr' then centralino and area = 'hr' else false end,
         direzione = (p_ruolo = 'direzione'),
         attivo = p_attivo
   where user_id = p_user;
  if not found then raise exception 'Account non trovato'; end if;
end $function$;

-- centralino in aggiunta per un account dell'ufficio personale (es. Simona Colagrossi, sostituta)
create or replace function public.admin_imposta_centralino(p_user uuid, p_attivo boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare r public.responsabili;
begin
  perform public.richiedi_admin();
  select * into r from public.responsabili where user_id = p_user;
  if r.user_id is null then raise exception 'Account non trovato'; end if;
  if r.area <> 'hr' then raise exception 'Il centralino in aggiunta vale solo per l''ufficio personale. Per gli altri scegli il ruolo «Centralino».'; end if;
  update public.responsabili set centralino = p_attivo where user_id = p_user;
end $function$;
grant execute on function public.admin_imposta_centralino(uuid, boolean) to authenticated;

-- notifiche «flotta»: non agli account formazione / centralino / direzione
create or replace function privato.notifica_responsabili(p_area text, p_titolo text, p_testo text, p_dati jsonb, p_livello text, p_link text)
 returns void language plpgsql set search_path to ''
as $function$
declare n int;
begin
  insert into public.notifiche (user_id, tipo, dati, link)
  select r.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
           'titolo', p_titolo, 'testo', p_testo) || coalesce(p_dati, '{}'::jsonb), p_link
    from public.responsabili r
   where r.attivo and case when p_area = 'flotta' then r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'flotta' and not r.formazione and not r.centralino and not r.direzione)
                           else r.ruolo = 'responsabile' and r.area = 'hr' end;
  get diagnostics n = row_count;
  if n = 0 and p_area = 'hr' then
    insert into public.notifiche (user_id, tipo, dati, link)
    select r.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
             'titolo', p_titolo, 'testo', p_testo) || coalesce(p_dati, '{}'::jsonb), p_link
      from public.responsabili r where r.attivo and r.ruolo = 'admin';
  end if;
end $function$;

-- 2. Email: copia conoscenza e collegamento alla pratica ------------------------------
alter table public.email_in_uscita add column if not exists cc text[];
alter table public.email_in_uscita add column if not exists pratica_id bigint;
create policy email_centralino_legge on public.email_in_uscita for select to authenticated
  using (pratica_id is not null and (select public.is_centralino_lettura()));

-- 3. Configurazione ------------------------------------------------------------------
create table if not exists public.centralino_impostazioni (
  chiave text primary key,
  valore jsonb not null,
  descrizione text,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid()
);
comment on table public.centralino_impostazioni is 'Impostazioni del centralino (orario ufficio per gli SLA, copie conoscenza, referenti, firma). Modificabili da centralino/admin.';

insert into public.centralino_impostazioni (chiave, valore, descrizione) values
  ('orario', '{"inizio":"08:30","fine":"17:30"}', 'Orario d''ufficio per gli SLA a minuti/ore (lun–ven, festività escluse).'),
  ('soglia_arancio', '0.25', 'Arancio quando resta meno di questa frazione del tempo SLA.'),
  ('cc_offerte_grandi', '[{"nome":"L. Esposito","email":""},{"nome":"A. Chiaradonna","email":""},{"nome":"A. Querini","email":""}]', 'In copia per le offerte oltre 1.000 €.'),
  ('amministrazione', '{"nome":"Simona Colagrossi","email":""}', 'Fatture e amministrazione; sostituta del centralino.'),
  ('fornitori', '{"nome":"Roberta Felci","email":"","giorni":"lunedì e venerdì"}', 'Fornitori.'),
  ('commerciali', '[]', 'Commerciali / tecnici commerciali: [{"nome":"…","email":"…"}].'),
  ('responsabili_info', '[]', 'Altri responsabili a cui girare le richieste di informazione: [{"nome":"…","email":"…"}].'),
  ('firma', '"Jennifer Marchetti\nFront Office · Molajoni Antincendi\nDal 1930"', 'Firma delle email ({firma}).'),
  ('sostituto', '"Simona Colagrossi"', 'Chi copre il centralino quando l''operatrice è assente.')
on conflict (chiave) do nothing;

create table if not exists public.pratiche_flussi (
  tipo text primary key,
  nome text not null,
  icona text not null default 'altro',
  ordine int not null default 100,
  sottotipi text[] not null default '{}',
  -- sottotipi con stile urgente e priorità urgente automatica
  sottotipi_urgenti text[] not null default '{}',
  -- [{key, nome, sla?:{tipo:'minuti'|'ore'|'stesso_giorno'|'giorni_lav', valore?, da:'creazione'|'ingresso'}, azione?, template?}]
  stadi jsonb not null,
  -- SLA diversi per sottotipo: {"Allarme sonoro attivo": {"eseguito": {"tipo":"stesso_giorno","da":"creazione"}}}
  sla_sottotipi jsonb not null default '{}',
  -- assegnazione proposta: {"ruolo":"amministrazione","nome":"Simona Colagrossi"}
  assegnazione jsonb,
  nota_procedura text,
  attivo boolean not null default true,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid()
);
comment on table public.pratiche_flussi is 'Flussi del centralino: stadi e SLA per tipo di richiesta. Modificabili senza codice (centralino/admin).';

insert into public.pratiche_flussi (tipo, nome, icona, ordine, sottotipi, sottotipi_urgenti, stadi, sla_sottotipi, assegnazione, nota_procedura) values
('manutenzione', 'Intervento manutenzione', 'manutenzione', 10,
  '{Guasto,Ritardo,"Allarme sonoro attivo",Altro}', '{"Allarme sonoro attivo"}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"appuntamento","nome":"Appuntamento fissato","azione":"appuntamento","template":"conferma_intervento"},
    {"key":"comunicato","nome":"Comunicato al tecnico","azione":"taylor"},
    {"key":"eseguito","nome":"Intervento eseguito","sla":{"tipo":"giorni_lav","valore":1,"da":"creazione"}},
    {"key":"chiusa","nome":"Chiusa"}]',
  '{"Allarme sonoro attivo":{"eseguito":{"tipo":"stesso_giorno","da":"creazione"}}}',
  '{"ruolo":"tecnico","nome":"Tecnico"}',
  'Dai subito data e fascia (mattina/pomeriggio) al cliente. Allarme sonoro: prova la tacitazione al telefono, intervento in giornata.'),
('sopralluogo', 'Sopralluogo tecnico', 'sopralluogo', 20, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"appuntamento","nome":"Appuntamento fissato","azione":"appuntamento","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"confermato","nome":"Confermato al cliente","template":"conferma_sopralluogo","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"commerciale","nome":"Commerciale informato","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"eseguito","nome":"Sopralluogo eseguito","sla":{"tipo":"giorni_lav","valore":2,"da":"creazione"}},
    {"key":"offerta","nome":"Offerta inviata","template":"invio_offerta"},
    {"key":"esito","nome":"Esito","azione":"esito"},
    {"key":"contratto","nome":"Contratto firmato"}]',
  '{}', '{"ruolo":"tecnico_commerciale","nome":"Tecnico commerciale"}',
  'Sopralluogo entro 2 giorni lavorativi. Conferma al cliente via email, commerciale in copia.'),
('offerta_piccola', 'Offerta fino a 1.000 €', 'offerta', 30, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"conferma","nome":"Conferma al cliente","template":"presa_offerta_piccola","sla":{"tipo":"minuti","valore":15,"da":"creazione"}},
    {"key":"offerta","nome":"Offerta inviata","template":"invio_offerta","sla":{"tipo":"minuti","valore":60,"da":"creazione"}},
    {"key":"followup","nome":"Follow-up","template":"followup_offerta","sla":{"tipo":"giorni_lav","valore":2,"da":"ingresso"}},
    {"key":"esito","nome":"Esito","azione":"esito"},
    {"key":"contratto","nome":"Contratto / Ordine"}]',
  '{}', '{"ruolo":"centralino","nome":"Centralino"}',
  'Conferma a voce e via email: offerta entro 60 minuti.'),
('offerta_grande', 'Offerta oltre 1.000 €', 'offerta', 40, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"presa","nome":"Presa in carico","template":"presa_offerta_grande","sla":{"tipo":"minuti","valore":30,"da":"creazione"}},
    {"key":"contattato","nome":"Commerciale ha contattato il cliente","sla":{"tipo":"ore","valore":2,"da":"creazione"}},
    {"key":"offerta","nome":"Offerta inviata o sopralluogo fissato","template":"invio_offerta","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"esito","nome":"Esito","azione":"esito"},
    {"key":"contratto","nome":"Contratto firmato"}]',
  '{}', '{"ruolo":"tecnico_commerciale","nome":"Commerciale"}',
  'Email al cliente con il commerciale e L. Esposito, A. Chiaradonna, A. Querini in copia. Il commerciale contatta il cliente entro 2 ore.'),
('modifica', 'Modifica calendario / anagrafica / disdetta', 'modifica', 50, '{Calendario,Anagrafica,Disdetta}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"registrata","nome":"Registrata","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"comunicata","nome":"Evasione comunicata al cliente","template":"conferma_modifica_calendario","sla":{"tipo":"giorni_lav","valore":1,"da":"creazione"}},
    {"key":"chiusa","nome":"Chiusa"}]',
  '{}', '{"ruolo":"centralino","nome":"Centralino"}', 'Registrare in giornata e confermare al cliente via email.'),
('amministrazione', 'Fatture / amministrazione', 'amministrazione', 60, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"girata","nome":"Girata a Simona Colagrossi","template":"girata_ufficio","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"chiusa","nome":"Chiusa"}]',
  '{}', '{"ruolo":"amministrazione","nome":"Simona Colagrossi"}', 'Girare all''amministrazione (Simona Colagrossi).'),
('fornitori', 'Fornitori', 'fornitori', 70, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"girata","nome":"Girata a Roberta Felci","template":"girata_ufficio","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"chiusa","nome":"Chiusa"}]',
  '{}', '{"ruolo":"fornitori","nome":"Roberta Felci"}', 'Girare a Roberta Felci (lunedì e venerdì).'),
('informazione', 'Informazione / altro', 'informazione', 80, '{}', '{}',
  '[{"key":"ricevuta","nome":"Ricevuta"},
    {"key":"girata","nome":"Girata al responsabile","template":"girata_ufficio","sla":{"tipo":"stesso_giorno","da":"creazione"}},
    {"key":"chiusa","nome":"Chiusa"}]',
  '{}', '{"ruolo":"responsabile","nome":"Responsabile"}', 'Girare al responsabile competente.')
on conflict (tipo) do nothing;

create table if not exists public.email_template (
  id bigint generated always as identity primary key,
  codice text not null unique check (codice ~ '^[a-z0-9_]{2,60}$'),
  nome text not null check (length(btrim(nome)) between 2 and 120),
  oggetto text not null,
  corpo_html text not null,
  cc_default text[] not null default '{}',
  -- aggiunge in copia le persone di centralino_impostazioni.cc_offerte_grandi e il commerciale della pratica
  cc_offerte_grandi boolean not null default false,
  tipo_pratica text,
  attivo boolean not null default true,
  ordine int not null default 100,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid()
);
comment on table public.email_template is 'Modelli email del centralino. Segnaposto: {cliente} {contatto} {numero_pratica} {data_appuntamento} {fascia} {commerciale} {tecnico} {firma}.';

-- 4. Pratiche ----------------------------------------------------------------------
create table if not exists privato.pratiche_contatori (anno int primary key, ultimo int not null default 0);

create table if not exists public.pratiche (
  id bigint generated always as identity primary key,
  numero text not null unique,
  canale text not null check (canale in ('telefono','whatsapp','email','collega','tablet_tmq','altro')),
  tipo text not null references public.pratiche_flussi(tipo),
  sottotipo text,
  priorita text not null default 'normale' check (priorita in ('normale','urgente')),
  cliente_codice text,
  cliente_nome text not null check (length(btrim(cliente_nome)) between 1 and 200),
  sede text,
  contatto_nome text,
  telefono text,
  email text,
  indirizzo text,
  cap text,
  comune text,
  descrizione text,
  assegnato_ruolo text check (assegnato_ruolo is null or assegnato_ruolo in ('tecnico','tecnico_commerciale','amministrazione','fornitori','responsabile','centralino')),
  assegnato_nome text,
  assegnato_dipendente_id bigint references public.dipendenti(id),
  commerciale_id uuid,
  commerciale_nome text,
  commerciale_email text,
  tecnico_nome text,
  importo_stimato numeric(12,2) check (importo_stimato is null or importo_stimato >= 0),
  appuntamento_data date,
  appuntamento_fascia text check (appuntamento_fascia is null or appuntamento_fascia in ('mattina','pomeriggio')),
  alert_taylor boolean not null default false,
  tacitazione_tentata boolean not null default false,
  esito_offerta text check (esito_offerta is null or esito_offerta in ('accettata','rifiutata','in_attesa')),
  stato_corrente text not null default 'ricevuta',
  esito text not null default 'aperta' check (esito in ('aperta','chiusa_ok','chiusa_ko','annullata')),
  sla_stadio text,
  sla_scadenza timestamptz,
  sla_rispettato boolean,
  sla_notificato text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((esito = 'aperta') = (closed_at is null))
);
comment on table public.pratiche is 'Pratiche del centralino (un contatto cliente = una pratica). Scritture solo dalle RPC centralino_*.';
create index if not exists pratiche_aperte on public.pratiche (sla_scadenza) where esito = 'aperta';
create index if not exists pratiche_creata on public.pratiche (created_at desc);
create index if not exists pratiche_chiusa on public.pratiche (closed_at desc) where closed_at is not null;
create index if not exists pratiche_cliente on public.pratiche (cliente_codice);

create table if not exists public.pratiche_eventi (
  id bigint generated always as identity primary key,
  pratica_id bigint not null references public.pratiche(id),
  tipo text not null check (tipo in ('creata','stato','nota','email_inviata','chiamata','assegnata','appuntamento','allegato','sla_scaduto','chiusa','modifica')),
  da_stato text,
  a_stato text,
  testo text,
  dati jsonb not null default '{}',
  autore uuid default auth.uid(),
  autore_nome text,
  at timestamptz not null default now()
);
comment on table public.pratiche_eventi is 'Storia della pratica: solo in aggiunta (UPDATE/DELETE vietati da trigger).';
create index if not exists pratiche_eventi_pratica on public.pratiche_eventi (pratica_id, at);
create index if not exists pratiche_eventi_at on public.pratiche_eventi (at desc);

create or replace function privato.tg_solo_aggiunta() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'La storia della pratica non si modifica e non si cancella' using errcode = '42501';
end $$;
create trigger pratiche_eventi_solo_aggiunta before update or delete on public.pratiche_eventi
  for each row execute function privato.tg_solo_aggiunta();

create table if not exists public.pratiche_allegati (
  id bigint generated always as identity primary key,
  pratica_id bigint not null references public.pratiche(id),
  path text not null unique,
  nome_file text,
  mime text,
  dimensione int,
  caricato_da uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.centralino_chiamate_info (
  id bigint generated always as identity primary key,
  canale text not null default 'telefono' check (canale in ('telefono','whatsapp','email','collega','tablet_tmq','altro')),
  nota text,
  autore uuid default auth.uid(),
  autore_nome text,
  at timestamptz not null default now()
);
comment on table public.centralino_chiamate_info is 'Contatti informativi che non richiedono una pratica (+1 chiamata informativa).';

-- RLS: lettura centralino + direzione + admin; scrittura diretta solo per configurazione (centralino/admin)
alter table public.centralino_impostazioni enable row level security;
alter table public.pratiche_flussi enable row level security;
alter table public.email_template enable row level security;
alter table public.pratiche enable row level security;
alter table public.pratiche_eventi enable row level security;
alter table public.pratiche_allegati enable row level security;
alter table public.centralino_chiamate_info enable row level security;

create policy ci_leggi on public.centralino_impostazioni for select to authenticated using ((select public.is_centralino_lettura()));
create policy ci_scrivi on public.centralino_impostazioni for update to authenticated using ((select public.is_centralino())) with check ((select public.is_centralino()));
create policy pf_leggi on public.pratiche_flussi for select to authenticated using ((select public.is_centralino_lettura()));
create policy pf_scrivi on public.pratiche_flussi for update to authenticated using ((select public.is_centralino())) with check ((select public.is_centralino()));
create policy et_leggi on public.email_template for select to authenticated using ((select public.is_centralino_lettura()));
create policy et_inserisci on public.email_template for insert to authenticated with check ((select public.is_centralino()));
create policy et_scrivi on public.email_template for update to authenticated using ((select public.is_centralino())) with check ((select public.is_centralino()));
create policy pr_leggi on public.pratiche for select to authenticated using ((select public.is_centralino_lettura()));
create policy pe_leggi on public.pratiche_eventi for select to authenticated using ((select public.is_centralino_lettura()));
create policy pa_leggi on public.pratiche_allegati for select to authenticated using ((select public.is_centralino_lettura()));
create policy cc_leggi on public.centralino_chiamate_info for select to authenticated using ((select public.is_centralino_lettura()));

grant select on public.centralino_impostazioni, public.pratiche_flussi, public.email_template, public.pratiche,
  public.pratiche_eventi, public.pratiche_allegati, public.centralino_chiamate_info to authenticated;
grant update on public.centralino_impostazioni, public.pratiche_flussi to authenticated;
grant insert, update on public.email_template to authenticated;

-- aggiornamento automatico data/autore della configurazione
create or replace function privato.tg_config_aggiornata() returns trigger
language plpgsql set search_path = '' as $$
begin new.aggiornato_il := now(); new.aggiornato_da := auth.uid(); return new; end $$;
create trigger ci_agg before update on public.centralino_impostazioni for each row execute function privato.tg_config_aggiornata();
create trigger pf_agg before update on public.pratiche_flussi for each row execute function privato.tg_config_aggiornata();
create trigger et_agg before update on public.email_template for each row execute function privato.tg_config_aggiornata();

-- 5. Allegati (bucket privato) --------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pratiche', 'pratiche', false, 10485760, array[
  'application/pdf','image/jpeg','image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'message/rfc822','application/vnd.ms-outlook','application/octet-stream'])
on conflict (id) do nothing;
create policy pratiche_file_leggi on storage.objects for select to authenticated
  using (bucket_id = 'pratiche' and (select public.is_centralino_lettura()));
create policy pratiche_file_carica on storage.objects for insert to authenticated
  with check (bucket_id = 'pratiche' and (select public.is_centralino()));

-- 6. Motore SLA (giorni lavorativi lun–ven, festività, orario d'ufficio, ora di Roma) ---------
create or replace function privato.ct_lav(d date) returns boolean
language sql stable set search_path = '' as $$
  select extract(isodow from d) < 6 and not exists (select 1 from public.festivita f where f.data = d and f.attiva);
$$;

create or replace function privato.ct_prossimo_lav(d date) returns date
language plpgsql stable set search_path = '' as $$
declare x date := d + 1;
begin
  while not privato.ct_lav(x) loop x := x + 1; end loop;
  return x;
end $$;

-- Scadenza da p_da secondo la regola:
--   minuti/ore n : minuti d'ufficio (oltre l'orario si continua il giorno lavorativo dopo)
--   stesso_giorno : fine orario dello stesso giorno lavorativo (dopo la chiusura o nel weekend: del successivo)
--   giorni_lav n : fine orario dell'n-esimo giorno lavorativo dopo la data di ricezione
create or replace function privato.ct_sla(p_da timestamptz, p_regola jsonb) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v_tipo text := p_regola->>'tipo'; n int := coalesce((p_regola->>'valore')::int, 0);
  o jsonb; hi time; hf time; l timestamp; d date; t time; m int; disp int;
begin
  if p_da is null or v_tipo is null then return null; end if;
  select valore into o from public.centralino_impostazioni where chiave = 'orario';
  hi := coalesce((o->>'inizio')::time, '08:30'); hf := coalesce((o->>'fine')::time, '17:30');
  l := p_da at time zone 'Europe/Rome'; d := l::date; t := l::time;
  if v_tipo = 'giorni_lav' then
    for i in 1..greatest(n, 0) loop d := privato.ct_prossimo_lav(d); end loop;
    if n <= 0 and not privato.ct_lav(d) then d := privato.ct_prossimo_lav(d); end if;
    return (d + hf) at time zone 'Europe/Rome';
  end if;
  if not privato.ct_lav(d) or t >= hf then d := privato.ct_prossimo_lav(d); t := hi;
  elsif t < hi then t := hi; end if;
  if v_tipo = 'stesso_giorno' then return (d + hf) at time zone 'Europe/Rome'; end if;
  if v_tipo in ('minuti', 'ore') then
    m := case when v_tipo = 'ore' then n * 60 else n end;
    loop
      disp := (extract(epoch from (hf - t)) / 60)::int;
      if m <= disp then return ((d + t) + make_interval(mins => m)) at time zone 'Europe/Rome'; end if;
      m := m - disp; d := privato.ct_prossimo_lav(d); t := hi;
    end loop;
  end if;
  return null;
end $$;

-- per i test e per l'anteprima nel modulo
create or replace function public.centralino_sla_anteprima(p_da timestamptz, p_regola jsonb) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
begin
  perform privato.richiedi_centralino();
  return privato.ct_sla(p_da, p_regola);
end $$;

create or replace function privato.ct_regola(p_tipo text, p_sottotipo text, p_stadio text) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(f.sla_sottotipi -> coalesce(p_sottotipo, '') -> p_stadio,
                  (select s->'sla' from jsonb_array_elements(f.stadi) s where s->>'key' = p_stadio))
    from public.pratiche_flussi f where f.tipo = p_tipo;
$$;

create or replace function privato.ct_indice(p_tipo text, p_stadio text) returns int
language sql stable set search_path = '' as $$
  select x.i::int from public.pratiche_flussi f, jsonb_array_elements(f.stadi) with ordinality x(s, i)
   where f.tipo = p_tipo and x.s->>'key' = p_stadio;
$$;

create or replace function privato.ct_ultimo(p_tipo text) returns text
language sql stable set search_path = '' as $$
  select f.stadi -> (jsonb_array_length(f.stadi) - 1) ->> 'key' from public.pratiche_flussi f where f.tipo = p_tipo;
$$;

-- imposta il prossimo obiettivo SLA dopo lo stadio di indice p_idx
create or replace function privato.ct_prossimo_sla(p_id bigint, p_idx int) returns void
language plpgsql set search_path = '' as $$
declare p public.pratiche; s jsonb; i int; r jsonb;
begin
  select * into p from public.pratiche where id = p_id;
  for s, i in select x.s, x.i::int from public.pratiche_flussi f, jsonb_array_elements(f.stadi) with ordinality x(s, i)
               where f.tipo = p.tipo and x.i > p_idx order by x.i loop
    r := privato.ct_regola(p.tipo, p.sottotipo, s->>'key');
    if r is not null then
      update public.pratiche set sla_stadio = s->>'key',
             sla_scadenza = privato.ct_sla(case when r->>'da' = 'ingresso' then now() else p.created_at end, r),
             sla_notificato = null
       where id = p_id;
      return;
    end if;
  end loop;
  update public.pratiche set sla_stadio = null, sla_scadenza = null, sla_notificato = null where id = p_id;
end $$;

create or replace function privato.ct_autore() returns text
language sql stable set search_path = '' as $$
  select coalesce((select r.nome from public.responsabili r where r.user_id = auth.uid()), 'Sistema');
$$;

create or replace function privato.ct_evento(p_pratica bigint, p_tipo text, p_da text, p_a text, p_testo text, p_dati jsonb) returns void
language sql set search_path = '' as $$
  insert into public.pratiche_eventi (pratica_id, tipo, da_stato, a_stato, testo, dati, autore, autore_nome)
  values (p_pratica, p_tipo, p_da, p_a, nullif(btrim(coalesce(p_testo, '')), ''), coalesce(p_dati, '{}'::jsonb), auth.uid(), privato.ct_autore());
$$;

-- campanella: centralino + direzione + admin
create or replace function privato.ct_notifica(p_titolo text, p_testo text, p_link text, p_livello text default 'warn') returns void
language sql set search_path = '' as $$
  insert into public.notifiche (user_id, tipo, dati, link)
  select r.user_id, 'avviso', jsonb_build_object('categoria', 'centralino', 'livello', p_livello, 'titolo', p_titolo, 'testo', p_testo), p_link
    from public.responsabili r where r.attivo and (r.ruolo = 'admin' or r.centralino or r.direzione);
$$;

-- 7. RPC ------------------------------------------------------------------------
create or replace function public.centralino_crea(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  f public.pratiche_flussi; anno int := extract(year from now() at time zone 'Europe/Rome')::int; k int; num text; nid bigint;
  v_tipo text := p->>'tipo'; v_sotto text := nullif(btrim(coalesce(p->>'sottotipo', '')), ''); urg boolean; imp numeric;
begin
  perform privato.richiedi_centralino();
  -- offerte: la soglia 1.000 € decide il flusso
  imp := nullif(p->>'importo_stimato', '')::numeric;
  if v_tipo in ('offerta', 'offerta_piccola', 'offerta_grande') and imp is not null then
    v_tipo := case when imp > 1000 then 'offerta_grande' else 'offerta_piccola' end;
  elsif v_tipo = 'offerta' then v_tipo := 'offerta_piccola';
  end if;
  select * into f from public.pratiche_flussi where tipo = v_tipo and attivo;
  if f.tipo is null then raise exception 'Tipo di richiesta non valido'; end if;
  if nullif(btrim(coalesce(p->>'cliente_nome', '')), '') is null then raise exception 'Indica il cliente'; end if;
  if (p->>'appuntamento_data') is not null and (p->>'appuntamento_fascia') is null then raise exception 'Indica mattina o pomeriggio'; end if;
  urg := coalesce(p->>'priorita', '') = 'urgente' or v_sotto = any (f.sottotipi_urgenti);

  insert into privato.pratiche_contatori (anno, ultimo) values (anno, 1)
  on conflict (anno) do update set ultimo = privato.pratiche_contatori.ultimo + 1 returning ultimo into k;
  num := 'CT-' || anno || '-' || lpad(k::text, 6, '0');

  insert into public.pratiche (numero, canale, tipo, sottotipo, priorita, cliente_codice, cliente_nome, sede, contatto_nome, telefono, email,
    indirizzo, cap, comune, descrizione, assegnato_ruolo, assegnato_nome, assegnato_dipendente_id, commerciale_nome, commerciale_email, tecnico_nome,
    importo_stimato, appuntamento_data, appuntamento_fascia, tacitazione_tentata)
  values (num, coalesce(p->>'canale', 'telefono'), v_tipo, v_sotto, case when urg then 'urgente' else 'normale' end,
    nullif(btrim(coalesce(p->>'cliente_codice', '')), ''), btrim(p->>'cliente_nome'), nullif(btrim(coalesce(p->>'sede', '')), ''),
    nullif(btrim(coalesce(p->>'contatto_nome', '')), ''), nullif(btrim(coalesce(p->>'telefono', '')), ''), nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
    nullif(btrim(coalesce(p->>'indirizzo', '')), ''), nullif(btrim(coalesce(p->>'cap', '')), ''), nullif(btrim(coalesce(p->>'comune', '')), ''),
    nullif(btrim(coalesce(p->>'descrizione', '')), ''),
    coalesce(nullif(p->>'assegnato_ruolo', ''), f.assegnazione->>'ruolo'), coalesce(nullif(p->>'assegnato_nome', ''), f.assegnazione->>'nome'),
    nullif(p->>'assegnato_dipendente_id', '')::bigint, nullif(btrim(coalesce(p->>'commerciale_nome', '')), ''), nullif(lower(btrim(coalesce(p->>'commerciale_email', ''))), ''),
    nullif(btrim(coalesce(p->>'tecnico_nome', '')), ''),
    imp, nullif(p->>'appuntamento_data', '')::date, nullif(p->>'appuntamento_fascia', ''), coalesce((p->>'tacitazione_tentata')::boolean, false))
  returning id into nid;

  perform privato.ct_evento(nid, 'creata', null, 'ricevuta', p->>'descrizione',
    jsonb_build_object('canale', coalesce(p->>'canale', 'telefono'), 'tipo', v_tipo, 'sottotipo', v_sotto));
  perform privato.ct_prossimo_sla(nid, 1);
  -- appuntamento dato al primo contatto: lo stadio è già raggiunto
  if (p->>'appuntamento_data') is not null and privato.ct_indice(v_tipo, 'appuntamento') is not null then
    perform public.centralino_avanza(nid, 'appuntamento', '{}'::jsonb, 'Data e fascia date al cliente al primo contatto');
  end if;
  return jsonb_build_object('id', nid, 'numero', num, 'tipo', v_tipo);
end $$;

create or replace function public.centralino_avanza(p_id bigint, p_stadio text, p_dati jsonb default '{}', p_testo text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p public.pratiche; idx int; idx_sla int; risp boolean; d jsonb := coalesce(p_dati, '{}'::jsonb); ultimo text;
begin
  perform privato.richiedi_centralino();
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è chiusa'; end if;
  idx := privato.ct_indice(p.tipo, p_stadio);
  if idx is null then raise exception 'Stadio non valido per questo tipo di pratica'; end if;
  if p_stadio = 'appuntamento' and coalesce(nullif(d->>'appuntamento_data', '')::date, p.appuntamento_data) is null then
    raise exception 'Indica data e fascia dell''appuntamento';
  end if;
  if p_stadio = 'esito' and coalesce(d->>'esito_offerta', '') not in ('accettata', 'rifiutata', 'in_attesa') then
    raise exception 'Indica l''esito: accettata, rifiutata o in attesa';
  end if;

  -- SLA dello stadio obiettivo raggiunto (o superato)
  if p.sla_stadio is not null then
    idx_sla := privato.ct_indice(p.tipo, p.sla_stadio);
    if idx >= idx_sla then
      risp := now() <= p.sla_scadenza;
      d := d || jsonb_build_object('sla_stadio', p.sla_stadio, 'sla_scadenza', p.sla_scadenza, 'sla_rispettato', risp);
    end if;
  end if;

  update public.pratiche set
    stato_corrente = p_stadio, updated_at = now(),
    appuntamento_data = coalesce(nullif(d->>'appuntamento_data', '')::date, appuntamento_data),
    appuntamento_fascia = coalesce(nullif(d->>'appuntamento_fascia', ''), appuntamento_fascia),
    alert_taylor = alert_taylor or coalesce((d->>'alert_taylor')::boolean, false),
    tecnico_nome = coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), tecnico_nome),
    esito_offerta = coalesce(nullif(d->>'esito_offerta', ''), esito_offerta),
    sla_rispettato = case when risp is false then false else sla_rispettato end
   where id = p_id;
  perform privato.ct_evento(p_id, 'stato', p.stato_corrente, p_stadio, p_testo, d);
  if idx_sla is not null and idx >= idx_sla then perform privato.ct_prossimo_sla(p_id, idx);
  elsif p.sla_stadio is null then perform privato.ct_prossimo_sla(p_id, idx); end if;

  -- ultimo stadio → chiusa positiva; offerta rifiutata → chiusa negativa
  ultimo := privato.ct_ultimo(p.tipo);
  if p_stadio = ultimo then perform privato.ct_chiudi(p_id, 'chiusa_ok', null);
  elsif p_stadio = 'esito' and d->>'esito_offerta' = 'rifiutata' then perform privato.ct_chiudi(p_id, 'chiusa_ko', 'Offerta rifiutata');
  end if;
  return jsonb_build_object('id', p_id, 'stato', p_stadio);
end $$;

create or replace function privato.ct_chiudi(p_id bigint, p_esito text, p_testo text) returns void
language plpgsql set search_path = '' as $$
declare p public.pratiche;
begin
  select * into p from public.pratiche where id = p_id;
  update public.pratiche set esito = p_esito, closed_at = now(), updated_at = now(),
         sla_rispettato = case when p_esito = 'annullata' then sla_rispettato
                               when sla_rispettato is false then false
                               when sla_scadenza is not null and now() > sla_scadenza then false
                               else true end
   where id = p_id;
  perform privato.ct_evento(p_id, 'chiusa', p.stato_corrente, p.stato_corrente, p_testo, jsonb_build_object('esito', p_esito));
end $$;

create or replace function public.centralino_chiudi(p_id bigint, p_esito text, p_testo text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare p public.pratiche;
begin
  perform privato.richiedi_centralino();
  if p_esito not in ('chiusa_ok', 'chiusa_ko', 'annullata') then raise exception 'Esito non valido'; end if;
  select * into p from public.pratiche where id = p_id for update;
  if p.id is null then raise exception 'Pratica non trovata'; end if;
  if p.esito <> 'aperta' then raise exception 'La pratica è già chiusa'; end if;
  if p_esito = 'annullata' and nullif(btrim(coalesce(p_testo, '')), '') is null then raise exception 'Scrivi il motivo dell''annullamento'; end if;
  perform privato.ct_chiudi(p_id, p_esito, p_testo);
end $$;

-- nota o chiamata registrata
create or replace function public.centralino_nota(p_id bigint, p_tipo text, p_testo text, p_dati jsonb default '{}') returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privato.richiedi_centralino();
  if p_tipo not in ('nota', 'chiamata') then raise exception 'Tipo non valido'; end if;
  if not exists (select 1 from public.pratiche where id = p_id) then raise exception 'Pratica non trovata'; end if;
  if nullif(btrim(coalesce(p_testo, '')), '') is null and p_tipo = 'nota' then raise exception 'Scrivi la nota'; end if;
  perform privato.ct_evento(p_id, p_tipo, null, null, p_testo, p_dati);
  update public.pratiche set updated_at = now() where id = p_id;
end $$;

-- dati della pratica, appuntamento, assegnazione (ogni cambio resta nella storia)
create or replace function public.centralino_aggiorna(p_id bigint, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v public.pratiche; n public.pratiche; cambi jsonb := '{}'; k text;
begin
  perform privato.richiedi_centralino();
  select * into v from public.pratiche where id = p_id for update;
  if v.id is null then raise exception 'Pratica non trovata'; end if;
  if p ? 'cliente_nome' and nullif(btrim(coalesce(p->>'cliente_nome', '')), '') is null then raise exception 'Indica il cliente'; end if;
  update public.pratiche set
    cliente_nome = case when p ? 'cliente_nome' then btrim(p->>'cliente_nome') else cliente_nome end,
    cliente_codice = case when p ? 'cliente_codice' then nullif(btrim(coalesce(p->>'cliente_codice', '')), '') else cliente_codice end,
    sede = case when p ? 'sede' then nullif(btrim(coalesce(p->>'sede', '')), '') else sede end,
    contatto_nome = case when p ? 'contatto_nome' then nullif(btrim(coalesce(p->>'contatto_nome', '')), '') else contatto_nome end,
    telefono = case when p ? 'telefono' then nullif(btrim(coalesce(p->>'telefono', '')), '') else telefono end,
    email = case when p ? 'email' then nullif(lower(btrim(coalesce(p->>'email', ''))), '') else email end,
    indirizzo = case when p ? 'indirizzo' then nullif(btrim(coalesce(p->>'indirizzo', '')), '') else indirizzo end,
    cap = case when p ? 'cap' then nullif(btrim(coalesce(p->>'cap', '')), '') else cap end,
    comune = case when p ? 'comune' then nullif(btrim(coalesce(p->>'comune', '')), '') else comune end,
    descrizione = case when p ? 'descrizione' then nullif(btrim(coalesce(p->>'descrizione', '')), '') else descrizione end,
    priorita = case when p ? 'priorita' and p->>'priorita' in ('normale', 'urgente') then p->>'priorita' else priorita end,
    importo_stimato = case when p ? 'importo_stimato' then nullif(p->>'importo_stimato', '')::numeric else importo_stimato end,
    commerciale_nome = case when p ? 'commerciale_nome' then nullif(btrim(coalesce(p->>'commerciale_nome', '')), '') else commerciale_nome end,
    commerciale_email = case when p ? 'commerciale_email' then nullif(lower(btrim(coalesce(p->>'commerciale_email', ''))), '') else commerciale_email end,
    tecnico_nome = case when p ? 'tecnico_nome' then nullif(btrim(coalesce(p->>'tecnico_nome', '')), '') else tecnico_nome end,
    assegnato_ruolo = case when p ? 'assegnato_ruolo' then nullif(p->>'assegnato_ruolo', '') else assegnato_ruolo end,
    assegnato_nome = case when p ? 'assegnato_nome' then nullif(btrim(coalesce(p->>'assegnato_nome', '')), '') else assegnato_nome end,
    assegnato_dipendente_id = case when p ? 'assegnato_dipendente_id' then nullif(p->>'assegnato_dipendente_id', '')::bigint else assegnato_dipendente_id end,
    appuntamento_data = case when p ? 'appuntamento_data' then nullif(p->>'appuntamento_data', '')::date else appuntamento_data end,
    appuntamento_fascia = case when p ? 'appuntamento_fascia' then nullif(p->>'appuntamento_fascia', '') else appuntamento_fascia end,
    tacitazione_tentata = case when p ? 'tacitazione_tentata' then coalesce((p->>'tacitazione_tentata')::boolean, false) else tacitazione_tentata end,
    alert_taylor = case when p ? 'alert_taylor' then coalesce((p->>'alert_taylor')::boolean, false) else alert_taylor end,
    updated_at = now()
   where id = p_id returning * into n;
  if n.appuntamento_data is not null and n.appuntamento_fascia is null then raise exception 'Indica mattina o pomeriggio'; end if;

  if (n.appuntamento_data, n.appuntamento_fascia) is distinct from (v.appuntamento_data, v.appuntamento_fascia) then
    perform privato.ct_evento(p_id, 'appuntamento', null, null, p->>'nota',
      jsonb_build_object('da', jsonb_build_object('data', v.appuntamento_data, 'fascia', v.appuntamento_fascia), 'a', jsonb_build_object('data', n.appuntamento_data, 'fascia', n.appuntamento_fascia)));
  end if;
  if (n.assegnato_ruolo, n.assegnato_nome, n.assegnato_dipendente_id, n.tecnico_nome, n.commerciale_nome) is distinct from
     (v.assegnato_ruolo, v.assegnato_nome, v.assegnato_dipendente_id, v.tecnico_nome, v.commerciale_nome) then
    perform privato.ct_evento(p_id, 'assegnata', null, null, p->>'nota',
      jsonb_build_object('ruolo', n.assegnato_ruolo, 'nome', n.assegnato_nome, 'tecnico', n.tecnico_nome, 'commerciale', n.commerciale_nome));
  end if;
  foreach k in array array['cliente_nome','cliente_codice','sede','contatto_nome','telefono','email','indirizzo','cap','comune','descrizione','priorita','importo_stimato','tacitazione_tentata','alert_taylor'] loop
    if (to_jsonb(n)->k) is distinct from (to_jsonb(v)->k) then cambi := cambi || jsonb_build_object(k, jsonb_build_object('da', to_jsonb(v)->k, 'a', to_jsonb(n)->k)); end if;
  end loop;
  if cambi <> '{}'::jsonb then perform privato.ct_evento(p_id, 'modifica', null, null, null, cambi); end if;
end $$;

-- email: in coda Resend (modo 'resend') oppure solo registrata (testo copiato / aperto in Outlook)
create or replace function public.centralino_invia_email(p_id bigint, p_template text, p_a text, p_cc text[], p_oggetto text,
  p_html text, p_testo text, p_modo text default 'resend', p_avanza text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare eid bigint; cc text[];
begin
  perform privato.richiedi_centralino();
  if p_modo not in ('resend', 'copia', 'outlook') then raise exception 'Modo non valido'; end if;
  if not exists (select 1 from public.pratiche where id = p_id) then raise exception 'Pratica non trovata'; end if;
  if nullif(btrim(coalesce(p_oggetto, '')), '') is null then raise exception 'Scrivi l''oggetto'; end if;
  if p_modo = 'resend' and coalesce(p_a, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Indirizzo email del destinatario non valido'; end if;
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into cc from unnest(coalesce(p_cc, '{}')) x where btrim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  if p_modo = 'resend' then
    insert into public.email_in_uscita (destinatario, cc, oggetto, html, testo, dati, pratica_id, stato)
    values (lower(btrim(p_a)), cc, p_oggetto, p_html, p_testo, jsonb_build_object('categoria', 'centralino', 'template', p_template), p_id, 'in_coda')
    returning id into eid;
    perform privato.email_avvia();
  end if;
  perform privato.ct_evento(p_id, 'email_inviata', null, null, p_oggetto,
    jsonb_build_object('modo', p_modo, 'a', p_a, 'cc', cc, 'oggetto', p_oggetto, 'testo', p_testo, 'template', p_template, 'email_id', eid));
  update public.pratiche set updated_at = now() where id = p_id;
  if p_avanza is not null then perform public.centralino_avanza(p_id, p_avanza, '{}'::jsonb, 'Email: ' || p_oggetto); end if;
  return jsonb_build_object('email_id', eid);
end $$;

create or replace function public.centralino_allegato(p_id bigint, p_path text, p_nome text, p_mime text, p_dimensione int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privato.richiedi_centralino();
  if not exists (select 1 from public.pratiche where id = p_id) then raise exception 'Pratica non trovata'; end if;
  if coalesce(p_dimensione, 0) > 10485760 then raise exception 'Il file è troppo grande (massimo 10 MB).'; end if;
  if p_path !~ ('^' || p_id || '/') then raise exception 'Percorso non valido'; end if;
  insert into public.pratiche_allegati (pratica_id, path, nome_file, mime, dimensione) values (p_id, p_path, p_nome, p_mime, p_dimensione);
  perform privato.ct_evento(p_id, 'allegato', null, null, p_nome, jsonb_build_object('path', p_path, 'mime', p_mime, 'dimensione', p_dimensione));
end $$;

create or replace function public.centralino_chiamata_info(p_canale text default 'telefono', p_nota text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform privato.richiedi_centralino();
  insert into public.centralino_chiamate_info (canale, nota, autore_nome) values (coalesce(p_canale, 'telefono'), nullif(btrim(coalesce(p_nota, '')), ''), privato.ct_autore());
end $$;

-- «Il mio registro di oggi»: contatori calcolati dalle pratiche (nessun doppio inserimento)
create or replace function public.centralino_registro_giorno(p_data date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare g date := coalesce(p_data, (now() at time zone 'Europe/Rome')::date);
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return (
    with pr as (select * from public.pratiche where (created_at at time zone 'Europe/Rome')::date = g),
         ci as (select * from public.centralino_chiamate_info where (at at time zone 'Europe/Rome')::date = g)
    select jsonb_build_object(
      'data', g,
      'telefonate', (select count(*) from pr where canale = 'telefono') + (select count(*) from ci where canale = 'telefono'),
      'whatsapp', (select count(*) from pr where canale = 'whatsapp') + (select count(*) from ci where canale = 'whatsapp'),
      'email', (select count(*) from pr where canale = 'email') + (select count(*) from ci where canale = 'email'),
      'offerte_tablet', (select count(*) from pr where tipo like 'offerta%' and canale = 'tablet_tmq'),
      'offerte_whatsapp', (select count(*) from pr where tipo like 'offerta%' and canale = 'whatsapp'),
      'offerte_cliente', (select count(*) from pr where tipo like 'offerta%' and canale in ('telefono', 'email', 'altro')),
      'aggiornamenti_anagrafica', (select count(*) from pr where tipo = 'modifica'),
      'chiamate_info', (select count(*) from ci),
      'pratiche', (select count(*) from pr),
      'chiuse', (select count(*) from public.pratiche where (closed_at at time zone 'Europe/Rome')::date = g and esito <> 'annullata')));
end $$;

-- clienti noti (Taylor: interventi importati) + clienti già passati dal centralino
create or replace function public.centralino_clienti(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_q, '')); pat text;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(x order by x->>'nome') from (
      select jsonb_build_object('codice', i.cod_cliente, 'nome', max(i.cliente), 'sedi', count(distinct i.impianto), 'fonte', 'taylor') x
        from public.interventi_importati i
       where i.cod_cliente is not null and (i.cliente ilike pat or i.cod_cliente ilike pat)
       group by i.cod_cliente limit 12) t), '[]'::jsonb)
    || coalesce((select jsonb_agg(y) from (
      select distinct on (lower(p.cliente_nome)) jsonb_build_object('codice', p.cliente_codice, 'nome', p.cliente_nome, 'contatto', p.contatto_nome,
               'telefono', p.telefono, 'email', p.email, 'indirizzo', p.indirizzo, 'cap', p.cap, 'comune', p.comune, 'fonte', 'pratiche') y
        from public.pratiche p
       where p.cliente_nome ilike pat or p.telefono ilike pat or p.contatto_nome ilike pat or p.email ilike pat
       order by lower(p.cliente_nome), p.created_at desc limit 8) t), '[]'::jsonb);
end $$;

create or replace function public.centralino_sedi(p_codice text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by x->>'comune', x->>'indirizzo') from (
    select distinct on (i.impianto) jsonb_build_object('impianto', i.impianto, 'indirizzo', concat_ws(' ', i.via, i.civico), 'cap', i.cap, 'comune', i.comune, 'cliente', i.cliente) x
      from public.interventi_importati i where i.cod_cliente = p_codice and i.impianto is not null
     order by i.impianto, i.data_riferimento desc nulls last limit 500) t), '[]'::jsonb);
end $$;

-- tecnici per l'assegnazione
create or replace function public.centralino_persone() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'nome', d.cognome || ' ' || d.nome, 'categoria', d.categoria) order by d.cognome, d.nome)
    from public.dipendenti d where d.attivo and d.categoria = 'TEC'), '[]'::jsonb);
end $$;

-- operatrice del centralino assente oggi (ferie approvate / assenze)? → copre il sostituto
create or replace function public.centralino_copertura() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare oggi date := (now() at time zone 'Europe/Rome')::date;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return jsonb_build_object(
    'assenti', coalesce((select jsonb_agg(distinct r.nome) from public.responsabili r
       join public.assenze a on a.tecnico_id = r.dipendente_id and oggi between a.dal and a.al
      where r.attivo and r.centralino and r.area = 'flotta'), '[]'::jsonb),
    'sostituto', (select valore #>> '{}' from public.centralino_impostazioni where chiave = 'sostituto'));
end $$;

-- controllo SLA: evento 'sla_scaduto' + campanella (una volta per stadio)
create or replace function privato.centralino_controlla_sla() returns int
language plpgsql security definer set search_path = '' as $$
declare p record; n int := 0; nomest text;
begin
  for p in select * from public.pratiche where esito = 'aperta' and sla_scadenza < now() and sla_notificato is distinct from sla_stadio for update skip locked loop
    select s->>'nome' into nomest from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p.sla_stadio;
    insert into public.pratiche_eventi (pratica_id, tipo, da_stato, a_stato, testo, dati, autore, autore_nome)
    values (p.id, 'sla_scaduto', p.stato_corrente, p.stato_corrente, 'Tempo scaduto per «' || coalesce(nomest, p.sla_stadio) || '»',
            jsonb_build_object('sla_stadio', p.sla_stadio, 'sla_scadenza', p.sla_scadenza), null, 'Sistema');
    update public.pratiche set sla_notificato = sla_stadio, sla_rispettato = false where id = p.id;
    perform privato.ct_notifica('SLA scaduto · ' || p.numero, p.cliente_nome || ' — ' || coalesce(nomest, p.sla_stadio), '/centralino/pratica/' || p.id, 'ko');
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.centralino_controlla_sla() returns int
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return privato.centralino_controlla_sla();
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('centralino_sla', '*/5 * * * *', 'select privato.centralino_controlla_sla()');
  end if;
end $$;

grant execute on function public.centralino_crea(jsonb), public.centralino_avanza(bigint, text, jsonb, text), public.centralino_chiudi(bigint, text, text),
  public.centralino_nota(bigint, text, text, jsonb), public.centralino_aggiorna(bigint, jsonb),
  public.centralino_invia_email(bigint, text, text, text[], text, text, text, text, text), public.centralino_allegato(bigint, text, text, text, int),
  public.centralino_chiamata_info(text, text), public.centralino_registro_giorno(date), public.centralino_clienti(text), public.centralino_sedi(text),
  public.centralino_persone(), public.centralino_copertura(), public.centralino_controlla_sla(), public.centralino_sla_anteprima(timestamptz, jsonb) to authenticated;

-- 8. Modelli email ---------------------------------------------------------------------
insert into public.email_template (codice, nome, oggetto, corpo_html, tipo_pratica, cc_offerte_grandi, ordine) values
('conferma_intervento', 'Conferma appuntamento intervento', 'Molajoni · Intervento confermato per {data_appuntamento} – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>le confermiamo l''intervento di manutenzione presso <b>{cliente}</b> per <b>{data_appuntamento}</b>, in fascia <b>{fascia}</b>.</p><p>Il nostro tecnico la contatterà poco prima di arrivare. Se nel frattempo dovesse cambiare qualcosa, può rispondere a questa email o chiamarci.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'manutenzione', false, 10),
('conferma_urgente_allarme', 'Conferma intervento urgente (allarme)', 'Molajoni · Intervento urgente in giornata – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>abbiamo ricevuto la sua segnalazione di allarme attivo presso <b>{cliente}</b>. Un nostro tecnico è stato avvisato e interverrà <b>in giornata</b>.</p><p>Se l''allarme dovesse tacitarsi o la situazione cambiare, ci chiami subito: aggiorniamo il tecnico.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'manutenzione', false, 20),
('conferma_sopralluogo', 'Conferma sopralluogo', 'Molajoni · Sopralluogo confermato per {data_appuntamento} – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>le confermiamo il sopralluogo tecnico presso <b>{cliente}</b> per <b>{data_appuntamento}</b>, in fascia <b>{fascia}</b>.</p><p>La seguirà {commerciale}, che resta a sua disposizione per qualsiasi domanda prima della visita.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'sopralluogo', false, 30),
('presa_offerta_piccola', 'Presa in carico offerta (entro 60 minuti)', 'Molajoni · Abbiamo ricevuto la sua richiesta – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>grazie per averci contattato. Abbiamo preso in carico la sua richiesta di offerta per <b>{cliente}</b>: le invieremo la proposta <b>entro 60 minuti</b>.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'offerta_piccola', false, 40),
('presa_offerta_grande', 'Presa in carico offerta oltre 1.000 €', 'Molajoni · Richiesta di offerta presa in carico – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>grazie per la sua richiesta. L''abbiamo affidata a <b>{commerciale}</b>, che la contatterà <b>entro 2 ore</b> per capire insieme le sue esigenze e preparare la proposta più adatta per <b>{cliente}</b>.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'offerta_grande', true, 50),
('invio_offerta', 'Invio offerta', 'Molajoni · La nostra offerta – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>come concordato, le inviamo in allegato la nostra offerta per <b>{cliente}</b>.</p><p>Restiamo a disposizione per chiarimenti o per adattarla alle sue esigenze. Per confermare è sufficiente rispondere a questa email.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 null, false, 60),
('followup_offerta', 'Follow-up offerta', 'Molajoni · Ha avuto modo di vedere la nostra offerta? – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>le scrivo per sapere se ha avuto modo di valutare l''offerta che le abbiamo inviato per <b>{cliente}</b>.</p><p>Se ha domande o desidera qualche modifica, sono a disposizione: possiamo sentirci quando le è più comodo.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 null, false, 70),
('conferma_modifica_calendario', 'Conferma modifica calendario', 'Molajoni · Modifica dell''appuntamento confermata – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>le confermiamo che abbiamo aggiornato il calendario degli interventi per <b>{cliente}</b>. Il nuovo appuntamento è per <b>{data_appuntamento}</b>, in fascia <b>{fascia}</b>.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'modifica', false, 80),
('conferma_anagrafica', 'Conferma aggiornamento anagrafica', 'Molajoni · Dati aggiornati – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>le confermiamo che abbiamo aggiornato i dati di <b>{cliente}</b> come da sua richiesta. Da ora in poi useremo i nuovi riferimenti.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'modifica', false, 90),
('conferma_disdetta', 'Conferma disdetta', 'Molajoni · Conferma di ricezione della disdetta – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>le confermiamo di aver ricevuto la richiesta di disdetta per <b>{cliente}</b>. La pratica è stata registrata e l''ufficio competente la gestirà secondo i termini del contratto.</p><p>Ci dispiace vederla andare: se possiamo fare qualcosa per farle cambiare idea, siamo qui.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'modifica', false, 100),
('girata_ufficio', 'Risposta generica: girata all''ufficio competente', 'Molajoni · Abbiamo ricevuto la sua richiesta – pratica {numero_pratica}',
 '<p>Gentile {contatto},</p><p>grazie per averci scritto. Abbiamo inoltrato la sua richiesta all''ufficio competente, che la ricontatterà il prima possibile.</p><p>Riferimento: {numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 null, false, 110)
on conflict (codice) do nothing;
