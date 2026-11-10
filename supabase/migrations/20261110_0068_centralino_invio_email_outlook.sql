-- Centralino: modalità di invio email. 'outlook' (predefinita) = Jennifer invia dalla sua casella Outlook (mailto);
-- 'automatico' = coda email_in_uscita → Resend. Non distruttiva.
insert into public.centralino_impostazioni (chiave, valore, descrizione)
values ('invio_email', '"outlook"'::jsonb, 'Invio email del Centralino: "outlook" (dalla casella di Jennifer, predefinito) oppure "automatico" (Resend)')
on conflict (chiave) do nothing;
