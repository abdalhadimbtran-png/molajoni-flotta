# Centralino (front office) e monitoraggio Direzione

Fonte: procedura «Jennifer MARCHETTI Rev.01/2027». Migrazioni `0043_centralino`, `0044_centralino_stato_cliente_trasferimenti`, `0045_centralino_richiamo_email_riepilogo`.

## Pagine
| Percorso | Chi | Cosa |
|---|---|---|
| `/centralino` | centralino, admin | Da fare adesso, scadute, in scadenza oggi, da richiamare, riepiloghi da inviare, kanban per tipo, chiuse oggi, registro del giorno |
| `/centralino/pratiche` | centralino | Tutte le pratiche del periodo con filtri (tipo, esito, canale, stato cliente) |
| `/centralino/pratica/:id` | centralino | Scheda: stadi, storia, azioni (`?nuova=1` dopo il salvataggio, `?trasferisci=1` apre la chiamata per un responsabile) |
| `/centralino/trasferimenti` | centralino, **e chi ha ricevuto il trasferimento** (anche senza ruolo centralino) | Richiami da fare (pulsante «Richiamato»), riepiloghi mancanti, storico 30 giorni |
| `/centralino/modelli` | centralino | Editor dei modelli email con anteprima |
| `/centralino/report` | centralino | Registro giornaliero, Pratiche per periodo, SLA, Funnel offerte, Chiamate trasferite (PDF/Excel) |
| `/centralino/impostazioni` | centralino | Impostazioni e flussi (stadi/SLA) in JSON controllato |
| `/direzione/centralino` | direzione, admin | KPI in sola lettura, funnel, ritardi, trasferimenti, movimenti |
| `/direzione/centralino/pratica/:id` | direzione | Stessa scheda, sola lettura |

Scorciatoia **N** = nuovo contatto (fuori dai campi). Ricerca in alto: cliente, contatto, telefono (ultime 6 cifre), email, `CT-…`. Scheda «Centralino oggi» nella Panoramica dell'amministratore.

## Ruoli
- `responsabili.centralino` / `responsabili.direzione` (booleani: il CHECK su `area` non si cambia). Da **Amministrazione › Account › Cambia ruolo**: «Centralino» o «Direzione». Questi account non entrano nella flotta (`is_responsabile()` li esclude).
- Ufficio personale + centralino (es. Simona Colagrossi, sostituta): ruolo «Ufficio personale» + casella «Anche centralino» (`admin_imposta_centralino`).
- `is_centralino()` = admin o centralino (scrive) · `is_direzione()` = admin o direzione (legge) · `is_centralino_lettura()` = una delle due.
- RLS: lettura per centralino + direzione + admin; **nessuna scrittura diretta** sulle pratiche, solo RPC `centralino_*`. Modelli, impostazioni e flussi: modificabili da centralino/admin. `anon`: niente.
- Storia (`pratiche_eventi`) solo in aggiunta: trigger che vieta UPDATE e DELETE anche al proprietario.

## Flussi e SLA (tabella `pratiche_flussi`)
Giorni lavorativi lun–ven, festività (`festivita`) escluse, orario d'ufficio `centralino_impostazioni.orario` (08:30–17:30). Ora di Roma. Stessa logica in SQL (`privato.ct_sla`) e in TS (`src/lib/centralino/sla.ts`, test `sla.test.ts`).

| Tipo | Stadi (★ = con SLA) | SLA |
|---|---|---|
| Manutenzione (Guasto, Ritardo, Allarme sonoro attivo, Altro) | Ricevuta → Appuntamento fissato → Comunicato al tecnico («Alert inviato su Taylor») → ★Intervento eseguito → Chiusa | fine del giorno lavorativo successivo; **Allarme**: in giornata, urgente, «Tacitazione tentata» |
| Sopralluogo | Ricevuta → ★Appuntamento → ★Confermato (email) → ★Commerciale informato → ★Sopralluogo eseguito → Offerta inviata → Esito → Contratto firmato | in giornata i primi; eseguito entro 2 giorni lavorativi |
| Offerta ≤ 1.000 € | Ricevuta → ★Conferma al cliente → ★Offerta inviata → ★Follow-up → Esito → Contratto/Ordine | 15 min; offerta **60 min** dalla creazione; follow-up 2 gg lav. |
| Offerta > 1.000 € | Ricevuta → ★Presa in carico (CC commerciale + Esposito, Chiaradonna, Querini) → ★Commerciale ha contattato → ★Offerta o sopralluogo → Esito → Contratto | 30 min; contatto **2 ore**; offerta in giornata |
| Modifica / anagrafica / disdetta | Ricevuta → ★Registrata → ★Evasione comunicata → Chiusa | in giornata; email entro giorno lav. successivo |
| Amministrazione · Fornitori · Informazione | Ricevuta → ★Girata a Simona Colagrossi / Roberta Felci (lun/ven) / responsabile → Chiusa | in giornata |

Regole: la soglia 1.000 € (importo stimato o pulsante) sceglie il flusso offerta. Appuntamento dato al primo contatto → stadio raggiunto subito. Ultimo stadio → chiusa positiva; esito «rifiutata» → chiusa negativa. Semaforo: verde, **arancio** sotto il 25% del tempo (`soglia_arancio`), **rosso** scaduto. Controllo `privato.centralino_controlla_sla()` con pg_cron ogni 5 minuti (job `centralino_sla`) e all'apertura dell'area: evento `sla_scaduto` + campanella a centralino, direzione e admin (una volta per stadio).

