# Centralino (front office) e monitoraggio Direzione

Fonte: procedura «Jennifer MARCHETTI Rev.01/2027». Migrazioni `0043`–`0053` (`0047_centralino_procedura_rigida`: passi rigidi, appunti, offerte > 1.000 €).

## Struttura (rifacimento)
Menu: **Oggi** (plancia: grande «Nuovo contatto», contatori del giorno cliccabili, coda «Adesso» per urgenza con conti alla rovescia, richiami dovuti, email da inviare, movimenti di oggi) · **Nuovo contatto** · **Pratiche** (vista divisa: elenco a sinistra, scheda a destra; `/centralino/pratica/:id`) · **Trasferimenti e richiami** · **Clienti** (ricerca, scheda con contatti, sedi, storico pratiche e chiamate, «Nuovo contatto per questo cliente») · **Analisi** (`/centralino/monitoraggio`) · Report · Modelli email · **Referenti** · Impostazioni. Barra in alto: stato in diretta (in scadenza 60 min, scadute, richiami dovuti → elenco).

## Referenti e responsabilità (0053)
`/centralino/referenti`: tabella `referenti` (nome, ruolo, email, telefono, cellulare, attivo, responsabilità: offerte > 1.000 €, ≤ 1.000 €, sopralluoghi, amministrazione, fornitori, interventi, sostituto, formazione, flotta, trasferte, abbigliamento). **Fonte unica**: un trigger riscrive le impostazioni derivate (`commerciali_offerte_grandi`, `cc_offerte_grandi`, `commerciali`, `destinatari_trasferimento`, `amministrazione`, `fornitori`, `sostituto`), non più modificabili a mano. Avvisi per responsabilità senza email o senza nessuno.

## Import clienti da Taylor (formato reale)
Intestazioni «Codice», «Ragione sociale», «Località», «Telefono», «Email» (spazi, maiuscole, accenti non contano; sinonimi Cod. cli., Cliente, Loc., Città, Tel, E-mail, Mail, PEC…). Colonne sconosciute mostrate come «non importate». Più numeri per cella (/ ; - ,): fisso → telefono, che inizia con 3 → cellulare, altri in rubrica; più email: prima → email, PEC → pec, altre in rubrica. «00186 ROMA (RM)» → CAP, comune, provincia. Doppioni per Codice: vince l'ultima riga. Blocchi da 500 righe con barra di avanzamento (10.000 righe ok). Logica in `src/lib/centralino/importa.ts` (test `importa.test.ts`).

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
| Offerta ≤ 1.000 € (gestita da Jennifer) | Ricevuta → ★Conferma al cliente (email «entro 60 minuti») → ★Offerta inviata → ★Follow-up → Esito → Contratto/Ordine | conferma **10 min**, offerta **60 min dalla richiesta** (la promessa «entro 60 minuti» parte dalla telefonata, quindi la conferma deve arrivare subito); follow-up 2 gg lav. |
| Offerta > 1.000 € (a L. Esposito / A. Chiaradonna / A. Querini) | Ricevuta → ★Presa in carico (CC commerciale + Esposito, Chiaradonna, Querini) → ★Commerciale ha contattato → ★Offerta o sopralluogo → Esito → Contratto | 30 min; contatto **2 ore**; offerta in giornata |
| Modifica / anagrafica / disdetta | Ricevuta → ★Registrata → ★Evasione comunicata → Chiusa | in giornata; email entro giorno lav. successivo |
| Amministrazione · Fornitori · Informazione (anche info@) | Ricevuta → ★Girata a Simona Colagrossi / Roberta Felci (lun/ven) / responsabile → Chiusa | in giornata |
| Trasferta (alloggio TMQ) · Abbigliamento di lavoro | Ricevuta → ★Prenotato / Ordinato → Comunicata / Consegnato → Chiusa | 1 / 2 gg lav. |

