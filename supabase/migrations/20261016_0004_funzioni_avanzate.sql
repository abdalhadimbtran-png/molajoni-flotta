-- Molajoni · Gestione flotta — funzioni avanzate
-- multe, notifiche (in app + push), foto segnalazioni, documenti e dotazioni di bordo,
-- carburante importato, previsione tagliando, report mensile.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ===================== Configurazione privata (mai esposta) =====================
create table public.config_privata (chiave text primary key, valore text not null);
alter table public.config_privata enable row level security;
revoke all on public.config_privata from anon, authenticated;
insert into public.config_privata values
  ('push_secret', encode(extensions.gen_random_bytes(24), 'hex')),
  ('funzioni_url', 'https://dhqvyxitcrbqwozgcgno.supabase.co/functions/v1/flotta');

-- ===================== Dotazioni di bordo =====================
create table public.dotazioni (
  id bigint generated always as identity primary key,
  veicolo_id bigint not null references public.veicoli(id),
  tipo text not null check (tipo in ('estintore','kit_primo_soccorso','triangolo','giubbotto','cassetta_attrezzi','altro')),
  descrizione text,
  matricola text,
  scadenza date,
  attiva boolean not null default true,
  note text,
  creato_il timestamptz not null default now()
);
create index on public.dotazioni (veicolo_id) where attiva;
create trigger audit_dotazioni after insert or update or delete on public.dotazioni for each row execute function public.tg_audit();

-- ===================== Documenti del veicolo =====================
create table public.documenti (
  id bigint generated always as identity primary key,
  veicolo_id bigint not null references public.veicoli(id),
  tipo text not null check (tipo in ('libretto','assicurazione','carta_verde','cid','altro')),
  titolo text not null,
  path text not null unique,
  mime text,
  dimensione int,
  caricato_il timestamptz not null default now(),
  caricato_da uuid references auth.users(id)
);
create index on public.documenti (veicolo_id);

-- ===================== Foto delle segnalazioni =====================
create table public.segnalazioni_foto (
  id bigint generated always as identity primary key,
  segnalazione_id bigint not null references public.segnalazioni(id),
  path text not null unique,
  creato_il timestamptz not null default now()
);
create index on public.segnalazioni_foto (segnalazione_id);

-- ===================== Multe =====================
create table public.multe (
  id bigint generated always as identity primary key,
  veicolo_id bigint not null references public.veicoli(id),
  data_ora_infrazione timestamptz not null,
  luogo text,
  ente text,
  numero_verbale text,
  importo numeric(10,2),
  decurtazione_punti boolean not null default false,
  data_ricezione date,
  scadenza_comunicazione date generated always as (case when decurtazione_punti and data_ricezione is not null then data_ricezione + 60 end) stored,
  tecnico_id bigint references public.tecnici(id),
  stato text not null default 'da_identificare' check (stato in ('da_identificare','da_comunicare','comunicata','pagata','contestata','chiusa')),
  data_comunicazione date,
  note text,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index on public.multe (veicolo_id, data_ora_infrazione);
create trigger upd_multe before update on public.multe for each row execute function public.tg_aggiornato();
create trigger audit_multe after insert or update or delete on public.multe for each row execute function public.tg_audit('aggiornato_il');

/** Chi aveva il veicolo in un dato momento, ricavato dal registro movimenti. */
create or replace function public.conducente_alle(p_veicolo bigint, p_ts timestamptz) returns jsonb
language plpgsql stable set search_path = '' as $$
declare m record; fine timestamptz;
begin
  perform public.richiedi_responsabile();
  select mv.tipo, mv.tecnico_id, mv.creato_il into m from public.movimenti mv
   where mv.veicolo_id = p_veicolo and mv.tipo in ('presa','riconsegna') and mv.creato_il <= p_ts
   order by mv.creato_il desc limit 1;
  if m.tipo is distinct from 'presa' then
    return jsonb_build_object('tecnico_id', null, 'esito', case when m.tipo is null then 'nessun_dato' else 'in_sede' end, 'dal', m.creato_il);
  end if;
  select mv.creato_il into fine from public.movimenti mv
   where mv.veicolo_id = p_veicolo and mv.tipo in ('presa','riconsegna') and mv.creato_il > p_ts order by mv.creato_il limit 1;
  return jsonb_build_object('tecnico_id', m.tecnico_id, 'esito', 'trovato',
    'nome', (select t.nome || ' ' || t.cognome from public.tecnici t where t.id = m.tecnico_id), 'dal', m.creato_il, 'al', fine);
end $$;

-- ===================== Carburante (import dal file della carta carburante) =====================
create table public.rifornimenti (
  id bigint generated always as identity primary key,
  veicolo_id bigint not null references public.veicoli(id),
  data date not null,
  litri numeric(10,2),
  importo numeric(10,2) not null,
  km int,
  prodotto text,
  fornitore text,
  riga_hash text not null unique,
  importazione text,
  importato_il timestamptz not null default now()
);
create index on public.rifornimenti (veicolo_id, data);

-- ===================== Notifiche =====================
create table public.notifiche (
  id bigint generated always as identity primary key,
  tecnico_id bigint references public.tecnici(id),
  user_id uuid references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('piano','segnalazione_fermo','segnalazione_risolta','scadenze')),
  dati jsonb not null default '{}',
  link text,
  creato_il timestamptz not null default now(),
  letta_il timestamptz,
  check ((tecnico_id is null) <> (user_id is null))
);
create index on public.notifiche (tecnico_id, creato_il desc);
create index on public.notifiche (user_id, creato_il desc);

