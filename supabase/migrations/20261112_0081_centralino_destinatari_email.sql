-- Centralino: ogni email al destinatario giusto.
-- 1) Oggetto delle email interne con il numero pratica ({rif_pratica} = « – CT-…», vuoto senza pratica).
--    Si aggiornano solo i modelli ancora con l'oggetto originale (le modifiche fatte a mano restano).
-- 2) Controllo lato server: email interna ([Centralino]) mai all'indirizzo del cliente; email al cliente mai a un collega.
update public.email_template set oggetto = v.nuovo
  from (values
    ('intervento_coordinatore', '[Centralino] Intervento da assegnare – {cliente} – {urgenza}', '[Centralino] Intervento da assegnare{rif_pratica} – {cliente} – {urgenza}'),
    ('sopralluogo_coordinatore', '[Centralino] Sopralluogo da assegnare – {cliente} – {urgenza}', '[Centralino] Sopralluogo da assegnare{rif_pratica} – {cliente} – {urgenza}'),
    ('trasf_referente', '[Centralino] Chiamata trasferita – {cliente} – {argomento}', '[Centralino] Chiamata trasferita{rif_pratica} – {cliente} – {argomento}'),
    ('girata_referente', '[Centralino] Richiesta da gestire – {cliente} – {argomento}', '[Centralino] Richiesta da gestire{rif_pratica} – {cliente} – {argomento}'),
    ('riepilogo_commerciale', '[Centralino] Preventivo da gestire – {cliente} – richiamare entro le {scadenza_richiamo}', '[Centralino] Preventivo da gestire{rif_pratica} – {cliente} – richiamare entro le {scadenza_richiamo}')
  ) v(codice, vecchio, nuovo)
 where email_template.codice = v.codice and email_template.oggetto = v.vecchio;

