-- =====================================================================
-- Portale unico · Fasi 2-4 — FERIE E PERMESSI · 5/5: correzioni dopo la revisione critica
-- (docs/REVISIONE_DB.md del 20/10/2026; risposte punto per punto in fondo a quel file)
--
--  P0-1  audit_log: il responsabile flotta vede solo il registro di flotta e dei TEC; HR vede il
--        registro delle tabelle HR; le note delle richieste non vanno nel registro.
--  P0-2  piano_giorno: tecnico assente CON interventi = blocco (ko) → il piano non si conferma;
--        intervento dentro la fascia di un permesso a ore = avviso; mezza giornata = avviso.
--  P0-4  maturazione part-time: giorni proporzionali ai giorni lavorati a settimana, ore alle ore
--        settimanali; spettanza personale (spettanze_dipendente) che prevale su quella aziendale.
--  P0-5  il responsabile flotta vede solo "Assente" (mai Ferie/Permesso/Malattia), salvo scelta
--        diversa del cliente (config flotta_mostra_tipo = 'si'); assenze manuali con motivi fissi.
--  P0-6  notifiche: il responsabile flotta non legge le notifiche ferie dei dipendenti; i titoli
--        push non contengono mai il tipo di assenza (compaiono sullo schermo bloccato).
--  P1-3  le richieste dei NON tecnici non toccano la conferma del piano; se una richiesta di un
--        tecnico toglie la conferma, il responsabile flotta riceve una notifica.
--  P1-4  permesso a ore oltre l'orario giornaliero = errore (non più solo avviso).
--  P1-6  riporto del saldo dall'anno precedente anche senza saldo iniziale; festività 2028 e
--        generazione automatica annuale; errore se l'anno richiesto non ha il calendario.
--  P1-10 regola dei giorni minimi con operatore configurabile ('>=' o '>'); avviso se manca la
--        data di assunzione.
--  P1-2  cambio di categoria di un dipendente = sessioni revocate.
--  P2-7  service_role: lettura delle nuove tabelle (funzioni server).
--  P2-8  dipendente con data di cessazione passata: non entra più.
--  P2-10 account HR collegato ma disattivato: le sue richieste tornano decidibili dall'HR.
--  P3    aggiornare un'assenza manuale annullata dà errore invece di non fare nulla.
-- =====================================================================

-- Configurazione nuova -----------------------------------------------------------------------
alter table public.config_azienda add constraint config_azienda_valori2_check check (
  (chiave <> 'giorni_settimana_full_time' or valore ~ '^[1-7]$')
  and (chiave <> 'maturazione_regola' or valore in ('>=', '>'))
  and (chiave <> 'flotta_mostra_tipo' or valore in ('si', 'no')));
insert into public.config_azienda (chiave, valore, descrizione, da_confermare) values
  ('giorni_settimana_full_time', '5', 'Giorni lavorati a settimana da un tempo pieno: base della proporzione per le spettanze in giorni (giorni lavorati del dipendente / questo valore).', true),
  ('maturazione_regola', '>=', 'Confronto con maturazione_giorni_minimi: ">=" (almeno 15 giorni, es. commercio) oppure ">" (più di 15 giorni, es. metalmeccanico).', true),
  ('flotta_mostra_tipo', 'no', '"no" = il responsabile flotta vede solo "Assente"; "si" = vede anche l''etichetta del tipo (Ferie/Permesso). Malattia e altre assenze restano sempre "Assente".', true)
on conflict (chiave) do nothing;

-- Esempio di spettanza coerente con il conteggio in giorni LAVORATIVI (settimana di 5 giorni)
update public.spettanze set quantita = 20,
  nota_ccnl = 'VALORE DI ESEMPIO da confermare col CCNL: 4 settimane = 20 giorni lavorativi su settimana di 5 giorni (prima era 26, che vale per la settimana convenzionale di 6 giorni).'
 where tipo = 'FERIE' and anno in (2026, 2027) and quantita = 26;

