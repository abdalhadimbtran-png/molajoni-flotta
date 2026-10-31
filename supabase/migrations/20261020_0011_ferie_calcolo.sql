-- =====================================================================
-- Portale unico · Fasi 2-4 — FERIE E PERMESSI · 2/5: regole di calcolo (unica fonte)
--
-- Funzioni interne nello schema `privato` (non chiamabili dalle API):
--  fmt_num, fmt_q, periodo_testo  testi in italiano
--  config_num                     lettura numerica di config_azienda
--  mesi_maturati                  mesi che maturano nell'anno (regola giorni minimi)
--  saldo                          saldo per dipendente/anno/tipo
--  calcola_richiesta              conteggio + controlli di una richiesta SENZA salvarla
--  salva_richiesta                salvataggio (numero RF-AAAA-NNNN + giorni)
--  notifica_dipendente / notifica_responsabili
-- Trigger su richieste_assenza: riga per il piano (assenze_da_richieste) e notifiche.
--
-- Regole:
--  * il dipendente indica PRIMO GIORNO e GIORNO DI RIENTRO: ultimo_giorno = rientro − 1;
--  * si contano solo i giorni lavorativi del dipendente (esclusi giorni_riposo e festività);
--  * permesso a ore: un solo giorno, ora_inizio < ora_fine, a quarti d'ora, quantità in ore;
--    un tipo "a ore" si può chiedere anche a giornate intere (ore = ore_giornaliere per giorno);
--  * mezza giornata: solo tipi che la ammettono, un solo giorno = 0,5 (o metà delle ore);
--  * nessuna sovrapposizione con richieste in attesa/approvate dello stesso dipendente
--    (a ore: sovrapposizione oraria; frazioni dello stesso giorno al massimo = 1 giornata);
--  * saldo = saldo iniziale (o riporto dell'anno prima) + maturato dopo la data di riferimento
--    − goduto (approvate dopo la data di riferimento) ± rettifiche; maturazione mensile 1/12,
--    proporzionale al part-time, mese valido se coperto per almeno N giorni (config);
--  * saldo insufficiente = la richiesta si invia lo stesso ma viene segnalata;
--  * a cavallo d'anno ogni giorno conta per il proprio anno.
-- =====================================================================

-- Testi -------------------------------------------------------------------------------
create or replace function privato.fmt_num(p numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p is null then '—'
              when round(p, 2) = trunc(p) then trunc(p)::text
              else replace(rtrim(round(p, 2)::text, '0'), '.', ',') end;
$$;

create or replace function privato.fmt_q(p numeric, p_unita text) returns text
language sql immutable set search_path = '' as $$
  select privato.fmt_num(p) || case when p_unita = 'ore' then case when abs(p) = 1 then ' ora' else ' ore' end
                                    else case when abs(p) = 1 then ' giorno' else ' giorni' end end;
$$;

create or replace function privato.periodo_testo(p_primo date, p_ultimo date, p_ora_inizio time, p_ora_fine time, p_mezza boolean)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_ora_inizio is not null then 'il ' || to_char(p_primo, 'DD/MM/YYYY') || ' dalle ' || to_char(p_ora_inizio, 'HH24:MI') || ' alle ' || to_char(p_ora_fine, 'HH24:MI')
    when p_mezza then 'mezza giornata il ' || to_char(p_primo, 'DD/MM/YYYY')
    when p_primo = p_ultimo then 'il ' || to_char(p_primo, 'DD/MM/YYYY') || ' (rientro ' || to_char(p_ultimo + 1, 'DD/MM/YYYY') || ')'
    else 'dal ' || to_char(p_primo, 'DD/MM/YYYY') || ' al ' || to_char(p_ultimo, 'DD/MM/YYYY') || ' (rientro ' || to_char(p_ultimo + 1, 'DD/MM/YYYY') || ')'
  end;
$$;

create or replace function privato.config_num(p_chiave text, p_default numeric) returns numeric
language sql stable set search_path = '' as $$
  select coalesce((select nullif(trim(c.valore), '')::numeric from public.config_azienda c where c.chiave = p_chiave), p_default);
$$;

-- Giorno lavorativo per un dipendente (riposi personali + festività attive)
create or replace function privato.e_lavorativo(p_riposo text, p_giorno date) returns boolean
language sql stable set search_path = '' as $$
  select substr(p_riposo, extract(isodow from p_giorno)::int, 1) = '0'
     and not exists (select 1 from public.festivita f where f.data = p_giorno and f.attiva);
$$;

-- Mesi dell'anno che maturano: fine mese dopo p_dopo (data di riferimento, esclusa) e
-- non oltre p_fino; il rapporto di lavoro deve coprire almeno N giorni del mese.
create or replace function privato.mesi_maturati(p_assunzione date, p_cessazione date, p_anno int, p_dopo date, p_fino date)
returns int language sql stable set search_path = '' as $$
  select count(*)::int
    from generate_series(1, 12) m,
         lateral (select make_date(p_anno, m, 1) as ini,
                         (make_date(p_anno, m, 1) + interval '1 month - 1 day')::date as fine) x
   where x.fine > coalesce(p_dopo, '-infinity'::date)
     and x.fine <= p_fino
     and (least(x.fine, coalesce(p_cessazione, x.fine)) - greatest(x.ini, coalesce(p_assunzione, x.ini)) + 1)
         >= privato.config_num('maturazione_giorni_minimi', 15);
$$;

-- Saldo -------------------------------------------------------------------------------
-- p_alla: data a cui calcolare il maturato (default oggi; i mesi maturano a fine mese).
-- "goduto" = richieste APPROVATE (anche future, cioè già prenotate) dopo la data di riferimento.
create or replace function privato.saldo(p_dip bigint, p_anno int, p_tipo text, p_alla date default null)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  d public.dipendenti; t public.tipi_assenza; sp public.spettanze; si public.saldi_iniziali;
  fattore numeric; quota numeric; base numeric := 0; rif date; origine text; prec jsonb;
  fine_anno date := make_date(p_anno, 12, 31); fino date; m int; m_fa int; god numeric; att numeric; ret numeric;
begin
  select * into d from public.dipendenti where id = p_dip;
  select * into t from public.tipi_assenza where codice = p_tipo;
  if d.id is null or t.codice is null or not t.con_saldo then return null; end if;
  fino := least(coalesce(p_alla, public.oggi()), fine_anno);
  select * into sp from public.spettanze s where s.anno = p_anno and s.tipo = p_tipo;
  fattore := least(1, d.ore_giornaliere / privato.config_num('ore_giornaliere_full_time', 8));
  quota := coalesce(sp.quantita, 0) / 12 * fattore;

  select * into si from public.saldi_iniziali s where s.dipendente_id = p_dip and s.anno = p_anno and s.tipo = p_tipo;
  if si.id is not null then
    base := si.residuo; rif := si.data_riferimento; origine := 'saldo_iniziale';
  elsif exists (select 1 from public.saldi_iniziali s where s.dipendente_id = p_dip and s.tipo = p_tipo and s.anno < p_anno) then
    prec := privato.saldo(p_dip, p_anno - 1, p_tipo, make_date(p_anno - 1, 12, 31));
    base := coalesce((prec->>'saldo')::numeric, 0); origine := 'riporto_anno_precedente';
  else
    origine := 'da_inizio_anno';
  end if;

  m := privato.mesi_maturati(d.data_assunzione, d.data_cessazione, p_anno, rif, fino);
  m_fa := privato.mesi_maturati(d.data_assunzione, d.data_cessazione, p_anno, rif, fine_anno);

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
    'spettanza_annua', sp.quantita, 'spettanza_da_confermare', coalesce(sp.da_confermare, true),
    'fattore_part_time', round(fattore, 4), 'quota_mensile', round(quota, 4),
    'origine', origine, 'data_riferimento', rif, 'saldo_iniziale', round(base, 2), 'goduto_al_riferimento', si.goduto_anno,
    'mesi_maturati', m, 'maturato', round(m * quota, 2),
    'goduto', round(god, 2), 'in_attesa', round(att, 2), 'rettifiche', round(ret, 2),
    'saldo', round(base + m * quota - god + ret, 2),
    'saldo_dopo_attesa', round(base + m * quota - god + ret - att, 2),
    'maturato_fine_anno', round(m_fa * quota, 2),
    'saldo_fine_anno', round(base + m_fa * quota - god + ret, 2),
    'saldo_fine_anno_dopo_attesa', round(base + m_fa * quota - god + ret - att, 2),
    'goduto_totale_anno', round(coalesce(si.goduto_anno, 0) + god, 2));
end $$;

-- Calcolo di una richiesta (anteprima e controlli). Non scrive nulla.
create or replace function privato.calcola_richiesta(
  p_dip bigint, p_tipo text, p_primo date, p_rientro date,
  p_ora_inizio time, p_ora_fine time, p_mezza boolean, p_da_dipendente boolean)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  d public.dipendenti; t public.tipi_assenza;
  err text[] := '{}'; avv text[] := '{}';
  orario boolean := p_ora_inizio is not null or p_ora_fine is not null;
  mezza boolean := coalesce(p_mezza, false);
  ultimo date; g date; q numeric; fr numeric; ore numeric; fest text;
  giorni jsonb := '[]'; tot numeric := 0; glav numeric := 0; escluse jsonb := '[]';
  saldi jsonb := '[]'; insuff boolean := false; x record; s jsonb; dopo numeric; fino date;
  conf text; n_int int := 0; oggi date := public.oggi();
begin
  select * into d from public.dipendenti where id = p_dip;
  if d.id is null then err := err || 'Dipendente non trovato.'::text;
  elsif not d.attivo then err := err || 'Dipendente non attivo.'::text; end if;
  select * into t from public.tipi_assenza where codice = upper(trim(coalesce(p_tipo, '')));
  if t.codice is null or not t.attivo then err := err || 'Tipo di assenza non valido.'::text;
  elsif p_da_dipendente and not t.richiedibile then err := err || 'Questo tipo di assenza lo inserisce solo l''ufficio personale.'::text; end if;
  if p_primo is null then err := err || 'Indica il primo giorno di assenza.'::text; end if;

  -- modalità: ore, mezza giornata o giornate intere
  if cardinality(err) = 0 then
    if orario then
      if t.unita <> 'ore' then err := err || 'Questo tipo di assenza si chiede a giorni, non a ore.'::text;
      elsif p_ora_inizio is null or p_ora_fine is null then err := err || 'Indica l''ora di inizio e l''ora di fine.'::text;
      elsif p_ora_fine <= p_ora_inizio then err := err || 'L''ora di fine deve essere dopo l''ora di inizio.'::text;
      elsif extract(minute from p_ora_inizio)::int % 15 <> 0 or extract(minute from p_ora_fine)::int % 15 <> 0
         or extract(second from p_ora_inizio) <> 0 or extract(second from p_ora_fine) <> 0 then
        err := err || 'Gli orari vanno indicati a quarti d''ora (es. 08:00, 08:15, 08:30, 08:45).'::text;
      end if;
      if mezza then err := err || 'Scegli la mezza giornata oppure l''orario, non entrambi.'::text; end if;
      if p_rientro is not null and p_rientro <> p_primo + 1 then err := err || 'Il permesso a ore vale per un solo giorno: indica solo il giorno.'::text; end if;
      ultimo := p_primo;
    elsif mezza then
      if not t.mezza_giornata then err := err || 'Questo tipo di assenza non si può chiedere a mezza giornata.'::text; end if;
      if p_rientro is not null and p_rientro <> p_primo + 1 then err := err || 'La mezza giornata vale per un solo giorno: indica solo il giorno.'::text; end if;
      ultimo := p_primo;
    else
      if p_rientro is null then err := err || 'Indica il giorno in cui rientri al lavoro.'::text;
      elsif p_rientro <= p_primo then err := err || 'Il giorno di rientro deve essere dopo il primo giorno di assenza.'::text;
      elsif p_rientro - p_primo > 366 then err := err || 'Periodo troppo lungo: al massimo un anno.'::text;
      else ultimo := p_rientro - 1; end if;
    end if;
  end if;

  -- rapporto di lavoro e limiti temporali
  if cardinality(err) = 0 then
    if d.data_assunzione is not null and p_primo < d.data_assunzione then
      err := err || ('Il periodo inizia prima della data di assunzione (' || to_char(d.data_assunzione, 'DD/MM/YYYY') || ').');
    end if;
    if d.data_cessazione is not null and ultimo > d.data_cessazione then
      err := err || ('Il periodo va oltre la data di cessazione (' || to_char(d.data_cessazione, 'DD/MM/YYYY') || ').');
    end if;
    if p_da_dipendente then
      if p_primo < oggi - 31 then err := err || 'Per giorni di oltre un mese fa rivolgiti all''ufficio personale.'::text;
      elsif p_primo < oggi then avv := avv || 'Attenzione: la richiesta riguarda giorni già passati.'::text; end if;
      if ultimo > oggi + 548 then err := err || 'Puoi chiedere al massimo 18 mesi in anticipo.'::text; end if;
    end if;
  end if;

  -- giorni conteggiati
  if cardinality(err) = 0 then
    for g in select gs::date from generate_series(p_primo, ultimo, interval '1 day') gs loop
      continue when substr(d.giorni_riposo, extract(isodow from g)::int, 1) = '1';
      fest := null;
      select f.nome into fest from public.festivita f where f.data = g and f.attiva;
      if fest is not null then escluse := escluse || jsonb_build_object('data', g, 'nome', fest); continue; end if;
      if orario then
        ore := extract(epoch from (p_ora_fine - p_ora_inizio)) / 3600.0;
        q := ore; fr := least(1, round(ore / d.ore_giornaliere, 3));
      elsif mezza then
        q := case when t.unita = 'giorni' then 0.5 else d.ore_giornaliere / 2 end; fr := 0.5;
      else
        q := case when t.unita = 'giorni' then 1 else d.ore_giornaliere end; fr := 1;
      end if;
      giorni := giorni || jsonb_build_object('giorno', g, 'quantita', round(q, 2), 'frazione', fr);
      tot := tot + round(q, 2); glav := glav + fr;
    end loop;
    if jsonb_array_length(giorni) = 0 then
      err := err || (case when orario or mezza then 'Il giorno scelto non è lavorativo (giorno di riposo o festività).'
                          else 'Nel periodo scelto non ci sono giorni lavorativi (solo riposi o festività).' end)::text;
    end if;
    if orario and ore > d.ore_giornaliere then
      avv := avv || ('Il permesso supera l''orario giornaliero (' || privato.fmt_num(d.ore_giornaliere) || ' ore).');
    end if;
    if jsonb_array_length(escluse) > 0 then
      avv := avv || ('Festività non conteggiate: ' || (select string_agg(to_char((e->>'data')::date, 'DD/MM/YYYY') || ' ' || (e->>'nome'), ', ')
                                                        from jsonb_array_elements(escluse) e) || '.');
    end if;
  end if;

  if cardinality(err) = 0 then
    -- sovrapposizioni con richieste in attesa o approvate dello stesso dipendente
    select string_agg(distinct r.numero || ' (' || case r.stato when 'in_attesa' then 'in attesa' else 'approvata' end || ')', ', ')
      into conf
      from public.richieste_assenza r
      join public.richieste_assenza_giorni gg on gg.richiesta_id = r.id
      join jsonb_to_recordset(giorni) n(giorno date, frazione numeric) on n.giorno = gg.giorno
     where r.dipendente_id = p_dip and r.stato in ('in_attesa', 'approvata')
       and ((not orario and not mezza)
            or (r.ora_inizio is null and not r.mezza_giornata)
            or (orario and r.ora_inizio is not null and p_ora_inizio < r.ora_fine and r.ora_inizio < p_ora_fine)
            or n.frazione + (select sum(g2.frazione) from public.richieste_assenza_giorni g2
                               join public.richieste_assenza r2 on r2.id = g2.richiesta_id
                              where r2.dipendente_id = p_dip and r2.stato in ('in_attesa', 'approvata') and g2.giorno = gg.giorno) > 1);
    if conf is not null then
      err := err || ('Per questi giorni c''è già una richiesta: ' || conf || '. Scegli altri giorni o annulla quella richiesta.');
    end if;

    if exists (select 1 from public.assenze_manuali m where m.tecnico_id = p_dip and not m.annullata and m.dal <= ultimo and m.al >= p_primo) then
      avv := avv || 'Nel periodo c''è già un''assenza registrata dal responsabile flotta.'::text;
    end if;
    if d.categoria = 'TEC' then
      select count(*) into n_int from public.interventi i
       where i.tecnico_id = p_dip and i.data in (select (e->>'giorno')::date from jsonb_array_elements(giorni) e);
      if n_int > 0 then
        avv := avv || (n_int || case when n_int = 1 then ' intervento già pianificato' else ' interventi già pianificati' end || ' in questi giorni: il responsabile flotta dovrà riassegnarli.');
      end if;
    end if;
    if t.codice = 'MAL' then
      avv := avv || 'Nelle note non scrivere mai la diagnosi: basta il numero di protocollo del certificato.'::text;
    end if;

    -- saldo per ciascun anno toccato (maturato fino alla fine del mese dell'ultimo giorno)
    if t.con_saldo then
      for x in select extract(year from (e->>'giorno')::date)::int as anno, sum((e->>'quantita')::numeric) as q,
                      max((e->>'giorno')::date) as ultimo_anno
                 from jsonb_array_elements(giorni) e group by 1 order by 1 loop
        fino := (date_trunc('month', x.ultimo_anno) + interval '1 month - 1 day')::date;
        s := privato.saldo(p_dip, x.anno, t.codice, fino);
        dopo := (s->>'saldo_dopo_attesa')::numeric - x.q;
        saldi := saldi || jsonb_build_object('anno', x.anno, 'quantita', x.q, 'saldo', (s->>'saldo')::numeric,
                   'in_attesa', (s->>'in_attesa')::numeric, 'saldo_dopo', dopo, 'alla_data', fino,
                   'insufficiente', dopo < 0, 'spettanza_mancante', (s->>'spettanza_annua') is null);
        if dopo < 0 then
          insuff := true;
          avv := avv || ('Saldo ' || x.anno || ' insufficiente: dopo questa richiesta (e quelle in attesa) resterebbero '
                         || privato.fmt_q(dopo, t.unita) || '. Puoi inviarla lo stesso: decide l''ufficio personale.');
        end if;
        if (s->>'spettanza_annua') is null then
          avv := avv || ('Spettanza ' || x.anno || ' non ancora impostata dall''ufficio personale: il saldo potrebbe non essere corretto.');
        end if;
      end loop;
    end if;
  end if;

  return jsonb_build_object(
    'ok', cardinality(err) = 0, 'errori', to_jsonb(err), 'avvisi', to_jsonb(avv),
    'dipendente_id', p_dip, 'tipo', t.codice, 'tipo_descrizione', t.descrizione, 'unita', t.unita,
    'modalita', case when orario then 'ore' when mezza then 'mezza_giornata' else 'giorni' end,
    'primo_giorno', p_primo, 'ultimo_giorno', ultimo, 'rientro', ultimo + 1,
    'ora_inizio', to_char(p_ora_inizio, 'HH24:MI'), 'ora_fine', to_char(p_ora_fine, 'HH24:MI'), 'mezza_giornata', mezza,
    'giorni', giorni, 'quantita', tot, 'giorni_lavorativi', glav, 'giorni_calendario', ultimo - p_primo + 1,
    'festivita_escluse', escluse, 'saldi', saldi, 'saldo_insufficiente', insuff, 'interventi_in_piano', n_int);
end $$;

-- Salvataggio di una richiesta già calcolata (chiamato solo dopo calcola_richiesta ok)
create or replace function privato.salva_richiesta(p_calc jsonb, p_note text, p_creata_da text, p_utente uuid, p_approva boolean)
returns public.richieste_assenza language plpgsql set search_path = '' as $$
declare r public.richieste_assenza; n int; a int := extract(year from public.oggi())::int;
begin
  insert into public.contatori_richieste as c (anno, ultimo) values (a, 1)
    on conflict (anno) do update set ultimo = c.ultimo + 1
    returning c.ultimo into n;
  insert into public.richieste_assenza (numero, dipendente_id, tipo, primo_giorno, ultimo_giorno, ora_inizio, ora_fine,
      mezza_giornata, quantita, unita, giorni_lavorativi, note, stato, saldo_insufficiente, avvisi,
      creata_da, creata_da_utente, deciso_da, deciso_il, motivo_decisione)
  values ('RF-' || a || '-' || case when n < 10000 then lpad(n::text, 4, '0') else n::text end,
      (p_calc->>'dipendente_id')::bigint, p_calc->>'tipo',
      (p_calc->>'primo_giorno')::date, (p_calc->>'ultimo_giorno')::date,
      (p_calc->>'ora_inizio')::time, (p_calc->>'ora_fine')::time, (p_calc->>'mezza_giornata')::boolean,
      (p_calc->>'quantita')::numeric, p_calc->>'unita', (p_calc->>'giorni_lavorativi')::numeric,
      left(nullif(trim(coalesce(p_note, '')), ''), 500),
      case when p_approva then 'approvata' else 'in_attesa' end,
      (p_calc->>'saldo_insufficiente')::boolean, coalesce(p_calc->'avvisi', '[]'::jsonb),
      p_creata_da, p_utente,
      case when p_approva then p_utente end, case when p_approva then now() end,
      case when p_approva then 'Registrata e approvata dall''ufficio personale' end)
  returning * into r;
  insert into public.richieste_assenza_giorni (richiesta_id, giorno, quantita, frazione)
  select r.id, (e->>'giorno')::date, (e->>'quantita')::numeric, (e->>'frazione')::numeric
    from jsonb_array_elements(p_calc->'giorni') e;
  return r;
end $$;

-- Notifiche (tipo 'avviso' con dati.categoria = 'ferie': il CHECK sui tipi non si tocca;
-- la funzione server `flotta` invia il push usando dati.titolo / dati.testo / dati.livello).
create or replace function privato.notifica_dipendente(p_dip bigint, p_titolo text, p_testo text, p_dati jsonb, p_livello text)
returns void language sql set search_path = '' as $$
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  values (p_dip, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
            'titolo', p_titolo, 'testo', p_testo, 'da', 'Ufficio personale') || coalesce(p_dati, '{}'::jsonb), '/t');
$$;

-- p_area: 'flotta' (admin + responsabili flotta) | 'hr' (responsabili HR; se nessuno è attivo, gli admin)
create or replace function privato.notifica_responsabili(p_area text, p_titolo text, p_testo text, p_dati jsonb, p_livello text, p_link text)
returns void language plpgsql set search_path = '' as $$
declare n int;
begin
  insert into public.notifiche (user_id, tipo, dati, link)
  select r.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
           'titolo', p_titolo, 'testo', p_testo) || coalesce(p_dati, '{}'::jsonb), p_link
    from public.responsabili r
   where r.attivo and case when p_area = 'flotta' then r.ruolo = 'admin' or (r.ruolo = 'responsabile' and r.area = 'flotta')
                           else r.ruolo = 'responsabile' and r.area = 'hr' end;
  get diagnostics n = row_count;
  if n = 0 and p_area = 'hr' then
    insert into public.notifiche (user_id, tipo, dati, link)
    select r.user_id, 'avviso', jsonb_build_object('categoria', 'ferie', 'livello', coalesce(p_livello, 'info'),
             'titolo', p_titolo, 'testo', p_testo) || coalesce(p_dati, '{}'::jsonb), p_link
      from public.responsabili r where r.attivo and r.ruolo = 'admin';
  end if;
