# Report Direzione – Settimana / Mese (PDF + email)

Sostituisce il riepilogo giornaliero delle 18:00 (dismesso il 17/11/2026). Modulare: oggi contiene la sezione **Centralino**; le altre aree del portale (Flotta, Pianificazione, HR, Formazione, Magazzino, Manutenzioni…) si aggiungono come nuove sezioni senza toccare il PDF né l'email.

## Calendario (ora di Roma, ora legale gestita)
| Report | Quando | Finestra | Confronto |
|---|---|---|---|
| Settimanale | venerdì 16:00 (se festivo: giovedì, o l'ultimo giorno lavorativo prima) | lunedì 00:00 → giorno d'invio 16:00 | stessa finestra della settimana precedente |
| Mensile | ultimo giorno lavorativo del mese (lun–ven, non in `public.festivita`) alle 16:00 | 1° del mese 00:00 → quel momento | stessa finestra «da orologio» del mese precedente |

- pg_cron: `report_direzione_settimana` (`0 14,15 * * 1-5`) e `report_direzione_mese` (`2 14,15 * * 1-5`) chiamano `privato.report_direzione_avvia(tipo)`, che parte solo se a Roma sono le 16 e oggi è il giorno d'invio del periodo; poi chiama la funzione Edge `report-direzione` (`azione: 'pianificato'`).
- Idempotente: `public.report_direzione_prenota` aggiorna `direzione_preferenze.ultimo_settimana` / `ultimo_mese` (chiave `2026-W47` / `2026-11`) prima dell'invio: un secondo avvio per lo stesso periodo non invia nulla.
- Iscrizione facoltativa (admin e direzione): interruttore «Report settimanale e mensile (PDF)» nell'area Direzione → `report_direzione_imposta` / `report_direzione_stato`.
- Email: Resend con PDF allegato (base64) + riepilogo HTML (logo, 5 KPI, «Da attenzionare», link alla pagina). Ogni invio è registrato in `email_in_uscita` (`dati.categoria = report_direzione_*`, `allegati = [{nome, byte}]`, `tentativi = 5` così la coda generica non lo ritenta senza allegato). Resend in prova: arriva solo a abdalhadi.m.btran@gmail.com finché il dominio non è verificato.
- Pagina Direzione → Centralino: «Scarica report settimana» / «Scarica report mese» (periodo in corso fino ad adesso, admin/direzione), «Invia report di prova» (solo admin, alla propria email).
- File: `Report_Direzione_Settimana_2026-W47.pdf`, `Report_Direzione_Novembre_2026.pdf`.

## Architettura
- `public.report_sezioni(codice, titolo, ordine, attiva, funzione)` – registro delle sezioni.
- `privato.report_sez_<codice>(ini timestamptz, fin timestamptz) returns jsonb` – una funzione per sezione, sola lettura, forma standard:
  ```json
  {"codice":"centralino","titolo":"Centralino",
   "kpi":[{"label":"Contatti ricevuti","valore":40,"unita":"%|ore|…","confronta":false}],
   "tabelle":[{"titolo":"…","colonne":["Tipo","N."],"righe":[["Intervento",13]],"larga":false}],
   "serie":[{"titolo":"Contatti al giorno","punti":[{"label":"16/11","valore":3}]}],
   "attenzione":[{"testo":"8 pratiche in ritardo","livello":"alto|medio"}]}
  ```
- `privato.report_direzione_calcola(tipo, rif, fino)` – calcola la finestra (`privato.report_periodo_finestra`), esegue ogni sezione attiva sul periodo e sul precedente e aggiunge `delta` % per i KPI con la stessa `label` (escluso `confronta: false`). Una sezione che va in errore diventa un avviso, non blocca il report.
- Funzione Edge `supabase/functions/report-direzione/` (`verify_jwt = false`, autenticazione interna: segreto email per il cron, JWT + `is_direzione`/`is_admin` per gli utenti). `render.ts` è generico: copertina (sintesi primi 4 KPI di ogni sezione + «Da attenzionare» + indice se > 2 sezioni), poi un blocco per sezione (KPI, grafico a barre della prima serie, tabelle strette a coppie e tabelle larghe), salti pagina automatici, piè di pagina «Report automatico – Portale Molajoni».
- Contenuto Centralino: tipi Intervento / Sopralluogo / Offerta / Modifiche-Disdetta / Informazione (esclusi fatture e fornitori, nessuna soglia 1000 €); chiuse, annullate, aperte a fine periodo, in ritardo; % entro SLA e tempo medio; offerte Gestita da Jennifer / Passata al Tecnico Commerciale + richiami commerciali scaduti; esiti Informazione; trasferite (senza le richiamate automatiche del commerciale); canali; serie giornaliera; max 15 pratiche in ritardo o annullate (motivo = testo dell'evento di chiusura, **mai** appunti privati).

## Sezione Centralino dal 25/11/2026 (0100)
Titolo «Centralino e offerte». KPI: Offerte arrivate, Inviate in tempo (%), Inviate in ritardo, Ancora da inviare, Accettate, Non accettate, Richieste ricevute, Registrate dopo. Tabelle: numeri del periodo con %, «Cosa significano i numeri», per persona, perché non accettate, perché in ritardo, offerte non accettate (cliente, gestita da, motivo), ancora da inviare, canale, tipo. Dati da `privato.offerte_periodo` (periodo = `arrivata_il`). Stesse parole di `testiDirezione.ts`. Nessuna modifica a `render.ts`.

## Aggiungere una sezione in 3 passi
1. **SQL** – scrivi `privato.report_sez_<area>(p_ini timestamptz, p_fin timestamptz) returns jsonb` (stable, security definer, `search_path = ''`, sola lettura) che restituisce la forma standard sopra; `revoke all … from public, anon, authenticated`.
2. **Registro** – `insert into public.report_sezioni (codice, titolo, ordine, funzione) values ('<area>', '<Titolo>', 20, 'report_sez_<area>');` (`attiva = false` per spegnerla).
3. **Prova** – `select privato.report_direzione_calcola('settimana', current_date, now());` poi «Scarica report settimana» nell'area Direzione. Nessuna modifica a PDF, email o pagina.

## Prove
- Sample PDF (dati fittizi, marcati ESEMPIO): generati con `render.ts` in Node (`node --experimental-strip-types`).
- SQL verificato con dati sintetici in una transazione annullata (40 pratiche: KPI, ritardi, annullate, avvisi corretti).
