-- 0039 Variazioni della giornata: ritardi, giornata finita, urgenze stesso giorno, riassegnazioni per assenza.
-- Non distruttiva (solo create / create or replace). Vedi docs/VARIAZIONI_giornata.md.
-- Tecnico: solo RPC con token (SECURITY DEFINER, _tecnico_da_token). Responsabile/admin: is_responsabile().

create table if not exists public.variazioni_impostazioni (
  id int primary key default 1 check (id = 1),
  soglia_fine time not null default '18:00',
  updated_at timestamptz not null default now()
);
insert into public.variazioni_impostazioni (id) values (1) on conflict do nothing;

create table if not exists public.ritardi (
  id bigint generated always as identity primary key,
  data date not null,
  tecnico_id bigint not null references public.dipendenti(id),
  intervento_id bigint,
  stop_key text not null,                       -- 'p:<id tappa percorso>' | 'i:<id intervento>' | 'u:<id urgenza>'
  motivo text not null check (motivo in ('cliente', 'tempo', 'traffico', 'veicolo', 'altro')),
  minuti int not null check (minuti between 1 and 600),
  nota text,
  fine_stimata text,
  created_at timestamptz not null default now(),
  created_by text                               -- 'token:<primi 12 caratteri dell'hash della sessione>'
);
create index if not exists ritardi_giorno on public.ritardi (data, tecnico_id);

create table if not exists public.giornate_lavoro (
  id bigint generated always as identity primary key,
  tecnico_id bigint not null references public.dipendenti(id),
  data date not null,
  fine_at timestamptz not null default now(),
  tutto_fatto boolean not null default true,
  nota text,
  non_fatti jsonb not null default '[]'::jsonb,
  unique (tecnico_id, data)
);

create table if not exists public.da_ripianificare (
  id bigint generated always as identity primary key,
  data date not null,
  tecnico_id bigint references public.dipendenti(id),
  stop_key text,
  intervento_id bigint,
  luogo text, attivita text,
  origine text not null default 'non_fatto' check (origine in ('non_fatto', 'urgenza', 'assenza')),
  stato text not null default 'aperto' check (stato in ('aperto', 'gestito')),
  created_at timestamptz not null default now()
);

create table if not exists public.urgenze (
  id bigint generated always as identity primary key,
  data date not null,
  tecnico_id bigint not null references public.dipendenti(id),
  dopo_key text,                                 -- inserita dopo questa tappa (null = in testa)
  luogo text not null, indirizzo text, cap text, lat double precision, lon double precision,
  attivita text not null, durata int not null check (durata between 5 and 600), note text,
  arrivo text not null, partenza text not null,  -- orario previsto 'HH:MI'
  spostamento_min int not null default 0,        -- di quanto slittano le tappe successive
  ritardo_base int not null default 0,           -- ritardo accumulato già incluso nell'orario previsto
  intervento_id bigint references public.interventi(id),
  importato_id bigint references public.interventi_importati(id),
  stato text not null default 'confermata' check (stato in ('confermata', 'inviata', 'annullata')),
  notifica_id bigint, inviata_at timestamptz, letta_at timestamptz,
  created_by uuid default auth.uid(), created_at timestamptz not null default now()
);
create index if not exists urgenze_giorno on public.urgenze (data, tecnico_id);

create table if not exists public.variazioni_da_inviare (
  id bigint generated always as identity primary key,
  tecnico_id bigint not null references public.dipendenti(id),
  data date not null,
  testo text not null,
  created_at timestamptz not null default now(),
  inviato_at timestamptz
);