-- Spettanza personale (anzianità, neo-assunti, accordi individuali) -------------------------
create table privato.spettanze_dipendente (
  dipendente_id bigint not null references public.dipendenti(id),
  anno int not null check (anno between 2000 and 2100),
  tipo text not null references public.tipi_assenza(codice),
  quantita numeric(7, 2) not null check (quantita >= 0),
  nota text,
  aggiornato_il timestamptz not null default now(),
  primary key (dipendente_id, anno, tipo)
);
alter table privato.spettanze_dipendente set schema public;
comment on table public.spettanze_dipendente is 'Spettanza annua PERSONALE (già proporzionata al suo orario): se presente prevale su spettanze e non si applica il fattore part-time.';
alter table public.spettanze_dipendente enable row level security;
create policy spettanze_dip_hr on public.spettanze_dipendente for all to authenticated using ((select public.is_hr())) with check ((select public.is_hr()));
grant select, insert on public.spettanze_dipendente to authenticated;
grant update (quantita, nota) on public.spettanze_dipendente to authenticated;
create trigger audit_spettanze_dipendente after insert or update on public.spettanze_dipendente for each row execute function public.tg_audit('aggiornato_il');
create trigger upd_spettanze_dipendente before update on public.spettanze_dipendente for each row execute function public.tg_aggiornato();

-- P2-7: lettura per le funzioni server (service_role salta la RLS ma non i permessi)
grant select on public.festivita, public.tipi_assenza, public.config_azienda, public.spettanze, public.spettanze_dipendente,
  public.saldi_iniziali, public.rettifiche_saldo, public.richieste_assenza, public.richieste_assenza_giorni,
  public.assenze_da_richieste, public.assenze to service_role;

-- P1-10: regola dei giorni minimi con operatore configurabile ---------------------------------
create or replace function privato.mesi_maturati(p_assunzione date, p_cessazione date, p_anno int, p_dopo date, p_fino date)
returns int language sql stable set search_path = '' as $$
  select count(*)::int
    from generate_series(1, 12) m,
         lateral (select make_date(p_anno, m, 1) as ini,
                         (make_date(p_anno, m, 1) + interval '1 month - 1 day')::date as fine) x,
         lateral (select least(x.fine, coalesce(p_cessazione, x.fine)) - greatest(x.ini, coalesce(p_assunzione, x.ini)) + 1 as gg) c
   where x.fine > coalesce(p_dopo, '-infinity'::date)
     and x.fine <= p_fino
     and case when coalesce((select valore from public.config_azienda where chiave = 'maturazione_regola'), '>=') = '>'
              then c.gg > privato.config_num('maturazione_giorni_minimi', 15)
              else c.gg >= privato.config_num('maturazione_giorni_minimi', 15) end;
$$;

