-- =====================================================================
-- Portale unico · Fasi 2-4 — FERIE E PERMESSI · 1/5: struttura
-- (documento di progetto approvato del 20/10/2026)
--
-- Contenuto:
--  A. Schema `privato` per le funzioni interne (non raggiungibile dalle API).
--  B. Tabelle: festivita, tipi_assenza, config_azienda, spettanze, saldi_iniziali,
--     rettifiche_saldo, contatori_richieste, richieste_assenza, richieste_assenza_giorni,
--     assenze_da_richieste.
--  C. Collegamento con piano e veicoli: `assenze` diventa `assenze_manuali` e nasce la
--     VISTA `assenze` = assenze manuali + richieste APPROVATE a giornata intera.
--  D. Sicurezza: RLS, permessi minimi, audit.
--
-- Nota sui permessi: in questo progetto le tabelle nuove create in `public` ricevono in
-- automatico TUTTI i permessi per anon e authenticated (privilegi di default di Supabase)
-- e le migrazioni non possono togliere permessi. Per questo ogni tabella/vista nuova viene
-- creata nello schema `privato` (nessun privilegio di default) e poi spostata in `public`
-- con ALTER ... SET SCHEMA: così nasce senza permessi e si concedono (GRANT) solo quelli
-- necessari, colonna per colonna dove serve.
-- =====================================================================

-- A. Schema interno ----------------------------------------------------------
create schema if not exists privato;
comment on schema privato is 'Funzioni e oggetti interni del portale. Nessun permesso per anon/authenticated: non esposto dalle API.';

-- B1. Festività ----------------------------------------------------------------
create table privato.festivita (
  data date primary key,
  nome text not null check (length(trim(nome)) > 0),
  origine text not null default 'nazionale' check (origine in ('nazionale', 'patrono', 'altro')),
  attiva boolean not null default true,
  creato_il timestamptz not null default now()
);
alter table privato.festivita set schema public;
comment on table public.festivita is 'Festività (non lavorative per tutti). Nazionali generate con hr_genera_festivita(anno); il Santo Patrono lo inserisce HR (origine patrono). Per togliere una festività: attiva = false.';

-- Pasqua (algoritmo gregoriano anonimo / Meeus-Jones-Butcher)
create or replace function privato.pasqua(p_anno int) returns date
language plpgsql immutable set search_path = '' as $$
declare
  a int := p_anno % 19; b int := p_anno / 100; c int := p_anno % 100;
  d int := b / 4; e int := b % 4; f int := (b + 8) / 25; g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30; i int := c / 4; k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7; m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_anno, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- Festività nazionali italiane di un anno (non sovrascrive quelle già presenti)
create or replace function privato.genera_festivita(p_anno int) returns int
language plpgsql set search_path = '' as $$
declare n int; p date;
begin
  if p_anno is null or p_anno < 2000 or p_anno > 2100 then raise exception 'Anno non valido'; end if;
  p := privato.pasqua(p_anno);
  insert into public.festivita (data, nome, origine)
  select x.d, x.n, 'nazionale' from (values
    (make_date(p_anno, 1, 1),   'Capodanno'),
    (make_date(p_anno, 1, 6),   'Epifania'),
    (p,                         'Pasqua'),
    (p + 1,                     'Lunedì dell''Angelo'),
    (make_date(p_anno, 4, 25),  'Festa della Liberazione'),
    (make_date(p_anno, 5, 1),   'Festa del Lavoro'),
    (make_date(p_anno, 6, 2),   'Festa della Repubblica'),
    (make_date(p_anno, 8, 15),  'Ferragosto (Assunzione)'),
    (make_date(p_anno, 11, 1),  'Ognissanti'),
    (make_date(p_anno, 12, 8),  'Immacolata Concezione'),
    (make_date(p_anno, 12, 25), 'Natale'),
    (make_date(p_anno, 12, 26), 'Santo Stefano')
  ) x(d, n)
  union all
  -- San Francesco d'Assisi: festività nazionale dal 2026 (L. 151/2025)
  select make_date(p_anno, 10, 4), 'San Francesco d''Assisi', 'nazionale' where p_anno >= 2026
  on conflict (data) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