end $$;

-- Trigger: riga per il piano (solo etichetta generica) ------------------------------------
create or replace function public.tg_richiesta_sincronizza() returns trigger
language plpgsql security definer set search_path = '' as $$
declare et text; riga text;
begin
  select t.etichetta_piano into et from public.tipi_assenza t where t.codice = new.tipo;
  riga := case when new.stato = 'in_attesa' then 'possibile'
               when new.ora_inizio is null and not new.mezza_giornata then 'assenza'
               else 'nota' end;
  et := case riga when 'possibile' then 'Possibile assenza'
                  when 'assenza' then et
                  else et || case when new.ora_inizio is not null
                                  then ' ' || to_char(new.ora_inizio, 'HH24:MI') || '-' || to_char(new.ora_fine, 'HH24:MI')
                                  else ' (mezza giornata)' end end;
  if new.stato in ('in_attesa', 'approvata') then
    insert into public.assenze_da_richieste as a (richiesta_id, dipendente_id, dal, al, tipo_riga, etichetta, attiva)
    values (new.id, new.dipendente_id, new.primo_giorno, new.ultimo_giorno, riga, et, true)
    on conflict (richiesta_id) do update
      set tipo_riga = excluded.tipo_riga, etichetta = excluded.etichetta, attiva = true, dal = excluded.dal, al = excluded.al
      where (a.tipo_riga, a.etichetta, a.attiva, a.dal, a.al) is distinct from (excluded.tipo_riga, excluded.etichetta, true, excluded.dal, excluded.al);
  else
    -- rifiutata o annullata: la riga resta (storico) ma non vale più
    update public.assenze_da_richieste set attiva = false where richiesta_id = new.id and attiva;
  end if;
  return new;