-- P0-4 + P1-6: saldo ---------------------------------------------------------------------------
-- Fattore: giorni → giorni lavorati a settimana / giorni_settimana_full_time (senza tetto: chi
-- lavora 6 giorni ne matura 6/5); ore → ore settimanali / ore settimanali del tempo pieno (max 1).
-- Riporto: se manca il saldo iniziale dell'anno, si riparte dal saldo finale dell'anno prima
-- quando c'è un saldo iniziale di un anno precedente oppure il dipendente era già in forza e
-- l'anno prima ha una spettanza (la ricorsione si ferma al primo anno senza spettanze).
create or replace function privato.saldo(p_dip bigint, p_anno int, p_tipo text, p_alla date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  d public.dipendenti; t public.tipi_assenza; si public.saldi_iniziali;
  sp_q numeric; sp_conf boolean; sp_orig text; gs int; fattore numeric; quota numeric;
  base numeric := 0; rif date; origine text; prec jsonb;
  fine_anno date := make_date(p_anno, 12, 31); fino date; m int; m_fa int; god numeric; att numeric; ret numeric;
begin
  select * into d from public.dipendenti where id = p_dip;
  select * into t from public.tipi_assenza where codice = p_tipo;
  if d.id is null or t.codice is null or not t.con_saldo then return null; end if;
  fino := least(coalesce(p_alla, public.oggi()), fine_anno);

  gs := 7 - (length(d.giorni_riposo) - length(replace(d.giorni_riposo, '1', '')));
  select x.quantita, false, 'personale' into sp_q, sp_conf, sp_orig
    from public.spettanze_dipendente x where x.dipendente_id = p_dip and x.anno = p_anno and x.tipo = p_tipo;
  if sp_orig is not null then
    fattore := 1;
  else
    select x.quantita, x.da_confermare, 'aziendale' into sp_q, sp_conf, sp_orig
      from public.spettanze x where x.anno = p_anno and x.tipo = p_tipo;
    if t.unita = 'giorni' then
      fattore := gs / privato.config_num('giorni_settimana_full_time', 5);
    else
      fattore := least(1, (d.ore_giornaliere * gs)
                          / (privato.config_num('ore_giornaliere_full_time', 8) * privato.config_num('giorni_settimana_full_time', 5)));
    end if;
  end if;
  quota := coalesce(sp_q, 0) / 12 * fattore;

  select * into si from public.saldi_iniziali s where s.dipendente_id = p_dip and s.anno = p_anno and s.tipo = p_tipo;
  if si.id is not null then
    base := si.residuo; rif := si.data_riferimento; origine := 'saldo_iniziale';
  elsif exists (select 1 from public.saldi_iniziali s where s.dipendente_id = p_dip and s.tipo = p_tipo and s.anno < p_anno)
     or ((d.data_assunzione is null or d.data_assunzione < make_date(p_anno, 1, 1))
         and (exists (select 1 from public.spettanze s where s.anno = p_anno - 1 and s.tipo = p_tipo)
              or exists (select 1 from public.spettanze_dipendente s where s.dipendente_id = p_dip and s.anno = p_anno - 1 and s.tipo = p_tipo))) then
    prec := privato.saldo(p_dip, p_anno - 1, p_tipo, make_date(p_anno - 1, 12, 31));
    base := coalesce((prec->>'saldo')::numeric, 0); origine := 'riporto_anno_precedente';
  else
    origine := 'da_inizio_anno';
  end if;

  m := privato.mesi_maturati(d.data_assunzione, d.data_cessazione, p_anno, rif, fino);
  m_fa := privato.mesi_maturati(d.data_assunzione, d.data_cessazione, p_anno, rif, fine_anno);

  -- goduto = giorni (> data di riferimento) delle richieste approvate; in attesa a parte
  select coalesce(sum(g.quantita) filter (where r.stato = 'approvata'), 0),
         coalesce(sum(g.quantita) filter (where r.stato = 'in_attesa'), 0)
    into god, att
    from public.richieste_assenza r
    join public.richieste_assenza_giorni g on g.richiesta_id = r.id
   where r.dipendente_id = p_dip and r.tipo = p_tipo
     and g.giorno between make_date(p_anno, 1, 1) and fine_anno
     and (rif is null or g.giorno > rif);
  select coalesce(sum(x.quantita), 0) into ret
    from public.rettifiche_saldo x where x.dipendente_id = p_dip and x.anno = p_anno and x.tipo = p_tipo;

  return jsonb_build_object(
    'anno', p_anno, 'tipo', p_tipo, 'descrizione', t.descrizione, 'unita', t.unita, 'alla_data', fino,
    'spettanza_annua', sp_q, 'spettanza_origine', sp_orig, 'spettanza_da_confermare', coalesce(sp_conf, true),
    'giorni_settimana', gs, 'fattore_part_time', round(fattore, 4), 'quota_mensile', round(quota, 4),
    'origine', origine, 'data_riferimento', rif, 'saldo_iniziale', round(base, 2), 'goduto_al_riferimento', si.goduto_anno,
    'mesi_maturati', m, 'maturato', round(m * quota, 2),
    'goduto', round(god, 2), 'in_attesa', round(att, 2), 'rettifiche', round(ret, 2),
    'saldo', round(base + m * quota - god + ret, 2),
    'saldo_dopo_attesa', round(base + m * quota - god + ret - att, 2),
    'maturato_fine_anno', round(m_fa * quota, 2),
    'saldo_fine_anno', round(base + m_fa * quota - god + ret, 2),
    'saldo_fine_anno_dopo_attesa', round(base + m_fa * quota - god + ret - att, 2),
    'goduto_totale_anno', round(coalesce(si.goduto_anno, 0) + god, 2),
    'data_assunzione_mancante', d.data_assunzione is null);
end $$;

-- P1-4, P1-6, P1-10: correzioni puntuali in calcola_richiesta -----------------------------------
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('privato.calcola_richiesta(bigint, text, date, date, time, time, boolean, boolean)'::regprocedure);
  nuovo := replace(src,
$a$    if orario and ore > d.ore_giornaliere then
      avv := avv || ('Il permesso supera l''orario giornaliero (' || privato.fmt_num(d.ore_giornaliere) || ' ore).');
    end if;$a$,
$a$    if orario and ore > d.ore_giornaliere then
      err := err || ('Il permesso supera l''orario giornaliero (' || privato.fmt_num(d.ore_giornaliere) || ' ore): per assentarti tutto il giorno scegli la giornata intera.');
    end if;$a$);
  nuovo := replace(nuovo,
$a$  -- giorni conteggiati
  if cardinality(err) = 0 then
$a$,
$a$  -- giorni conteggiati
  if cardinality(err) = 0 then
    select string_agg(y::text, ', ') into conf
      from generate_series(extract(year from p_primo)::int, extract(year from ultimo)::int) y
     where not exists (select 1 from public.festivita f where f.data between make_date(y, 1, 1) and make_date(y, 12, 31) and f.origine = 'nazionale');
    if conf is not null then
      err := err || ('Il calendario delle festività ' || conf || ' non è ancora pronto: contatta l''ufficio personale.');
    end if;
    conf := null;
$a$);
  nuovo := replace(nuovo,
$a$    if t.codice = 'MAL' then$a$,
$a$    if t.con_saldo and d.data_assunzione is null then
      avv := avv || 'Data di assunzione non registrata: il saldo è indicativo (avvisa l''ufficio personale).'::text;
    end if;
    if t.codice = 'MAL' then$a$);
  if nuovo = src or position('non è ancora pronto' in nuovo) = 0 or position('scegli la giornata intera' in nuovo) = 0
     or position('Data di assunzione non registrata' in nuovo) = 0 then
    raise exception 'calcola_richiesta: testo atteso non trovato';
  end if;
  execute nuovo;
end $$;

-- P1-6: festività 2028 e generazione automatica (1° dicembre: anno successivo e quello dopo) ---------
select privato.genera_festivita(2028);
select cron.schedule('ferie_festivita_annuali', '0 4 1 12 *',
  $$select privato.genera_festivita(extract(year from now())::int + 1), privato.genera_festivita(extract(year from now())::int + 2)$$);

-- P0-5 + P1-3 + P0-2: riga per il piano con etichetta generica, orario, flag TEC ---------------------
alter table public.assenze_da_richieste
  add column ora_inizio time,
  add column ora_fine time,
  add column tec boolean not null default true;
comment on column public.assenze_da_richieste.tec is 'Il dipendente era TEC quando la riga è cambiata: solo le righe TEC toccano la conferma del piano.';

create or replace function privato.etichetta_piano(p_tipo text, p_riga text, p_ora_inizio time, p_ora_fine time) returns text
language sql stable set search_path = '' as $$
  select case p_riga
    when 'possibile' then 'Possibile assenza'
    else (case when coalesce((select c.valore from public.config_azienda c where c.chiave = 'flotta_mostra_tipo'), 'no') = 'si'
               then coalesce((select t.etichetta_piano from public.tipi_assenza t where t.codice = p_tipo), 'Assente')
               else 'Assente' end)
         || case when p_riga = 'nota' then
              case when p_ora_inizio is not null then ' ' || to_char(p_ora_inizio, 'HH24:MI') || '-' || to_char(p_ora_fine, 'HH24:MI')
                   else ' (mezza giornata)' end
            else '' end
  end;
$$;

create or replace function public.tg_richiesta_sincronizza() returns trigger
language plpgsql security definer set search_path = '' as $$
declare et text; riga text; e_tec boolean;
begin
  riga := case when new.stato = 'in_attesa' then 'possibile'
               when new.ora_inizio is null and not new.mezza_giornata then 'assenza'
               else 'nota' end;
  et := privato.etichetta_piano(new.tipo, riga, new.ora_inizio, new.ora_fine);
  e_tec := exists (select 1 from public.dipendenti d where d.id = new.dipendente_id and d.categoria = 'TEC');
  if new.stato in ('in_attesa', 'approvata') then
    insert into public.assenze_da_richieste as a (richiesta_id, dipendente_id, dal, al, tipo_riga, etichetta, attiva, ora_inizio, ora_fine, tec)
    values (new.id, new.dipendente_id, new.primo_giorno, new.ultimo_giorno, riga, et, true, new.ora_inizio, new.ora_fine, e_tec)
    on conflict (richiesta_id) do update
      set tipo_riga = excluded.tipo_riga, etichetta = excluded.etichetta, attiva = true, dal = excluded.dal, al = excluded.al,
          ora_inizio = excluded.ora_inizio, ora_fine = excluded.ora_fine, tec = excluded.tec
      where (a.tipo_riga, a.etichetta, a.attiva, a.dal, a.al, a.tec) is distinct from
            (excluded.tipo_riga, excluded.etichetta, true, excluded.dal, excluded.al, excluded.tec);
  else
    update public.assenze_da_richieste set attiva = false, tec = e_tec where richiesta_id = new.id and attiva;
  end if;
  return new;
end $$;

-- righe già presenti: etichetta generica, orari e flag TEC
update public.assenze_da_richieste a
   set etichetta = privato.etichetta_piano(r.tipo, a.tipo_riga, r.ora_inizio, r.ora_fine),
       ora_inizio = r.ora_inizio, ora_fine = r.ora_fine,
       tec = exists (select 1 from public.dipendenti d where d.id = a.dipendente_id and d.categoria = 'TEC')
  from public.richieste_assenza r where r.id = a.richiesta_id;

create or replace trigger piano_assenze_richieste_ins after insert on public.assenze_da_richieste
  for each row when (new.tipo_riga <> 'possibile' and new.tec) execute function public.tg_annulla_piano();
create or replace trigger piano_assenze_richieste_upd after update on public.assenze_da_richieste
  for each row when ((old.tec or new.tec)
                     and (old.tipo_riga <> 'possibile' or new.tipo_riga <> 'possibile')
                     and (old.attiva, old.tipo_riga, old.dal, old.al) is distinct from (new.attiva, new.tipo_riga, new.dal, new.al))
  execute function public.tg_annulla_piano();

-- P0-6 + P1-3: notifiche senza tipo di assenza; avviso al flotta anche per piano confermato da rivedere
create or replace function public.tg_richiesta_notifiche() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.dipendenti; per text; n_int int; date_int text; date_piano text; nome text; intera boolean;
begin
  if coalesce(current_setting('portale.senza_notifiche', true), '') = 'on' then return new; end if;
  if TG_OP = 'UPDATE' and new.stato is not distinct from old.stato then return new; end if;
  select * into d from public.dipendenti where id = new.dipendente_id;
  nome := d.nome || ' ' || d.cognome;
  intera := new.ora_inizio is null and not new.mezza_giornata;
  per := privato.periodo_testo(new.primo_giorno, new.ultimo_giorno, new.ora_inizio, new.ora_fine, new.mezza_giornata);

  -- 1. nuova richiesta del dipendente → ufficio personale (il tipo si vede solo nell'app)
  if TG_OP = 'INSERT' and new.stato = 'in_attesa' then
    perform privato.notifica_responsabili('hr', 'Nuova richiesta da decidere',
      nome || ' · ' || per || ' · ' || new.numero,
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'nuova_richiesta'), 'info', '/hr/richieste');
  end if;

  -- 2. esito al dipendente (push: niente tipo di assenza nel testo)
  if new.stato = 'approvata' then
    perform privato.notifica_dipendente(new.dipendente_id,
      case when TG_OP = 'INSERT' then 'Assenza registrata dall''ufficio personale' else 'Richiesta approvata' end,
      new.numero || ' · ' || per,
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'approvata'), 'info');
  elsif new.stato = 'rifiutata' then
    perform privato.notifica_dipendente(new.dipendente_id, 'Richiesta non approvata',
      new.numero || ' · ' || per || ' · apri l''app per il motivo',
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'rifiutata'), 'importante');
  elsif new.stato = 'annullata' and new.annullata_da = 'hr' then
    perform privato.notifica_dipendente(new.dipendente_id, 'Richiesta annullata dall''ufficio personale',
      new.numero || ' · ' || per || ' · apri l''app per il motivo',
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'annullata'), 'importante');
  end if;

  -- 3. tecnico → responsabile flotta: interventi da riassegnare e piani confermati da rivedere (mai il tipo)
  if d.categoria = 'TEC' and new.ultimo_giorno >= public.oggi()
     and (new.stato = 'approvata' or (new.stato = 'annullata' and TG_OP = 'UPDATE' and old.stato = 'approvata')) then
    select count(*), string_agg(distinct to_char(i.data, 'DD/MM'), ', ') into n_int, date_int
      from public.interventi i
     where i.tecnico_id = new.dipendente_id and i.data between greatest(new.primo_giorno, public.oggi()) and new.ultimo_giorno;
    select string_agg(to_char(p.data, 'DD/MM'), ', ' order by p.data) into date_piano
      from public.piani p where p.data between greatest(new.primo_giorno, public.oggi()) and new.ultimo_giorno;
    if new.stato = 'approvata' and (n_int > 0 or date_piano is not null) then
      perform privato.notifica_responsabili('flotta',
        case when n_int > 0 then 'Interventi da riassegnare' else 'Piano da rivedere' end,
        nome || ' sarà assente ' || privato.periodo_testo(new.primo_giorno, new.ultimo_giorno, new.ora_inizio, new.ora_fine, new.mezza_giornata)
             || case when n_int > 0 then ': ' || n_int || case when n_int = 1 then ' intervento' else ' interventi' end || ' in piano (' || date_int || ')' else '' end
             || case when date_piano is not null then '. Piano confermato da rivedere: ' || date_piano else '' end || '.',
        jsonb_build_object('dipendente_id', new.dipendente_id, 'dal', new.primo_giorno, 'al', new.ultimo_giorno, 'evento', 'interventi_da_riassegnare'),
        'importante', '/piano');
    elsif new.stato = 'annullata' then
      perform privato.notifica_responsabili('flotta', 'Assenza annullata',
        nome || ' torna disponibile ' || privato.periodo_testo(new.primo_giorno, new.ultimo_giorno, new.ora_inizio, new.ora_fine, new.mezza_giornata)
             || case when date_piano is not null then '. Piano confermato da rivedere: ' || date_piano else '' end || '.',
        jsonb_build_object('dipendente_id', new.dipendente_id, 'dal', new.primo_giorno, 'al', new.ultimo_giorno, 'evento', 'assenza_annullata'),
        'info', '/piano');
    end if;
  end if;
  return new;
