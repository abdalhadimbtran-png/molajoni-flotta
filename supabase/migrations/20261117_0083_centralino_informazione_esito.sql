-- Centralino: «Informazione» con 3 esiti (17/11/2026). Nessuna email obbligatoria per default.
--   voce   = Risposto a voce            → chiusa, nessuna email
--   email  = Risposto via email         → email al cliente (risposta_informazione), richiede l'email del cliente
--   girata = Girata a un responsabile   → email interna (girata_referente) o «Avvisato per telefono»; conferma al cliente facoltativa (girata_ufficio)
-- L'esito e il referente restano nella storia (pratiche_eventi, tipo 'stato', dati.esito_info / dati.assegnato_nome).
-- Non distruttiva: INSERT/UPDATE + CREATE OR REPLACE di privato.ct_mancanti (aggiunto il requisito 'esito_info').

insert into public.email_template (codice, nome, oggetto, corpo_html, cc_default, cc_offerte_grandi, tipo_pratica, attivo, ordine, titolo, dati, firma_tipo)
values ('risposta_informazione', 'Al cliente – risposta a una richiesta di informazioni',
 'RISPOSTA ALLA VOSTRA RICHIESTA DI INFORMAZIONI – {cliente} – {numero_pratica}',
 '<p>{saluto},</p><p>in riferimento alla Vostra richiesta di informazioni, Vi comunichiamo quanto segue:</p><p>[scrivere qui la risposta]</p><p>Restiamo a disposizione per qualsiasi chiarimento.</p><p>Grazie per la preferenza e distinti saluti.</p>',
 '{}', false, 'informazione', true, 97, 'Risposta alla Vostra richiesta',
 '[["Numero pratica","{numero_pratica}"]]'::jsonb, 'front_office')
on conflict (codice) do update set nome = excluded.nome, oggetto = excluded.oggetto, corpo_html = excluded.corpo_html, titolo = excluded.titolo,
  dati = excluded.dati, tipo_pratica = excluded.tipo_pratica, firma_tipo = excluded.firma_tipo, attivo = true, aggiornato_il = now();

-- girata_referente: tolto il residuo «({chi_chiama})» (il centralino gestisce solo clienti)
update public.email_template set
  corpo_html = '<p>Ciao {referente},</p><p>ti giro questa richiesta ricevuta dal centralino: <b>{argomento}</b> da <b>{cliente}</b>.</p><p>Sintesi: {descrizione}</p><p>Puoi ricontattare {contatto} al {telefono}? Da qui la richiesta è tua.</p><p><a href="{link}" style="display:inline-block;background:#E30613;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Apri la pratica {numero_pratica}</a></p>',
  dati = '[["Numero pratica","{numero_pratica}"],["Cliente","{cliente}"],["Contatto","{contatto}"],["Telefono","{telefono}"],["Email","{email_cliente}"],["Argomento","{argomento}"],["Sintesi / note","{descrizione}"]]'::jsonb,
  aggiornato_il = now()
where codice = 'girata_referente';

-- girata_ufficio: «il nostro responsabile {referente} Vi ricontatterà»
update public.email_template set
  corpo_html = '<p>{saluto},</p><p>Vi confermiamo che abbiamo inoltrato la Vostra richiesta: il nostro responsabile <b>{referente}</b> Vi ricontatterà il prima possibile.</p><p>Grazie per la preferenza e distinti saluti.</p>',
  dati = '[["Numero pratica","{numero_pratica}"],["Responsabile","{referente}"]]'::jsonb,
  aggiornato_il = now()
where codice = 'girata_ufficio';

-- flusso: un solo passo «Esito», requisito esito_info (a voce = nessun altro requisito)
update public.pratiche_flussi f set stadi = (
  select jsonb_agg(case when s->>'key' = 'evasa'
    then (s - 'template' - 'template_extra' - 'extra_etichetta' - 'girata_facoltativa')
         || '{"nome":"Esito: a voce, via email o girata","requisiti":["esito_info"],"esito_info":true}'::jsonb
    else s end order by i)
  from jsonb_array_elements(f.stadi) with ordinality as e(s, i)), aggiornato_il = now()
where f.tipo = 'informazione';

create or replace function privato.ct_mancanti(p_id bigint, p_stadio text, p_dati jsonb DEFAULT '{}'::jsonb)
 returns text[] language plpgsql stable set search_path to ''
as $function$
declare p public.pratiche; req jsonb; r text; m text[] := '{}'; d jsonb := coalesce(p_dati, '{}'::jsonb); dal timestamptz; com text[];
  val text; email_fatta boolean; ass jsonb; esi text;
