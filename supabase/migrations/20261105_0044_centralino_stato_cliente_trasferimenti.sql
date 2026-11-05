-- 0044 Centralino: stato del cliente (nuovo / ex cliente / attivo) e trasferimenti di chiamata.
-- Non distruttiva. Gli eventi di trasferimento nella storia usano il tipo esistente 'chiamata'
-- con dati.trasferimento (il CHECK su pratiche_eventi.tipo non si cambia senza DROP).

-- 1. Stato cliente -----------------------------------------------------------------
alter table public.pratiche add column if not exists stato_cliente text
  check (stato_cliente is null or stato_cliente in ('nuovo', 'ex_cliente', 'attivo'));
alter table public.pratiche add column if not exists stato_cliente_manuale boolean not null default false;

insert into public.centralino_impostazioni (chiave, valore, descrizione) values
  ('mesi_cliente_attivo', '12', 'Cliente «attivo» se ha interventi Taylor negli ultimi N mesi.'),
  ('trasferimento_sla', '{"tipo":"ore","valore":2}', 'Tempo per richiamare il cliente dopo un trasferimento non risposto.'),
  ('destinatari_trasferimento', '[{"nome":"Tecnico commerciale","ruolo":"tecnico_commerciale","email":""},{"nome":"L. Esposito","ruolo":"responsabile","email":""},{"nome":"A. Chiaradonna","ruolo":"responsabile","email":""},{"nome":"A. Querini","ruolo":"responsabile","email":""},{"nome":"Simona Colagrossi","ruolo":"amministrazione","email":""},{"nome":"Roberta Felci","ruolo":"fornitori","email":""},{"nome":"Tecnico","ruolo":"tecnico","email":""},{"nome":"Altro","ruolo":"altro","email":""}]', 'Persone a cui si trasferiscono le chiamate (email = account del portale per la campanella).')
on conflict (chiave) do nothing;