end $$;

-- P0-6: il responsabile flotta legge solo le notifiche dei TEC che non riguardano le ferie
alter policy resp_notifiche_sel on public.notifiche
  using (user_id = (select auth.uid())
         or (tecnico_id is not null and (select public.is_responsabile())
             and coalesce(dati->>'categoria', '') <> 'ferie'
             and exists (select 1 from public.tecnici t where t.id = tecnico_id)));

-- P0-1: registro modifiche diviso per area; le note delle richieste non entrano nel registro
alter policy resp_audit on public.audit_log
  using ((select public.is_admin())
         or ((select public.is_responsabile())
             and (tabella in ('veicoli', 'segnalazioni', 'assegnazioni', 'multe', 'dotazioni', 'interventi', 'assenze', 'assenze_manuali')
                  or (tabella in ('dipendenti', 'tecnici') and coalesce(coalesce(dopo, prima)->>'categoria', 'TEC') = 'TEC'))));
create policy audit_hr_sel on public.audit_log for select to authenticated
  using ((select public.is_hr())
         and tabella in ('dipendenti', 'tecnici', 'festivita', 'tipi_assenza', 'config_azienda', 'spettanze', 'spettanze_dipendente',
                         'saldi_iniziali', 'rettifiche_saldo', 'richieste_assenza', 'assenze_manuali'));
