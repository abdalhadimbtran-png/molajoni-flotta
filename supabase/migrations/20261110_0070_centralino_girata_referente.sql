-- Centralino: revisione email (audit 10/11/2026).
-- 1) «Girata»: email principale interna al referente (girata_referente); conferma al chiamante facoltativa (girata_ufficio / girata_fornitore).
-- 2) Conferme di presa in carico facoltative nel primo passo di manutenzione (presa_intervento) e sopralluogo (presa_sopralluogo).
-- Non distruttiva: solo INSERT/UPDATE.

insert into public.email_template (codice, nome, oggetto, corpo_html, cc_default, cc_offerte_grandi, tipo_pratica, attivo, ordine, titolo, dati, firma_tipo)
values
('girata_referente', 'Al referente – richiesta girata dal centralino',
 '[Centralino] Richiesta da gestire – {cliente} – {argomento}',
 '<p>Ciao {referente},</p><p>ti giro questa richiesta ricevuta dal centralino: <b>{argomento}</b> da <b>{cliente}</b> ({chi_chiama}).</p><p>Sintesi: {descrizione}</p><p>Puoi ricontattare {contatto} al {telefono}? Da qui la richiesta è tua.</p><p><a href="{link}" style="display:inline-block;background:#E30613;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Apri la pratica {numero_pratica}</a></p>',
 '{}', false, null, true, 95, 'Richiesta da gestire',
 '[["Numero pratica","{numero_pratica}"],["Chi chiama","{chi_chiama}"],["Nome","{cliente}"],["Contatto","{contatto}"],["Telefono","{telefono}"],["Email","{email_cliente}"],["Argomento","{argomento}"],["Sintesi / note","{descrizione}"]]'::jsonb,
 'front_office'),
('girata_fornitore', 'Al fornitore – comunicazione inoltrata (facoltativa)',
 'COMUNICAZIONE INOLTRATA – {cliente} – {numero_pratica}',
 '<p>{saluto},</p><p>Vi confermiamo che abbiamo inoltrato la Vostra comunicazione a <b>{referente}</b>, che Vi ricontatterà il prima possibile.</p><p>Cordiali saluti.</p>',
 '{}', false, null, true, 96, 'Comunicazione inoltrata',
 '[["Numero pratica","{numero_pratica}"],["Inoltrata a","{referente}"]]'::jsonb, 'front_office'),
('presa_sopralluogo', 'Al cliente – richiesta sopralluogo presa in carico (facoltativa)', 'RICHIESTA SOPRALLUOGO – PRESA IN CARICO – {cliente} – {numero_pratica}',
 '<p>{saluto},</p><p>Vi confermiamo che abbiamo preso in carico la Vostra richiesta di sopralluogo. <b>Entro 1 ora</b> Vi ricontatteremo per comunicarVi il nome del Tecnico Commerciale e l''appuntamento.</p><p>Grazie per la preferenza e distinti saluti.</p>',
 '{}', false, 'sopralluogo', true, 15, 'Richiesta di sopralluogo presa in carico',
 '[["Numero pratica","{numero_pratica}"],["Richiesta","{descrizione}"],["Indirizzo","{indirizzo}"]]'::jsonb, 'front_office')
on conflict (codice) do update set nome = excluded.nome, oggetto = excluded.oggetto, corpo_html = excluded.corpo_html, titolo = excluded.titolo, dati = excluded.dati, attivo = true, aggiornato_il = now();

update public.email_template set nome = 'Al cliente – richiesta inoltrata (facoltativa)', aggiornato_il = now() where codice = 'girata_ufficio';

-- passi: template principale + template_extra facoltativo
update public.pratiche_flussi f set stadi = (
  select jsonb_agg(case
    when s->>'key' = 'girata' then s || '{"template":"girata_referente","template_extra":"girata_ufficio","extra_etichetta":"Invia anche la conferma a chi ha chiamato (facoltativa)"}'::jsonb
    when f.tipo = 'informazione' and s->>'key' = 'evasa' then s || '{"template":"girata_referente","template_extra":"girata_ufficio","extra_etichetta":"Invia anche la conferma a chi ha chiamato (facoltativa)","requisiti":["destinatario"],"girata_facoltativa":true}'::jsonb
    when f.tipo = 'manutenzione' and s->>'key' = 'coordinatore' then s || '{"template_extra":"presa_intervento","extra_etichetta":"Invia conferma di presa in carico al cliente (facoltativa)"}'::jsonb
    when f.tipo = 'sopralluogo' and s->>'key' = 'coordinatore' then s || '{"template_extra":"presa_sopralluogo","extra_etichetta":"Invia conferma di presa in carico al cliente (facoltativa)"}'::jsonb
    else s end order by i)
  from jsonb_array_elements(f.stadi) with ordinality as e(s, i)), aggiornato_il = now()
where f.tipo in ('amministrazione', 'fornitori', 'informazione', 'manutenzione', 'sopralluogo');