create table public.push_iscrizioni (
  id bigint generated always as identity primary key,
  tecnico_id bigint references public.tecnici(id),
  user_id uuid references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  lingua text not null default 'it' check (lingua in ('it','ar')),
  creato_il timestamptz not null default now(),
  ultimo_errore text,
  check ((tecnico_id is null) <> (user_id is null))
);

-- Ogni nuova notifica chiede alla funzione server di inviare il push (best effort)
create or replace function public.tg_notifica_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u text; s text;
begin
  select valore into u from public.config_privata where chiave = 'funzioni_url';
  select valore into s from public.config_privata where chiave = 'push_secret';
  perform net.http_post(url := u || '/push', body := jsonb_build_object('id', new.id),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-flotta-secret', s), timeout_milliseconds := 5000);
  return new;
exception when others then
  return new;  -- il push non deve mai bloccare la notifica
end $$;
create trigger push_notifiche after insert on public.notifiche for each row execute function public.tg_notifica_push();

-- Segnalazione "veicolo fermo" o incidente → notifica ai responsabili
create or replace function public.tg_segnalazione_notifica() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v public.veicoli; nome text;
begin
  if TG_OP = 'INSERT' and (new.gravita = 'fermo' or new.categoria = 'incidente') then
    select * into v from public.veicoli where id = new.veicolo_id;
    select t.nome || ' ' || t.cognome into nome from public.tecnici t where t.id = new.tecnico_id;
    insert into public.notifiche (user_id, tipo, dati, link)
    select r.user_id, 'segnalazione_fermo',
      jsonb_build_object('targa', v.targa, 'categoria', new.categoria, 'gravita', new.gravita, 'descrizione', left(new.descrizione, 160), 'tecnico', nome),
      '/segnalazioni'
    from public.responsabili r;
  elsif TG_OP = 'UPDATE' and new.stato = 'chiusa' and old.stato <> 'chiusa' and new.tecnico_id is not null then
    select * into v from public.veicoli where id = new.veicolo_id;
    insert into public.notifiche (tecnico_id, tipo, dati, link)
    values (new.tecnico_id, 'segnalazione_risolta',
      jsonb_build_object('targa', v.targa, 'categoria', new.categoria, 'nota', new.nota_chiusura), '/t');
  end if;
  return new;
end $$;
create trigger notifica_segnalazioni after insert or update on public.segnalazioni for each row execute function public.tg_segnalazione_notifica();

-- ===================== Controlli: anche le dotazioni di bordo =====================
create or replace function public.controlli_veicolo(p_veicolo bigint, p_data date default null)
returns table (livello text, messaggio text)
language plpgsql stable set search_path = '' as $$
declare v public.veicoli; d date := coalesce(p_data, public.oggi()); n int; diff int; x record;
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

  for x in select dt.tipo, dt.scadenza from public.dotazioni dt where dt.veicolo_id = v.id and dt.attiva and dt.scadenza is not null and dt.scadenza <= d + 30 order by dt.scadenza loop
    livello := 'warn';
    messaggio := case when x.scadenza < d then 'Dotazione scaduta: ' else 'Dotazione in scadenza: ' end
      || case x.tipo when 'estintore' then 'estintore di bordo' when 'kit_primo_soccorso' then 'kit primo soccorso' when 'triangolo' then 'triangolo'
                     when 'giubbotto' then 'giubbotto' when 'cassetta_attrezzi' then 'cassetta attrezzi' else 'altro' end
      || ' (' || to_char(x.scadenza,'DD/MM/YYYY') || ')';
    return next;
  end loop;

  select count(*) into n from public.segnalazioni s where s.veicolo_id = v.id and s.stato <> 'chiusa' and s.gravita = 'da_verificare';
  if n > 0 then livello := 'warn'; messaggio := n || case when n = 1 then ' segnalazione da verificare' else ' segnalazioni da verificare' end; return next; end if;
end $$;

-- ===================== Previsione tagliando nella vista flotta =====================
create or replace function public.km_giornalieri(p_veicolo bigint) returns numeric
language sql stable set search_path = '' as $$
  select case when count(*) >= 2 and max(m.creato_il) - min(m.creato_il) >= interval '3 days'
    then round((max(m.km) - min(m.km))::numeric / (extract(epoch from max(m.creato_il) - min(m.creato_il)) / 86400), 1) end
  from public.movimenti m where m.veicolo_id = p_veicolo and m.creato_il > now() - interval '90 days' and m.tipo <> 'rettifica';
$$;

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
  end as stato,
  k.km_giorno,
  case when k.km_giorno > 0 and v.km_prossimo_tagliando > v.km_attuali
    then public.oggi() + ceil((v.km_prossimo_tagliando - v.km_attuali) / k.km_giorno)::int end as tagliando_previsto
from public.veicoli v
left join public.tecnici t on t.id = v.tecnico_in_carico
left join lateral (select public.km_giornalieri(v.id) as km_giorno) k on true;

-- ===================== Conferma piano: notifica a ogni tecnico =====================
create or replace function public.conferma_piano(p_data date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare p jsonb; bloccati text[]; r jsonb;
begin
  perform public.richiedi_responsabile();
  p := public.piano_giorno(p_data);
  select coalesce(array_agg(x->>'nome'), '{}') into bloccati from jsonb_array_elements(p->'righe') x where x->>'livello' = 'ko';
  if array_length(bloccati, 1) > 0 then
    return jsonb_build_object('ok', false, 'bloccati', to_jsonb(bloccati));
  end if;
  insert into public.piani (data, confermato_il, confermato_da) values (p_data, now(), auth.uid())
    on conflict (data) do update set confermato_il = now(), confermato_da = auth.uid();
  for r in select x from jsonb_array_elements(p->'righe') x
           where x->>'assenza' is null and (jsonb_array_length(x->'interventi') > 0 or x->>'veicolo_id' is not null) loop
    insert into public.notifiche (tecnico_id, tipo, dati, link)
    values ((r->>'tecnico_id')::bigint, 'piano', jsonb_build_object(
      'data', p_data,
      'veicolo', (select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello) from public.veicoli v where v.id = (r->>'veicolo_id')::bigint),
      'interventi', r->'interventi'), '/t');
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- ===================== Riepilogo scadenze settimanale ai responsabili =====================
create or replace function public.genera_notifiche_scadenze() returns void
language plpgsql security definer set search_path = '' as $$
declare sup int := 0; prox int := 0; elenco jsonb := '[]'; v record; c record;
begin
  for v in select id, targa from public.veicoli where not dismesso loop
    for c in select * from public.controlli_veicolo(v.id) loop
      if c.messaggio ~ '(scadut|superato)' then sup := sup + 1; elenco := elenco || to_jsonb(v.targa || ' · ' || c.messaggio);
      elsif c.messaggio ~ '(in scadenza|Tagliando tra)' then prox := prox + 1; elenco := elenco || to_jsonb(v.targa || ' · ' || c.messaggio);
      end if;
    end loop;
  end loop;
  select sup + count(*) filter (where patente_scadenza < public.oggi()), prox + count(*) filter (where patente_scadenza between public.oggi() and public.oggi() + 30)
    into sup, prox from public.tecnici where attivo;
  if sup + prox = 0 then return; end if;
  insert into public.notifiche (user_id, tipo, dati, link)
  select r.user_id, 'scadenze', jsonb_build_object('superate', sup, 'in_scadenza', prox, 'elenco', (select jsonb_agg(e) from (select e from jsonb_array_elements(elenco) e limit 8) z)), '/flotta'
  from public.responsabili r;
end $$;

select cron.schedule('flotta_scadenze_settimanali', '0 5 * * 1', $$select public.genera_notifiche_scadenze()$$);

-- ===================== Funzioni app tecnico: notifiche, push, foto, documenti =====================
create or replace function public.tecnico_notifiche(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'tipo', n.tipo, 'dati', n.dati, 'creato_il', n.creato_il, 'letta', n.letta_il is not null) order by n.creato_il desc)
    from (select * from public.notifiche where tecnico_id = tid order by creato_il desc limit 15) n), '[]');
