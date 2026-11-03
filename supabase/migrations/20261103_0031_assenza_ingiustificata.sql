-- Assenza ingiustificata (trattenuta in busta paga).
--  * tipo ING: lo registra solo l'ufficio personale (mai richiedibile), non tocca nessun saldo, blocca il piano come ogni assenza.
--    Il responsabile flotta vede solo "Assente" (etichetta_piano). Il dipendente lo vede nello storico come "Assenza ingiustificata".
--  * unità ore: giornata intera = ore_giornaliere, mezza giornata o fascia oraria; nei report giorni (frazione) e ore.
--  * azioni HR: annulla (hr_annulla_richiesta, motivo obbligatorio) e converti in FERIE/ROL/EXF con saldo sufficiente:
--    l'originale passa ad annullata con convertita_in -> nuova richiesta approvata (convertita_da). Audit da tg_audit.
--  * nessuna email: il trigger email_richieste parte solo per stato 'in_attesa', e queste nascono già approvate.

insert into public.tipi_assenza (codice, descrizione, unita, con_saldo, mezza_giornata, etichetta_piano, richiedibile, ordine, attivo)
values ('ING', 'Assenza ingiustificata', 'ore', false, true, 'Assente', false, 95, true)
on conflict (codice) do nothing;

alter table public.tipi_assenza add constraint tipi_ing_non_richiedibile check (codice <> 'ING' or not richiedibile);

alter table public.richieste_assenza
  add column if not exists convertita_in bigint references public.richieste_assenza(id),
  add column if not exists convertita_da bigint references public.richieste_assenza(id);
alter table public.richieste_assenza add constraint richieste_convertita_annullata check (convertita_in is null or stato = 'annullata');