create or replace trigger audit_richieste_assenza after insert or update on public.richieste_assenza
  for each row execute function public.tg_audit('aggiornato_il', 'note', 'avvisi');

-- P0-2: piano_giorno con blocco per assente con interventi e avvisi per permessi -------------------
create or replace function public.piano_giorno(p_data date)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  t record; r record; a record; v public.veicoli; conf public.piani; n record;
  ints jsonb; ass text; vid bigint; msgs jsonb; primo text; liv text; righe jsonb := '[]';
  poss boolean; note jsonb; dentro text;
begin
  perform public.richiedi_responsabile();
  for t in select id, codice, nome, cognome, ruolo, patente_categoria from public.tecnici where attivo order by cognome, nome loop
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ora', to_char(i.ora,'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita, 'note', i.note)
             order by i.ora nulls last, i.id), '[]') into ints
      from public.interventi i where i.tecnico_id = t.id and i.data = p_data;
    ass := null; vid := null;
    select x.motivo into ass from public.assenze x where x.tecnico_id = t.id and p_data between x.dal and x.al order by x.origine, x.id limit 1;
    select g.veicolo_id into vid from public.assegnazioni g where g.tecnico_id = t.id and g.data = p_data;
    poss := exists (select 1 from public.assenze_da_richieste x where x.dipendente_id = t.id and x.attiva
                      and x.tipo_riga = 'possibile' and p_data between x.dal and x.al);
    select coalesce(jsonb_agg(x.etichetta order by x.richiesta_id), '[]') into note
      from public.assenze_da_richieste x where x.dipendente_id = t.id and x.attiva and x.tipo_riga = 'nota' and p_data between x.dal and x.al;
    msgs := '[]';
    if ass is not null then
      msgs := msgs || jsonb_build_object('l','info','m','Assente: ' || ass);
      if jsonb_array_length(ints) > 0 then
        msgs := msgs || jsonb_build_object('l','ko','m', jsonb_array_length(ints)
                  || case when jsonb_array_length(ints) = 1 then ' intervento da riassegnare' else ' interventi da riassegnare' end || ' (tecnico assente)');
      end if;
      for v in select * from public.veicoli where tecnico_in_carico = t.id loop
        msgs := msgs || jsonb_build_object('l','warn','m','Ha in carico ' || v.targa || ': recuperare il veicolo');
      end loop;
    elsif jsonb_array_length(ints) = 0 then
      msgs := msgs || jsonb_build_object('l','info','m','Nessun intervento pianificato');
    else
      for r in select * from public.controlli_tecnico(t.id, p_data) loop
        msgs := msgs || jsonb_build_object('l', r.livello, 'm', r.messaggio);
      end loop;
      if vid is null then
        msgs := msgs || jsonb_build_object('l','ko','m','Nessun veicolo assegnato');
      else
        select * into v from public.veicoli where id = vid;
        for r in select * from public.controlli_veicolo(vid, p_data) loop
          msgs := msgs || jsonb_build_object('l', r.livello, 'm', r.messaggio);
        end loop;
        primo := ints->0->>'luogo';
        for a in
          select tt.nome || ' ' || tt.cognome as nome,
                 (select i.luogo from public.interventi i where i.tecnico_id = g.tecnico_id and i.data = p_data order by i.ora nulls last, i.id limit 1) as luogo
            from public.assegnazioni g join public.tecnici tt on tt.id = g.tecnico_id
           where g.data = p_data and g.veicolo_id = vid and g.tecnico_id <> t.id
             and not exists (select 1 from public.assenze x where x.tecnico_id = g.tecnico_id and p_data between x.dal and x.al)
        loop
          if a.luogo is not distinct from primo then
            msgs := msgs || jsonb_build_object('l','info','m','Veicolo condiviso con ' || a.nome || ' (stesso primo intervento)');
          else
            msgs := msgs || jsonb_build_object('l','ko','m','Veicolo già assegnato a ' || a.nome || ' con altro intervento');
          end if;
        end loop;
        if v.tecnico_in_carico is not null and v.tecnico_in_carico <> t.id
           and not exists (select 1 from public.assegnazioni g where g.data = p_data and g.tecnico_id = v.tecnico_in_carico and g.veicolo_id = vid) then
          msgs := msgs || jsonb_build_object('l','warn','m',
            'Oggi è in carico a ' || (select tt.nome || ' ' || tt.cognome from public.tecnici tt where tt.id = v.tecnico_in_carico)
            || case when exists (select 1 from public.assenze x where x.tecnico_id = v.tecnico_in_carico and p_data between x.dal and x.al) then ' (assente)' else '' end
            || ': organizzare il passaggio');
        end if;
      end if;
    end if;
    if ass is null then
      -- permessi a ore / mezza giornata approvati: nota, e avviso se tocca gli interventi
      for n in select x.etichetta, x.ora_inizio, x.ora_fine from public.assenze_da_richieste x
                where x.dipendente_id = t.id and x.attiva and x.tipo_riga = 'nota' and p_data between x.dal and x.al order by x.richiesta_id loop
        msgs := msgs || jsonb_build_object('l','info','m', n.etichetta);
        if n.ora_inizio is not null then
          select string_agg(i->>'ora', ', ') into dentro from jsonb_array_elements(ints) i
           where (i->>'ora') is not null and (i->>'ora')::time >= n.ora_inizio and (i->>'ora')::time < n.ora_fine;
          if dentro is not null then
            msgs := msgs || jsonb_build_object('l','warn','m','Intervento alle ' || dentro || ' durante l''assenza ' || to_char(n.ora_inizio,'HH24:MI') || '-' || to_char(n.ora_fine,'HH24:MI'));
          end if;
        elsif jsonb_array_length(ints) > 0 then
          msgs := msgs || jsonb_build_object('l','warn','m','Assente mezza giornata: verifica l''orario degli interventi');
        end if;
      end loop;
      if poss then
        msgs := msgs || jsonb_build_object('l','info','m','Possibile assenza: richiesta in attesa di decisione');
      end if;
    end if;
    liv := case
      when msgs @> '[{"l":"ko"}]' then 'ko'
      when msgs @> '[{"l":"warn"}]' then 'warn'
      when ass is null and jsonb_array_length(ints) > 0 then 'ok'
      else 'na' end;
    if liv = 'ok' then msgs := msgs || jsonb_build_object('l','ok','m','Idoneo'); end if;
    righe := righe || jsonb_build_object(
      'tecnico_id', t.id, 'nome', t.nome || ' ' || t.cognome, 'codice', t.codice, 'ruolo', t.ruolo,
      'patente', t.patente_categoria, 'assenza', ass, 'interventi', ints, 'veicolo_id', vid,
      'livello', liv, 'messaggi', msgs, 'prima_ora', ints->0->>'ora',
      'possibile_assenza', poss and ass is null, 'note_assenza', case when ass is null then note else '[]'::jsonb end);
  end loop;
  select * into conf from public.piani where data = p_data;
  return jsonb_build_object('data', p_data, 'confermato_il', conf.confermato_il, 'righe', righe);
