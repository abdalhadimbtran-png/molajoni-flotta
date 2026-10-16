-- Molajoni · Gestione flotta — schema iniziale
-- Regole: i km e il veicolo in carico cambiano SOLO tramite movimenti (funzioni),
-- movimenti e segnalazioni non si cancellano, ogni modifica anagrafica va nell'audit.

create extension if not exists pgcrypto with schema extensions;

-- ===================== Utilità =====================
create or replace function public.oggi() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'Europe/Rome')::date;
$$;

create or replace function public.prossimo_lavorativo(p_da date) returns date
language plpgsql immutable set search_path = '' as $$
declare d date := p_da + 1;
begin
  while extract(isodow from d) in (6,7) loop d := d + 1; end loop;
  return d;
end $$;

create or replace function public.fmt_km(n int) returns text
language sql immutable set search_path = '' as $$
  select replace(to_char(n, 'FM999,999,999'), ',', '.');
$$;

-- ===================== Responsabili (accesso gestionale) =====================
create table public.responsabili (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  creato_il timestamptz not null default now()
);

create or replace function public.is_responsabile() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.responsabili r where r.user_id = auth.uid());
$$;

create or replace function public.richiedi_responsabile() returns void
language plpgsql stable set search_path = '' as $$
begin
  if not public.is_responsabile() then
    raise exception 'Accesso riservato al responsabile flotta' using errcode = '42501';
  end if;
end $$;