-- RLS: lettura/scrittura diretta solo responsabile/admin; il tecnico passa dalle RPC.
alter table public.variazioni_impostazioni enable row level security;
alter table public.ritardi enable row level security;
alter table public.giornate_lavoro enable row level security;
alter table public.da_ripianificare enable row level security;
alter table public.urgenze enable row level security;
alter table public.variazioni_da_inviare enable row level security;
grant select, insert, update on public.variazioni_impostazioni, public.ritardi, public.giornate_lavoro, public.da_ripianificare, public.urgenze, public.variazioni_da_inviare to authenticated;
do $$ declare t text; begin
  foreach t in array array['variazioni_impostazioni','ritardi','giornate_lavoro','da_ripianificare','urgenze','variazioni_da_inviare'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_resp') then
      execute format('create policy %I on public.%I for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()))', t || '_resp', t);
    end if;
  end loop;
end $$;

-- ---------- utilità orari ----------
create or replace function privato.hm(p text) returns int language sql immutable set search_path = '' as $$
  select case when p ~ '^\d{1,2}:\d{2}' then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int end;
$$;
create or replace function privato.fmt_hm(p int) returns text language sql immutable set search_path = '' as $$
  select case when p is null then null else lpad(((p / 60) % 24)::text, 2, '0') || ':' || lpad((p % 60)::text, 2, '0') end;
$$;

-- Tappe del giorno nell'ordine pianificato: percorso salvato se c'è, altrimenti interventi per ora; poi le urgenze.
create or replace function privato.giornata_tappe(p_tid bigint, p_data date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare p public.percorsi; base jsonb; ris jsonb := '[]'; u public.urgenze; e jsonb; messo boolean; gap int := 0;
begin
  select * into p from public.percorsi where tecnico_id = p_tid and data = p_data;
  if p.id is not null and p.risultato is not null then
    select coalesce(jsonb_agg(jsonb_build_object('key', 'p:' || (x->>'id'), 'luogo', x->>'luogo', 'attivita', x->>'attivita', 'arrivo', x->>'arrivo', 'partenza', x->>'partenza',
             'lat', s->'lat', 'lon', s->'lon', 'indirizzo', s->>'indirizzo', 'urgente', false) order by n), '[]')
      into base
      from jsonb_array_elements(p.risultato->'righe') with ordinality t(x, n)
      left join lateral (select s from jsonb_array_elements(p.stops) s where s->>'id' = x->>'id' limit 1) ss on true
     where x->>'tipo' = 'tappa';
    -- tempo di rientro in sede dopo l'ultima tappa
    select privato.hm(r->>'arrivo') - privato.hm(base->-1->>'partenza') into gap
      from jsonb_array_elements(p.risultato->'righe') r where r->>'tipo' = 'rientro' limit 1;
  else
    select coalesce(jsonb_agg(jsonb_build_object('key', 'i:' || i.id, 'intervento_id', i.id, 'luogo', i.luogo, 'attivita', i.attivita,
             'arrivo', to_char(i.ora, 'HH24:MI'), 'partenza', to_char(coalesce(i.ora_fine, i.ora + interval '60 minutes'), 'HH24:MI'),
             'indirizzo', i.luogo, 'urgente', i.priorita = 'urgente') order by i.ora nulls last, i.id), '[]')
      into base
      from public.interventi i
     where i.tecnico_id = p_tid and i.data = p_data
       and not exists (select 1 from public.urgenze x where x.intervento_id = i.id and x.stato <> 'annullata');
  end if;
  ris := base;
  for u in select * from public.urgenze where tecnico_id = p_tid and data = p_data and stato <> 'annullata' order by id loop
    e := jsonb_build_object('key', 'u:' || u.id, 'urgenza_id', u.id, 'intervento_id', u.intervento_id, 'luogo', u.luogo, 'attivita', u.attivita,
           'arrivo', u.arrivo, 'partenza', u.partenza, 'lat', u.lat, 'lon', u.lon, 'indirizzo', coalesce(u.indirizzo, u.luogo), 'cap', u.cap, 'urgente', true,
           'spostamento_min', u.spostamento_min, 'ritardo_base', u.ritardo_base);
    if u.dopo_key is null then ris := jsonb_build_array(e) || ris;
    else
      base := ris; ris := '[]'; messo := false;
      for k in 0 .. jsonb_array_length(base) - 1 loop
        ris := ris || jsonb_build_array(base->k);
        if base->k->>'key' = u.dopo_key then ris := ris || jsonb_build_array(e); messo := true; end if;
      end loop;
      if not messo then ris := ris || jsonb_build_array(e); end if;
    end if;
  end loop;
  return jsonb_build_object('tappe', ris, 'rientro_min', coalesce(gap, 0), 'percorso_id', p.id);
end $$;

-- Stima: le tappe dopo un ritardo slittano; per traffico/veicolo slitta anche l'arrivo della tappa stessa.
-- Ogni urgenza sposta le tappe successive di spostamento_min.
create or replace function privato.giornata_stima(p_tid bigint, p_data date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare g jsonb := privato.giornata_tappe(p_tid, p_data); tp jsonb := g->'tappe'; out jsonb := '[]'; x jsonb;
  cum int := 0; r_arr int; r_tot int; sh_a int; sh_p int; ora int := privato.hm(to_char(now() at time zone 'Europe/Rome', 'HH24:MI'));
  corr text; ult int; fine int; n int := jsonb_array_length(g->'tappe'); tot_rit int;
begin
  for k in 0 .. n - 1 loop
    x := tp->k;
    select coalesce(sum(minuti) filter (where motivo in ('traffico', 'veicolo')), 0), coalesce(sum(minuti), 0) into r_arr, r_tot
      from public.ritardi where tecnico_id = p_tid and data = p_data and stop_key = x->>'key';
    if (x->>'urgente')::boolean and x ? 'urgenza_id' then
      sh_a := greatest(cum - coalesce((x->>'ritardo_base')::int, 0), 0) + r_arr;
      sh_p := greatest(cum - coalesce((x->>'ritardo_base')::int, 0), 0) + r_tot;
      cum := cum + r_tot + coalesce((x->>'spostamento_min')::int, 0);
    else
      sh_a := cum + r_arr; sh_p := cum + r_tot; cum := sh_p;
    end if;
    x := x || jsonb_build_object('arrivo_stimato', privato.fmt_hm(privato.hm(x->>'arrivo') + sh_a), 'partenza_stimata', privato.fmt_hm(privato.hm(x->>'partenza') + sh_p),
                                 'slittamento', sh_p, 'ritardi_min', r_tot);
    out := out || jsonb_build_array(x);
  end loop;
  if n > 0 then
    if p_data = public.oggi() then
      select e->>'key' into corr from jsonb_array_elements(out) e where privato.hm(e->>'partenza_stimata') > ora limit 1;
      if corr is null then corr := out->-1->>'key'; end if;
    else corr := out->0->>'key'; end if;
    ult := privato.hm(out->-1->>'partenza_stimata');
    fine := ult + coalesce((g->>'rientro_min')::int, 0);
  end if;
  select coalesce(sum(minuti), 0) into tot_rit from public.ritardi where tecnico_id = p_tid and data = p_data;
  return jsonb_build_object('tappe', out, 'corrente', corr, 'fine_stimata', privato.fmt_hm(fine), 'rientro_min', g->'rientro_min',
    'ritardo_tot', tot_rit, 'percorso_id', g->'percorso_id',
    'soglia', (select to_char(soglia_fine, 'HH24:MI') from public.variazioni_impostazioni where id = 1));
end $$;

-- Tappe da spostare perché la giornata stia entro la soglia (dalla fine, non urgenti, non la corrente).
create or replace function privato.giornata_suggerisci_spostamento(p_stima jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare fine int := privato.hm(p_stima->>'fine_stimata'); soglia int := privato.hm(p_stima->>'soglia'); nomi text[] := '{}'; x jsonb; n int := jsonb_array_length(p_stima->'tappe');
begin
  if fine is null or soglia is null or fine <= soglia then return null; end if;
  for k in reverse n - 1 .. 0 loop
    x := p_stima->'tappe'->k;
    exit when x->>'key' = p_stima->>'corrente';
    continue when (x->>'urgente')::boolean;
    nomi := nomi || coalesce(x->>'luogo', '?');
    fine := fine - (privato.hm(x->>'partenza') - privato.hm(x->>'arrivo'));
    exit when fine <= soglia;
  end loop;
  if cardinality(nomi) = 0 then return null; end if;
  return 'Suggerito: spostare ' || array_to_string(array(select '«' || v || '»' from unnest(nomi) v), ', ');
end $$;

-- ---------- App del tecnico ----------
create or replace function public.tecnico_giornata(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); d date := public.oggi(); s jsonb; g public.giornate_lavoro;
begin
  s := privato.giornata_stima(tid, d);
  select * into g from public.giornate_lavoro where tecnico_id = tid and data = d;
  return s || jsonb_build_object('data', d,
    'finita', case when g.id is null then null else jsonb_build_object('alle', to_char(g.fine_at at time zone 'Europe/Rome', 'HH24:MI'), 'tutto_fatto', g.tutto_fatto) end,
    'ritardi', coalesce((select jsonb_agg(jsonb_build_object('key', r.stop_key, 'motivo', r.motivo, 'minuti', r.minuti, 'alle', to_char(r.created_at at time zone 'Europe/Rome', 'HH24:MI')) order by r.id)
                         from public.ritardi r where r.tecnico_id = tid and r.data = d), '[]'),
    'urgenze', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'luogo', u.luogo, 'indirizzo', coalesce(u.indirizzo, u.luogo), 'attivita', u.attivita, 'note', u.note,
                           'arrivo', u.arrivo, 'lat', u.lat, 'lon', u.lon, 'letta', u.letta_at is not null) order by u.id)
                         from public.urgenze u where u.tecnico_id = tid and u.data = d and u.stato = 'inviata'), '[]'));