end $function$;

-- P0-5 + P3: assenze manuali del flotta con motivi fissi (mai motivi sanitari); niente update muti
create or replace function public.tg_assenze_vista() returns trigger
language plpgsql set search_path = '' as $$
declare mot text;
begin
  if TG_OP in ('INSERT', 'UPDATE') then
    mot := case when trim(coalesce(new.motivo, '')) in ('Formazione', 'Trasferta', 'Altro') then trim(new.motivo) else 'Assenza' end;
  end if;
  if TG_OP = 'INSERT' then
    insert into public.assenze_manuali (tecnico_id, dal, al, motivo)
    values (new.tecnico_id, new.dal, new.al, mot)
    returning id, creato_il into new.id, new.creato_il;
    new.motivo := mot; new.origine := 'manuale';
    return new;
  end if;
  if coalesce(old.id, 0) < 0 then
    raise exception 'Questa assenza viene da una richiesta approvata dall''ufficio personale: si modifica o annulla solo dall''area HR.';
  end if;
  if TG_OP = 'UPDATE' then
    update public.assenze_manuali set tecnico_id = new.tecnico_id, dal = new.dal, al = new.al, motivo = mot
     where id = old.id and not annullata;
    if not found then raise exception 'Assenza non trovata o già annullata.'; end if;
    new.motivo := mot;
    return new;
  end if;
  -- eliminazione dal pannello: la riga non si cancella, si annulla
  update public.assenze_manuali set annullata = true, annullata_il = now(), annullata_da = auth.uid()
   where id = old.id and not annullata;
  return old;