-- ===================== Anagrafiche =====================
create table public.tecnici (
  id bigint generated always as identity primary key,
  codice text not null unique check (codice ~ '^[A-Z0-9]{2,12}$'),
  nome text not null check (length(trim(nome)) > 0),
  cognome text not null check (length(trim(cognome)) > 0),
  ruolo text,
  telefono text,
  patente_categoria text,
  patente_scadenza date,
  attivo boolean not null default true,
  pin_hash text,
  ha_pin boolean generated always as (pin_hash is not null) stored,
  tentativi_falliti int not null default 0,
  bloccato_fino timestamptz,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create table public.veicoli (
  id bigint generated always as identity primary key,
  targa text not null unique check (targa ~ '^[A-Z0-9 ]{5,10}$'),
  marca_modello text not null check (length(trim(marca_modello)) > 0),
  tipo text,
  proprieta text check (proprieta in ('proprieta','noleggio','leasing')),
  km_attuali int not null default 0 check (km_attuali >= 0),
  km_prossimo_tagliando int check (km_prossimo_tagliando >= 0),
  scad_assicurazione date,
  scad_revisione date,
  scad_bollo date,
  tecnico_in_carico bigint references public.tecnici(id),
  in_carico_dal timestamptz,
  in_officina boolean not null default false,
  dismesso boolean not null default false,
  qr_token text not null unique default encode(extensions.gen_random_bytes(12), 'hex'),
  note text,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

create table public.movimenti (
  id bigint generated always as identity primary key,
  veicolo_id bigint not null references public.veicoli(id),
  tecnico_id bigint references public.tecnici(id),
  tipo text not null check (tipo in ('presa','riconsegna','lettura_km','rettifica')),
  km int not null check (km >= 0),
  km_precedenti int not null,
  carburante text check (carburante in ('riserva','1/4','1/2','3/4','pieno')),
  danni_dichiarati boolean not null default false,
  note text,
  registrato_da text not null check (registrato_da in ('tecnico','responsabile')),
  responsabile_id uuid references auth.users(id),
  creato_il timestamptz not null default now()
);
create index on public.movimenti (veicolo_id, creato_il desc);
create index on public.movimenti (tecnico_id, creato_il desc);

create table public.segnalazioni (
  id bigint generated always as identity primary key,
  veicolo_id bigint not null references public.veicoli(id),
  tecnico_id bigint references public.tecnici(id),
  categoria text not null check (categoria in ('guasto_meccanico','spia_accesa','pneumatici','danno_carrozzeria','incidente','dotazioni','pulizia','altro')),
  gravita text not null check (gravita in ('utilizzabile','da_verificare','fermo')),
  descrizione text not null check (length(trim(descrizione)) >= 5),
  stato text not null default 'aperta' check (stato in ('aperta','in_lavorazione','chiusa')),
  nota_chiusura text,
  chiusa_il timestamptz,
  chiusa_da uuid references auth.users(id),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  constraint chiusura_con_nota check (stato <> 'chiusa' or length(trim(coalesce(nota_chiusura,''))) > 0)
);
create index on public.segnalazioni (veicolo_id) where stato <> 'chiusa';

-- ===================== Pianificazione =====================
create table public.interventi (
  id bigint generated always as identity primary key,
  data date not null,
  tecnico_id bigint not null references public.tecnici(id),
  ora time,
  luogo text not null check (length(trim(luogo)) > 0),
  attivita text not null check (length(trim(attivita)) > 0),
  note text,
  creato_il timestamptz not null default now()
);
create index on public.interventi (data, tecnico_id);

create table public.assenze (
  id bigint generated always as identity primary key,
  tecnico_id bigint not null references public.tecnici(id),
  dal date not null,
  al date not null,
  motivo text not null default 'Assenza',
  creato_il timestamptz not null default now(),
  check (al >= dal)
);
create index on public.assenze (tecnico_id, dal, al);

create table public.assegnazioni (
  id bigint generated always as identity primary key,
  data date not null,
  tecnico_id bigint not null references public.tecnici(id),
  veicolo_id bigint references public.veicoli(id),
  aggiornato_il timestamptz not null default now(),
  unique (data, tecnico_id)
);

create table public.piani (
  data date primary key,
  confermato_il timestamptz not null default now(),
  confermato_da uuid references auth.users(id)
);

-- ===================== Sessioni tecnico (accesso con codice + PIN) =====================
create table public.sessioni_tecnico (
  token_hash text primary key,
  tecnico_id bigint not null references public.tecnici(id),
  creato_il timestamptz not null default now(),
  scade_il timestamptz not null,
  revocata boolean not null default false
);

-- ===================== Audit =====================
create table public.audit_log (
  id bigint generated always as identity primary key,
  tabella text not null,
  record_id text,
  azione text not null,
  prima jsonb,
  dopo jsonb,
  utente uuid,
  creato_il timestamptz not null default now()
);

create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare o jsonb; n jsonb; esclusi text[] := coalesce(TG_ARGV::text[], '{}');
begin
  if TG_OP <> 'INSERT' then o := to_jsonb(old) - esclusi - 'pin_hash'; end if;
  if TG_OP <> 'DELETE' then n := to_jsonb(new) - esclusi - 'pin_hash'; end if;
  if TG_OP = 'UPDATE' and o = n then return new; end if;
  insert into public.audit_log (tabella, record_id, azione, prima, dopo, utente)
  values (TG_TABLE_NAME, coalesce(n->>'id', o->>'id', n->>'data', o->>'data'), TG_OP, o, n, auth.uid());
  return coalesce(new, old);
end $$;

create trigger audit_tecnici after insert or update or delete on public.tecnici
  for each row execute function public.tg_audit('tentativi_falliti','bloccato_fino','aggiornato_il','ha_pin');
create trigger audit_veicoli after insert or update or delete on public.veicoli
  for each row execute function public.tg_audit('aggiornato_il');
create trigger audit_segnalazioni after update on public.segnalazioni
  for each row execute function public.tg_audit('aggiornato_il');
create trigger audit_assegnazioni after insert or update or delete on public.assegnazioni
  for each row execute function public.tg_audit('aggiornato_il');
create trigger audit_assenze after insert or update or delete on public.assenze
  for each row execute function public.tg_audit();

create or replace function public.tg_aggiornato() returns trigger
language plpgsql set search_path = '' as $$
begin new.aggiornato_il := now(); return new; end $$;
create trigger upd_tecnici before update on public.tecnici for each row execute function public.tg_aggiornato();
create trigger upd_veicoli before update on public.veicoli for each row execute function public.tg_aggiornato();
create trigger upd_segnalazioni before update on public.segnalazioni for each row execute function public.tg_aggiornato();

-- Chiusura segnalazione: chi e quando
create or replace function public.tg_segnalazione_stato() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stato = 'chiusa' and old.stato <> 'chiusa' then
    new.chiusa_il := now(); new.chiusa_da := auth.uid();
  elsif new.stato <> 'chiusa' then
    new.chiusa_il := null; new.chiusa_da := null;
  end if;
  return new;
end $$;
create trigger stato_segnalazioni before update on public.segnalazioni
  for each row execute function public.tg_segnalazione_stato();

-- Ogni modifica a interventi/assegnazioni/assenze annulla la conferma del piano di quel giorno
create or replace function public.tg_annulla_piano() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if TG_TABLE_NAME = 'assenze' then
    delete from public.piani p where p.data between least(coalesce(new.dal,old.dal), coalesce(old.dal,new.dal))
                                               and greatest(coalesce(new.al,old.al), coalesce(old.al,new.al));
  else
    delete from public.piani p where p.data in (coalesce(new.data, old.data), coalesce(old.data, new.data));
  end if;
  return coalesce(new, old);
end $$;
create trigger piano_interventi after insert or update or delete on public.interventi for each row execute function public.tg_annulla_piano();
create trigger piano_assegnazioni after insert or update or delete on public.assegnazioni for each row execute function public.tg_annulla_piano();
create trigger piano_assenze after insert or update or delete on public.assenze for each row execute function public.tg_annulla_piano();

-- ===================== Controlli (unica fonte delle regole) =====================
create or replace function public.controlli_veicolo(p_veicolo bigint, p_data date default null)
returns table (livello text, messaggio text)
language plpgsql stable set search_path = '' as $$
declare v public.veicoli; d date := coalesce(p_data, public.oggi()); n int; diff int;
begin
  select * into v from public.veicoli where id = p_veicolo;
  if not found then return; end if;
  if v.dismesso then livello := 'ko'; messaggio := 'Veicolo dismesso'; return next; end if;
  if v.in_officina then livello := 'ko'; messaggio := 'In officina'; return next; end if;
  select count(*) into n from public.segnalazioni s where s.veicolo_id = v.id and s.stato <> 'chiusa' and s.gravita = 'fermo';
  if n > 0 then livello := 'ko'; messaggio := 'Fermo per segnalazione aperta'; return next; end if;

  if v.scad_assicurazione is null then livello := 'warn'; messaggio := 'Scadenza assicurazione non registrata'; return next;
  elsif v.scad_assicurazione < d then livello := 'ko'; messaggio := 'Assicurazione scaduta il ' || to_char(v.scad_assicurazione,'DD/MM/YYYY'); return next;
  elsif v.scad_assicurazione <= d + 30 then livello := 'warn'; messaggio := 'Assicurazione in scadenza il ' || to_char(v.scad_assicurazione,'DD/MM/YYYY'); return next;
  end if;

  if v.scad_revisione is null then livello := 'warn'; messaggio := 'Scadenza revisione non registrata'; return next;
  elsif v.scad_revisione < d then livello := 'ko'; messaggio := 'Revisione scaduta il ' || to_char(v.scad_revisione,'DD/MM/YYYY'); return next;
  elsif v.scad_revisione <= d + 30 then livello := 'warn'; messaggio := 'Revisione in scadenza il ' || to_char(v.scad_revisione,'DD/MM/YYYY'); return next;
  end if;

  if v.scad_bollo is not null then
    if v.scad_bollo < d then livello := 'warn'; messaggio := 'Bollo scaduto il ' || to_char(v.scad_bollo,'DD/MM/YYYY'); return next;
    elsif v.scad_bollo <= d + 30 then livello := 'warn'; messaggio := 'Bollo in scadenza il ' || to_char(v.scad_bollo,'DD/MM/YYYY'); return next;
    end if;
  end if;

  if v.km_prossimo_tagliando is not null then
    diff := v.km_prossimo_tagliando - v.km_attuali;
    if diff < 0 then livello := 'warn'; messaggio := 'Tagliando superato di ' || public.fmt_km(-diff) || ' km'; return next;
    elsif diff <= 1500 then livello := 'warn'; messaggio := 'Tagliando tra ' || public.fmt_km(diff) || ' km'; return next;
    end if;
  end if;

  select count(*) into n from public.segnalazioni s where s.veicolo_id = v.id and s.stato <> 'chiusa' and s.gravita = 'da_verificare';
  if n > 0 then livello := 'warn'; messaggio := n || case when n = 1 then ' segnalazione da verificare' else ' segnalazioni da verificare' end; return next; end if;
end $$;

create or replace function public.controlli_tecnico(p_tecnico bigint, p_data date default null)
returns table (livello text, messaggio text)
language plpgsql stable security definer set search_path = '' as $$
declare t public.tecnici; d date := coalesce(p_data, public.oggi()); mot text;
begin
  select * into t from public.tecnici where id = p_tecnico;
  if not found then return; end if;
  if not t.attivo then livello := 'ko'; messaggio := 'Tecnico non attivo'; return next; end if;
  select a.motivo into mot from public.assenze a where a.tecnico_id = t.id and d between a.dal and a.al limit 1;
  if mot is not null then livello := 'ko'; messaggio := 'Assente: ' || mot; return next; end if;
  if t.patente_scadenza is null then livello := 'warn'; messaggio := 'Scadenza patente non registrata'; return next;
  elsif t.patente_scadenza < d then livello := 'ko'; messaggio := 'Patente scaduta il ' || to_char(t.patente_scadenza,'DD/MM/YYYY') || ': non può guidare'; return next;
  elsif t.patente_scadenza <= d + 30 then livello := 'warn'; messaggio := 'Patente in scadenza il ' || to_char(t.patente_scadenza,'DD/MM/YYYY'); return next;
  end if;
end $$;

-- Vista flotta per il responsabile
create or replace view public.v_veicoli with (security_invoker = true) as
select v.*,
  t.nome || ' ' || t.cognome as in_carico_nome,
  coalesce((select jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) from public.controlli_veicolo(v.id) c), '[]'::jsonb) as controlli,
  case
    when v.dismesso then 'dismesso'
    when v.in_officina or exists (select 1 from public.segnalazioni s where s.veicolo_id = v.id and s.stato <> 'chiusa' and s.gravita = 'fermo') then 'fermo'
    when exists (select 1 from public.controlli_veicolo(v.id) c where c.livello = 'ko') then 'non_utilizzabile'
    when v.tecnico_in_carico is not null then 'in_uso'
    else 'disponibile'
  end as stato
from public.veicoli v
left join public.tecnici t on t.id = v.tecnico_in_carico;

-- ===================== Pianificazione: funzioni responsabile =====================
create or replace function public.piano_giorno(p_data date) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  t record; r record; a record; v public.veicoli; conf public.piani;
  ints jsonb; ass text; vid bigint; msgs jsonb; primo text; liv text; righe jsonb := '[]';
begin
  perform public.richiedi_responsabile();
  for t in select id, codice, nome, cognome, ruolo, patente_categoria from public.tecnici where attivo order by cognome, nome loop
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'ora', to_char(i.ora,'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita, 'note', i.note)
             order by i.ora nulls last, i.id), '[]') into ints
      from public.interventi i where i.tecnico_id = t.id and i.data = p_data;
    ass := null; vid := null;
    select x.motivo into ass from public.assenze x where x.tecnico_id = t.id and p_data between x.dal and x.al limit 1;
    select g.veicolo_id into vid from public.assegnazioni g where g.tecnico_id = t.id and g.data = p_data;
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
    liv := case
      when msgs @> '[{"l":"ko"}]' then 'ko'
      when msgs @> '[{"l":"warn"}]' then 'warn'
      when ass is null and jsonb_array_length(ints) > 0 then 'ok'
      else 'na' end;
    if liv = 'ok' then msgs := msgs || jsonb_build_object('l','ok','m','Idoneo'); end if;
    righe := righe || jsonb_build_object(
      'tecnico_id', t.id, 'nome', t.nome || ' ' || t.cognome, 'codice', t.codice, 'ruolo', t.ruolo,
      'patente', t.patente_categoria, 'assenza', ass, 'interventi', ints, 'veicolo_id', vid,
      'livello', liv, 'messaggi', msgs, 'prima_ora', ints->0->>'ora');
  end loop;
  select * into conf from public.piani where data = p_data;
  return jsonb_build_object('data', p_data, 'confermato_il', conf.confermato_il, 'righe', righe);