-- ---------- registrazione ----------
create or replace function public.hr_registra_ingiustificata(p_dipendente bigint, p_primo_giorno date, p_rientro date default null,
  p_ora_inizio time default null, p_ora_fine time default null, p_mezza_giornata boolean default false, p_meta text default null,
  p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  perform public.richiedi_hr();
  x := public.hr_inserisci_richiesta(p_dipendente, 'ING', p_primo_giorno, p_rientro, p_ora_inizio, p_ora_fine,
                                     coalesce(p_mezza_giornata, false), p_note, true, p_meta);
  return x || jsonb_build_object('messaggio', 'Assenza ingiustificata ' || (x->>'numero') || ' registrata: '
    || privato.fmt_q((x->'calcolo'->>'quantita')::numeric, 'ore') || '. Non tocca i saldi.');
end $$;

-- ---------- conversione ----------
-- calcolo della richiesta sostitutiva, come se l'ingiustificata non ci fosse (sottotransazione annullata)
create or replace function privato.calcolo_conversione(p_id bigint, p_tipo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.richieste_assenza; c jsonb; t text := upper(trim(coalesce(p_tipo, '')));
begin
  select * into r from public.richieste_assenza where id = p_id;
  if r.id is null or r.tipo <> 'ING' then raise exception 'Assenza ingiustificata non trovata.'; end if;
  if r.stato <> 'approvata' then
    raise exception 'L''assenza % è già %: non si può convertire.', r.numero, case when r.convertita_in is not null then 'convertita' else 'annullata' end;
  end if;
  if t not in ('FERIE', 'ROL', 'EXF') then raise exception 'Scegli ferie, permesso ROL o permesso ex festività.'; end if;
  if t = 'FERIE' and r.ora_inizio is not null then
    raise exception 'Le ferie si registrano a giornate o mezze giornate: per un''assenza a ore scegli ROL o ex festività.';
  end if;
  if t <> 'FERIE' and r.mezza_giornata then
    raise exception 'Per la mezza giornata scegli le ferie: i permessi ROL ed ex festività si registrano a ore.';
  end if;
  begin
    perform set_config('portale.senza_notifiche', 'on', true);
    update public.richieste_assenza set stato = 'annullata', annullata_da = 'hr', annullata_il = now() where id = r.id;
    c := privato.calcola_richiesta(r.dipendente_id, t, r.primo_giorno,
           case when r.ora_inizio is null and not r.mezza_giornata then r.ultimo_giorno + 1 end,
           r.ora_inizio, r.ora_fine, r.mezza_giornata, false, r.meta);
    raise exception using errcode = 'P0099', message = 'anteprima';
  exception when sqlstate 'P0099' then null;
  end;
  perform set_config('portale.senza_notifiche', '', true);
  return c || jsonb_build_object('originale', jsonb_build_object('id', r.id, 'numero', r.numero, 'quantita', r.quantita,
    'giorni_lavorativi', r.giorni_lavorativi));
end $$;

create or replace function privato.errore_saldo_conversione(c jsonb) returns text
language sql stable set search_path = '' as $$
  select 'Saldo insufficiente per convertire: ' || string_agg(
           'nel ' || (s->>'anno') || ' disponibili ' || privato.fmt_q((s->>'saldo_dopo')::numeric + (s->>'quantita')::numeric, c->>'unita')
           || ', servono ' || privato.fmt_q((s->>'quantita')::numeric, c->>'unita'), '; ')
         || '. Scegli un altro tipo oppure lascia l''assenza come ingiustificata.'
    from jsonb_array_elements(c->'saldi') s where (s->>'insufficiente')::boolean;
$$;

create or replace function public.hr_anteprima_conversione(p_id bigint, p_tipo text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb; r public.richieste_assenza;
begin
  perform public.richiedi_hr();
  select * into r from public.richieste_assenza where id = p_id;
  if r.id is null then raise exception 'Assenza ingiustificata non trovata.'; end if;
  perform privato.controlla_decisore(r.dipendente_id);
  c := privato.calcolo_conversione(p_id, p_tipo);
  if (c->>'ok')::boolean and (c->>'saldo_insufficiente')::boolean then
    c := c || jsonb_build_object('ok', false, 'errori', (c->'errori') || to_jsonb(privato.errore_saldo_conversione(c)));
  end if;
  return c;
end $$;

create or replace function public.hr_converti_ingiustificata(p_id bigint, p_tipo text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.richieste_assenza; n public.richieste_assenza; c jsonb; t public.tipi_assenza;
begin
  perform public.richiedi_hr();
  if length(coalesce(p_note, '')) > 500 then raise exception 'Note troppo lunghe: massimo 500 caratteri.'; end if;
  select * into r from public.richieste_assenza where id = p_id for update;
  if r.id is null or r.tipo <> 'ING' then raise exception 'Assenza ingiustificata non trovata.'; end if;
  perform privato.controlla_decisore(r.dipendente_id);
  perform 1 from public.dipendenti where id = r.dipendente_id for update;
  c := privato.calcolo_conversione(p_id, p_tipo);
  if not (c->>'ok')::boolean then
    raise exception '%', (select string_agg(e, ' ') from jsonb_array_elements_text(c->'errori') e);
  end if;
  if (c->>'saldo_insufficiente')::boolean then raise exception '%', privato.errore_saldo_conversione(c); end if;
  select * into t from public.tipi_assenza where codice = c->>'tipo';

  -- niente notifiche intermedie (annullata + nuova): il dipendente riceve un solo messaggio alla fine
  perform set_config('portale.senza_notifiche', 'on', true);
  update public.richieste_assenza set stato = 'annullata', annullata_da = 'hr', annullata_da_utente = auth.uid(), annullata_il = now(),
         motivo_annullamento = 'Convertita in ' || lower(privato.nome_tipo_breve(t.descrizione))
   where id = r.id;
  n := privato.salva_richiesta(c, coalesce(nullif(trim(coalesce(p_note, '')), ''), r.note), 'hr', auth.uid(), true);
  update public.richieste_assenza
     set meta = c->>'meta', convertita_da = r.id,
         motivo_decisione = 'Conversione dell''assenza ingiustificata ' || r.numero
   where id = n.id;
  update public.richieste_assenza
     set convertita_in = n.id, motivo_annullamento = 'Convertita in ' || lower(privato.nome_tipo_breve(t.descrizione)) || ' (' || n.numero || ')'
   where id = r.id;
  perform set_config('portale.senza_notifiche', '', true);

  perform privato.notifica_dipendente(r.dipendente_id, 'Assenza ingiustificata convertita',
    r.numero || ' → ' || n.numero || ' · ' || privato.periodo_testo(n.primo_giorno, n.ultimo_giorno, n.ora_inizio, n.ora_fine, n.mezza_giornata),
    jsonb_build_object('richiesta_id', n.id, 'numero', n.numero, 'evento', 'convertita', 'originale', r.numero), 'info');
  return jsonb_build_object('ok', true, 'id', n.id, 'numero', n.numero, 'originale', r.numero,
    'messaggio', r.numero || ' convertita in ' || lower(privato.nome_tipo_breve(t.descrizione)) || ' ' || n.numero || ': ' || privato.fmt_q(n.quantita, n.unita) || '.');
end $$;

create or replace function privato.nome_tipo_breve(p text) returns text
language sql immutable set search_path = '' as $$ select regexp_replace(coalesce(p, ''), '\s*\(.*\)\s*$', '') $$;

-- ---------- report ----------
-- il corpo attuale di hr_report diventa privato.hr_report_base; public.hr_report aggiunge 'ingiustificate' e le colonne ING nel riepilogo
do $$
declare def text := pg_get_functiondef('public.hr_report(text, date, date, text, bigint)'::regprocedure);
begin
  if not exists (select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'privato' and p.proname = 'hr_report_base') then
    execute replace(def, 'FUNCTION public.hr_report(', 'FUNCTION privato.hr_report_base(');
  end if;
end $$;

create or replace function public.hr_report(p_tipo text, p_da date, p_a date, p_categoria text default null, p_dipendente bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare righe jsonb; base jsonb; ing jsonb;
begin
  perform public.richiedi_hr();
  if p_tipo = 'ingiustificate' then
    if p_da is null or p_a is null or p_a < p_da then raise exception 'Periodo non valido'; end if;
    if p_a - p_da > 731 then raise exception 'Periodo troppo lungo: massimo 2 anni'; end if;
    select coalesce(jsonb_agg(x order by x->>'dipendente', x->>'data', x->>'numero'), '[]') into righe from (
      select jsonb_build_object(
          'numero', r.numero, 'dipendente', d.cognome || ' ' || d.nome, 'codice', d.codice, 'categoria', d.categoria, 'reparto', d.reparto,
          'data', g.giorno,
          'orario', case when r.ora_inizio is not null then to_char(r.ora_inizio, 'HH24:MI') || '-' || to_char(r.ora_fine, 'HH24:MI')
                         when r.mezza_giornata then coalesce(r.meta, 'mezza giornata') end,
          'stato', case when r.stato = 'approvata' then 'Registrata' when r.convertita_in is not null then 'Convertita' else 'Annullata' end,
          'giorni', case when r.stato = 'approvata' then g.frazione end,
          'ore', case when r.stato = 'approvata' then g.quantita end,
          'giorni_orig', g.frazione, 'ore_orig', g.quantita,
          'nota', r.note,
          'esito', case when r.stato = 'annullata' then r.motivo_annullamento end,
          'registrata_da', privato.nome_account(r.creata_da_utente), 'registrata_il', r.creato_il,
          'annullata_da', privato.nome_account(r.annullata_da_utente), 'annullata_il', r.annullata_il) x
        from public.richieste_assenza r
        join public.richieste_assenza_giorni g on g.richiesta_id = r.id
        join public.dipendenti d on d.id = r.dipendente_id
       where r.tipo = 'ING' and r.stato in ('approvata', 'annullata') and g.giorno between p_da and p_a
         and (p_categoria is null or d.categoria = p_categoria) and (p_dipendente is null or d.id = p_dipendente)) z;
    return jsonb_build_object('righe', righe, 'generato_il', now());
  end if;

  base := privato.hr_report_base(p_tipo, p_da, p_a, p_categoria, p_dipendente);
  if p_tipo <> 'riepilogo' then return base; end if;
  select coalesce(jsonb_object_agg(d.codice, jsonb_build_object('gg', s.gg, 'ore', s.ore)), '{}') into ing
    from (select r.dipendente_id, sum(g.frazione) gg, sum(g.quantita) ore
            from public.richieste_assenza r join public.richieste_assenza_giorni g on g.richiesta_id = r.id
           where r.tipo = 'ING' and r.stato = 'approvata' and g.giorno between p_da and p_a group by 1) s
    join public.dipendenti d on d.id = s.dipendente_id;
  select coalesce(jsonb_agg(e || jsonb_build_object(
           'ing_gg', coalesce((ing->(e->>'codice')->>'gg')::numeric, 0),
           'ing_ore', coalesce((ing->(e->>'codice')->>'ore')::numeric, 0)) order by o), '[]')
    into righe from jsonb_array_elements(base->'righe') with ordinality a(e, o);
  return base || jsonb_build_object('righe', righe);
end $$;