Regole: **un passo alla volta** (mai salti), ogni passo con i suoi requisiti (`requisiti`: appuntamento, email, taylor, commerciale, destinatario, esito); «Prossimo passo: … · manca: …» nella scheda (`centralino_prossimo`). Prima della fine si può solo **annullare** con motivo dall'elenco. La soglia 1.000 € (importo stimato o pulsante) sceglie il flusso offerta. Appuntamento dato al primo contatto → stadio raggiunto subito. Ultimo stadio → chiusa positiva; esito «rifiutata» → chiusa negativa. Semaforo: verde, **arancio** sotto il 25% del tempo (`soglia_arancio`), **rosso** scaduto. Controllo `privato.centralino_controlla_sla()` con pg_cron ogni 5 minuti (job `centralino_sla`) e all'apertura dell'area: evento `sla_scaduto` + campanella a centralino, direzione e admin (una volta per stadio).

### Modificare un flusso
`/centralino/impostazioni` › Flussi: JSON `stadi` = `[{key, nome, sla?, azione?, template?}]`, `sla` = `{"tipo":"minuti|ore|stesso_giorno|giorni_lav","valore":N,"da":"creazione|ingresso"}`, `azione` = `appuntamento|taylor|esito`, `template` = codice modello suggerito. `sla_sottotipi` per SLA diversi per sottotipo. Il primo stadio resta `ricevuta`; non rinominare chiavi già usate (la storia le conserva).

## Appunti privati
Tabella `appunti` (chiave `bozza` nel nuovo contatto, `p:<id>` nella pratica), salvataggio automatico. RLS: solo l'autore legge e scrive; non vanno nella storia, alla direzione né nei report. Al salvataggio del nuovo contatto la bozza passa alla pratica.

## Procedura applicata (Rev.01/2027 → portale)
| Regola della procedura | Dove / come |
|---|---|
| 1.1 Rispondere entro 3 squilli + «Molajoni dal 1930, Buongiorno sono Jennifer…» | Promemoria in cima al nuovo contatto (telefono/WhatsApp) e nella home |
| 1.1 In assenza passa il compito a Simona Colagrossi | `centralino_copertura()`: banner se l'operatrice ha un'assenza approvata oggi; Simona = Ufficio personale + «Anche centralino» |
| 1.2 Risponditore: 1 manutenzione/commerciale, 2 fatture (pomeriggio cellulare Simona), 3 fornitori lun/ven (Roberta Felci) | Tipi «Fatture / amministrazione» e «Fornitori» con regola mostrata; destinatari dei trasferimenti con nota del tasto |
| 1.3 Intervento: DATA + mattina/pomeriggio alla prima telefonata | `centralino_crea` **rifiuta** manutenzione/sopralluogo senza data e fascia; il modulo non salva |
| 1.3 Comunicato ai tecnici via Taylor con Documento di Intervento | Passo «Comunicato al tecnico»: casella «Alert inviato su Taylor» + **numero documento** obbligatori |
| 1.3 Allarme sonoro: in giornata, tacitazione al telefono · Altri: entro il giorno dopo | SLA `stesso_giorno` per il sottotipo, urgente, casella «Tacitazione tentata»; altri `giorni_lav 1` |
| 1.4 Sopralluogo entro 2 giorni, confermato al cliente, cc al Tecnico Commerciale | SLA 2 gg lav.; passo «Confermato» richiede commerciale + email (modello con cc) |
| 1.4 Il commerciale sposta solo dopo accordo telefonico e conferma scritta | «Sposta appuntamento» (`centralino_sposta`): motivo dall'elenco + 2 conferme; cambi diretti bloccati da trigger |
| 1.4 Offerte ≤ 1.000 €: conferma a voce e email «entro 60 minuti» | Gestita dal centralino; conferma 10 min con email, offerta 60 min dalla richiesta, entrambe con email obbligatoria |
| 1.4 Offerte > 1.000 €: commerciale + cc Esposito/Chiaradonna/Querini, «la contatterà entro 2 ore», commerciale telefona in giornata e conferma per email | Assegnazione solo ai tre (disponibilità: account, assenze approvate, «disponibile/occupato»); disponibile → trasferimento; nessuno → email di presa in carico + **richiamo 2 ore** creato da `centralino_crea`; passi «Commerciale ha telefonato» (2 h) e «Offerta o sopralluogo (email)» in giornata |
| Note: mai chiedere l'anagrafica completa per email | Avviso nel nuovo contatto e in «Dati e assegnazione»; bastano nome e telefono |
| 1.5 Modifiche calendario/anagrafica/disdetta registrate in giornata, evasione per email | Passo «Registrata» in giornata, «Evasione comunicata» richiede email |
| info@molajoni.it monitorata, girata al competente | Canale Email + tipo «Informazione» → passo «Girata» con destinatario obbligatorio |
| WhatsApp: stesse regole del telefono per gli interventi | Stessi controlli (data/fascia, Taylor) per ogni canale |
| B) Offerte da tablet TMQ e ≤ 1.000 € | Canale «Tablet TMQ» + flusso offerta ≤ 1.000 €; contatore dedicato |
| C) Attestati di formazione | Link «Altre attività» → `/formazione` |
| D) Anagrafica clienti/impianti | Tipo «Modifica / anagrafica» (sottotipo Anagrafica), contatore «Aggiornamento anagrafica» |
| E) Trasferte (alloggio TMQ), abbigliamento di lavoro | Tipi dedicati (canale Collega); flotta resta nel pannello flotta |
| Jennifer pannel: telefonate, offerte da tablet / WA / cliente, aggiornamento anagrafica | «Il mio registro di oggi» (`centralino_registro_giorno`), calcolato dalle pratiche |