end $$;

create or replace function public.proponi_assegnazioni(p_data date) returns jsonb
language plpgsql set search_path = '' as $$
declare t record; vid bigint; cand bigint; cambi int := 0; senza text[] := '{}';
begin
  perform public.richiedi_responsabile();
  for t in
    select tt.id, tt.nome || ' ' || tt.cognome as nome, min(i.ora) as prima
      from public.tecnici tt join public.interventi i on i.tecnico_id = tt.id and i.data = p_data
     where tt.attivo and not exists (select 1 from public.assenze x where x.tecnico_id = tt.id and p_data between x.dal and x.al)
     group by tt.id order by min(i.ora) nulls last, tt.id
  loop
    vid := null;
    select g.veicolo_id into vid from public.assegnazioni g where g.data = p_data and g.tecnico_id = t.id;
    if vid is not null and not exists (select 1 from public.controlli_veicolo(vid, p_data) c where c.livello = 'ko') then continue; end if;
    if exists (select 1 from public.controlli_tecnico(t.id, p_data) c where c.livello = 'ko') then continue; end if;
    cand := null;
    select v.id into cand from public.veicoli v
     where not v.dismesso
       and not exists (select 1 from public.controlli_veicolo(v.id, p_data) c where c.livello = 'ko')
       and not exists (select 1 from public.assegnazioni g where g.data = p_data and g.veicolo_id = v.id and g.tecnico_id <> t.id)
       and (v.tecnico_in_carico is null or v.tecnico_in_carico = t.id
            or exists (select 1 from public.assenze x where x.tecnico_id = v.tecnico_in_carico and p_data between x.dal and x.al)
            or not exists (select 1 from public.interventi i where i.tecnico_id = v.tecnico_in_carico and i.data = p_data))
     order by case when v.tecnico_in_carico = t.id then 0 when v.tecnico_in_carico is null then 1 else 2 end, v.id
     limit 1;
    insert into public.assegnazioni (data, tecnico_id, veicolo_id) values (p_data, t.id, cand)
      on conflict (data, tecnico_id) do update set veicolo_id = excluded.veicolo_id, aggiornato_il = now();
    if cand is null then senza := senza || t.nome; else cambi := cambi + 1; end if;
  end loop;
  return jsonb_build_object('cambi', cambi, 'senza_veicolo', to_jsonb(senza));