end $$;

create or replace function public.tecnico_notifica_letta(p_token text, p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  update public.notifiche set letta_il = coalesce(letta_il, now()) where id = p_id and tecnico_id = tid;
end $$;

create or replace function public.tecnico_salva_push(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_lingua text) returns void
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  insert into public.push_iscrizioni (tecnico_id, endpoint, p256dh, auth, lingua)
  values (tid, p_endpoint, p_p256dh, p_auth, case when p_lingua = 'ar' then 'ar' else 'it' end)
  on conflict (endpoint) do update set tecnico_id = excluded.tecnico_id, user_id = null, p256dh = excluded.p256dh, auth = excluded.auth, lingua = excluded.lingua, ultimo_errore = null;
end $$;

create or replace function public.responsabile_salva_push(p_endpoint text, p_p256dh text, p_auth text, p_lingua text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.richiedi_responsabile();
  insert into public.push_iscrizioni (user_id, endpoint, p256dh, auth, lingua)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, case when p_lingua = 'ar' then 'ar' else 'it' end)
  on conflict (endpoint) do update set user_id = excluded.user_id, tecnico_id = null, p256dh = excluded.p256dh, auth = excluded.auth, lingua = excluded.lingua, ultimo_errore = null;
end $$;

-- La segnalazione restituisce anche il suo id (per collegare le foto)
create or replace function public.tecnico_segnalazione(p_token text, p_qr text, p_categoria text, p_gravita text, p_descrizione text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token); v public.veicoli; nid bigint;
begin
  select * into v from public.veicoli where qr_token = p_qr and not dismesso;
  if not found then raise exception 'Codice QR non riconosciuto.'; end if;
  if length(trim(coalesce(p_descrizione,''))) < 5 then raise exception 'Descrivi il problema in poche parole.'; end if;
  insert into public.segnalazioni (veicolo_id, tecnico_id, categoria, gravita, descrizione)
  values (v.id, tid, p_categoria, p_gravita, trim(p_descrizione)) returning id into nid;
  return jsonb_build_object('esito', 'ok', 'id', nid, 'messaggio',
    case when p_gravita = 'fermo'
      then 'Segnalazione inviata. ' || v.targa || ' è fermo: non verrà assegnato finché il responsabile flotta non chiude la segnalazione.'
      else 'Segnalazione inviata al responsabile flotta.' end);
end $$;

/** Usata solo dalla funzione server: il tecnico può aggiungere foto alla propria segnalazione recente (max 5). */
create or replace function public.tecnico_puo_caricare_foto(p_token text, p_segnalazione bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return exists (select 1 from public.segnalazioni s where s.id = p_segnalazione and s.tecnico_id = tid and s.creato_il > now() - interval '24 hours')
     and (select count(*) from public.segnalazioni_foto f where f.segnalazione_id = p_segnalazione) < 5;
end $$;

create or replace function public.tecnico_documenti(p_token text, p_qr text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'titolo', d.titolo) order by d.tipo, d.id)
    from public.documenti d join public.veicoli v on v.id = d.veicolo_id where v.qr_token = p_qr and not v.dismesso), '[]');
