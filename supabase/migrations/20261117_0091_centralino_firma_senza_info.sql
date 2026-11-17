-- Email del Centralino: partono dalla casella dell'operatore (Jennifer), mai da info@.
-- Additiva: toglie «info@molajoni.it» dalla firma configurata e dai modelli email.
update public.centralino_impostazioni
   set valore = to_jsonb(regexp_replace(valore #>> '{}', '\s*·?\s*info@molajoni\.it', '', 'gi'))
 where chiave = 'firma' and jsonb_typeof(valore) = 'string' and valore #>> '{}' ilike '%info@molajoni.it%';

update public.email_template
   set corpo_html = regexp_replace(corpo_html, '\s*·?\s*info@molajoni\.it', '', 'gi')
 where corpo_html ilike '%info@molajoni.it%';
