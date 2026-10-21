-- =====================================================================
-- Portale unico · Fasi 2-4 — FERIE E PERMESSI · 4/5: collegamento con piano e veicoli
--
-- Le ferie approvate a giornata intera entrano già nella vista `assenze` (migrazione 0010):
-- tecnico non assegnabile, controlli_tecnico "Assente: Ferie", proponi_assegnazioni lo esclude
-- e il suo veicolo in carico diventa assegnabile ad altri. Qui:
--  1. piano_giorno: nuovi campi per riga `possibile_assenza` (richiesta in attesa, senza tipo,
--     non blocca) e `note_assenza` (permessi a ore / mezza giornata approvati, es.
--     "Permesso 08:00-10:00"); i messaggi informativi corrispondenti (livello info).
--  2. v_veicoli: nuova colonna `in_carico_assente` (chi ha il veicolo in carico oggi è assente).
--  3. prossimo_lavorativo: esclude anche le festività.
--  4. imposta_pin (pannello flotta): solo per i TEC (prima accettava qualsiasi dipendente:
--     con l'accesso esteso a tutte le categorie il responsabile flotta avrebbe potuto
--     impostare il PIN di un impiegato ed entrare al suo posto).
--  5. report_dati / analisi_admin: le notifiche ferie (tipo avviso, dati.categoria = 'ferie')
--     non si contano come "avvisi" ai tecnici; report assenze: giorni lavorativi senza festività.
-- =====================================================================

-- 1. piano_giorno ----------------------------------------------------------------------------
create or replace function public.piano_giorno(p_data date)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  t record; r record; a record; v public.veicoli; conf public.piani;
  ints jsonb; ass text; vid bigint; msgs jsonb; primo text; liv text; righe jsonb := '[]';
  poss boolean; note jsonb; nota text;
begin
  perform public.richiedi_responsabile();
  for t in select id, codice, nome, cognome, ruolo, patente_categoria from public.tecnici where attivo order by cognome, nome loop
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ora', to_char(i.ora,'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita, 'note', i.note)
             order by i.ora nulls last, i.id), '[]') into ints
      from public.interventi i where i.tecnico_id = t.id and i.data = p_data;
    ass := null; vid := null;
    select x.motivo into ass from public.assenze x where x.tecnico_id = t.id and p_data between x.dal and x.al limit 1;
    select g.veicolo_id into vid from public.assegnazioni g where g.tecnico_id = t.id and g.data = p_data;
    -- richieste HR: in attesa (possibile assenza) e permessi a ore / mezza giornata (nota)
    poss := exists (select 1 from public.assenze_da_richieste x where x.dipendente_id = t.id and x.attiva
                      and x.tipo_riga = 'possibile' and p_data between x.dal and x.al);
    select coalesce(jsonb_agg(x.etichetta order by x.richiesta_id), '[]') into note
      from public.assenze_da_richieste x where x.dipendente_id = t.id and x.attiva and x.tipo_riga = 'nota' and p_data between x.dal and x.al;
    msgs := '[]';
    if ass is not null then
      msgs := msgs || jsonb_build_object('l','info','m','Assente: ' || ass);
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
      for nota in select jsonb_array_elements_text(note) loop
        msgs := msgs || jsonb_build_object('l','info','m', nota);
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