end $$;

/** Usata solo dalla funzione server: percorso del documento se il tecnico è autenticato. */
create or replace function public.tecnico_percorso_documento(p_token text, p_id bigint) returns text
language plpgsql security definer set search_path = '' as $$
declare tid bigint := public._tecnico_da_token(p_token);
begin
  return (select d.path from public.documenti d join public.veicoli v on v.id = d.veicolo_id where d.id = p_id and not v.dismesso);
end $$;

-- Home tecnico: anche nota di chiusura delle segnalazioni
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
      'veicolo', (select jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'qr', v.qr_token) from public.veicoli v where v.id = vid and not v.dismesso),
      'interventi', coalesce((select jsonb_agg(jsonb_build_object('ora', to_char(i.ora,'HH24:MI'), 'luogo', i.luogo, 'attivita', i.attivita) order by i.ora nulls last, i.id)
                              from public.interventi i where i.tecnico_id = tid and i.data = d), '[]'));
  end loop;
  return jsonb_build_object(
    'nome', t.nome || ' ' || t.cognome, 'codice', t.codice,
    'avvisi', coalesce((select jsonb_agg(jsonb_build_object('l', c.livello, 'm', c.messaggio)) from public.controlli_tecnico(tid) c where c.messaggio not like 'Assente%'), '[]'),
    'in_carico', coalesce((select jsonb_agg(jsonb_build_object('targa', v.targa, 'modello', v.marca_modello, 'km', v.km_attuali, 'dal', v.in_carico_dal, 'qr', v.qr_token))
                           from public.veicoli v where v.tecnico_in_carico = tid), '[]'),
    'giorni', giorni,
    'non_lette', (select count(*) from public.notifiche n where n.tecnico_id = tid and n.letta_il is null),
    'segnalazioni', coalesce((select jsonb_agg(jsonb_build_object('targa', v.targa, 'categoria', s.categoria, 'gravita', s.gravita, 'stato', s.stato,
                                'creato_il', s.creato_il, 'nota_chiusura', s.nota_chiusura, 'chiusa_il', s.chiusa_il) order by s.creato_il desc)
                              from public.segnalazioni s join public.veicoli v on v.id = s.veicolo_id
                              where s.tecnico_id = tid and (s.stato <> 'chiusa' or s.chiusa_il > now() - interval '14 days')), '[]'));
