-- 0040 Notifiche del piano ai tecnici: pubblicazione giorno/settimana/mese e modifiche raggruppate. Non distruttiva.
-- Fotografia per (giorno, tecnico) in piano_inviato (già usata da conferma_piano): la differenza con il piano attuale
-- dà le modifiche da inviare. Una sola notifica 'piano' per tecnico a ogni pressione di «Pubblica» / «Invia aggiornamenti».
-- Le urgenze del giorno restano fuori (vanno con «Invia urgente al tecnico»).

create table if not exists public.notifiche_piano (
  id bigint generated always as identity primary key,
  tecnico_id bigint not null references public.dipendenti(id),
  tipo text not null check (tipo in ('giorno', 'settimana', 'mese', 'modifiche')),
  periodo_da date not null, periodo_a date not null,
  dettaglio jsonb not null default '{}'::jsonb,
  notifica_id bigint,
  inviata_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists notifiche_piano_tec on public.notifiche_piano (tecnico_id, inviata_at desc);
alter table public.notifiche_piano enable row level security;
grant select on public.notifiche_piano to authenticated;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notifiche_piano' and policyname = 'notifiche_piano_resp') then
    create policy notifiche_piano_resp on public.notifiche_piano for select to authenticated using ((select public.is_responsabile()));
  end if;
end $$;

create or replace function privato.giorno_breve(d date) returns text language sql immutable set search_path = '' as $$
  select (array['lun','mar','mer','gio','ven','sab','dom'])[extract(isodow from d)::int] || ' ' || extract(day from d)::int || ' ' ||
         (array['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'])[extract(month from d)::int];
$$;

-- Fotografia del giorno per il tecnico: veicolo + interventi (senza le urgenze del giorno) + tappe del percorso. null se assente o vuoto.
create or replace function privato.piano_impronta(p_tid bigint, p_data date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare v jsonb; i jsonb; p public.percorsi;
begin
  if exists (select 1 from public.assenze a where a.tecnico_id = p_tid and p_data between a.dal and a.al) then return null; end if;
  select jsonb_build_object('targa', ve.targa, 'modello', ve.marca_modello) into v
    from public.assegnazioni g join public.veicoli ve on ve.id = g.veicolo_id where g.tecnico_id = p_tid and g.data = p_data;
  select coalesce(jsonb_agg(jsonb_build_object('ora', to_char(x.ora, 'HH24:MI'), 'luogo', x.luogo, 'attivita', x.attivita) order by x.ora nulls last, x.id), '[]') into i
    from public.interventi x
   where x.tecnico_id = p_tid and x.data = p_data
     and not exists (select 1 from public.urgenze u where u.intervento_id = x.id and u.stato <> 'annullata');
  select * into p from public.percorsi where tecnico_id = p_tid and data = p_data;
  if p.id is not null then
    i := i || coalesce((select jsonb_agg(jsonb_build_object('ora', r->>'arrivo', 'luogo', r->>'luogo', 'attivita', r->>'attivita') order by n)
                          from jsonb_array_elements(p.risultato->'righe') with ordinality t(r, n) where r->>'tipo' = 'tappa'), '[]');
  end if;
  if v is null and jsonb_array_length(i) = 0 then return null; end if;
  return jsonb_build_object('veicolo', v, 'interventi', i, 'partenza', coalesce(p.opzioni->>'ora', i->0->>'ora'));
end $$;

-- Differenze tra quanto già inviato e il piano attuale, nel periodo.
-- p_solo_inviati: considera solo i giorni già inviati (o segnati in variazioni_da_inviare).
create or replace function privato.piano_diff(p_tid bigint, p_da date, p_a date, p_solo_inviati boolean) returns jsonb
language plpgsql stable set search_path = '' as $$
declare d date; o jsonb; n jsonb; c boolean; vecchi jsonb := '[]'; nuovi jsonb := '[]'; righe text[] := '{}'; prima boolean := true; imp jsonb := '{}'; tot int := 0; x record;
  fmt text;
begin
  for d in select g::date from generate_series(p_da, p_a, interval '1 day') g loop
    select pi.impronta, true into o, c from public.piano_inviato pi where pi.data = d and pi.tecnico_id = p_tid;
    if c then prima := false; end if;
    if p_solo_inviati and c is null and not exists (select 1 from public.variazioni_da_inviare v where v.tecnico_id = p_tid and v.data = d and v.inviato_at is null)
       and not exists (select 1 from public.notifiche_piano np where np.tecnico_id = p_tid and d between np.periodo_da and np.periodo_a) then
      o := null; c := null; continue;
    end if;
    n := privato.piano_impronta(p_tid, d);
    imp := imp || jsonb_build_object(d::text, coalesce(n, 'null'::jsonb));
    tot := tot + jsonb_array_length(coalesce(n->'interventi', '[]'));
    vecchi := vecchi || coalesce((select jsonb_agg(e || jsonb_build_object('d', d)) from jsonb_array_elements(coalesce(o->'interventi', '[]')) e), '[]');
    nuovi := nuovi || coalesce((select jsonb_agg(e || jsonb_build_object('d', d)) from jsonb_array_elements(coalesce(n->'interventi', '[]')) e), '[]');
    if o is not null and n is not null and (o->'veicolo'->>'targa') is distinct from (n->'veicolo'->>'targa') then
      righe := righe || ('Veicolo ' || privato.giorno_breve(d) || ': ' || coalesce(o->'veicolo'->>'targa', '—') || ' → ' || coalesce(n->'veicolo'->>'targa', '—'));
    end if;
    o := null; c := null;
  end loop;
  for x in
    with v as (select e, e->>'luogo' l, e->>'attivita' a, row_number() over (partition by e->>'luogo', e->>'attivita' order by e->>'d', e->>'ora') k from jsonb_array_elements(vecchi) e),
         w as (select e, e->>'luogo' l, e->>'attivita' a, row_number() over (partition by e->>'luogo', e->>'attivita' order by e->>'d', e->>'ora') k from jsonb_array_elements(nuovi) e)
    select v.e ve, w.e we from v full join w on v.l = w.l and v.a = w.a and v.k = w.k
     order by coalesce(w.e->>'d', v.e->>'d'), coalesce(w.e->>'ora', v.e->>'ora')
  loop
    if x.ve is null then
      righe := righe || ('Aggiunto: ' || (x.we->>'luogo') || ' – ' || privato.giorno_breve((x.we->>'d')::date) || coalesce(' ' || (x.we->>'ora'), ''));
    elsif x.we is null then
      righe := righe || ('Tolto: ' || (x.ve->>'luogo') || ' – ' || privato.giorno_breve((x.ve->>'d')::date) || coalesce(' ' || (x.ve->>'ora'), ''));
    elsif (x.ve->>'d') <> (x.we->>'d') or (x.ve->>'ora') is distinct from (x.we->>'ora') then
      fmt := case when (x.ve->>'d') = (x.we->>'d') then coalesce(x.ve->>'ora', '—') || ' → ' || coalesce(x.we->>'ora', '—') || ' (' || privato.giorno_breve((x.we->>'d')::date) || ')'
                  else 'da ' || privato.giorno_breve((x.ve->>'d')::date) || ' a ' || privato.giorno_breve((x.we->>'d')::date) || coalesce(' ' || (x.we->>'ora'), '') end;
      righe := righe || ('Spostato: ' || (x.we->>'luogo') || ' ' || fmt);
    end if;
  end loop;
  return jsonb_build_object('prima', prima, 'righe', to_jsonb(righe), 'totale', tot, 'impronte', imp);
end $$;

-- Pubblica per tutti i tecnici attivi (o uno solo): una notifica 'piano' per tecnico, fotografie aggiornate, registro.
create or replace function privato.piano_pubblica(p_tipo text, p_da date, p_a date, p_tecnico bigint default null) returns int
language plpgsql set search_path = '' as $$
declare t record; df jsonb; tit text; righe jsonb; n int := 0; nid bigint; k text; imp jsonb; d0 jsonb; mesi text[] := array['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
begin
  for t in select tc.id from public.tecnici tc where tc.attivo and (p_tecnico is null or tc.id = p_tecnico) loop
    df := privato.piano_diff(t.id, p_da, p_a, p_tipo = 'modifiche');
    righe := df->'righe';
    if p_tipo <> 'modifiche' and (df->>'prima')::boolean then
      continue when (df->>'totale')::int = 0;
      d0 := df->'impronte'->(p_da::text);
      tit := case p_tipo
        when 'giorno' then 'Piano di ' || privato.giorno_breve(p_da) || ': ' || (df->>'totale') || ' interventi' || coalesce(', partenza ' || (d0->>'partenza'), '')
        when 'settimana' then 'Piano settimana ' || extract(day from p_da)::int || '–' || substr(privato.giorno_breve(p_a), 5) || ' pronto: ' || (df->>'totale') || ' interventi'
        else 'Piano di ' || mesi[extract(month from p_da)::int] || ' pronto: ' || (df->>'totale') || ' interventi' end;
      righe := '[]';
    else
      continue when jsonb_array_length(righe) = 0;
      tit := case when p_tipo = 'giorno' then 'Piano di ' || privato.giorno_breve(p_da) || ' aggiornato' else 'Piano aggiornato' end
             || ': ' || jsonb_array_length(righe) || case when jsonb_array_length(righe) = 1 then ' modifica' else ' modifiche' end;
    end if;
    d0 := df->'impronte'->(p_da::text);
    insert into public.notifiche (tecnico_id, tipo, dati, link)
    values (t.id, 'piano', jsonb_strip_nulls(jsonb_build_object(
        'data', p_da, 'periodo', jsonb_build_object('tipo', p_tipo, 'da', p_da, 'a', p_a), 'titolo', tit, 'righe', righe, 'totale', (df->>'totale')::int,
        'veicolo', case when p_tipo = 'giorno' then d0->'veicolo' end,
        'interventi', case when p_tipo = 'giorno' then coalesce(d0->'interventi', '[]'::jsonb) end,
        'aggiornato', not (df->>'prima')::boolean, 'annullato', p_tipo = 'giorno' and jsonb_typeof(d0) = 'null')), '/t?data=' || p_da)
    returning id into nid;
    for k, imp in select * from jsonb_each(df->'impronte') loop
      if jsonb_typeof(imp) = 'null' then
        delete from public.piano_inviato where data = k::date and tecnico_id = t.id;
      else
        insert into public.piano_inviato (data, tecnico_id, impronta, inviato_il) values (k::date, t.id, imp, now())
          on conflict (data, tecnico_id) do update set impronta = excluded.impronta, inviato_il = now();
      end if;
    end loop;
    update public.variazioni_da_inviare set inviato_at = now() where tecnico_id = t.id and inviato_at is null and data between p_da and p_a;
    insert into public.notifiche_piano (tecnico_id, tipo, periodo_da, periodo_a, dettaglio, notifica_id)
    values (t.id, p_tipo, p_da, p_a, jsonb_build_object('titolo', tit, 'righe', righe, 'totale', (df->>'totale')::int), nid);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Conferma del giorno: stessi controlli di prima, la notifica passa da piano_pubblica (nessun doppione).
create or replace function public.conferma_piano(p_data date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb; bloccati text[]; n int;
begin
  perform public.richiedi_responsabile();
  p := public.piano_giorno(p_data);
  select coalesce(array_agg(x->>'nome'), '{}') into bloccati from jsonb_array_elements(p->'righe') x where x->>'livello' = 'ko';
  if array_length(bloccati, 1) > 0 then
    return jsonb_build_object('ok', false, 'bloccati', to_jsonb(bloccati));
  end if;
  insert into public.piani (data, confermato_il, confermato_da) values (p_data, now(), auth.uid())
    on conflict (data) do update set confermato_il = now(), confermato_da = auth.uid();
  n := privato.piano_pubblica('giorno', p_data, p_data);
  return jsonb_build_object('ok', true, 'notificati', n);
end $$;

create or replace function public.pubblica_piano(p_tipo text, p_data date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare da date; a date; n int;
begin
  perform public.richiedi_responsabile();
  if p_tipo = 'giorno' then da := p_data; a := p_data;
  elsif p_tipo = 'settimana' then da := p_data - (extract(isodow from p_data)::int - 1); a := da + 4;
  elsif p_tipo = 'mese' then da := date_trunc('month', p_data)::date; a := (date_trunc('month', p_data) + interval '1 month - 1 day')::date;
  else raise exception 'Tipo non valido'; end if;
  n := privato.piano_pubblica(p_tipo, da, a);
  return jsonb_build_object('ok', true, 'notificati', n, 'da', da, 'a', a);
end $$;

-- «Invia aggiornamenti»: modifiche dei giorni già inviati da oggi a +31, una notifica per tecnico.
create or replace function public.variazioni_invia_aggiornamenti() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  perform public.richiedi_responsabile();
  n := privato.piano_pubblica('modifiche', public.oggi(), public.oggi() + 31);
  return jsonb_build_object('ok', true, 'tecnici', n);
end $$;

-- Badge «N modifiche non inviate» per tecnico + ultime notifiche del piano con stato di lettura.
create or replace function public.piano_modifiche_pendenti() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb := '{}'; t record; df jsonb;
begin
  perform public.richiedi_responsabile();
  for t in select tc.id from public.tecnici tc where tc.attivo loop
    df := privato.piano_diff(t.id, public.oggi(), public.oggi() + 31, true);
    if jsonb_array_length(df->'righe') > 0 then r := r || jsonb_build_object(t.id::text, df->'righe'); end if;
  end loop;
  return jsonb_build_object('pendenti', r,
    'registro', coalesce((select jsonb_agg(jsonb_build_object('id', np.id, 'tecnico_id', np.tecnico_id, 'tipo', np.tipo, 'da', np.periodo_da, 'a', np.periodo_a,
                            'titolo', np.dettaglio->>'titolo', 'righe', np.dettaglio->'righe', 'inviata_at', np.inviata_at, 'letta_at', nt.letta_il) order by np.inviata_at desc)
                          from (select * from public.notifiche_piano order by inviata_at desc limit 60) np left join public.notifiche nt on nt.id = np.notifica_id), '[]'));
end $$;

-- Tappe di percorso spostate: il luogo resta lo stesso, così la modifica risulta «Spostato» e non «Tolto + Aggiunto».
create or replace function privato.sposta_tappa(p_da_tecnico bigint, p_data date, p_key text, p_tecnico bigint, p_nuova_data date) returns text
language plpgsql set search_path = '' as $$
declare st jsonb := privato.giornata_tappe(p_da_tecnico, p_data); x jsonb; pid bigint; nome text;
begin
  select e into x from jsonb_array_elements(st->'tappe') e where e->>'key' = p_key;
  if x is null then raise exception 'Tappa % non trovata', p_key; end if;
  if p_key like 'i:%' or p_key like 'u:%' then
    if x->>'intervento_id' is null then raise exception 'Tappa senza intervento'; end if;
    update public.interventi set tecnico_id = p_tecnico, data = p_nuova_data where id = (x->>'intervento_id')::bigint;
    if p_key like 'u:%' then update public.urgenze set tecnico_id = p_tecnico, data = p_nuova_data, dopo_key = null where id = (x->>'urgenza_id')::bigint; end if;
  else
    pid := (st->>'percorso_id')::bigint;
    update public.percorsi set
      stops = coalesce((select jsonb_agg(s) from jsonb_array_elements(stops) s where 'p:' || (s->>'id') <> p_key), '[]'),
      risultato = jsonb_set(jsonb_set(risultato, '{righe}', coalesce((select jsonb_agg(r) from jsonb_array_elements(risultato->'righe') r where coalesce('p:' || (r->>'id'), '') <> p_key), '[]')),
                            '{avvisi}', coalesce(risultato->'avvisi', '[]') || '["Percorso modificato: ricalcola"]'::jsonb),
      stato = 'bozza'
     where id = pid;
    insert into public.interventi (data, tecnico_id, ora, ora_fine, luogo, attivita, note, priorita)
    values (p_nuova_data, p_tecnico, null, null, coalesce(x->>'luogo', x->>'indirizzo'), coalesce(x->>'attivita', 'Intervento'),
            concat_ws(' · ', nullif(x->>'indirizzo', x->>'luogo'), 'Spostato da percorso del ' || to_char(p_data, 'DD/MM')), 'normale');
  end if;
  select tc.nome into nome from public.tecnici tc where tc.id = p_tecnico;
  -- segna i giorni coinvolti: rientrano in «Invia aggiornamenti» anche se mai inviati
  insert into public.variazioni_da_inviare (tecnico_id, data, testo)
  values (p_tecnico, p_nuova_data, to_char(p_nuova_data, 'DD/MM') || ': ' || coalesce(x->>'luogo', '') || ' – ' || coalesce(x->>'attivita', ''));
  if p_da_tecnico is distinct from p_tecnico or p_nuova_data <> p_data then
    insert into public.variazioni_da_inviare (tecnico_id, data, testo) values (p_da_tecnico, p_data, 'Tolto: ' || coalesce(x->>'luogo', ''));
  end if;
  return nome;
end $$;

do $$ declare f text; begin
  foreach f in array array['pubblica_piano(text,date)', 'piano_modifiche_pendenti()'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