end $$;

create or replace function public.tecnico_segnala_ritardo(p_token text, p_key text, p_motivo text, p_minuti int, p_nota text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); d date := public.oggi(); s jsonb; x jsonb; sig text; lbl text; sugg text; sopra boolean; t public.tecnici;
begin
  if p_motivo not in ('cliente', 'tempo', 'traffico', 'veicolo', 'altro') then raise exception 'Scegli il motivo del ritardo'; end if;
  if coalesce(p_minuti, 0) < 1 or p_minuti > 600 then raise exception 'Indica quanti minuti di ritardo'; end if;
  if p_motivo = 'altro' and length(trim(coalesce(p_nota, ''))) < 3 then raise exception 'Scrivi il motivo del ritardo'; end if;
  s := privato.giornata_stima(tid, d);
  select e into x from jsonb_array_elements(s->'tappe') e where e->>'key' = p_key;
  if x is null then raise exception 'Intervento non trovato nella giornata di oggi'; end if;
  insert into public.ritardi (data, tecnico_id, intervento_id, stop_key, motivo, minuti, nota, created_by)
  values (d, tid, (x->>'intervento_id')::bigint, p_key, p_motivo, p_minuti, nullif(trim(coalesce(p_nota, '')), ''),
          'token:' || left(encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex'), 12));
  s := privato.giornata_stima(tid, d);
  update public.ritardi set fine_stimata = s->>'fine_stimata' where id = (select max(id) from public.ritardi where tecnico_id = tid and data = d);
  select * into t from public.tecnici where id = tid;
  select ts.sigla into sig from public.tecnici_sigle ts where ts.dipendente_id = tid order by ts.sigla limit 1;
  lbl := case p_motivo when 'cliente' then 'cliente' when 'tempo' then 'intervento lungo' when 'traffico' then 'traffico' when 'veicolo' then 'veicolo' else 'altro' end;
  sopra := privato.hm(s->>'fine_stimata') > privato.hm(s->>'soglia');
  sugg := privato.giornata_suggerisci_spostamento(s);
  perform privato.notifica_responsabili('flotta',
    coalesce(sig, t.nome) || ' +' || p_minuti || ' min (' || lbl || ') – fine giornata stimata ' || coalesce(s->>'fine_stimata', '—'),
    concat_ws(' · ', t.nome || ' ' || t.cognome || ': ' || coalesce(x->>'luogo', ''), nullif(trim(coalesce(p_nota, '')), ''),
              case when sopra then 'Oltre le ' || (s->>'soglia') end, sugg),
    jsonb_build_object('categoria', 'variazioni', 'evento', 'ritardo', 'tecnico_id', tid, 'data', d),
    case when sopra then 'urgente' else 'importante' end, '/giornata?data=' || d);
  return s || jsonb_build_object('ok', true);
end $$;

create or replace function public.tecnico_giornata_finita(p_token text, p_tutto_fatto boolean, p_non_fatti text[] default '{}', p_nota text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); d date := public.oggi(); s jsonb := privato.giornata_stima(tid, d); nf jsonb; t public.tecnici; sig text; n int;
begin
  if not coalesce(p_tutto_fatto, true) and coalesce(cardinality(p_non_fatti), 0) = 0 then raise exception 'Scegli gli interventi non fatti'; end if;
  select coalesce(jsonb_agg(e), '[]') into nf from jsonb_array_elements(s->'tappe') e where not coalesce(p_tutto_fatto, true) and e->>'key' = any(p_non_fatti);
  insert into public.giornate_lavoro (tecnico_id, data, tutto_fatto, nota, non_fatti)
  values (tid, d, coalesce(p_tutto_fatto, true), nullif(trim(coalesce(p_nota, '')), ''), nf)
  on conflict (tecnico_id, data) do update set fine_at = now(), tutto_fatto = excluded.tutto_fatto, nota = excluded.nota, non_fatti = excluded.non_fatti;
  insert into public.da_ripianificare (data, tecnico_id, stop_key, intervento_id, luogo, attivita, origine)
  select d, tid, e->>'key', (e->>'intervento_id')::bigint, e->>'luogo', e->>'attivita', 'non_fatto' from jsonb_array_elements(nf) e
   where not exists (select 1 from public.da_ripianificare r where r.data = d and r.tecnico_id = tid and r.stop_key = e->>'key' and r.stato = 'aperto');
  n := jsonb_array_length(nf);
  select * into t from public.tecnici where id = tid;
  select ts.sigla into sig from public.tecnici_sigle ts where ts.dipendente_id = tid order by ts.sigla limit 1;
  perform privato.notifica_responsabili('flotta',
    coalesce(sig, t.nome) || ': giornata finita alle ' || to_char(now() at time zone 'Europe/Rome', 'HH24:MI'),
    case when n > 0 then n || ' interventi non fatti → da ripianificare' else 'Tutto fatto' end,
    jsonb_build_object('categoria', 'variazioni', 'evento', 'giornata_finita', 'tecnico_id', tid, 'data', d), case when n > 0 then 'importante' else 'info' end, '/giornata?data=' || d);
  return jsonb_build_object('ok', true, 'alle', to_char(now() at time zone 'Europe/Rome', 'HH24:MI'), 'non_fatti', n);
end $$;

create or replace function public.tecnico_urgenza_letta(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); u public.urgenze;
begin
  update public.urgenze set letta_at = coalesce(letta_at, now()) where id = p_id and tecnico_id = tid returning * into u;
  if u.notifica_id is not null then update public.notifiche set letta_il = coalesce(letta_il, now()) where id = u.notifica_id and tecnico_id = tid; end if;
end $$;

-- ---------- Responsabile ----------
create or replace function public.variazioni_giornata(p_data date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r jsonb := '[]'; t record; s jsonb; g public.giornate_lavoro; ass boolean;
begin
  perform public.richiedi_responsabile();
  for t in select tc.id, tc.nome, tc.cognome, (select ts.sigla from public.tecnici_sigle ts where ts.dipendente_id = tc.id order by ts.sigla limit 1) sigla
             from public.tecnici tc where tc.attivo order by tc.cognome loop
    ass := exists (select 1 from public.assenze a where a.tecnico_id = t.id and p_data between a.dal and a.al);
    s := privato.giornata_stima(t.id, p_data);
    select * into g from public.giornate_lavoro where tecnico_id = t.id and data = p_data;
    r := r || jsonb_build_array(s || jsonb_build_object('tecnico_id', t.id, 'nome', t.nome || ' ' || t.cognome, 'sigla', t.sigla, 'assente', ass,
      'finita', case when g.id is null then null else jsonb_build_object('alle', to_char(g.fine_at at time zone 'Europe/Rome', 'HH24:MI'), 'tutto_fatto', g.tutto_fatto, 'nota', g.nota) end,
      'n_ritardi', (select count(*) from public.ritardi x where x.tecnico_id = t.id and x.data = p_data),
      'ritardi', coalesce((select jsonb_agg(jsonb_build_object('key', x.stop_key, 'motivo', x.motivo, 'minuti', x.minuti, 'nota', x.nota, 'alle', to_char(x.created_at at time zone 'Europe/Rome', 'HH24:MI')) order by x.id)
                           from public.ritardi x where x.tecnico_id = t.id and x.data = p_data), '[]'),
      'urgenze', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'luogo', u.luogo, 'attivita', u.attivita, 'stato', u.stato, 'arrivo', u.arrivo,
                             'inviata_at', u.inviata_at, 'letta_at', u.letta_at) order by u.id)
                           from public.urgenze u where u.tecnico_id = t.id and u.data = p_data and u.stato <> 'annullata'), '[]')));
  end loop;
  return jsonb_build_object('data', p_data, 'oggi', public.oggi(), 'ora', to_char(now() at time zone 'Europe/Rome', 'HH24:MI'),
    'soglia', (select to_char(soglia_fine, 'HH24:MI') from public.variazioni_impostazioni where id = 1),
    'tecnici', r,
    'cap_zone', coalesce((select jsonb_object_agg(z.cap, sg.dipendente_id) from public.cap_zone z join public.tecnici_sigle sg on sg.sigla = z.tecnico_sigla where sg.dipendente_id is not null), '{}'),
    'da_ripianificare', coalesce((select jsonb_agg(to_jsonb(d) order by d.id) from public.da_ripianificare d where d.stato = 'aperto'), '[]'),
    'da_inviare', (select count(*) from public.variazioni_da_inviare v where v.inviato_at is null));