end $$;

-- ===================== Report mensile =====================
create or replace function public.report_mese(p_anno int, p_mese int) returns jsonb
language plpgsql stable set search_path = '' as $$
declare da timestamptz; a timestamptz; dd date := make_date(p_anno, p_mese, 1); ad date := (make_date(p_anno, p_mese, 1) + interval '1 month')::date; righe jsonb;
begin
  perform public.richiedi_responsabile();
  da := make_timestamptz(p_anno, p_mese, 1, 0, 0, 0, 'Europe/Rome');
  a := da + interval '1 month';
  select coalesce(jsonb_agg(r order by r->>'targa'), '[]') into righe from (
    select jsonb_build_object(
      'veicolo_id', v.id, 'targa', v.targa, 'modello', v.marca_modello,
      'km', greatest(0, coalesce((select max(m.km) from public.movimenti m where m.veicolo_id = v.id and m.creato_il >= da and m.creato_il < a), 0)
                 - coalesce((select m.km from public.movimenti m where m.veicolo_id = v.id and m.creato_il < da order by m.creato_il desc limit 1),
                            (select min(m.km) from public.movimenti m where m.veicolo_id = v.id and m.creato_il >= da and m.creato_il < a), 0)),
      'giorni_assegnato', (select count(distinct g.data) from public.assegnazioni g where g.veicolo_id = v.id and g.data >= dd and g.data < ad),
      'giorni_fermo', coalesce((select round(sum(extract(epoch from (least(coalesce(s.chiusa_il, now()), a) - greatest(s.creato_il, da))) / 86400)::numeric, 1)
                       from public.segnalazioni s where s.veicolo_id = v.id and s.gravita = 'fermo' and s.creato_il < a and coalesce(s.chiusa_il, now()) > da), 0),
      'segnalazioni', (select count(*) from public.segnalazioni s where s.veicolo_id = v.id and s.creato_il >= da and s.creato_il < a),
      'carburante_eur', coalesce((select sum(f.importo) from public.rifornimenti f where f.veicolo_id = v.id and f.data >= dd and f.data < ad), 0),
      'litri', coalesce((select sum(f.litri) from public.rifornimenti f where f.veicolo_id = v.id and f.data >= dd and f.data < ad), 0),
      'multe', (select count(*) from public.multe x where x.veicolo_id = v.id and x.data_ora_infrazione >= da and x.data_ora_infrazione < a),
      'multe_eur', coalesce((select sum(x.importo) from public.multe x where x.veicolo_id = v.id and x.data_ora_infrazione >= da and x.data_ora_infrazione < a), 0)
    ) r
    from public.veicoli v where not v.dismesso or exists (select 1 from public.movimenti m where m.veicolo_id = v.id and m.creato_il >= da and m.creato_il < a)
  ) z;
  return jsonb_build_object('anno', p_anno, 'mese', p_mese, 'righe', righe);