end $$;

create or replace function public.conferma_piano(p_data date) returns jsonb
language plpgsql set search_path = '' as $$
declare p jsonb; bloccati text[];
begin
  perform public.richiedi_responsabile();
  p := public.piano_giorno(p_data);
  select coalesce(array_agg(r->>'nome'), '{}') into bloccati from jsonb_array_elements(p->'righe') r where r->>'livello' = 'ko';
  if array_length(bloccati, 1) > 0 then
    return jsonb_build_object('ok', false, 'bloccati', to_jsonb(bloccati));
  end if;
  insert into public.piani (data, confermato_il, confermato_da) values (p_data, now(), auth.uid())
    on conflict (data) do update set confermato_il = now(), confermato_da = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- ===================== Funzioni responsabile su veicoli =====================
create or replace function public.movimento_responsabile(p_veicolo bigint, p_tipo text, p_km int, p_tecnico bigint default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.veicoli;
begin
  perform public.richiedi_responsabile();
  select * into v from public.veicoli where id = p_veicolo for update;
  if not found then raise exception 'Veicolo non trovato'; end if;
  if p_km is null or p_km < 0 then raise exception 'Km non validi'; end if;
  if p_tipo = 'rettifica' then
    if length(trim(coalesce(p_note,''))) < 5 then raise exception 'La rettifica richiede una nota con il motivo'; end if;
  elsif p_km < v.km_attuali then
    raise exception 'I km non possono essere inferiori all''ultima lettura (% km). Usa una rettifica con motivo.', public.fmt_km(v.km_attuali);
  end if;
  if p_tipo = 'presa' then
    if p_tecnico is null then raise exception 'Indica il tecnico che prende il veicolo'; end if;
    update public.veicoli set tecnico_in_carico = p_tecnico, in_carico_dal = now(), km_attuali = p_km where id = v.id;
  elsif p_tipo = 'riconsegna' then
    if v.tecnico_in_carico is null then raise exception 'Il veicolo risulta già in sede'; end if;
    p_tecnico := v.tecnico_in_carico;
    update public.veicoli set tecnico_in_carico = null, in_carico_dal = null, km_attuali = p_km where id = v.id;
  elsif p_tipo = 'rettifica' then
    update public.veicoli set km_attuali = p_km where id = v.id;
  else
    raise exception 'Operazione non valida';
  end if;
  insert into public.movimenti (veicolo_id, tecnico_id, tipo, km, km_precedenti, note, registrato_da, responsabile_id)
  values (v.id, p_tecnico, p_tipo, p_km, v.km_attuali, nullif(trim(coalesce(p_note,'')),''), 'responsabile', auth.uid());
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.rigenera_qr(p_veicolo bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare t text := encode(extensions.gen_random_bytes(12), 'hex');
begin
  perform public.richiedi_responsabile();
  update public.veicoli set qr_token = t where id = p_veicolo;
  return t;
end $$;

create or replace function public.imposta_pin(p_tecnico bigint, p_pin text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  if p_pin !~ '^[0-9]{6}$' then raise exception 'Il PIN deve avere 6 cifre'; end if;
  update public.tecnici set pin_hash = extensions.crypt(p_pin, extensions.gen_salt('bf')), tentativi_falliti = 0, bloccato_fino = null where id = p_tecnico;
  update public.sessioni_tecnico set revocata = true where tecnico_id = p_tecnico;
end $$;

-- ===================== Funzioni tecnico (app QR) =====================
create or replace function public._tecnico_da_token(p_token text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare tid bigint;
begin
  select s.tecnico_id into tid from public.sessioni_tecnico s join public.tecnici t on t.id = s.tecnico_id
   where s.token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex')
     and s.scade_il > now() and not s.revocata and t.attivo;
  if tid is null then raise exception 'SESSIONE_NON_VALIDA'; end if;
  return tid;
end $$;

create or replace function public.tecnico_login(p_codice text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.tecnici; raw text;
begin
  select * into t from public.tecnici where codice = upper(trim(coalesce(p_codice,''))) and attivo for update;
  if not found or t.pin_hash is null then
    return jsonb_build_object('ok', false, 'errore', 'Codice o PIN non validi.');
  end if;
  if t.bloccato_fino is not null and t.bloccato_fino > now() then
    return jsonb_build_object('ok', false, 'errore', 'Troppi tentativi errati. Riprova dopo le ' || to_char(t.bloccato_fino at time zone 'Europe/Rome', 'HH24:MI') || ' o chiedi al responsabile flotta.');
  end if;
  if t.pin_hash <> extensions.crypt(coalesce(p_pin,''), t.pin_hash) then
    update public.tecnici set tentativi_falliti = tentativi_falliti + 1,
      bloccato_fino = case when tentativi_falliti + 1 >= 5 then now() + interval '15 minutes' else null end
     where id = t.id;
    return jsonb_build_object('ok', false, 'errore', 'Codice o PIN non validi.');
  end if;
  update public.tecnici set tentativi_falliti = 0, bloccato_fino = null where id = t.id;
  raw := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.sessioni_tecnico (token_hash, tecnico_id, scade_il)
  values (encode(extensions.digest(raw, 'sha256'), 'hex'), t.id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', raw, 'nome', t.nome || ' ' || t.cognome);
end $$;

create or replace function public.tecnico_logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  update public.sessioni_tecnico set revocata = true
   where token_hash = encode(extensions.digest(coalesce(p_token,''), 'sha256'), 'hex');
$$;

create or replace function public.tecnico_home(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); t public.tecnici; d date; giorni jsonb := '[]'; vid bigint;
begin
  select * into t from public.tecnici where id = tid;
  foreach d in array array[public.oggi(), public.prossimo_lavorativo(public.oggi())] loop
    vid := null;
    select g.veicolo_id into vid from public.assegnazioni g where g.tecnico_id = tid and g.data = d;
    giorni := giorni || jsonb_build_object(
      'data', d,
      'confermato', exists (select 1 from public.piani p where p.data = d),
      'assenza', (select x.motivo from public.assenze x where x.tecnico_id = tid and d between x.dal and x.al limit 1),
      'veicolo', (select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello) from public.veicoli v where v.id = vid),
      'interventi', coalesce((select jsonb_agg(jsonb_build_object('ora', to_char(i.ora,'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita) order by i.ora nulls last, i.id)
                              from public.interventi i where i.tecnico_id = tid and i.data = d), '[]'));
  end loop;
  return jsonb_build_object(
    'nome', t.nome || ' ' || t.cognome, 'codice', t.codice,
    'avvisi', coalesce((select jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) from public.controlli_tecnico(tid) c where c.messaggio not like 'Assente%'), '[]'),
    'in_carico', coalesce((select jsonb_agg(jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'km', v.km_attuali, 'dal', v.in_carico_dal, 'qr', v.qr_token))
                           from public.veicoli v where v.tecnico_in_carico = tid), '[]'),
    'giorni', giorni,
    'segnalazioni', coalesce((select jsonb_agg(jsonb_build_object('targa', v.targa, 'categoria', s.categoria, 'gravita', s.gravita, 'stato', s.stato, 'creato_il', s.creato_il) order by s.creato_il desc)
                              from public.segnalazioni s join public.veicoli v on v.id = s.veicolo_id
                              where s.tecnico_id = tid and (s.stato <> 'chiusa' or s.creato_il > now() - interval '14 days')), '[]'));
end $$;

create or replace function public.tecnico_veicolo(p_token text, p_qr text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli;
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso;
  if not found then raise exception 'Codice QR non riconosciuto. Avvisa il responsabile flotta.'; end if;
  return jsonb_build_object(
    'targa', v.targa, 'modello', v.marca_modello, 'km', v.km_attuali,
    'in_carico_a', (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico),
    'in_carico_a_me', v.tecnico_in_carico = tid,
    'utilizzabile', not exists (select 1 from public.controlli_veicolo(v.id) c where c.livello = 'ko'),
    'controlli', coalesce((select jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) from public.controlli_veicolo(v.id) c), '[]'));
end $$;

create or replace function public.tecnico_movimento(p_token text, p_qr text, p_tipo text, p_km int, p_carburante text, p_note text, p_danni boolean, p_conferma_km boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli; ko text; altro text; nota text := nullif(trim(coalesce(p_note,'')),'');
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso for update;
  if not found then raise exception 'Codice QR non riconosciuto.'; end if;
  if p_tipo not in ('presa','riconsegna','lettura_km') then raise exception 'Operazione non valida.'; end if;
  if p_carburante is not null and p_carburante not in ('riserva','1/4','1/2','3/4','pieno') then raise exception 'Livello carburante non valido.'; end if;
  if p_km is null or p_km < v.km_attuali then
    raise exception 'I km non possono essere inferiori all''ultima lettura (% km). Ricontrolla il cruscotto.', public.fmt_km(v.km_attuali);
  end if;
  if p_km - v.km_attuali > 1000 and not coalesce(p_conferma_km, false) then
    return jsonb_build_object('esito', 'conferma', 'messaggio',
      'Sono ' || public.fmt_km(p_km - v.km_attuali) || ' km in più dall''ultima lettura (' || public.fmt_km(v.km_attuali) || '). Se è corretto, conferma.');
  end if;

  if p_tipo = 'presa' then
    select string_agg(c.messaggio, '; ') into ko from public.controlli_veicolo(v.id) c where c.livello = 'ko';
    if ko is not null then raise exception 'Veicolo non utilizzabile: %. Contatta il responsabile flotta.', ko; end if;
    select string_agg(c.messaggio, '; ') into ko from public.controlli_tecnico(tid) c where c.livello = 'ko';
    if ko is not null then raise exception 'Non puoi prendere un veicolo: %. Contatta il responsabile flotta.', ko; end if;
    if v.tecnico_in_carico = tid then raise exception 'Il veicolo risulta già in carico a te.'; end if;
    select string_agg(x.targa, ', ') into altro from public.veicoli x where x.tecnico_in_carico = tid;
    if altro is not null then raise exception 'Hai già in carico %. Riconsegnalo prima di prendere un altro veicolo.', altro; end if;
    if v.tecnico_in_carico is not null then
      nota := concat_ws(' · ', 'Passaggio da ' || (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico), nota);
    end if;
    update public.veicoli set tecnico_in_carico = tid, in_carico_dal = now(), km_attuali = p_km where id = v.id;
  elsif p_tipo = 'riconsegna' then
    if v.tecnico_in_carico is distinct from tid then
      raise exception '%', case when v.tecnico_in_carico is null then 'Il veicolo risulta già in sede.'
        else 'Il veicolo risulta in carico a ' || (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = v.tecnico_in_carico) || ', non a te.' end;
    end if;
    update public.veicoli set tecnico_in_carico = null, in_carico_dal = null, km_attuali = p_km where id = v.id;
  else
    if v.tecnico_in_carico is distinct from tid then raise exception 'Puoi aggiornare i km solo di un veicolo in carico a te.'; end if;
    update public.veicoli set km_attuali = p_km where id = v.id;
  end if;

  insert into public.movimenti (veicolo_id, tecnico_id, tipo, km, km_precedenti, carburante, danni_dichiarati, note, registrato_da)
  values (v.id, tid, p_tipo, p_km, v.km_attuali, p_carburante, coalesce(p_danni, false), nota, 'tecnico');

  return jsonb_build_object('esito', 'ok', 'messaggio',
    case p_tipo when 'presa' then 'Presa in carico registrata: ' || v.targa || ', ' || public.fmt_km(p_km) || ' km.'
                when 'riconsegna' then 'Riconsegna registrata: ' || v.targa || ', ' || public.fmt_km(p_km) || ' km. Grazie.'
                else 'Km aggiornati: ' || public.fmt_km(p_km) || '.' end
    || case when coalesce(p_danni,false) then ' Hai indicato danni: invia ora una segnalazione.' else '' end);
end $$;

create or replace function public.tecnico_segnalazione(p_token text, p_qr text, p_categoria text, p_gravita text, p_descrizione text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli;
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso;
  if not found then raise exception 'Codice QR non riconosciuto.'; end if;
  if length(trim(coalesce(p_descrizione,''))) < 5 then raise exception 'Descrivi il problema in poche parole.'; end if;
  insert into public.segnalazioni (veicolo_id, tecnico_id, categoria, gravita, descrizione)
  values (v.id, tid, p_categoria, p_gravita, trim(p_descrizione));
  return jsonb_build_object('esito', 'ok', 'messaggio',
    case when p_gravita = 'fermo'
      then 'Segnalazione inviata. ' || v.targa || ' è fermo: non verrà assegnato finché il responsabile flotta non chiude la segnalazione.'
      else 'Segnalazione inviata al responsabile flotta.' end);
end $$;

-- ===================== Sicurezza: RLS e permessi =====================
alter table public.responsabili enable row level security;
alter table public.tecnici enable row level security;
alter table public.veicoli enable row level security;
alter table public.movimenti enable row level security;
alter table public.segnalazioni enable row level security;
alter table public.interventi enable row level security;
alter table public.assenze enable row level security;
alter table public.assegnazioni enable row level security;
alter table public.piani enable row level security;
alter table public.sessioni_tecnico enable row level security;
alter table public.audit_log enable row level security;

-- Nessun accesso diretto alle tabelle per anon; il tecnico passa solo dalle funzioni.
revoke all on all tables in schema public from anon;
revoke all on all tables in schema public from authenticated;

create policy resp_self on public.responsabili for select to authenticated using (user_id = (select auth.uid()));

create policy resp_tecnici on public.tecnici for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select (id, codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo, ha_pin, tentativi_falliti, bloccato_fino, creato_il, aggiornato_il) on public.tecnici to authenticated;
grant insert (codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo) on public.tecnici to authenticated;
grant update (codice, nome, cognome, ruolo, telefono, patente_categoria, patente_scadenza, attivo, tentativi_falliti, bloccato_fino) on public.tecnici to authenticated;

create policy resp_veicoli on public.veicoli for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select on public.veicoli to authenticated;
grant insert (targa, marca_modello, tipo, proprieta, km_attuali, km_prossimo_tagliando, scad_assicurazione, scad_revisione, scad_bollo, in_officina, note) on public.veicoli to authenticated;
grant update (targa, marca_modello, tipo, proprieta, km_prossimo_tagliando, scad_assicurazione, scad_revisione, scad_bollo, in_officina, dismesso, note) on public.veicoli to authenticated;

create policy resp_movimenti on public.movimenti for select to authenticated using ((select public.is_responsabile()));
grant select on public.movimenti to authenticated;

create policy resp_segn_sel on public.segnalazioni for select to authenticated using ((select public.is_responsabile()));
create policy resp_segn_upd on public.segnalazioni for update to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select on public.segnalazioni to authenticated;
grant update (stato, nota_chiusura) on public.segnalazioni to authenticated;

create policy resp_interventi on public.interventi for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, update, delete on public.interventi to authenticated;
create policy resp_assenze on public.assenze for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, update, delete on public.assenze to authenticated;
create policy resp_assegnazioni on public.assegnazioni for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, update, delete on public.assegnazioni to authenticated;
create policy resp_piani on public.piani for select to authenticated using ((select public.is_responsabile()));
grant select on public.piani to authenticated;
create policy resp_audit on public.audit_log for select to authenticated using ((select public.is_responsabile()));
grant select on public.audit_log to authenticated;
grant select on public.responsabili to authenticated;
grant select on public.v_veicoli to authenticated;

-- Funzioni: di default eseguibili da tutti → si chiude tutto e si riapre solo il necessario
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.oggi(), public.prossimo_lavorativo(date), public.fmt_km(int), public.is_responsabile(), public.richiedi_responsabile(),
  public.controlli_veicolo(bigint, date), public.controlli_tecnico(bigint, date),
  public.piano_giorno(date), public.proponi_assegnazioni(date), public.conferma_piano(date),
  public.movimento_responsabile(bigint, text, int, bigint, text), public.rigenera_qr(bigint), public.imposta_pin(bigint, text)
  to authenticated;
grant execute on function public.tecnico_login(text, text), public.tecnico_logout(text), public.tecnico_home(text), public.tecnico_veicolo(text, text),
  public.tecnico_movimento(text, text, text, int, text, text, boolean, boolean), public.tecnico_segnalazione(text, text, text, text, text)
  to anon, authenticated;

alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