end $$;
alter table public.assenze_manuali add constraint assenze_manuali_motivo_check
  check (motivo in ('Assenza', 'Formazione', 'Trasferta', 'Altro')) not valid;

-- P1-2: cambio di categoria = sessioni revocate ------------------------------------------------------
create or replace function public.tg_dipendente_categoria() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.categoria is distinct from old.categoria or (new.attivo is distinct from old.attivo and not new.attivo) then
    update public.sessioni_tecnico set revocata = true where tecnico_id = new.id and not revocata;
  end if;
  return new;
end $$;
create trigger sessioni_categoria after update of categoria, attivo on public.dipendenti
  for each row execute function public.tg_dipendente_categoria();

-- P2-8: cessato = niente accesso -------------------------------------------------------------------
create or replace function privato.dipendente_da_token(p_token text) returns bigint
language plpgsql stable set search_path = '' as $$
declare did bigint;
begin
  select s.tecnico_id into did
    from public.sessioni_tecnico s join public.dipendenti d on d.id = s.tecnico_id
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.scade_il > now() and not s.revocata and d.attivo
     and (d.data_cessazione is null or d.data_cessazione >= public.oggi());
  if did is null then raise exception 'SESSIONE_NON_VALIDA'; end if;
  return did;
end $$;
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('public.dipendente_login(text, text)'::regprocedure);
  nuovo := replace(src, $a$upper(trim(left(coalesce(p_codice, ''), 20))) and attivo for update;$a$,
    $a$upper(trim(left(coalesce(p_codice, ''), 20))) and attivo
     and (data_cessazione is null or data_cessazione >= public.oggi()) for update;$a$);
  if nuovo = src then raise exception 'dipendente_login: testo atteso non trovato'; end if;
  execute nuovo;