Scelte: canale e tipo restano pulsanti grandi (scelta chiusa, più rapida di un menu); tutte le altre scelte sono menu a tendina (dettaglio, fascia, commerciale, destinatario, argomento, esito, «entro», stato cliente, motivi). Testo libero solo per nomi, descrizioni e note.

## Stato del cliente
`pratiche.stato_cliente`: **attivo** (interventi Taylor negli ultimi `mesi_cliente_attivo` = 12 mesi), **ex cliente** (codice noto in `interventi_importati`/`impianti_posizione` ma niente di recente), **nuovo** (sconosciuto). Proposto automaticamente (trigger), modificabile a mano (`centralino_imposta_stato_cliente`, null = torna alla proposta). KPI e funnel divisi per stato.

## Chiamate per un responsabile (trasferimenti)
Tabella `chiamate_trasferite` (anche senza pratica). Due esiti:
- **Trasferita**: risposto / non risposto / occupato / richiamerà. Non risposto → richiamo entro `trasferimento_sla` (2 ore lavorative).
- **Responsabile non disponibile**: «Vi ricontatteremo entro» 30 min / 1 ora / 2 ore / oggi pomeriggio / domani mattina / data-ora scelta dal cliente → scadenza del richiamo.
Campanella al destinatario se la sua email (`destinatari_trasferimento`) corrisponde a un account; promemoria 15 minuti prima; se scade: escalation a centralino + direzione. «Richiamato» (con breve esito) dal centralino o dal destinatario. Ogni trasferimento è anche un evento `chiamata` nella storia della pratica.
**Email di riepilogo obbligatoria**: dopo il salvataggio si apre il compositore con «Riepilogo telefonata – trasferita al referente» o «… vi ricontatteremo entro {entro}». Senza email: «Email non disponibile» con motivo. Finché manca: segnale rosso «Email di riepilogo non inviata» e KPI «% chiamate con email di riepilogo».