-- attivo: interventi Taylor recenti; ex_cliente: codice/nome noto ma niente di recente; nuovo: sconosciuto
create or replace function privato.ct_stato_cliente(p_codice text, p_nome text) returns text
language plpgsql stable set search_path = '' as $$
declare mesi int; lim date; cod text := nullif(btrim(coalesce(p_codice, '')), ''); nome text := lower(btrim(coalesce(p_nome, '')));
begin
  select coalesce((valore #>> '{}')::int, 12) into mesi from public.centralino_impostazioni where chiave = 'mesi_cliente_attivo';
  lim := (now() - make_interval(months => coalesce(mesi, 12)))::date;
  if cod is null and nome <> '' then
    select i.cod_cliente into cod from public.interventi_importati i where lower(btrim(i.cliente)) = nome and i.cod_cliente is not null limit 1;
  end if;
  if cod is not null then
    if exists (select 1 from public.interventi_importati i where i.cod_cliente = cod and i.data_riferimento >= lim) then return 'attivo'; end if;
    if exists (select 1 from public.interventi_importati i where i.cod_cliente = cod)
       or exists (select 1 from public.impianti_posizione x where x.cod_cliente = cod) then return 'ex_cliente'; end if;
  end if;
  return 'nuovo';
end $$;

create or replace function public.centralino_stato_cliente(p_codice text, p_nome text) returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  return privato.ct_stato_cliente(p_codice, p_nome);
end $$;

-- alla creazione: proposta automatica se non indicata; modifica a mano con centralino_aggiorna (stato_cliente)
create or replace function privato.tg_pratica_stato_cliente() returns trigger
language plpgsql set search_path = '' as $$
begin
  if TG_OP = 'INSERT' then
    if new.stato_cliente is null then new.stato_cliente := privato.ct_stato_cliente(new.cliente_codice, new.cliente_nome);
    else new.stato_cliente_manuale := true; end if;
  elsif new.stato_cliente is distinct from old.stato_cliente then
    new.stato_cliente_manuale := coalesce(current_setting('centralino.stato_auto', true), '') <> 'on';
  elsif new.cliente_codice is distinct from old.cliente_codice and not old.stato_cliente_manuale then
    new.stato_cliente := privato.ct_stato_cliente(new.cliente_codice, new.cliente_nome);
  end if;
  return new;
end $$;
create trigger pratiche_stato_cliente before insert or update on public.pratiche
  for each row execute function privato.tg_pratica_stato_cliente();

create or replace function public.centralino_imposta_stato_cliente(p_id bigint, p_stato text) returns void
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  perform privato.richiedi_centralino();
  if p_stato is not null and p_stato not in ('nuovo', 'ex_cliente', 'attivo') then raise exception 'Stato cliente non valido'; end if;
  select stato_cliente into v from public.pratiche where id = p_id for update;
  if not found then raise exception 'Pratica non trovata'; end if;
  if p_stato is null then -- torna alla proposta automatica
    perform set_config('centralino.stato_auto', 'on', true);
    update public.pratiche set stato_cliente = privato.ct_stato_cliente(cliente_codice, cliente_nome), stato_cliente_manuale = false where id = p_id;
    perform set_config('centralino.stato_auto', '', true);
  else
    update public.pratiche set stato_cliente = p_stato where id = p_id;
  end if;
  perform privato.ct_evento(p_id, 'modifica', null, null, null,
    jsonb_build_object('stato_cliente', jsonb_build_object('da', v, 'a', (select stato_cliente from public.pratiche where id = p_id))));
end $$;

-- 2. Trasferimenti di chiamata -------------------------------------------------------
create table if not exists public.chiamate_trasferite (
  id bigint generated always as identity primary key,
  pratica_id bigint references public.pratiche(id),
  cliente_codice text,
  cliente_nome text,
  telefono text,
  destinatario_nome text not null check (length(btrim(destinatario_nome)) between 1 and 120),
  destinatario_ruolo text,
  destinatario_user uuid,
  argomento text,
  tipo_argomento text,
  esito text not null check (esito in ('risposto', 'non_risposto', 'occupato', 'richiamera')),
  richiamo_scadenza timestamptz,
  richiamo_notificato boolean not null default false,
  richiamato_at timestamptz,
  richiamato_da text,
  autore uuid default auth.uid(),
  autore_nome text,
  at timestamptz not null default now()
);
comment on table public.chiamate_trasferite is 'Chiamate trasferite dal centralino (anche senza pratica). Non risposta → richiamo da fare entro trasferimento_sla.';
create index if not exists chiamate_trasferite_at on public.chiamate_trasferite (at desc);
create index if not exists chiamate_trasferite_aperte on public.chiamate_trasferite (richiamo_scadenza) where richiamato_at is null and richiamo_scadenza is not null;
alter table public.chiamate_trasferite enable row level security;
create policy ct_trasf_leggi on public.chiamate_trasferite for select to authenticated
  using ((select public.is_centralino_lettura()) or destinatario_user = (select auth.uid()));
grant select on public.chiamate_trasferite to authenticated;

create or replace function public.centralino_trasferisci(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite; pr public.pratiche; regola jsonb; uid uuid; em text; nid bigint;
begin
  perform privato.richiedi_centralino();
  if coalesce(p->>'esito', '') not in ('risposto', 'non_risposto', 'occupato', 'richiamera') then raise exception 'Indica l''esito del trasferimento'; end if;
  if nullif(btrim(coalesce(p->>'destinatario_nome', '')), '') is null then raise exception 'Indica a chi hai trasferito la chiamata'; end if;
  if nullif(p->>'pratica_id', '') is not null then
    select * into pr from public.pratiche where id = (p->>'pratica_id')::bigint;
    if pr.id is null then raise exception 'Pratica non trovata'; end if;
  end if;
  -- account del destinatario: email indicata o dalla lista dei destinatari
  em := lower(nullif(btrim(coalesce(p->>'destinatario_email', '')), ''));
  if em is null then
    select lower(nullif(x->>'email', '')) into em from public.centralino_impostazioni i, jsonb_array_elements(i.valore) x
     where i.chiave = 'destinatari_trasferimento' and x->>'nome' = p->>'destinatario_nome' limit 1;
  end if;
  if em is not null then
    select r2.user_id into uid from public.responsabili r2 left join auth.users u on u.id = r2.user_id
     where r2.attivo and (lower(r2.email) = em or lower(u.email) = em) limit 1;
  end if;
  select valore into regola from public.centralino_impostazioni where chiave = 'trasferimento_sla';
  insert into public.chiamate_trasferite (pratica_id, cliente_codice, cliente_nome, telefono, destinatario_nome, destinatario_ruolo, destinatario_user,
    argomento, tipo_argomento, esito, richiamo_scadenza, autore_nome)
  values (pr.id, coalesce(pr.cliente_codice, nullif(btrim(coalesce(p->>'cliente_codice', '')), '')), coalesce(pr.cliente_nome, nullif(btrim(coalesce(p->>'cliente_nome', '')), '')),
    coalesce(nullif(btrim(coalesce(p->>'telefono', '')), ''), pr.telefono), btrim(p->>'destinatario_nome'), nullif(p->>'destinatario_ruolo', ''), uid,
    nullif(btrim(coalesce(p->>'argomento', '')), ''), nullif(btrim(coalesce(p->>'tipo_argomento', '')), ''), p->>'esito',
    case when p->>'esito' <> 'risposto' then privato.ct_sla(now(), coalesce(regola, '{"tipo":"ore","valore":2}')) end, privato.ct_autore())
  returning * into r;
  nid := r.id;
  if pr.id is not null then
    perform privato.ct_evento(pr.id, 'chiamata', null, null, 'Chiamata trasferita a ' || r.destinatario_nome,
      jsonb_build_object('trasferimento', jsonb_build_object('id', r.id, 'a', r.destinatario_nome, 'argomento', r.argomento, 'tipo', r.tipo_argomento,
        'esito', r.esito, 'richiamo_scadenza', r.richiamo_scadenza)));
  end if;
  if r.esito <> 'risposto' and uid is not null then
    insert into public.notifiche (user_id, tipo, dati, link) values (uid, 'avviso',
      jsonb_build_object('categoria', 'centralino', 'livello', 'warn', 'titolo', 'Da richiamare: ' || coalesce(r.cliente_nome, r.telefono, 'cliente'),
        'testo', concat_ws(' · ', r.argomento, r.telefono, 'entro ' || to_char(r.richiamo_scadenza at time zone 'Europe/Rome', 'DD/MM HH24:MI'))),
      '/centralino/trasferimenti');
  end if;
  return jsonb_build_object('id', nid, 'richiamo_scadenza', r.richiamo_scadenza, 'notificato', uid is not null);
end $$;

-- «Richiamato»: il centralino o la persona a cui è stata trasferita la chiamata
create or replace function public.centralino_richiamato(p_id bigint, p_nota text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite;
begin
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  if not (public.is_centralino() or r.destinatario_user = auth.uid()) then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  if r.richiamato_at is not null then raise exception 'Già segnato come richiamato'; end if;
  update public.chiamate_trasferite set richiamato_at = now(), richiamato_da = privato.ct_autore() where id = p_id;
  if r.pratica_id is not null then
    perform privato.ct_evento(r.pratica_id, 'chiamata', null, null, coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Cliente richiamato'),
      jsonb_build_object('richiamato', jsonb_build_object('trasferimento_id', r.id, 'da', r.destinatario_nome,
        'in_tempo', r.richiamo_scadenza is null or now() <= r.richiamo_scadenza)));
  end if;
end $$;

-- controllo SLA: anche i richiami scaduti (una volta per trasferimento)
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
  for p in select * from public.chiamate_trasferite where richiamato_at is null and richiamo_scadenza < now() and not richiamo_notificato for update skip locked loop
    update public.chiamate_trasferite set richiamo_notificato = true where id = p.id;
    perform privato.ct_notifica('Richiamo scaduto · ' || coalesce(p.cliente_nome, p.telefono, 'cliente'),
      'Trasferita a ' || p.destinatario_nome || coalesce(' · ' || p.argomento, ''), '/centralino/trasferimenti', 'ko');
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'ko', 'titolo', 'Richiamo scaduto: ' || coalesce(p.cliente_nome, p.telefono, 'cliente'), 'testo', p.argomento), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

-- clienti suggeriti: con stato proposto
create or replace function public.centralino_clienti(p_q text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_q, '')); pat text; mesi int; lim date;
begin
  if not public.is_centralino_lettura() then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  if length(q) < 2 then return '[]'::jsonb; end if;
  select coalesce((valore #>> '{}')::int, 12) into mesi from public.centralino_impostazioni where chiave = 'mesi_cliente_attivo';
  lim := (now() - make_interval(months => coalesce(mesi, 12)))::date;
  pat := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  return coalesce((select jsonb_agg(x order by x->>'nome') from (
      select jsonb_build_object('codice', i.cod_cliente, 'nome', max(i.cliente), 'sedi', count(distinct i.impianto), 'fonte', 'taylor',
               'stato_cliente', case when max(i.data_riferimento) >= lim then 'attivo' else 'ex_cliente' end) x
        from public.interventi_importati i
       where i.cod_cliente is not null and (i.cliente ilike pat or i.cod_cliente ilike pat)
       group by i.cod_cliente limit 12) t), '[]'::jsonb)
    || coalesce((select jsonb_agg(y) from (
      select distinct on (lower(p.cliente_nome)) jsonb_build_object('codice', p.cliente_codice, 'nome', p.cliente_nome, 'contatto', p.contatto_nome,
               'telefono', p.telefono, 'email', p.email, 'indirizzo', p.indirizzo, 'cap', p.cap, 'comune', p.comune, 'fonte', 'pratiche', 'stato_cliente', p.stato_cliente) y
        from public.pratiche p
       where p.cliente_nome ilike pat or p.telefono ilike pat or p.contatto_nome ilike pat or p.email ilike pat
       order by lower(p.cliente_nome), p.created_at desc limit 8) t), '[]'::jsonb);
end $$;

grant execute on function public.centralino_stato_cliente(text, text), public.centralino_imposta_stato_cliente(bigint, text),
  public.centralino_trasferisci(jsonb), public.centralino_richiamato(bigint, text) to authenticated;
