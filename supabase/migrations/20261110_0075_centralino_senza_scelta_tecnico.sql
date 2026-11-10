-- Centralino: Jennifer non sceglie né nomina il tecnico (interventi / sopralluoghi).
-- L'assegnazione la fa il coordinatore (Alberto / Antonella) al telefono.
-- Additiva: nessun DROP; colonne tecnico_* restano. Si aggiornano solo testi e requisiti dei flussi.

-- 1. Flussi: il passo «tecnico» resta (stesso key, stessa SLA) ma senza requisito «tecnico».
update public.pratiche_flussi
   set stadi = (select jsonb_agg(case when s->>'key' = 'tecnico'
                  then (s - 'requisiti') || jsonb_build_object('nome', 'Assegnato dal coordinatore (al telefono)')
                  else s end order by o)
                from jsonb_array_elements(stadi) with ordinality as t(s, o))
 where tipo in ('manutenzione', 'sopralluogo');

-- 2. Modelli al cliente: nessun nome del tecnico.
update public.email_template set
  nome = 'Al cliente – intervento programmato',
  dati = '[["Numero pratica", "{numero_pratica}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,
  corpo_html = '<p>{saluto},</p><p>come anticipato telefonicamente, Vi confermiamo che sarete contattati a breve da un nostro tecnico per l''intervento richiesto.</p><p>Per qualsiasi variazione potete rispondere a questa email o chiamarci allo 06 6941 4281.</p><p>Grazie per la preferenza e distinti saluti.</p>'
 where codice = 'intervento_cliente';
update public.email_template set
  dati = '[["Numero pratica", "{numero_pratica}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,
  corpo_html = '<p>{saluto},</p><p>Vi confermiamo che sarete contattati a breve da un nostro tecnico per fissare l''appuntamento del sopralluogo.</p><p>Grazie per la preferenza e distinti saluti.</p>'
 where codice = 'sopralluogo_cliente';
update public.email_template set
  corpo_html = '<p>{saluto},</p><p>Vi confermiamo che abbiamo preso in carico la Vostra richiesta di intervento. <b>Entro 1 ora</b> sarete contattati da un nostro tecnico.</p><p>Grazie per la preferenza e distinti saluti.</p>'
 where codice = 'presa_intervento';
update public.email_template set
  corpo_html = '<p>{saluto},</p><p>Vi confermiamo che abbiamo preso in carico la Vostra richiesta di sopralluogo. <b>Entro 1 ora</b> sarete contattati da un nostro tecnico per l''appuntamento.</p><p>Grazie per la preferenza e distinti saluti.</p>'
 where codice = 'presa_sopralluogo';