create or replace function privato.ct_controlla_destinatario(p_template text, p_oggetto text, p_a text, p_cc text[], p_email_cliente text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  interna boolean;
  cli text := nullif(lower(btrim(coalesce(p_email_cliente, ''))), '');
  a text := lower(btrim(coalesce(p_a, '')));
  tutti text[];
  colleghi text[];
begin
  if p_template is null then return; end if;
  select coalesce(t.oggetto like '[Centralino]%', false) or p_template in ('trasf_referente', 'girata_referente', 'riepilogo_commerciale') or p_template like '%\_coordinatore'
    into interna from (select 1) x left join public.email_template t on t.codice = p_template;
  interna := coalesce(interna, false) or coalesce(p_oggetto, '') like '[Centralino]%';
  select coalesce(array_agg(distinct lower(btrim(email))), '{}') into colleghi from public.referenti where nullif(btrim(coalesce(email, '')), '') is not null;
  tutti := array_append(coalesce((select array_agg(lower(btrim(x))) from unnest(coalesce(p_cc, '{}')) x), '{}'), a);
  if interna then
    if cli is not null and cli = any (tutti) and not (cli = any (colleghi)) then
      raise exception 'Email interna: non può andare all''indirizzo del cliente (%). Controlla A e CC.', cli using errcode = 'P0001';
    end if;
  elsif a = any (colleghi) and a is distinct from cli then
    raise exception 'Email per il cliente: % è l''indirizzo di un collega. Scrivi l''email del cliente.', a using errcode = 'P0001';
  end if;
end $$;
revoke all on function privato.ct_controlla_destinatario(text, text, text, text[], text) from public, anon, authenticated;

create or replace function public.centralino_invia_email(p_id bigint, p_template text, p_a text, p_cc text[], p_oggetto text, p_html text, p_testo text, p_modo text DEFAULT 'resend'::text, p_avanza text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare eid bigint; cc text[];
begin
  perform privato.richiedi_centralino();
  if p_modo not in ('resend', 'copia', 'outlook') then raise exception 'Modo non valido'; end if;
  if not exists (select 1 from public.pratiche where id = p_id) then raise exception 'Pratica non trovata'; end if;
  if nullif(btrim(coalesce(p_oggetto, '')), '') is null then raise exception 'Scrivi l''oggetto'; end if;
  if p_modo = 'resend' and coalesce(p_a, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Indirizzo email del destinatario non valido'; end if;
  perform privato.ct_controlla_destinatario(p_template, p_oggetto, p_a, p_cc, (select email from public.pratiche where id = p_id));
  select coalesce(array_agg(distinct lower(btrim(x))), '{}') into cc from unnest(coalesce(p_cc, '{}')) x where btrim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
  if p_modo = 'resend' then
    insert into public.email_in_uscita (destinatario, cc, oggetto, html, testo, dati, pratica_id, stato)
    values (lower(btrim(p_a)), cc, p_oggetto, p_html, p_testo, jsonb_build_object('categoria', 'centralino', 'template', p_template), p_id, 'in_coda')
    returning id into eid;
    perform privato.email_avvia();
  end if;
  perform privato.ct_evento(p_id, 'email_inviata', null, null, p_oggetto,
    jsonb_build_object('modo', p_modo, 'a', p_a, 'cc', cc, 'oggetto', p_oggetto, 'testo', p_testo, 'template', p_template, 'email_id', eid));
  update public.pratiche set updated_at = now() where id = p_id;
  if p_avanza is not null then perform public.centralino_avanza(p_id, p_avanza, '{}'::jsonb, 'Email: ' || p_oggetto); end if;
  return jsonb_build_object('email_id', eid);
end $function$;

create or replace function public.centralino_trasf_email(p_id bigint, p_template text, p_a text, p_cc text[], p_oggetto text, p_html text, p_testo text, p_modo text DEFAULT 'resend'::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare r public.chiamate_trasferite; cc text[];
begin
  perform privato.richiedi_centralino();
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  if p_modo not in ('resend', 'copia', 'outlook') then raise exception 'Modo non valido'; end if;
  if coalesce(p_a, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Indirizzo email del cliente non valido'; end if;
  perform privato.ct_controlla_destinatario(p_template, p_oggetto, p_a, p_cc, coalesce(r.cliente_email, (select email from public.pratiche where id = r.pratica_id)));
  if r.pratica_id is not null then
    perform public.centralino_invia_email(r.pratica_id, p_template, p_a, p_cc, p_oggetto, p_html, p_testo, p_modo, null);
  elsif p_modo = 'resend' then
    select coalesce(array_agg(distinct lower(btrim(x))), '{}') into cc from unnest(coalesce(p_cc, '{}')) x where btrim(x) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';
    insert into public.email_in_uscita (destinatario, cc, oggetto, html, testo, dati, stato)
    values (lower(btrim(p_a)), cc, p_oggetto, p_html, p_testo, jsonb_build_object('categoria', 'centralino', 'template', p_template, 'trasferimento_id', p_id), 'in_coda');
    perform privato.email_avvia();
  end if;
  update public.chiamate_trasferite set email_riepilogo_at = now(), email_cliente_inviata_at = now(), cliente_email = lower(btrim(p_a)), email_non_disponibile = null where id = p_id;
end $function$;

create or replace function public.centralino_trasf_email_referente(p_id bigint, p_a text, p_oggetto text, p_html text, p_testo text, p_modo text DEFAULT 'resend'::text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
declare r public.chiamate_trasferite;
begin
  perform privato.richiedi_centralino();
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  if p_modo not in ('resend', 'copia', 'outlook') then raise exception 'Modo non valido'; end if;
  if coalesce(p_a, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Aggiungi l''email di % in Impostazioni', r.destinatario_nome; end if;
  if nullif(btrim(coalesce(p_oggetto, '')), '') is null then raise exception 'Scrivi l''oggetto'; end if;
  perform privato.ct_controlla_destinatario('trasf_referente', p_oggetto, p_a, '{}', coalesce(r.cliente_email, (select email from public.pratiche where id = r.pratica_id)));
  if p_modo = 'resend' then
    insert into public.email_in_uscita (destinatario, oggetto, html, testo, dati, pratica_id, stato)
    values (lower(btrim(p_a)), p_oggetto, p_html, p_testo, jsonb_build_object('categoria', 'centralino', 'template', 'trasf_referente', 'trasferimento_id', p_id), r.pratica_id, 'in_coda');
    perform privato.email_avvia();
  end if;
  update public.chiamate_trasferite set email_referente_inviata_at = now(), referente_email = lower(btrim(p_a)) where id = p_id;
  if r.pratica_id is not null then
    perform privato.ct_evento(r.pratica_id, 'email_inviata', null, null, p_oggetto,
      jsonb_build_object('modo', p_modo, 'a', lower(btrim(p_a)), 'cc', '[]'::jsonb, 'oggetto', p_oggetto, 'testo', p_testo, 'template', 'trasf_referente',
        'trasferimento_id', p_id, 'al_referente', true));
  end if;
end $function$;
