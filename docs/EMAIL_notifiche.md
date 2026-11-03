# Email notifiche ferie (Resend)

Ogni nuova richiesta di assenza **in attesa** (inviata dal dipendente, o inserita dall'ufficio personale senza approvarla subito) genera un'email all'indirizzo `email_hr`.

## Come funziona
- Tabella `impostazioni_portale`: `email_hr` (destinatario), `email_mittente` (mittente). Si modificano da **Amministrazione › Sicurezza › Email notifiche ferie** (pulsante *Invia email di prova*).
- Trigger differito `email_richieste` su `richieste_assenza` → riga in `email_in_uscita` (coda) → `pg_net` chiama la Edge Function `notifica-email` con l'intestazione `x-email-secret` (segreto in Supabase Vault, nome `email_notifiche_secret`).
- Un errore nell'invio non blocca mai la richiesta. Stati: `in_coda`, `inviata`, `errore` (ritentata fino a 5 volte alla chiamata successiva), `in_attesa_configurazione` (manca `RESEND_API_KEY` o l'indirizzo).
- Malattia: l'email riporta solo «Malattia», senza note. Nessuna email per le richieste dell'utente HR/admin per sé stesso.

## 1. Creare l'account Resend
1. Registrarsi su https://resend.com.
2. **API Keys › Create API Key** (permesso *Sending access*). Copiare la chiave (inizia con `re_`).

## 2. Inserire la chiave in Supabase
Dashboard Supabase (progetto `dhqvyxitcrbqwozgcgno`) › **Edge Functions › Secrets** › *Add new secret*:
- Name: `RESEND_API_KEY`
- Value: la chiave copiata.

Non serve ridistribuire la funzione. Le email rimaste in `in_attesa_configurazione` partono alla prossima richiesta o con *Invia email di prova*.

## 3. Modalità test
Finché non si verifica un dominio, il mittente è `onboarding@resend.dev` e **Resend consegna solo all'indirizzo con cui è stato registrato l'account Resend** (oggi `abdalhadi.m.btran@gmail.com`). Le email verso altri indirizzi finiscono in stato `errore` (403).

## 4. Verificare il dominio aziendale (dopo)
1. Resend › **Domains › Add domain** (es. `molajoni.it`, meglio un sottodominio come `notifiche.molajoni.it`).
2. Aggiungere al DNS (chi gestisce il dominio) i record TXT/MX/DKIM indicati; attendere lo stato *Verified*.
3. In `impostazioni_portale` impostare `email_mittente`, es. `Molajoni Portale <portale@molajoni.it>` (RPC `admin_salva_impostazione('email_mittente', ...)`), e `email_hr` con l'indirizzo reale dell'ufficio personale dalla pagina Sicurezza.
