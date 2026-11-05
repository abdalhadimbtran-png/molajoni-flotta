-- 0045 Trasferimenti: «Responsabile non disponibile» (richiamo promesso con scadenza scelta),
-- promemoria 15 minuti prima, escalation se scaduto, email di riepilogo al cliente obbligatoria.
alter table public.chiamate_trasferite add column if not exists modalita text not null default 'trasferita'
  check (modalita in ('trasferita', 'richiamo'));
alter table public.chiamate_trasferite add column if not exists entro_testo text;
alter table public.chiamate_trasferite add column if not exists cliente_email text;
alter table public.chiamate_trasferite add column if not exists promemoria_inviato boolean not null default false;
alter table public.chiamate_trasferite add column if not exists esito_richiamo text;
alter table public.chiamate_trasferite add column if not exists email_riepilogo_at timestamptz;
alter table public.chiamate_trasferite add column if not exists email_non_disponibile text;
comment on column public.chiamate_trasferite.email_riepilogo_at is 'Email di riepilogo al cliente inviata/registrata. Senza questa (o il motivo in email_non_disponibile) resta il segnale rosso.';

-- p: pratica_id?, cliente_nome?, telefono?, cliente_email?, destinatario_nome, destinatario_ruolo?, argomento?, tipo_argomento?,
--    modalita ('trasferita' | 'richiamo'), esito (solo trasferita), scadenza (timestamptz, solo richiamo), entro_testo
create or replace function public.centralino_trasferisci(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite; pr public.pratiche; regola jsonb; uid uuid; em text; mod text := coalesce(nullif(p->>'modalita', ''), 'trasferita'); v_esito text; scad timestamptz;
begin
  perform privato.richiedi_centralino();
  if mod not in ('trasferita', 'richiamo') then raise exception 'Modalità non valida'; end if;
  v_esito := case when mod = 'richiamo' then 'richiamera' else p->>'esito' end;
  if coalesce(v_esito, '') not in ('risposto', 'non_risposto', 'occupato', 'richiamera') then raise exception 'Indica l''esito del trasferimento'; end if;
  if nullif(btrim(coalesce(p->>'destinatario_nome', '')), '') is null then raise exception 'Indica il responsabile'; end if;
  if mod = 'richiamo' then
    scad := nullif(p->>'scadenza', '')::timestamptz;
    if scad is null then raise exception 'Indica entro quando ricontattare il cliente'; end if;
    if scad < now() - interval '1 minute' then raise exception 'La scadenza del richiamo è già passata'; end if;
  end if;
  if nullif(p->>'pratica_id', '') is not null then
    select * into pr from public.pratiche where id = (p->>'pratica_id')::bigint;
    if pr.id is null then raise exception 'Pratica non trovata'; end if;
  end if;
  em := lower(nullif(btrim(coalesce(p->>'destinatario_email', '')), ''));
  if em is null then
    select lower(nullif(x->>'email', '')) into em from public.centralino_impostazioni i, jsonb_array_elements(i.valore) x
     where i.chiave = 'destinatari_trasferimento' and x->>'nome' = p->>'destinatario_nome' limit 1;
  end if;
  if em is not null then
    select r2.user_id into uid from public.responsabili r2 left join auth.users u on u.id = r2.user_id
     where r2.attivo and (lower(r2.email) = em or lower(u.email) = em) limit 1;
  end if;
  if mod = 'trasferita' and v_esito <> 'risposto' then
    select valore into regola from public.centralino_impostazioni where chiave = 'trasferimento_sla';
    scad := privato.ct_sla(now(), coalesce(regola, '{"tipo":"ore","valore":2}'));
  end if;
  insert into public.chiamate_trasferite (pratica_id, cliente_codice, cliente_nome, telefono, cliente_email, destinatario_nome, destinatario_ruolo, destinatario_user,
    argomento, tipo_argomento, esito, modalita, entro_testo, richiamo_scadenza, autore_nome)
  values (pr.id, coalesce(pr.cliente_codice, nullif(btrim(coalesce(p->>'cliente_codice', '')), '')), coalesce(pr.cliente_nome, nullif(btrim(coalesce(p->>'cliente_nome', '')), '')),
    coalesce(nullif(btrim(coalesce(p->>'telefono', '')), ''), pr.telefono), coalesce(nullif(lower(btrim(coalesce(p->>'cliente_email', ''))), ''), pr.email),
    btrim(p->>'destinatario_nome'), nullif(p->>'destinatario_ruolo', ''), uid,
    nullif(btrim(coalesce(p->>'argomento', '')), ''), nullif(btrim(coalesce(p->>'tipo_argomento', '')), ''), v_esito, mod,
    nullif(btrim(coalesce(p->>'entro_testo', '')), ''), scad, privato.ct_autore())
  returning * into r;
  if pr.id is not null then
    perform privato.ct_evento(pr.id, 'chiamata', null, null,
      case when mod = 'richiamo' then 'Responsabile non disponibile: ' || r.destinatario_nome || ' ricontatterà il cliente ' || coalesce(r.entro_testo, '')
           else 'Chiamata trasferita a ' || r.destinatario_nome end,
      jsonb_build_object('trasferimento', jsonb_build_object('id', r.id, 'a', r.destinatario_nome, 'argomento', r.argomento, 'tipo', r.tipo_argomento,
        'esito', r.esito, 'modalita', mod, 'entro', r.entro_testo, 'richiamo_scadenza', r.richiamo_scadenza)));
  end if;
  if r.richiamo_scadenza is not null and uid is not null then
    insert into public.notifiche (user_id, tipo, dati, link) values (uid, 'avviso',
      jsonb_build_object('categoria', 'centralino', 'livello', 'warn', 'titolo', 'Da richiamare: ' || coalesce(r.cliente_nome, r.telefono, 'cliente'),
        'testo', concat_ws(' · ', r.argomento, r.telefono, 'entro ' || to_char(r.richiamo_scadenza at time zone 'Europe/Rome', 'DD/MM HH24:MI'))),
      '/centralino/trasferimenti');
  end if;
  return jsonb_build_object('id', r.id, 'richiamo_scadenza', r.richiamo_scadenza, 'notificato', uid is not null, 'cliente_email', r.cliente_email);
end $$;

create or replace function public.centralino_richiamato(p_id bigint, p_nota text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite;
begin
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  if not (public.is_centralino() or r.destinatario_user = auth.uid()) then raise exception 'Accesso riservato al centralino' using errcode = '42501'; end if;
  if r.richiamato_at is not null then raise exception 'Già segnato come richiamato'; end if;
  update public.chiamate_trasferite set richiamato_at = now(), richiamato_da = privato.ct_autore(), esito_richiamo = nullif(btrim(coalesce(p_nota, '')), '') where id = p_id;
  if r.pratica_id is not null then
    perform privato.ct_evento(r.pratica_id, 'chiamata', null, null, coalesce(nullif(btrim(coalesce(p_nota, '')), ''), 'Cliente richiamato'),
      jsonb_build_object('richiamato', jsonb_build_object('trasferimento_id', r.id, 'da', r.destinatario_nome,
        'in_tempo', r.richiamo_scadenza is null or now() <= r.richiamo_scadenza)));
  end if;
end $$;

-- email di riepilogo dopo la chiamata (Resend / testo copiato / Outlook)
create or replace function public.centralino_trasf_email(p_id bigint, p_template text, p_a text, p_cc text[], p_oggetto text,
  p_html text, p_testo text, p_modo text default 'resend') returns void
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite; eid bigint; cc text[];
begin
  perform privato.richiedi_centralino();
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  if p_modo not in ('resend', 'copia', 'outlook') then raise exception 'Modo non valido'; end if;
  if coalesce(p_a, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Indirizzo email del cliente non valido'; end if;
  if r.pratica_id is not null then
    perform public.centralino_invia_email(r.pratica_id, p_template, p_a, p_cc, p_oggetto, p_html, p_testo, p_modo, null);
  elsif p_modo = 'resend' then
    select coalesce(array_agg(distinct lower(btrim(x))), '{}') into cc from unnest(coalesce(p_cc, '{}')) x where btrim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    insert into public.email_in_uscita (destinatario, cc, oggetto, html, testo, dati, stato)
    values (lower(btrim(p_a)), cc, p_oggetto, p_html, p_testo, jsonb_build_object('categoria', 'centralino', 'template', p_template, 'trasferimento_id', p_id), 'in_coda')
    returning id into eid;
    perform privato.email_avvia();
  end if;
  update public.chiamate_trasferite set email_riepilogo_at = now(), cliente_email = lower(btrim(p_a)), email_non_disponibile = null where id = p_id;
end $$;

create or replace function public.centralino_trasf_senza_email(p_id bigint, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite;
begin
  perform privato.richiedi_centralino();
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'Scrivi il motivo'; end if;
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  update public.chiamate_trasferite set email_non_disponibile = btrim(p_motivo) where id = p_id;
  if r.pratica_id is not null then
    perform privato.ct_evento(r.pratica_id, 'nota', null, null, 'Email di riepilogo non inviata: ' || btrim(p_motivo), jsonb_build_object('trasferimento_id', p_id));
  end if;
end $$;

-- controllo: SLA pratiche, promemoria 15 min prima del richiamo, escalation dei richiami scaduti
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
  for p in select * from public.chiamate_trasferite where richiamato_at is null and not promemoria_inviato and richiamo_scadenza > now()
            and richiamo_scadenza <= now() + interval '15 minutes' for update skip locked loop
    update public.chiamate_trasferite set promemoria_inviato = true where id = p.id;
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'warn', 'titolo', 'Tra poco: richiamare ' || coalesce(p.cliente_nome, p.telefono, 'il cliente'),
          'testo', concat_ws(' · ', p.argomento, p.telefono, 'entro ' || to_char(p.richiamo_scadenza at time zone 'Europe/Rome', 'HH24:MI'))), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  for p in select * from public.chiamate_trasferite where richiamato_at is null and richiamo_scadenza < now() and not richiamo_notificato for update skip locked loop
    update public.chiamate_trasferite set richiamo_notificato = true where id = p.id;
    perform privato.ct_notifica('Richiamo scaduto · ' || coalesce(p.cliente_nome, p.telefono, 'cliente'),
      p.destinatario_nome || ' non ha ancora richiamato' || coalesce(' · ' || p.argomento, ''), '/centralino/trasferimenti', 'ko');
    if p.destinatario_user is not null then
      insert into public.notifiche (user_id, tipo, dati, link) values (p.destinatario_user, 'avviso',
        jsonb_build_object('categoria', 'centralino', 'livello', 'ko', 'titolo', 'Richiamo scaduto: ' || coalesce(p.cliente_nome, p.telefono, 'cliente'), 'testo', p.argomento), '/centralino/trasferimenti');
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;

grant execute on function public.centralino_trasf_email(bigint, text, text, text[], text, text, text, text), public.centralino_trasf_senza_email(bigint, text) to authenticated;

insert into public.email_template (codice, nome, oggetto, corpo_html, tipo_pratica, ordine) values
('riepilogo_trasferita', 'Riepilogo telefonata – trasferita al referente', 'Molajoni · Riepilogo della sua telefonata',
 '<p>Gentile {cliente},</p><p>grazie per la sua telefonata di oggi. Come d''accordo, l''abbiamo messa in contatto con <b>{referente}</b> per: {argomento}.</p><p>Se le serve altro, può rispondere a questa email o richiamarci: siamo a sua disposizione.</p><p>{numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'trasferimento', 5),
('riepilogo_richiamo', 'Riepilogo telefonata – vi ricontatteremo entro {entro}', 'Molajoni · La ricontatteremo {entro}',
 '<p>Gentile {cliente},</p><p>grazie per la sua telefonata. In questo momento <b>{referente}</b> non era disponibile: la ricontatterà <b>{entro}</b> per: {argomento}.</p><p>Se nel frattempo preferisce un altro orario, ci risponda pure a questa email.</p><p>{numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>',
 'trasferimento', 6)
on conflict (codice) do nothing;