### Modificare un flusso
`/centralino/impostazioni` › Flussi: JSON `stadi` = `[{key, nome, sla?, azione?, template?}]`, `sla` = `{"tipo":"minuti|ore|stesso_giorno|giorni_lav","valore":N,"da":"creazione|ingresso"}`, `azione` = `appuntamento|taylor|esito`, `template` = codice modello suggerito. `sla_sottotipi` per SLA diversi per sottotipo. Il primo stadio resta `ricevuta`; non rinominare chiavi già usate (la storia le conserva).

## Stato del cliente
`pratiche.stato_cliente`: **attivo** (interventi Taylor negli ultimi `mesi_cliente_attivo` = 12 mesi), **ex cliente** (codice noto in `interventi_importati`/`impianti_posizione` ma niente di recente), **nuovo** (sconosciuto). Proposto automaticamente (trigger), modificabile a mano (`centralino_imposta_stato_cliente`, null = torna alla proposta). KPI e funnel divisi per stato.

## Chiamate per un responsabile (trasferimenti)
Tabella `chiamate_trasferite` (anche senza pratica). Due esiti:
- **Trasferita**: risposto / non risposto / occupato / richiamerà. Non risposto → richiamo entro `trasferimento_sla` (2 ore lavorative).
- **Responsabile non disponibile**: «Vi ricontatteremo entro» 30 min / 1 ora / 2 ore / oggi pomeriggio / domani mattina / data-ora scelta dal cliente → scadenza del richiamo.
Campanella al destinatario se la sua email (`destinatari_trasferimento`) corrisponde a un account; promemoria 15 minuti prima; se scade: escalation a centralino + direzione. «Richiamato» (con breve esito) dal centralino o dal destinatario. Ogni trasferimento è anche un evento `chiamata` nella storia della pratica.
**Email di riepilogo obbligatoria**: dopo il salvataggio si apre il compositore con «Riepilogo telefonata – trasferita al referente» o «… vi ricontatteremo entro {entro}». Senza email: «Email non disponibile» con motivo. Finché manca: segnale rosso «Email di riepilogo non inviata» e KPI «% chiamate con email di riepilogo».

## Email ai clienti
Modelli `email_template` (13 di base). Segnaposto: `{cliente} {contatto} {numero_pratica} {data_appuntamento} {fascia} {commerciale} {tecnico} {firma} {argomento} {referente} {entro}`. Testo modificabile prima dell'invio. Invio: coda `email_in_uscita` (nuove colonne `cc`, `pratica_id`) → Edge Function `notifica-email` (ora con CC) → Resend; ogni invio = evento `email_inviata` con copia del testo. Finché Resend è in prova: **Copia testo** o **Apri in Outlook** (mailto), registrati comunque. «Segna anche … come fatto» avanza lo stadio collegato al modello.
Da compilare in Impostazioni: email di L. Esposito, A. Chiaradonna, A. Querini (`cc_offerte_grandi`), commerciali, Simona, Roberta, destinatari dei trasferimenti, firma.

## Registro del giorno
`centralino_registro_giorno(p_data)`: telefonate, WhatsApp, email, offerte da tablet / WA / cliente, aggiornamenti anagrafica (= pratiche «modifica»), chiuse — calcolati dalle pratiche (nessun doppio inserimento) + «+1 chiamata informativa» (`centralino_chiamate_info`).

## Assenza
`centralino_copertura()`: se un account centralino (collegato al dipendente) ha un'assenza approvata oggi, banner «Centralino coperto da Simona Colagrossi» (`sostituto`).

## RPC
`centralino_crea(p)`, `centralino_avanza(p_id, p_stadio, p_dati, p_testo)`, `centralino_chiudi(p_id, p_esito, p_testo)`, `centralino_nota(p_id, 'nota'|'chiamata', p_testo, p_dati)`, `centralino_aggiorna(p_id, p)`, `centralino_invia_email(...)`, `centralino_allegato(...)` (bucket privato `pratiche`, 10 MB, pdf/jpg/png/docx/xlsx/eml/msg, percorso `<pratica>/<uuid>.<ext>`), `centralino_chiamata_info`, `centralino_registro_giorno`, `centralino_clienti`, `centralino_sedi`, `centralino_persone`, `centralino_copertura`, `centralino_controlla_sla`, `centralino_sla_anteprima`, `centralino_stato_cliente`, `centralino_imposta_stato_cliente`, `centralino_trasferisci(p)`, `centralino_richiamato(p_id, p_nota)`, `centralino_trasf_email(...)`, `centralino_trasf_senza_email(p_id, p_motivo)`. Taylor: nessuna integrazione, solo la casella «Alert inviato su Taylor».

## Prove
- `npm test` → `src/lib/centralino/sla.test.ts` (SLA con weekend, festività, orario, ora legale; semaforo; modelli; KPI; trasferimenti).
- `supabase/prove/centralino_prove.sql`: blocco DO annullato (RLS per ruolo incl. anon, storia solo in aggiunta, SLA, contatori, SLA scaduto). Da eseguire in SQL editor: risultato atteso `PROVE CENTRALINO OK`. Il calcolo SLA è stato verificato sul database con 8 casi (tutti ok).