end $$;

create or replace function public.variazioni_imposta_soglia(p_soglia time) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  update public.variazioni_impostazioni set soglia_fine = p_soglia, updated_at = now() where id = 1;
end $$;

-- Sposta una tappa del giorno: 'domani' (stesso tecnico, prossimo lavorativo) o 'tecnico' (altro tecnico, stessa data) o una data/tecnico qualsiasi.
-- Interventi: si aggiorna la riga. Tappe di percorso: si tolgono dal percorso (avviso «ricalcola») e diventano interventi del destinatario.
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
    values (p_nuova_data, p_tecnico, null, null, coalesce(x->>'indirizzo', x->>'luogo'), coalesce(x->>'attivita', 'Intervento'), 'Spostato da percorso del ' || to_char(p_data, 'DD/MM'), 'normale');
  end if;
  select tc.nome into nome from public.tecnici tc where tc.id = p_tecnico;
  if p_tecnico is distinct from p_da_tecnico or p_nuova_data <> p_data then
    insert into public.variazioni_da_inviare (tecnico_id, data, testo)
    values (p_tecnico, p_nuova_data, to_char(p_nuova_data, 'DD/MM') || ': nuovo intervento ' || coalesce(x->>'luogo', '') || ' – ' || coalesce(x->>'attivita', ''));
  end if;
  return nome;