select privato.genera_festivita(2026), privato.genera_festivita(2027);

-- B2. Tipi di assenza -----------------------------------------------------------
create table privato.tipi_assenza (
  codice text primary key check (codice ~ '^[A-Z]{2,10}$'),
  descrizione text not null check (length(trim(descrizione)) > 0),
  unita text not null check (unita in ('giorni', 'ore')),
  con_saldo boolean not null default false,
  mezza_giornata boolean not null default false,
  etichetta_piano text not null check (etichetta_piano in ('Ferie', 'Permesso', 'Assente')),
  richiedibile boolean not null default true,
  ordine int not null default 100,
  attivo boolean not null default true
);
alter table privato.tipi_assenza set schema public;
comment on table public.tipi_assenza is 'Catalogo dei tipi di assenza. unita = giorni|ore; etichetta_piano = unica informazione visibile al responsabile flotta (mai la causa).';
comment on column public.tipi_assenza.richiedibile is 'false = solo HR può inserirlo per conto del dipendente.';

insert into public.tipi_assenza (codice, descrizione, unita, con_saldo, mezza_giornata, etichetta_piano, richiedibile, ordine) values
  ('FERIE', 'Ferie',                                         'giorni', true,  true,  'Ferie',    true, 10),
  ('ROL',   'Permesso ROL (riduzione orario di lavoro)',      'ore',    true,  false, 'Permesso', true, 20),
  ('EXF',   'Permesso ex festività',                          'ore',    true,  false, 'Permesso', true, 30),
  ('PNR',   'Permesso non retribuito',                        'ore',    false, false, 'Permesso', true, 40),
  ('MAL',   'Malattia',                                       'giorni', false, false, 'Assente',  true, 50),
  ('ALTRO', 'Altra assenza (congedi, lutto, L. 104, ...)',    'giorni', false, true,  'Assente',  true, 90);

-- B3. Configurazione aziendale (chiave/valore) ------------------------------------
create table privato.config_azienda (
  chiave text primary key,
  valore text,
  descrizione text not null,
  da_confermare boolean not null default false,
  aggiornato_il timestamptz not null default now(),
  constraint config_azienda_valori_check check (
    (chiave <> 'maturazione_giorni_minimi' or valore ~ '^[0-9]{1,2}$')
    and (chiave <> 'ore_giornaliere_full_time' or valore ~ '^[0-9]{1,2}(\.[0-9]{1,2})?$'))
);
alter table privato.config_azienda set schema public;
insert into public.config_azienda (chiave, valore, descrizione, da_confermare) values
  ('comune_sede', null, 'Comune della sede (per il Santo Patrono, da inserire in festivita con origine patrono).', true),
  ('ccnl', 'Da definire', 'Contratto collettivo applicato (es. Metalmeccanico industria).', true),
  ('maturazione_giorni_minimi', '15', 'Un mese matura ferie/permessi se il rapporto di lavoro copre almeno questi giorni di calendario del mese (regola CCNL, da confermare).', true),
  ('ore_giornaliere_full_time', '8', 'Ore di una giornata a tempo pieno: base per la proporzione part-time (ore_giornaliere / questo valore).', false);

-- B4. Spettanze annue (tempo pieno) -------------------------------------------------
create table privato.spettanze (
  anno int not null check (anno between 2000 and 2100),
  tipo text not null references public.tipi_assenza(codice),
  quantita numeric(7, 2) not null check (quantita >= 0),
  nota_ccnl text,
  da_confermare boolean not null default true,
  aggiornato_il timestamptz not null default now(),
  primary key (anno, tipo)
);
alter table privato.spettanze set schema public;
comment on table public.spettanze is 'Spettanza annua per un tempo pieno, nell''unità del tipo (giorni o ore). Maturazione: 1/12 al mese, proporzionale al part-time.';
insert into public.spettanze (anno, tipo, quantita, nota_ccnl, da_confermare)
select a, x.tipo, x.q, x.nota, true from generate_series(2026, 2027) a, (values
  ('FERIE', 26::numeric, 'VALORE DI ESEMPIO da confermare col CCNL. Attenzione: i giorni si contano lavorativi (esclusi riposi e festività); con settimana di 5 giorni 4 settimane = 20 giorni.'),
  ('ROL',   72::numeric, 'VALORE DI ESEMPIO da confermare col CCNL (ore annue).'),
  ('EXF',   32::numeric, 'VALORE DI ESEMPIO da confermare col CCNL (ore annue).')
) x(tipo, q, nota);

