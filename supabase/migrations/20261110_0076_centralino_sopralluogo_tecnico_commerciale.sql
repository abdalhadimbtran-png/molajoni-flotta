-- Centralino: il SOPRALLUOGO torna com'era prima della 0075 (Jennifer sceglie il Tecnico Commerciale
-- e l'appuntamento {quando}). Il comportamento generico resta solo per intervento/manutenzione.
-- Additiva: solo UPDATE.

-- 1. Flusso sopralluogo: passo «tecnico» di nuovo obbligatorio e con il nome originale.
update public.pratiche_flussi
   set stadi = (select jsonb_agg(case when s->>'key' = 'tecnico'
                  then s || jsonb_build_object('nome', 'Tecnico / commerciale individuato', 'requisiti', '["tecnico"]'::jsonb)
                  else s end order by o)
                from jsonb_array_elements(stadi) with ordinality as t(s, o))
 where tipo = 'sopralluogo';

-- 2. Modelli sopralluogo: testi originali (0069 / 0070).
update public.email_template set
  nome = 'Al cliente – conferma appuntamento sopralluogo',
  dati = '[["Numero pratica", "{numero_pratica}"], ["Quando", "{quando}"], ["Tecnico Commerciale", "{tecnico}"], ["Indirizzo", "{indirizzo}"]]'::jsonb,
  corpo_html = '<p>{saluto},</p><p>Vi confermiamo l''appuntamento per il sopralluogo <b>{quando}</b> con il nostro Tecnico Commerciale <b>{tecnico}</b>{tel_tecnico}.</p><p>Grazie per la preferenza e distinti saluti.</p>'
 where codice = 'sopralluogo_cliente';
update public.email_template set
  corpo_html = '<p>{saluto},</p><p>Vi confermiamo che abbiamo preso in carico la Vostra richiesta di sopralluogo. <b>Entro 1 ora</b> Vi ricontatteremo per comunicarVi il nome del Tecnico Commerciale e l''appuntamento.</p><p>Grazie per la preferenza e distinti saluti.</p>'
 where codice = 'presa_sopralluogo';

-- 3. Intervento/manutenzione: email interna al coordinatore coerente (niente nome del tecnico al cliente).
update public.email_template set
  corpo_html = '<p>Ciao,</p><p>nuova richiesta di intervento da assegnare. Al cliente ho detto che <b>entro 1 ora</b> sarà contattato da un nostro tecnico.</p><p>Assegni tu il tecnico, che contatterà direttamente il cliente.</p>'
 where codice = 'intervento_coordinatore';