end $$;

-- ===================== Storage: foto e documenti (privati) =====================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('foto', 'foto', false, 8388608, array['image/jpeg','image/png','image/webp']),
  ('documenti', 'documenti', false, 15728640, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

create policy "responsabile legge foto" on storage.objects for select to authenticated
  using (bucket_id = 'foto' and (select public.is_responsabile()));
create policy "responsabile gestisce documenti" on storage.objects for all to authenticated
  using (bucket_id = 'documenti' and (select public.is_responsabile()))
  with check (bucket_id = 'documenti' and (select public.is_responsabile()));

-- ===================== Sicurezza nuove tabelle =====================
alter table public.dotazioni enable row level security;
alter table public.documenti enable row level security;
alter table public.segnalazioni_foto enable row level security;
alter table public.multe enable row level security;
alter table public.rifornimenti enable row level security;
alter table public.notifiche enable row level security;
alter table public.push_iscrizioni enable row level security;
revoke all on public.dotazioni, public.documenti, public.segnalazioni_foto, public.multe, public.rifornimenti, public.notifiche, public.push_iscrizioni from anon, authenticated;

create policy resp_dotazioni on public.dotazioni for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, update, delete on public.dotazioni to authenticated;
create policy resp_documenti on public.documenti for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, delete on public.documenti to authenticated;
create policy resp_foto on public.segnalazioni_foto for select to authenticated using ((select public.is_responsabile()));
grant select on public.segnalazioni_foto to authenticated;
create policy resp_multe on public.multe for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, update on public.multe to authenticated;
create policy resp_rifornimenti on public.rifornimenti for all to authenticated using ((select public.is_responsabile())) with check ((select public.is_responsabile()));
grant select, insert, delete on public.rifornimenti to authenticated;
create policy resp_notifiche_sel on public.notifiche for select to authenticated
  using (user_id = (select auth.uid()) or (tecnico_id is not null and (select public.is_responsabile())));
create policy resp_notifiche_upd on public.notifiche for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select on public.notifiche to authenticated;
grant update (letta_il) on public.notifiche to authenticated;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.oggi(), public.prossimo_lavorativo(date), public.fmt_km(int), public.is_responsabile(), public.richiedi_responsabile(),
  public.controlli_veicolo(bigint, date), public.controlli_tecnico(bigint, date), public.km_giornalieri(bigint),
  public.piano_giorno(date), public.proponi_assegnazioni(date), public.conferma_piano(date),
  public.movimento_responsabile(bigint, text, int, bigint, text), public.rigenera_qr(bigint), public.imposta_pin(bigint, text),
  public.conducente_alle(bigint, timestamptz), public.report_mese(int, int), public.responsabile_salva_push(text, text, text, text)
  to authenticated;
grant execute on function public.tecnico_login(text, text), public.tecnico_logout(text), public.tecnico_home(text), public.tecnico_veicolo(text, text),
  public.tecnico_elenco_veicoli(text), public.tecnico_movimento(text, text, text, int, text, text, boolean, boolean),
  public.tecnico_segnalazione(text, text, text, text, text), public.tecnico_notifiche(text), public.tecnico_notifica_letta(text, bigint),
  public.tecnico_salva_push(text, text, text, text, text), public.tecnico_documenti(text, text)
  to anon, authenticated;
grant execute on function public.tecnico_puo_caricare_foto(text, bigint), public.tecnico_percorso_documento(text, bigint), public._tecnico_da_token(text) to service_role;