begin
  select * into p from public.pratiche where id = p_id;
  select s->'requisiti', f.assegnazione into req, ass from public.pratiche_flussi f, jsonb_array_elements(f.stadi) s where f.tipo = p.tipo and s->>'key' = p_stadio;
  select max(at) into dal from public.pratiche_eventi where pratica_id = p_id and tipo in ('creata', 'stato');
  -- email registrata (Resend, copia, Outlook) oppure avvisato per telefono (conta come l'email)
  email_fatta := exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at)
                           and (e.tipo = 'email_inviata'
                                or (e.tipo = 'nota' and e.dati->>'canale' = 'telefono' and coalesce((e.dati->>'comunicazione')::boolean, false))));
  for r in select jsonb_array_elements_text(coalesce(req, '[]'::jsonb)) loop
    if r = 'appuntamento' and coalesce(nullif(d->>'appuntamento_data', ''), p.appuntamento_data::text) is null then m := m || text 'Data dell''appuntamento'; end if;
    if r = 'urgenza' and coalesce(nullif(d->>'urgenza', ''), p.urgenza) is null then m := m || text 'Valutazione urgenza'; end if;
    if r = 'coordinatore' then
      if coalesce(nullif(btrim(coalesce(d->>'coordinatore_nome', '')), ''), p.coordinatore_nome) is null then m := m || text 'Coordinatore'; end if;
      if not (email_fatta or p.coordinatore_telefonato or coalesce((d->>'coordinatore_telefonato')::boolean, false)) then m := m || text 'Email o telefonata al coordinatore'; end if;
    end if;
    if r = 'tecnico' and coalesce(nullif(btrim(coalesce(d->>'tecnico_nome', '')), ''), p.tecnico_nome) is null then m := m || text 'Tecnico'; end if;
    if r = 'verificato' and not coalesce((d->>'verificato')::boolean, false) then m := m || text 'Preventivo verificato'; end if;
    if r in ('buono', 'avviso') and not (p.alert_taylor or p.whatsapp_tecnico or p.avviso_app_at is not null
                             or coalesce((d->>'alert_taylor')::boolean, false) or coalesce((d->>'whatsapp_tecnico')::boolean, false)) then m := m || text 'Avviso al tecnico (Taylor, WhatsApp o app)'; end if;
    if r = 'taylor' and not (p.alert_taylor or coalesce((d->>'alert_taylor')::boolean, false)) then m := m || text 'Alert inviato su Taylor'; end if;
    if r = 'commerciale' then
      val := coalesce(nullif(btrim(coalesce(d->>'commerciale_nome', '')), ''), p.commerciale_nome);
      if val is null then m := m || text 'Commerciale assegnato';
      elsif p.tipo = 'offerta_grande' then
        select array_agg(x->>'nome') into com from jsonb_array_elements(privato.ct_commerciali()) x;
        if not (val = any (coalesce(com, '{}'))) then m := m || text 'Commerciale tra i Tecnici Commerciali per le offerte'; end if;
      end if;
    end if;
    if r = 'email' and not email_fatta then m := m || text 'Email (Invia email o «Avvisato per telefono»)'; end if;
    if r = 'informato' and not (email_fatta or coalesce((d->>'informato_voce')::boolean, false) or nullif(btrim(coalesce(d->>'email_non_disponibile', '')), '') is not null) then
      m := m || text 'Email al cliente o «informato a voce»'; end if;
    if r = 'destinatario' and coalesce(nullif(btrim(coalesce(d->>'assegnato_nome', '')), ''), p.assegnato_nome, ass->>'nome') is null then m := m || text 'A chi è stata girata'; end if;
    if r = 'esito_info' then
      esi := d->>'esito_info';
      if esi is null or esi not in ('voce', 'email', 'girata') then m := m || text 'Esito (a voce, via email o girata)';
      elsif esi = 'email' then
        if nullif(btrim(coalesce(p.email, '')), '') is null then m := m || text 'Email del cliente (oppure «Risposto a voce»)';
        elsif not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at)
                            and e.tipo = 'email_inviata' and e.dati->>'template' = 'risposta_informazione') then
          m := m || text 'Email di risposta al cliente'; end if;
      elsif esi = 'girata' then
        if nullif(btrim(coalesce(d->>'assegnato_nome', '')), '') is null then m := m || text 'Responsabile a cui è stata girata'; end if;
        if not exists (select 1 from public.pratiche_eventi e where e.pratica_id = p_id and e.at >= coalesce(dal, p.created_at)
                         and ((e.tipo = 'email_inviata' and e.dati->>'template' = 'girata_referente')
                              or (e.tipo = 'nota' and e.dati->>'canale' = 'telefono' and e.dati->>'chi' = 'referente'))) then
          m := m || text 'Email o telefonata al responsabile'; end if;
      end if;
    end if;
  end loop;
  return m;
end $function$;