end $$;

create or replace function public.variazioni_crea_urgenza(p_data date, p_tecnico bigint, p_dopo_key text, p_luogo text, p_indirizzo text, p_cap text,
  p_lat double precision, p_lon double precision, p_attivita text, p_durata int, p_note text, p_arrivo text, p_partenza text,
  p_spostamento int, p_ritardo_base int, p_importato bigint default null, p_spostamenti jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare iid bigint; uid bigint; m jsonb; nd date; pr public.piani;
begin
  perform public.richiedi_responsabile();
  select * into pr from public.piani where data = p_data;  -- un'urgenza del giorno non toglie la conferma del piano
  if length(trim(coalesce(p_luogo, ''))) < 2 then raise exception 'Indica cliente o indirizzo'; end if;
  if length(trim(coalesce(p_attivita, ''))) < 2 then raise exception 'Indica l''attività'; end if;
  if privato.hm(p_arrivo) is null or privato.hm(p_partenza) is null then raise exception 'Orario non valido'; end if;
  insert into public.interventi (data, tecnico_id, ora, ora_fine, luogo, attivita, note, priorita)
  values (p_data, p_tecnico, p_arrivo::time, p_partenza::time, trim(p_luogo), trim(p_attivita), nullif(trim(coalesce(p_note, '')), ''), 'urgente') returning id into iid;
  insert into public.urgenze (data, tecnico_id, dopo_key, luogo, indirizzo, cap, lat, lon, attivita, durata, note, arrivo, partenza, spostamento_min, ritardo_base, intervento_id, importato_id)
  values (p_data, p_tecnico, nullif(p_dopo_key, ''), trim(p_luogo), nullif(trim(coalesce(p_indirizzo, '')), ''), p_cap, p_lat, p_lon, trim(p_attivita), p_durata,
          nullif(trim(coalesce(p_note, '')), ''), p_arrivo, p_partenza, greatest(coalesce(p_spostamento, 0), 0), greatest(coalesce(p_ritardo_base, 0), 0), iid, p_importato)
  returning id into uid;
  if p_importato is not null then update public.interventi_importati set stato = 'pianificato' where id = p_importato; end if;
  for m in select * from jsonb_array_elements(coalesce(p_spostamenti, '[]')) loop
    nd := case when m->>'azione' = 'domani' then public.prossimo_lavorativo(p_data) else p_data end;
    perform privato.sposta_tappa(p_tecnico, p_data, m->>'key', coalesce((m->>'tecnico_id')::bigint, p_tecnico), nd);
  end loop;
  if pr.data is not null then insert into public.piani select pr.* on conflict do nothing; end if;
  return jsonb_build_object('ok', true, 'id', uid, 'intervento_id', iid);
end $$;

create or replace function public.variazioni_invia_urgenza(p_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u public.urgenze; nid bigint; mitt text; dove text;
begin
  perform public.richiedi_responsabile();
  select * into u from public.urgenze where id = p_id and stato <> 'annullata';
  if u.id is null then raise exception 'Urgenza non trovata'; end if;
  select r.nome into mitt from public.responsabili r where r.user_id = auth.uid();
  dove := coalesce(u.indirizzo, u.luogo);
  insert into public.notifiche (tecnico_id, tipo, dati, link)
  values (u.tecnico_id, 'avviso', jsonb_strip_nulls(jsonb_build_object('livello', 'urgente', 'evento', 'urgenza_giornata', 'urgenza_id', u.id,
            'titolo', 'URGENTE: dopo l''intervento in corso vai a ' || u.luogo, 'testo', concat_ws(' · ', u.attivita, u.note), 'ora', u.arrivo, 'luogo', dove,
            'mappa', 'https://www.google.com/maps/search/?api=1&query=' || case when u.lat is not null then u.lat || ',' || u.lon else replace(dove, ' ', '+') end,
            'da', mitt)), '/t')
  returning id into nid;
  update public.urgenze set stato = 'inviata', inviata_at = now(), notifica_id = nid, letta_at = null where id = u.id;
  return jsonb_build_object('ok', true, 'notifica_id', nid);
end $$;

create or replace function public.variazioni_annulla_urgenza(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare u public.urgenze;
begin
  perform public.richiedi_responsabile();
  update public.urgenze set stato = 'annullata' where id = p_id returning * into u;
  -- l'intervento resta nel piano come «da ripianificare»
  if u.id is not null then
    insert into public.da_ripianificare (data, tecnico_id, stop_key, intervento_id, luogo, attivita, origine) values (u.data, u.tecnico_id, 'i:' || u.intervento_id, u.intervento_id, u.luogo, u.attivita, 'urgenza');
  end if;
end $$;

create or replace function public.variazioni_ripianificato(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  update public.da_ripianificare set stato = 'gestito' where id = p_id;
end $$;

-- Assenze: tecnico indisponibile (riga in assenze_manuali, motivo «Altro»).
create or replace function public.variazioni_indisponibile(p_tecnico bigint, p_dal date, p_al date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare nid bigint;
begin
  perform public.richiedi_responsabile();
  if p_al < p_dal then raise exception 'La data finale è prima di quella iniziale'; end if;
  insert into public.assenze_manuali (tecnico_id, dal, al, motivo) values (p_tecnico, p_dal, p_al, 'Altro') returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
end $$;

-- Attività da riassegnare nel periodo per i tecnici assenti/indisponibili, con carico degli altri e primo giorno libero dopo il rientro.
create or replace function public.variazioni_da_riassegnare(p_da date, p_a date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare compiti jsonb := '[]'; carico jsonb := '[]'; rientri jsonb := '{}'; a record; d date; s jsonb; t record; ri date; lib date; k int;
begin
  perform public.richiedi_responsabile();
  if p_a < p_da or p_a - p_da > 31 then raise exception 'Periodo non valido (max 31 giorni)'; end if;
  for a in select x.tecnico_id, greatest(x.dal, p_da) dal, least(x.al, p_a) al, max(x.al) over (partition by x.tecnico_id) fine
             from public.assenze x join public.tecnici tc on tc.id = x.tecnico_id and tc.attivo
            where x.dal <= p_a and x.al >= p_da loop
    d := a.dal;
    while d <= a.al loop
      s := privato.giornata_tappe(a.tecnico_id, d);
      compiti := compiti || coalesce((select jsonb_agg(e || jsonb_build_object('data', d, 'tecnico_id', a.tecnico_id)) from jsonb_array_elements(s->'tappe') e), '[]');
      d := d + 1;
    end loop;
    if not rientri ? a.tecnico_id::text then
      ri := public.prossimo_lavorativo(a.fine); lib := null; k := 0;
      while lib is null and k < 30 loop
        if not exists (select 1 from public.assenze x where x.tecnico_id = a.tecnico_id and ri between x.dal and x.al)
           and jsonb_array_length(privato.giornata_tappe(a.tecnico_id, ri)->'tappe') = 0 then lib := ri; end if;
        ri := public.prossimo_lavorativo(ri); k := k + 1;
      end loop;
      rientri := rientri || jsonb_build_object(a.tecnico_id::text, jsonb_build_object('rientro', public.prossimo_lavorativo(a.fine), 'primo_libero', lib));
    end if;
  end loop;
  -- carico e posizione media dei tecnici presenti, per i giorni con attività da riassegnare
  for d in select distinct (e->>'data')::date from jsonb_array_elements(compiti) e loop
    for t in select tc.id from public.tecnici tc where tc.attivo
               and not exists (select 1 from public.assenze x where x.tecnico_id = tc.id and d between x.dal and x.al) loop
      s := privato.giornata_tappe(t.id, d);
      carico := carico || jsonb_build_array(jsonb_build_object('data', d, 'tecnico_id', t.id,
        'n', jsonb_array_length(s->'tappe'),
        'minuti', coalesce((select sum(privato.hm(e->>'partenza') - privato.hm(e->>'arrivo')) from jsonb_array_elements(s->'tappe') e), 0),
        'lat', (select avg((e->>'lat')::float8) from jsonb_array_elements(s->'tappe') e where jsonb_typeof(e->'lat') = 'number'),
        'lon', (select avg((e->>'lon')::float8) from jsonb_array_elements(s->'tappe') e where jsonb_typeof(e->'lon') = 'number')));
    end loop;
  end loop;
  return jsonb_build_object('compiti', compiti, 'carico', carico, 'rientri', rientri,
    'importati', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'cliente', i.cliente, 'comune', i.comune, 'cap', i.cap, 'via', i.via, 'civico', i.civico,
                              'tecnico_id', i.tecnico_id, 'tecnico_sigla', i.tecnico_sigla, 'stato', i.stato, 'lat', i.lat, 'lon', i.lon))
                           from public.interventi_importati i
                          where i.stato = 'pianificato' and not i.fuori_lazio
                            and exists (select 1 from public.assenze x where x.tecnico_id = i.tecnico_id and x.dal <= p_a and x.al >= p_da)
                            and date_trunc('month', i.data_riferimento) <= date_trunc('month', p_a) and date_trunc('month', i.data_riferimento) >= date_trunc('month', p_da)), '[]'),
    'cap_zone', coalesce((select jsonb_object_agg(z.cap, s2.dipendente_id) from public.cap_zone z join public.tecnici_sigle s2 on s2.sigla = z.tecnico_sigla where s2.dipendente_id is not null), '{}'),
    'tecnici', coalesce((select jsonb_agg(jsonb_build_object('id', tc.id, 'nome', tc.nome || ' ' || tc.cognome,
                            'sigla', (select ts.sigla from public.tecnici_sigle ts where ts.dipendente_id = tc.id order by ts.sigla limit 1)) order by tc.cognome)
                          from public.tecnici tc where tc.attivo), '[]'));
end $$;

-- p_azioni: [{tipo:'tappa', data, tecnico_id, key, azione:'assegna'|'rimanda'|'lascia', a_tecnico?, a_data?} | {tipo:'importato', id, azione:'assegna'|'lascia', a_tecnico?}]
create or replace function public.variazioni_applica(p_azioni jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m jsonb; n int := 0; sig text;
begin
  perform public.richiedi_responsabile();
  for m in select * from jsonb_array_elements(coalesce(p_azioni, '[]')) loop
    if m->>'tipo' = 'importato' then
      if m->>'azione' = 'assegna' then
        select ts.sigla into sig from public.tecnici_sigle ts where ts.dipendente_id = (m->>'a_tecnico')::bigint order by ts.sigla limit 1;
        if sig is null then raise exception 'Il tecnico scelto non ha una sigla Taylor'; end if;
        update public.interventi_importati set tecnico_sigla = sig where id = (m->>'id')::bigint;
      elsif m->>'azione' = 'lascia' then
        update public.interventi_importati set stato = 'da_pianificare' where id = (m->>'id')::bigint;
      end if;
    elsif m->>'azione' = 'assegna' then
      perform privato.sposta_tappa((m->>'tecnico_id')::bigint, (m->>'data')::date, m->>'key', (m->>'a_tecnico')::bigint, (m->>'data')::date);
    elsif m->>'azione' = 'rimanda' then
      perform privato.sposta_tappa((m->>'tecnico_id')::bigint, (m->>'data')::date, m->>'key', (m->>'tecnico_id')::bigint, (m->>'a_data')::date);
    elsif m->>'azione' = 'lascia' then
      insert into public.da_ripianificare (data, tecnico_id, stop_key, luogo, attivita, origine)
      select (m->>'data')::date, (m->>'tecnico_id')::bigint, m->>'key', m->>'luogo', m->>'attivita', 'assenza'
       where not exists (select 1 from public.da_ripianificare r where r.stop_key = m->>'key' and r.data = (m->>'data')::date and r.stato = 'aperto');
    else continue;
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'applicate', n, 'da_inviare', (select count(*) from public.variazioni_da_inviare where inviato_at is null));
end $$;

create or replace function public.variazioni_invia_aggiornamenti() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g record; n int := 0; mitt text;
begin
  perform public.richiedi_responsabile();
  select r.nome into mitt from public.responsabili r where r.user_id = auth.uid();
  for g in select tecnico_id, array_agg(id) ids, string_agg(testo, E'\n' order by data, id) testi, min(data) dal
             from public.variazioni_da_inviare where inviato_at is null group by tecnico_id loop
    insert into public.notifiche (tecnico_id, tipo, dati, link)
    values (g.tecnico_id, 'avviso', jsonb_strip_nulls(jsonb_build_object('livello', 'importante', 'evento', 'aggiornamento_piano', 'titolo', 'Piano aggiornato', 'testo', g.testi, 'da', mitt)), '/t');
    update public.variazioni_da_inviare set inviato_at = now() where id = any(g.ids);
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'tecnici', n);
end $$;

-- Report «Ritardi» e «Giornate»
create or replace function public.report_variazioni(p_tipo text, p_da date, p_a date, p_tecnico bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  if p_tipo = 'ritardi' then
    return jsonb_build_object('righe', coalesce((select jsonb_agg(jsonb_build_object('data', r.data, 'tecnico', tc.nome || ' ' || tc.cognome,
        'motivo', case r.motivo when 'cliente' then 'Il cliente ha chiesto di aspettare' when 'tempo' then 'Intervento più lungo' when 'traffico' then 'Traffico' when 'veicolo' then 'Problema al veicolo' else 'Altro' end,
        'minuti', r.minuti, 'nota', r.nota, 'alle', r.created_at, 'fine_stimata', r.fine_stimata) order by tc.cognome, r.data, r.id)
      from public.ritardi r join public.tecnici tc on tc.id = r.tecnico_id
      where r.data between p_da and p_a and (p_tecnico is null or r.tecnico_id = p_tecnico)), '[]'));
  elsif p_tipo = 'giornate' then
    return jsonb_build_object('righe', coalesce((select jsonb_agg(jsonb_build_object('data', g.data, 'tecnico', tc.nome || ' ' || tc.cognome,
        'fine', to_char(g.fine_at at time zone 'Europe/Rome', 'HH24:MI'), 'tutto_fatto', case when g.tutto_fatto then 'Sì' else 'No' end,
        'non_fatti', jsonb_array_length(g.non_fatti), 'ritardi', (select count(*) from public.ritardi r where r.tecnico_id = g.tecnico_id and r.data = g.data),
        'minuti_ritardo', (select coalesce(sum(minuti), 0) from public.ritardi r where r.tecnico_id = g.tecnico_id and r.data = g.data), 'nota', g.nota) order by tc.cognome, g.data)
      from public.giornate_lavoro g join public.tecnici tc on tc.id = g.tecnico_id
      where g.data between p_da and p_a and (p_tecnico is null or g.tecnico_id = p_tecnico)), '[]'));
  end if;
  raise exception 'Report non valido';
end $$;

-- Permessi
do $$ declare f text; begin
  foreach f in array array['tecnico_giornata(text)', 'tecnico_segnala_ritardo(text,text,text,int,text)', 'tecnico_giornata_finita(text,boolean,text[],text)', 'tecnico_urgenza_letta(text,bigint)'] loop
    execute format('revoke execute on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated', f);
  end loop;
  foreach f in array array['variazioni_giornata(date)', 'variazioni_imposta_soglia(time)',
      'variazioni_crea_urgenza(date,bigint,text,text,text,text,double precision,double precision,text,int,text,text,text,int,int,bigint,jsonb)',
      'variazioni_invia_urgenza(bigint)', 'variazioni_annulla_urgenza(bigint)', 'variazioni_ripianificato(bigint)', 'variazioni_indisponibile(bigint,date,date)',
      'variazioni_da_riassegnare(date,date)', 'variazioni_applica(jsonb)', 'variazioni_invia_aggiornamenti()', 'report_variazioni(text,date,date,bigint)'] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