-- B5. Saldi iniziali (import dal file dell'ufficio paghe) ------------------------------
create table privato.saldi_iniziali (
  id bigint generated always as identity primary key,
  dipendente_id bigint not null references public.dipendenti(id),
  anno int not null check (anno between 2000 and 2100),
  tipo text not null references public.tipi_assenza(codice),
  data_riferimento date not null,
  residuo numeric(7, 2) not null,
  goduto_anno numeric(7, 2) not null default 0 check (goduto_anno >= 0),
  fonte text,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  unique (dipendente_id, anno, tipo),
  check (extract(year from data_riferimento)::int = anno)
);
alter table privato.saldi_iniziali set schema public;
comment on table public.saldi_iniziali is 'Saldo alla data dell''ultimo cedolino: residuo disponibile e goduto nell''anno a quella data. Il calcolo riparte da qui.';

-- B6. Rettifiche manuali dei saldi ---------------------------------------------------
create table privato.rettifiche_saldo (
  id bigint generated always as identity primary key,
  dipendente_id bigint not null references public.dipendenti(id),
  anno int not null check (anno between 2000 and 2100),
  tipo text not null references public.tipi_assenza(codice),
  quantita numeric(7, 2) not null check (quantita <> 0),
  motivo text not null check (length(trim(motivo)) >= 5),
  autore uuid references auth.users(id),
  creato_il timestamptz not null default now()
);
alter table privato.rettifiche_saldo set schema public;
create index rettifiche_saldo_dip_idx on public.rettifiche_saldo (dipendente_id, anno, tipo);

-- B7. Numerazione leggibile delle richieste (RF-AAAA-NNNN) -----------------------------
create table privato.contatori_richieste (
  anno int primary key,
  ultimo int not null default 0
);
alter table privato.contatori_richieste set schema public;

-- B8. Richieste di assenza (mai cancellate: si annullano con lo stato) ------------------
create table privato.richieste_assenza (
  id bigint generated always as identity primary key,
  numero text not null unique,
  dipendente_id bigint not null references public.dipendenti(id),
  tipo text not null references public.tipi_assenza(codice),
  primo_giorno date not null,
  ultimo_giorno date not null,
  ora_inizio time,
  ora_fine time,
  mezza_giornata boolean not null default false,
  quantita numeric(7, 2) not null check (quantita > 0),
  unita text not null check (unita in ('giorni', 'ore')),
  giorni_lavorativi numeric(6, 2) not null check (giorni_lavorativi > 0),
  note text check (note is null or length(note) <= 500),
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'approvata', 'rifiutata', 'annullata')),
  saldo_insufficiente boolean not null default false,
  avvisi jsonb not null default '[]',
  motivo_decisione text,
  deciso_da uuid references auth.users(id),
  deciso_il timestamptz,
  motivo_annullamento text,
  annullata_da text check (annullata_da in ('dipendente', 'hr')),
  annullata_da_utente uuid references auth.users(id),
  annullata_il timestamptz,
  creata_da text not null default 'dipendente' check (creata_da in ('dipendente', 'hr')),
  creata_da_utente uuid references auth.users(id),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  constraint richieste_periodo_check check (ultimo_giorno >= primo_giorno),
  constraint richieste_orario_check check ((ora_inizio is null) = (ora_fine is null)
    and (ora_inizio is null or (ora_fine > ora_inizio and primo_giorno = ultimo_giorno and not mezza_giornata))),
  constraint richieste_mezza_check check (not mezza_giornata or primo_giorno = ultimo_giorno),
  constraint richieste_rifiuto_motivo_check check (stato <> 'rifiutata' or length(trim(coalesce(motivo_decisione, ''))) > 0),
  constraint richieste_annullo_check check (stato <> 'annullata' or (annullata_il is not null and annullata_da is not null))
);
alter table privato.richieste_assenza set schema public;
create index richieste_assenza_dip_idx on public.richieste_assenza (dipendente_id, primo_giorno);
create index richieste_assenza_attesa_idx on public.richieste_assenza (creato_il) where stato = 'in_attesa';
comment on table public.richieste_assenza is 'Richieste di ferie/permessi/assenze. ultimo_giorno = giorno di rientro − 1. Le note non devono MAI contenere diagnosi. Scritte solo dalle funzioni dipendente_* e hr_*.';

