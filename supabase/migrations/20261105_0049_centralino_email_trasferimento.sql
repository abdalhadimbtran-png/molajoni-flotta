-- 0049 Trasferimenti: due email per ogni chiamata passata a un responsabile.
--  1) al referente (cosa deve fare ed entro quando, link alla pratica)  2) al cliente (presa in carico / riepilogo)
-- Entrambe dalla coda (o «Apri in Outlook»/«Copia» finché Resend è in prova), registrate sul trasferimento e nella storia.
alter table public.chiamate_trasferite add column if not exists email_referente_inviata_at timestamptz;
alter table public.chiamate_trasferite add column if not exists email_cliente_inviata_at timestamptz;
alter table public.chiamate_trasferite add column if not exists referente_email text;
update public.chiamate_trasferite set email_cliente_inviata_at = email_riepilogo_at where email_cliente_inviata_at is null and email_riepilogo_at is not null;

-- email al cliente: aggiorna anche la nuova colonna
create or replace function public.centralino_trasf_email(p_id bigint, p_template text, p_a text, p_cc text[], p_oggetto text,
  p_html text, p_testo text, p_modo text default 'resend') returns void
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite; cc text[];
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
    values (lower(btrim(p_a)), cc, p_oggetto, p_html, p_testo, jsonb_build_object('categoria', 'centralino', 'template', p_template, 'trasferimento_id', p_id), 'in_coda');
    perform privato.email_avvia();
  end if;
  update public.chiamate_trasferite set email_riepilogo_at = now(), email_cliente_inviata_at = now(), cliente_email = lower(btrim(p_a)), email_non_disponibile = null where id = p_id;
end $$;

-- email al referente
create or replace function public.centralino_trasf_email_referente(p_id bigint, p_a text, p_oggetto text, p_html text, p_testo text, p_modo text default 'resend') returns void
language plpgsql security definer set search_path = '' as $$
declare r public.chiamate_trasferite;
begin
  perform privato.richiedi_centralino();
  select * into r from public.chiamate_trasferite where id = p_id for update;
  if r.id is null then raise exception 'Trasferimento non trovato'; end if;
  if p_modo not in ('resend', 'copia', 'outlook') then raise exception 'Modo non valido'; end if;
  if coalesce(p_a, '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Aggiungi l''email di % in Impostazioni', r.destinatario_nome; end if;
  if nullif(btrim(coalesce(p_oggetto, '')), '') is null then raise exception 'Scrivi l''oggetto'; end if;
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
end $$;
grant execute on function public.centralino_trasf_email_referente(bigint, text, text, text, text, text) to authenticated;

-- modelli: referente + cliente (con ora e giorno della scadenza)
insert into public.email_template (codice, nome, oggetto, corpo_html, tipo_pratica, ordine) values
('trasf_referente', 'Al referente – chiamata trasferita', 'Chiamata trasferita – {argomento} – {cliente} ({numero_pratica})',
 '<p>Ciao {referente},</p><p>{richiesta_al_referente}</p><table style="font-size:14px;border-collapse:collapse"><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Cliente</td><td><b>{cliente}</b> · {stato_cliente}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Contatto</td><td>{contatto}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Telefono</td><td>{telefono}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Email</td><td>{email_cliente}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Sede</td><td>{sede}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Canale</td><td>{canale}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Argomento</td><td>{argomento}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Richiesta</td><td>{richiesta}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Importo stimato</td><td>{importo}</td></tr><tr><td style="color:#6b6b6b;padding:3px 12px 3px 0">Scadenza</td><td><b>{scadenza}</b></td></tr></table><p><a href="{link}" style="display:inline-block;background:#E30613;color:#fff;text-decoration:none;padding:9px 16px;border-radius:4px;font-weight:600">Apri la pratica</a></p><p style="color:#8a8a8a;font-size:12px">Trasferita da {autore} alle {ora_trasferimento}.</p>',
 'trasferimento_referente', 1)
on conflict (codice) do nothing;

update public.email_template set
  oggetto = 'Molajoni · Abbiamo preso in carico la sua richiesta',
  corpo_html = '<p>Gentile {contatto},</p><p>grazie per averci chiamato. Abbiamo preso in carico la sua richiesta ({argomento}): il nostro referente <b>{referente}</b> la contatterà <b>{entro}</b> (entro le {ora_scadenza} di {giorno}).</p><p>Se nel frattempo le è più comodo un altro orario, ci risponda pure a questa email.</p><p>{numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>'
 where codice = 'riepilogo_richiamo';
update public.email_template set
  oggetto = 'Molajoni · Riepilogo della sua telefonata',
  corpo_html = '<p>Gentile {contatto},</p><p>grazie per la telefonata di oggi. Come d''accordo l''abbiamo messa in contatto con <b>{referente}</b> per: {argomento}. Riceverà da lui la conferma scritta di quanto concordato.</p><p>Per qualsiasi altra necessità siamo a sua disposizione.</p><p>{numero_pratica}</p><p>Cordiali saluti,<br>{firma}</p>'
 where codice = 'riepilogo_trasferita';
update public.centralino_impostazioni set valore = to_jsonb('Jennifer Marchetti' || chr(10) || 'Front Office · Molajoni Antincendi · dal 1930' || chr(10) || 'Tel. 06 6941 4281 · info@molajoni.it')
 where chiave = 'firma' and valore #>> '{}' like 'Jennifer Marchetti%Dal 1930';

-- stato del cliente anche sul trasferimento (KPI per stato cliente)
alter table public.chiamate_trasferite add column if not exists stato_cliente text
  check (stato_cliente is null or stato_cliente in ('nuovo', 'ex_cliente', 'attivo'));
create or replace function privato.tg_trasf_stato_cliente() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stato_cliente is null then
    new.stato_cliente := coalesce((select p.stato_cliente from public.pratiche p where p.id = new.pratica_id),
                                  case when new.cliente_nome is not null or new.cliente_codice is not null then privato.ct_stato_cliente(new.cliente_codice, new.cliente_nome) end);
  end if;
  return new;
end $$;
create trigger chiamate_trasferite_stato_cliente before insert on public.chiamate_trasferite
  for each row execute function privato.tg_trasf_stato_cliente();
update public.chiamate_trasferite t set stato_cliente = p.stato_cliente from public.pratiche p where p.id = t.pratica_id and t.stato_cliente is null;