-- 2. v_veicoli: chi ha il veicolo in carico è assente oggi? -------------------------------------
create or replace view public.v_veicoli with (security_invoker = true) as
 SELECT v.id,
    v.targa,
    v.marca_modello,
    v.tipo,
    v.proprieta,
    v.km_attuali,
    v.km_prossimo_tagliando,
    v.scad_assicurazione,
    v.scad_revisione,
    v.scad_bollo,
    v.tecnico_in_carico,
    v.in_carico_dal,
    v.in_officina,
    v.dismesso,
    v.qr_token,
    v.note,
    v.creato_il,
    v.aggiornato_il,
    ((t.nome || ' '::text) || t.cognome) AS in_carico_nome,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) AS jsonb_agg
           FROM controlli_veicolo(v.id) c(livello, messaggio)), '[]'::jsonb) AS controlli,
        CASE
            WHEN v.dismesso THEN 'dismesso'::text
            WHEN (v.in_officina OR (EXISTS ( SELECT 1
               FROM segnalazioni s
              WHERE ((s.veicolo_id = v.id) AND (s.stato <> 'chiusa'::text) AND (s.gravita = 'fermo'::text))))) THEN 'fermo'::text
            WHEN (EXISTS ( SELECT 1
               FROM controlli_veicolo(v.id) c(livello, messaggio)
              WHERE (c.livello = 'ko'::text))) THEN 'non_utilizzabile'::text
            WHEN (v.tecnico_in_carico IS NOT NULL) THEN 'in_uso'::text
            ELSE 'disponibile'::text
        END AS stato,
    k.km_giorno,
        CASE
            WHEN ((k.km_giorno > (0)::numeric) AND (v.km_prossimo_tagliando > v.km_attuali)) THEN (oggi() + (ceil((((v.km_prossimo_tagliando - v.km_attuali))::numeric / k.km_giorno)))::integer)
            ELSE NULL::date
        END AS tagliando_previsto,
    (v.tecnico_in_carico IS NOT NULL AND EXISTS ( SELECT 1 FROM public.assenze x
              WHERE x.tecnico_id = v.tecnico_in_carico AND public.oggi() BETWEEN x.dal AND x.al)) AS in_carico_assente
   FROM ((veicoli v
     LEFT JOIN dipendenti t ON ((t.id = v.tecnico_in_carico)))
     LEFT JOIN LATERAL ( SELECT km_giornalieri(v.id) AS km_giorno) k ON (true));
comment on column public.v_veicoli.in_carico_assente is 'true se il tecnico che ha il veicolo in carico è assente oggi: il veicolo è assegnabile ad altri nel piano (proponi_assegnazioni lo considera libero).';

-- 3. prossimo_lavorativo con le festività -------------------------------------------------------
create or replace function public.prossimo_lavorativo(p_da date)
 returns date
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare d date := p_da + 1;
begin
  while extract(isodow from d) in (6, 7)
        or exists (select 1 from public.festivita f where f.data = d and f.attiva) loop
    d := d + 1;
  end loop;
  return d;
end $function$;

-- 4. imposta_pin del pannello flotta: solo TEC ----------------------------------------------------
create or replace function public.imposta_pin(p_tecnico bigint, p_pin text)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  perform public.richiedi_responsabile();
  if not exists (select 1 from public.tecnici where id = p_tecnico) then
    raise exception 'Tecnico non trovato. Il PIN degli altri dipendenti lo gestisce l''ufficio personale.';
  end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'Il PIN deve avere 6 cifre'; end if;
  if (select count(distinct c) from regexp_split_to_table(p_pin, '') c) <= 2
     or position(p_pin in '01234567890') > 0 or position(p_pin in '09876543210') > 0 then
    raise exception 'PIN troppo facile da indovinare: evita cifre ripetute o in sequenza';
  end if;
  update public.dipendenti set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null where id = p_tecnico;
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_tecnico;
end $function$;

-- 5. report_dati / analisi_admin: sostituzioni puntuali nel testo delle funzioni esistenti --------
do $$
declare f text; src text; nuovo text;
begin
  foreach f in array array['public.report_dati(text, date, date, bigint, bigint)', 'public.analisi_admin(integer)'] loop
    src := pg_get_functiondef(f::regprocedure);
    nuovo := replace(src, $x$n.tipo = 'avviso'$x$, $x$n.tipo = 'avviso' and n.dati->>'categoria' is distinct from 'ferie'$x$);
    if f like 'public.report_dati%' then
      nuovo := replace(nuovo, $x$g where extract(isodow from g) < 6)) x$x$,
        $x$g where extract(isodow from g) < 6 and not exists (select 1 from public.festivita f where f.data = g::date and f.attiva))) x$x$);
    end if;
    if nuovo = src then raise exception '%: testo atteso non trovato', f; end if;
    execute nuovo;
  end loop;
end $$;