## Due email per ogni trasferimento (0049)
Dopo «Trasferita» o «Responsabile non disponibile» si apre il compositore con **due email in anteprima modificabile**: al referente (chi ha chiamato, stato cliente, contatti, sede, canale, argomento, richiesta — mai gli appunti —, importo, cosa deve fare ed entro quando, link alla pratica) e al cliente (presa in carico «la contatterà entro … (entro le hh:mm di …)» oppure riepilogo se la chiamata è passata). «Invia entrambe»; per ognuna «Apri in Outlook» / «Copia testo». Email del referente mancante → «Aggiungi l'email di … in Impostazioni» (il trasferimento resta registrato). Cliente senza email → motivo dall'elenco. Colonne `email_referente_inviata_at`, `email_cliente_inviata_at`; segnale rosso finché ne manca una. Scadenza predefinita del richiamo: 2 ore d'ufficio (`ct_sla`).

## Numeri cliccabili e dettaglio (`/centralino/analisi`)
Ogni tessera, barra, contatore e cifra viene dal **registro KPI** (`src/lib/centralino/registro.ts`): la pagina `/centralino/analisi?kpi=…&da=…&a=…&dest=…&arg=…&stato=…&tipo=…&canale=…` (o `/direzione/centralino/analisi`) usa la stessa funzione `valuta()` → numero ed elenco coincidono (test `registro.test.ts`). Mostra spiegazione (numeratore/denominatore), filtri modificabili, riepilogo, elenco completo (clic → pratica), PDF/Excel dell'elenco.

## Conti alla rovescia
Ovunque compare una pratica o un richiamo: «mancano 47:12» / «mancano 1 g 03 h», «in ritardo da 00:18» in rosso; ore d'ufficio e festività, «in pausa fino a lun 08:30» fuori orario; regola mostrata («Procedura: Offerta inviata entro 60 min»); tempo totale «ricevuta da …»; nella storia il tempo passato in ogni fase.

## Tempo reale
Supabase Realtime su `pratiche`, `pratiche_eventi`, `chiamate_trasferite`, `notifiche` (RLS valida): le pagine si aggiornano da sole; avviso a comparsa (e suono, spento di default: menu utente) per scadenze e richiami. Scorciatoie: **N** nuovo contatto, **/** ricerca, **Esc** chiude.

## Rubrica contatti e anagrafica clienti (0050–0051)
`clienti_contatti` (più contatti per cliente/sede, preferito) con storia `clienti_contatti_storia` (solo in aggiunta). Scelto un cliente, il contatto preferito/più recente riempie i campi; menu per cambiarlo. Telefono normalizzato +39, email controllata. Se Jennifer cambia telefono/email: «Aggiorna anche nell'anagrafica del cliente?» (sì di default) → storia + conta come «aggiornamento anagrafica». Una pratica nuova aggiunge solo contatti nuovi.
**Impostazioni › Anagrafica clienti – Importa da Taylor**: Excel/CSV, colonne riconosciute per nome (mappa ricordata), **prova senza scrivere** (nuovi / aggiornati / invariati / protetti / errori + differenze), conferma; upsert per `cod_cliente` in `clienti` + contatto in rubrica; le modifiche manuali non si sovrascrivono senza «Sovrascrivi»; registro `clienti_importazioni` con rapporto errori scaricabile.

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
- `supabase/prove/centralino_prove.sql`: blocco DO annullato (RLS per ruolo incl. anon, storia solo in aggiunta, SLA, contatori, SLA scaduto, **ordine rigido dei passi**, requisiti Taylor/email, annullo, spostamento, **appunti solo dell'autore**, **offerte > 1.000 €** con richiamo 2 ore) + secondo blocco «PROVE TRASFERIMENTI OK» (richiamo, email al referente/cliente, richiamato, rubrica con storia e +39, import clienti con prova e protezione, permessi direzione/anon).
- QA visivo: Playwright con dati finti a 1440, 1280 e 1024 px (home, pratica, direzione, dettaglio, trasferimenti, impostazioni, nuovo contatto, email doppia): nessun elemento fuori larghezza. Da eseguire in SQL editor: risultato atteso `PROVE CENTRALINO OK`. Il calcolo SLA è stato verificato sul database con 8 casi (tutti ok).