-- Dettaglio giorno per giorno (solo giorni lavorativi del dipendente): base di saldi,
-- sovrapposizioni, attribuzione all'anno, calendario e report. Scritto una volta sola.
create table privato.richieste_assenza_giorni (
  richiesta_id bigint not null references public.richieste_assenza(id),
  giorno date not null,
  quantita numeric(7, 2) not null check (quantita > 0),
  frazione numeric(4, 3) not null check (frazione > 0 and frazione <= 1),
  primary key (richiesta_id, giorno)
);
alter table privato.richieste_assenza_giorni set schema public;
create index richieste_assenza_giorni_giorno_idx on public.richieste_assenza_giorni (giorno);

-- Riga "per il piano" di ogni richiesta, con la SOLA etichetta (mai tipo, motivo, note):
--  possibile = richiesta in attesa (il piano mostra "possibile assenza", non blocca)
--  assenza   = approvata a giornata intera (entra nella vista assenze: blocca)
--  nota      = approvata a ore o mezza giornata (solo una nota nel piano)
-- Mantenuta dal trigger su richieste_assenza; attiva = false quando rifiutata/annullata.
create table privato.assenze_da_richieste (
  richiesta_id bigint primary key references public.richieste_assenza(id),
  dipendente_id bigint not null references public.dipendenti(id),
  dal date not null,
  al date not null,
  tipo_riga text not null check (tipo_riga in ('possibile', 'assenza', 'nota')),
  etichetta text not null,
  attiva boolean not null,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
alter table privato.assenze_da_richieste set schema public;
create index assenze_da_richieste_dip_idx on public.assenze_da_richieste (dipendente_id, dal, al) where attiva;

-- C. Collegamento con piano e veicoli -----------------------------------------------------
-- La tabella delle assenze inserite dal responsabile flotta diventa `assenze_manuali`
-- (permessi, policy, trigger e chiavi la seguono). Le righe non si cancellano: annullata = true.
alter table public.assenze rename to assenze_manuali;
alter table public.assenze_manuali
  add column annullata boolean not null default false,
  add column annullata_il timestamptz,
  add column annullata_da uuid references auth.users(id);
comment on table public.assenze_manuali is 'Assenze inserite a mano dal responsabile flotta (es. formazione). Ferie e permessi arrivano dalle richieste HR. Mai cancellate: annullata = true.';

-- Il trigger che annulla la conferma del piano riconosceva la tabella dal nome: si estende
-- ai nuovi nomi con una sostituzione puntuale nel testo della funzione esistente (stesso
-- metodo della fase 1), lasciando invariato il resto del comportamento.
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.tg_annulla_piano()'::regprocedure);
  nuovo := replace(src, $x$TG_TABLE_NAME = 'assenze'$x$, $x$TG_TABLE_NAME in ('assenze', 'assenze_manuali', 'assenze_da_richieste')$x$);
  if nuovo = src then raise exception 'tg_annulla_piano: testo atteso non trovato'; end if;
  execute nuovo;
end $$;

-- Chi vede le assenze manuali: responsabile flotta solo TEC (com'era), HR in sola lettura.
alter policy resp_assenze on public.assenze_manuali
  using ((select public.is_responsabile()) and exists (select 1 from public.tecnici t where t.id = tecnico_id))
  with check ((select public.is_responsabile()) and exists (select 1 from public.tecnici t where t.id = tecnico_id));
alter policy resp_assenze on public.assenze_manuali rename to assenze_man_resp;
create policy assenze_man_hr_sel on public.assenze_manuali for select to authenticated using ((select public.is_hr()));

-- VISTA `assenze`: tutte le funzioni esistenti (piano_giorno, proponi_assegnazioni,
-- controlli_tecnico, tecnico_home, report, ...) la leggono per nome e vedono così anche le
-- ferie approvate. id positivo = manuale, id negativo = −id della richiesta.
create view privato.assenze with (security_invoker = true) as
  select m.id, m.tecnico_id, m.dal, m.al, m.motivo, m.creato_il, 'manuale'::text as origine
    from public.assenze_manuali m
   where not m.annullata
  union all
  select -d.richiesta_id, d.dipendente_id, d.dal, d.al, d.etichetta, d.creato_il, 'richiesta'::text
    from public.assenze_da_richieste d
   where d.attiva and d.tipo_riga = 'assenza';
alter view privato.assenze set schema public;
comment on view public.assenze is 'Assenze che bloccano il piano: manuali (id > 0) + richieste approvate a giornata intera (id < 0, motivo = etichetta generica). Scrivibile solo per le manuali (trigger INSTEAD OF).';

-- Scritture sulla vista (compatibilità con il pannello attuale): vanno su assenze_manuali.
-- Funzioni SECURITY INVOKER: valgono i permessi e le policy di chi scrive.
create or replace function public.tg_assenze_vista() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    insert into public.assenze_manuali (tecnico_id, dal, al, motivo)
    values (new.tecnico_id, new.dal, new.al, coalesce(nullif(trim(new.motivo), ''), 'Assenza'))
    returning id, creato_il into new.id, new.creato_il;
    new.origine := 'manuale';
    return new;
  end if;
  if coalesce(old.id, 0) < 0 then
    raise exception 'Questa assenza viene da una richiesta approvata dall''ufficio personale: si modifica o annulla solo dall''area HR.';
  end if;
  if TG_OP = 'UPDATE' then
    update public.assenze_manuali set tecnico_id = new.tecnico_id, dal = new.dal, al = new.al, motivo = new.motivo
     where id = old.id and not annullata;
    return new;
  end if;
  -- eliminazione dal pannello: la riga non si cancella, si annulla
  update public.assenze_manuali set annullata = true, annullata_il = now(), annullata_da = auth.uid()
   where id = old.id and not annullata;
  return old;
end $$;
create trigger assenze_vista_scrittura instead of insert or update on public.assenze
  for each row execute function public.tg_assenze_vista();

-- D. Sicurezza -----------------------------------------------------------------------------
alter table public.festivita enable row level security;
alter table public.tipi_assenza enable row level security;
alter table public.config_azienda enable row level security;
alter table public.spettanze enable row level security;
alter table public.saldi_iniziali enable row level security;
alter table public.rettifiche_saldo enable row level security;
alter table public.contatori_richieste enable row level security;
alter table public.richieste_assenza enable row level security;
alter table public.richieste_assenza_giorni enable row level security;
alter table public.assenze_da_richieste enable row level security;

-- Festività: lettura per tutti i pannelli autenticati, modifica solo HR
create policy fest_lettura on public.festivita for select to authenticated using (true);
create policy fest_hr_ins on public.festivita for insert to authenticated with check ((select public.is_hr()));
create policy fest_hr_upd on public.festivita for update to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
grant select, insert on public.festivita to authenticated;
grant update (nome, origine, attiva) on public.festivita to authenticated;

-- Impostazioni HR
create policy tipi_hr on public.tipi_assenza for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
grant select on public.tipi_assenza to authenticated;
grant insert (codice, descrizione, unita, con_saldo, mezza_giornata, etichetta_piano, richiedibile, ordine) on public.tipi_assenza to authenticated;
grant update (descrizione, mezza_giornata, etichetta_piano, richiedibile, ordine, attivo) on public.tipi_assenza to authenticated;

create policy config_hr on public.config_azienda for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
grant select on public.config_azienda to authenticated;
grant update (valore, da_confermare) on public.config_azienda to authenticated;

create policy spettanze_hr on public.spettanze for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
grant select, insert on public.spettanze to authenticated;
grant update (quantita, nota_ccnl, da_confermare) on public.spettanze to authenticated;

create policy saldi_iniziali_hr on public.saldi_iniziali for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
grant select on public.saldi_iniziali to authenticated;
grant insert (dipendente_id, anno, tipo, data_riferimento, residuo, goduto_anno, fonte) on public.saldi_iniziali to authenticated;
grant update (data_riferimento, residuo, goduto_anno, fonte) on public.saldi_iniziali to authenticated;

-- Richieste, giorni e rettifiche: sola lettura per HR (scritture solo dalle funzioni)
create policy rett_hr_sel on public.rettifiche_saldo for select to authenticated using ((select public.is_hr()));
grant select on public.rettifiche_saldo to authenticated;
create policy rich_hr_sel on public.richieste_assenza for select to authenticated using ((select public.is_hr()));
grant select on public.richieste_assenza to authenticated;
create policy rich_giorni_hr_sel on public.richieste_assenza_giorni for select to authenticated using ((select public.is_hr()));
grant select on public.richieste_assenza_giorni to authenticated;

-- Righe per il piano: HR tutte; responsabile flotta solo i TEC (solo etichetta generica)
create policy adr_lettura on public.assenze_da_richieste for select to authenticated
  using ((select public.is_hr()) or ((select public.is_responsabile()) and exists (select 1 from public.tecnici t where t.id = dipendente_id)));
grant select on public.assenze_da_richieste to authenticated;

-- Vista assenze: stessi permessi che aveva la tabella per il pannello
grant select, insert, update on public.assenze to authenticated;
-- (l'eliminazione dal pannello attuale è attivata a parte nella migrazione 0010b)

-- Audit (trigger esistente) e data di aggiornamento
create trigger audit_festivita after insert or update on public.festivita for each row execute function public.tg_audit();
create trigger audit_tipi_assenza after insert or update on public.tipi_assenza for each row execute function public.tg_audit();
create trigger audit_config_azienda after insert or update on public.config_azienda for each row execute function public.tg_audit('aggiornato_il');
create trigger audit_spettanze after insert or update on public.spettanze for each row execute function public.tg_audit('aggiornato_il');
create trigger audit_saldi_iniziali after insert or update on public.saldi_iniziali for each row execute function public.tg_audit('aggiornato_il');
create trigger audit_rettifiche_saldo after insert on public.rettifiche_saldo for each row execute function public.tg_audit();
create trigger audit_richieste_assenza after insert or update on public.richieste_assenza for each row execute function public.tg_audit('aggiornato_il');
create trigger upd_config_azienda before update on public.config_azienda for each row execute function public.tg_aggiornato();
create trigger upd_spettanze before update on public.spettanze for each row execute function public.tg_aggiornato();
create trigger upd_saldi_iniziali before update on public.saldi_iniziali for each row execute function public.tg_aggiornato();
create trigger upd_richieste_assenza before update on public.richieste_assenza for each row execute function public.tg_aggiornato();
create trigger upd_assenze_da_richieste before update on public.assenze_da_richieste for each row execute function public.tg_aggiornato();

-- Il piano confermato si annulla quando cambia una riga che conta per il piano
-- (approvazione, annullamento di un'approvata, permesso a ore). Le sole richieste in
-- attesa ("possibile assenza") non annullano la conferma.
create trigger piano_assenze_richieste_ins after insert on public.assenze_da_richieste
  for each row when (new.tipo_riga <> 'possibile') execute function public.tg_annulla_piano();
create trigger piano_assenze_richieste_upd after update on public.assenze_da_richieste
  for each row when ((old.tipo_riga <> 'possibile' or new.tipo_riga <> 'possibile')
                     and (old.attiva, old.tipo_riga, old.dal, old.al) is distinct from (new.attiva, new.tipo_riga, new.dal, new.al))
  execute function public.tg_annulla_piano();

-- Il tipo di assenza non cambia unità o saldo se ci sono già richieste (i conteggi resterebbero falsi)
create or replace function public.tg_tipi_assenza_blocco() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.unita, new.con_saldo) is distinct from (old.unita, old.con_saldo)
     and exists (select 1 from public.richieste_assenza r where r.tipo = old.codice) then
    raise exception 'Questo tipo ha già delle richieste: unità e saldo non si possono cambiare.';
  end if;
  return new;
end $$;
create trigger blocco_tipi_assenza before update on public.tipi_assenza for each row execute function public.tg_tipi_assenza_blocco();