end $$;

-- P2-10: un account HR collegato ma disattivato non blocca più le decisioni ---------------------------
create or replace function privato.controlla_decisore(p_dip bigint) returns void
language plpgsql stable set search_path = '' as $$
declare l public.responsabili;
begin
  select * into l from public.responsabili r where r.dipendente_id = p_dip and r.attivo;
  if l.user_id is not null and l.user_id is distinct from auth.uid() then
    raise exception 'Questa richiesta riguarda %, che ha un account dell''ufficio personale: la decide solo lei/lui dal proprio account.', l.nome
      using errcode = '42501';
  end if;
end $$;
do $$
declare src text; nuovo text;
begin
  src := pg_get_functiondef('privato.richiesta_json(public.richieste_assenza, boolean)'::regprocedure);
  nuovo := replace(src, $a$from public.responsabili x where x.dipendente_id = r.dipendente_id)$a$,
                        $a$from public.responsabili x where x.dipendente_id = r.dipendente_id and x.attivo)$a$);
  nuovo := replace(nuovo, $a$x.dipendente_id = r.dipendente_id and x.user_id is distinct from auth.uid())$a$,
                          $a$x.dipendente_id = r.dipendente_id and x.attivo and x.user_id is distinct from auth.uid())$a$);
  if nuovo = src then raise exception 'richiesta_json: testo atteso non trovato'; end if;
  execute nuovo;
end $$;