end $$;
create trigger sincronizza_richieste after insert or update of stato on public.richieste_assenza
  for each row execute function public.tg_richiesta_sincronizza();

-- Trigger: notifiche (HR, dipendente, responsabile flotta) ---------------------------------
-- Per import o dati di prova: `set local portale.senza_notifiche = 'on'` le disattiva.
create or replace function public.tg_richiesta_notifiche() returns trigger
language plpgsql security definer set search_path = '' as $$
declare d public.dipendenti; t public.tipi_assenza; per text; n_int int; date_int text; nome text; intera boolean;
begin
  if coalesce(current_setting('portale.senza_notifiche', true), '') = 'on' then return new; end if;
  if TG_OP = 'UPDATE' and new.stato is not distinct from old.stato then return new; end if;
  select * into d from public.dipendenti where id = new.dipendente_id;
  select * into t from public.tipi_assenza where codice = new.tipo;
  nome := d.nome || ' ' || d.cognome;
  intera := new.ora_inizio is null and not new.mezza_giornata;
  per := privato.periodo_testo(new.primo_giorno, new.ultimo_giorno, new.ora_inizio, new.ora_fine, new.mezza_giornata);

  -- 1. nuova richiesta del dipendente → ufficio personale
  if TG_OP = 'INSERT' and new.stato = 'in_attesa' then
    perform privato.notifica_responsabili('hr', 'Nuova richiesta: ' || t.descrizione,
      nome || ' · ' || per || ' · ' || new.numero,
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'nuova_richiesta'), 'info', '/hr/richieste');
  end if;

  -- 2. esito al dipendente (push)
  if new.stato = 'approvata' then
    perform privato.notifica_dipendente(new.dipendente_id,
      case when TG_OP = 'INSERT' then t.descrizione || ': registrata dall''ufficio personale' else t.descrizione || ': richiesta approvata' end,
      per || ' · ' || privato.fmt_q(new.quantita, new.unita) || ' · ' || new.numero,
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'approvata'), 'info');
  elsif new.stato = 'rifiutata' then
    perform privato.notifica_dipendente(new.dipendente_id, t.descrizione || ': richiesta non approvata',
      per || ' · Motivo: ' || new.motivo_decisione || ' · ' || new.numero,
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'rifiutata'), 'importante');
  elsif new.stato = 'annullata' and new.annullata_da = 'hr' then
    perform privato.notifica_dipendente(new.dipendente_id, t.descrizione || ': annullata dall''ufficio personale',
      per || ' · Motivo: ' || coalesce(new.motivo_annullamento, '—') || ' · ' || new.numero,
      jsonb_build_object('richiesta_id', new.id, 'numero', new.numero, 'evento', 'annullata'), 'importante');
  end if;

  -- 3. tecnico con interventi in piano → responsabile flotta (solo etichetta generica, mai il tipo)
  if d.categoria = 'TEC' and new.ultimo_giorno >= public.oggi() then
    if new.stato = 'approvata' then
      select count(*), string_agg(distinct to_char(i.data, 'DD/MM'), ', ') into n_int, date_int
        from public.interventi i
       where i.tecnico_id = new.dipendente_id and i.data between greatest(new.primo_giorno, public.oggi()) and new.ultimo_giorno;
      if n_int > 0 then
        perform privato.notifica_responsabili('flotta',
          case when intera then 'Interventi da riassegnare' else 'Verifica interventi: permesso' end,
          nome || case when intera then ' sarà assente (' || t.etichetta_piano || ') ' else ' ha un permesso ' end
               || privato.periodo_testo(new.primo_giorno, new.ultimo_giorno, new.ora_inizio, new.ora_fine, new.mezza_giornata)
               || ': ' || n_int || case when n_int = 1 then ' intervento' else ' interventi' end || ' in piano (' || date_int || ').',
          jsonb_build_object('dipendente_id', new.dipendente_id, 'dal', new.primo_giorno, 'al', new.ultimo_giorno, 'evento', 'interventi_da_riassegnare'),
          'importante', '/piano');
      end if;
    elsif new.stato = 'annullata' and TG_OP = 'UPDATE' and old.stato = 'approvata' and intera then
      perform privato.notifica_responsabili('flotta', 'Assenza annullata',
        nome || ' torna disponibile ' || privato.periodo_testo(new.primo_giorno, new.ultimo_giorno, null, null, false) || '.',
        jsonb_build_object('dipendente_id', new.dipendente_id, 'dal', new.primo_giorno, 'al', new.ultimo_giorno, 'evento', 'assenza_annullata'),
        'info', '/piano');
    end if;
  end if;
  return new;
end $$;
create trigger notifiche_richieste after insert or update of stato on public.richieste_assenza
  for each row execute function public.tg_richiesta_notifiche();
