# Centralino (front office) e monitoraggio Direzione

Fonte: procedura «Jennifer MARCHETTI Rev.01/2027». Migrazioni `0043`–`0053` (`0047_centralino_procedura_rigida`: passi rigidi, appunti, offerte al Tecnico Commerciale).

## Struttura (rifacimento)
Menu: **Oggi** (plancia: grande «Nuovo contatto», contatori del giorno cliccabili, coda «Adesso» per urgenza con conti alla rovescia, richiami dovuti, email da inviare, movimenti di oggi) · **Nuovo contatto** · **Pratiche** (vista divisa: elenco a sinistra, scheda a destra; `/centralino/pratica/:id`) · **Trasferimenti e richiami** · **Clienti** (ricerca, scheda con contatti, sedi, storico pratiche e chiamate, «Nuovo contatto per questo cliente») · **Analisi** (`/centralino/monitoraggio`) · Report · Modelli email · **Referenti** · Impostazioni. Barra in alto: stato in diretta (in scadenza 60 min, scadute, richiami dovuti → elenco).

## Chi chiama (0064)
Primo passo del Nuovo contatto: **Chi chiama** (Cliente · Fornitore · Collega o tecnico · Altro: ente, privato, commerciale di altra azienda), gruppo a scelta con frecce/Invio/1–4, predefinito Cliente. `pratiche.tipo_contatto` e `chiamate_trasferite.tipo_contatto` (default `cliente`, check); i campi `cliente_*` restano per nome/telefono/email di chiunque chiami (cambia solo l'etichetta). Fornitore ⇄ «Cosa chiede: Fornitori» si impostano a vicenda (girata a Roberta Felci, lunedì e venerdì). Per i non clienti si nascondono stato cliente, sede/impianto, rubrica e promemoria anagrafica Taylor. RPC `centralino_tipo_contatto(pratica, trasf, tipo)` (dopo `centralino_crea`, dal modale trasferimento senza pratica e dalla scheda pratica); un trigger copia il tipo della pratica nei trasferimenti collegati.
**Anagrafica fornitori**: tabella `fornitori` (nome unico, P. IVA, telefono, email, referente, note, attivo); lettura centralino/direzione, scrittura centralino/admin; `centralino_fornitori(q)` (autocompletamento per nome, P. IVA, telefono) e `centralino_fornitore_salva` (aggiunta al volo nome + telefono, senza doppioni).
Badge «Chi chiama» in elenchi, scheda, ricerca (anche scrivendo «fornitore»/«collega»), Analisi (filtro `chi`) e report; Direzione: KPI «Chi chiama» per pratiche e trasferimenti; i KPI per stato cliente contano solo i clienti.

## Referenti e responsabilità (0053)
`/centralino/referenti`: tabella `referenti` (nome, ruolo, email, telefono, cellulare, attivo, responsabilità: offerte del Tecnico Commerciale, offerte gestite dal centralino, sopralluoghi, amministrazione, fornitori, interventi, sostituto, formazione, flotta, trasferte, abbigliamento). **Fonte unica**: un trigger riscrive le impostazioni derivate (`commerciali_offerte_grandi`, `cc_offerte_grandi`, `commerciali`, `destinatari_trasferimento`, `amministrazione`, `fornitori`, `sostituto`), non più modificabili a mano. Avvisi per responsabilità senza email o senza nessuno.

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
| `/direzione` | direzione, admin | Area Direzione (shell propria, `src/direzione/`): Panoramica di oggi (contatti, aperte, scadute, richiami commerciali scaduti, % SLA, cliente informato entro 1 ora, movimenti in diretta); Flotta/Personale/Formazione/Interventi «Prossimamente» |
| `/direzione/centralino` | direzione, admin | Periodo Oggi/Settimana/Mese/Personalizzato con confronto ▲▼; Volumi (canale, tipo, chi chiama, stato cliente, heatmap giorno×ora, trend 30/90), Servizio (SLA per tipo e passo, tempi, prima risposta, scadute, urgenze in giornata), Offerte (gestite da Jennifer / passate al Tecnico Commerciale, richiami per commerciale), Trasferimenti, Qualità, Registro di Jennifer, Movimenti; «Report direzione» PDF/Excel; interruttore email delle 18:00 |
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
| Manutenzione (rev2, 0056) | Ricevuta (urgenza) → ★Inviato al coordinatore (email + «Telefonato») → ★Tecnico individuato (tecnico + quando) → ★Cliente informato (email «La contatterà il nostro tecnico {tecnico} {quando}») → Buono creato e tecnico avvisato (n. buono + Taylor + WhatsApp, avviso app facoltativo) → chiusa | **10 / 45 / 60 min** dalla chiamata; obiettivo: urgente = oggi, ordinario = entro 2 gg lav. |
| Sopralluogo (rev2) | Stessi passi: coordinatore sopralluoghi → tecnico/commerciale → cliente informato (cc commerciale) → avviso inviato | 10 / 45 / 60 min |
| Offerta gestita da Jennifer (`offerta_piccola`) | come da flusso in `pratiche_flussi` (0055), senza passo «Esito» | conferma 10 min, offerta 60 min dalla richiesta |
| Offerta passata al Tecnico Commerciale (`offerta_grande`; L. Esposito / A. Chiaradonna / A. Querini, il primo disponibile) | Ricevuta (commerciale) → ★Email al cliente «Entro 2 ore la contatterà il nostro Tecnico Commerciale {nome}» → ★Email di riepilogo al commerciale → chiusa per Jennifer | **10 / 15 min**; richiamo 2 ore per il commerciale sempre creato |
| Modifica / anagrafica / disdetta | Ricevuta → ★Registrata → ★Evasione comunicata → Chiusa | in giornata; email entro giorno lav. successivo |
| Amministrazione · Fornitori · Informazione (anche info@) | Ricevuta → ★Girata a Simona Colagrossi / Roberta Felci (lun/ven) / responsabile → Chiusa | in giornata |
| Trasferta (alloggio TMQ) · Abbigliamento di lavoro | Ricevuta → ★Prenotato / Ordinato → Comunicata / Consegnato → Chiusa | 1 / 2 gg lav. |

Regole: **un passo alla volta** (mai salti), ogni passo con i suoi requisiti (`requisiti`: urgenza, coordinatore, tecnico, buono, avviso, email, commerciale, destinatario, appuntamento, taylor); «Prossimo passo: … · manca: …» nella scheda (`centralino_prossimo`). Prima della fine si può solo **annullare** con motivo dall'elenco. Offerte: **nessuna soglia di importo** (Jennifer non conosce l'importo prima di preparare l'offerta). Al primo contatto sceglie **«Gestita da Jennifer»** o **«Passa al Tecnico Commerciale»** (`centralino_crea` con `gestione` = `centralino` | `commerciale`; l'importo è facoltativo e non instrada). Un'offerta gestita da Jennifer ancora aperta si può **passare al Tecnico Commerciale** dalla scheda (`centralino_passa_commerciale`: tipo → `offerta_grande`, stadio → ricevuta, evento `modifica`, richiamo 2 ore). Nessun appuntamento al primo contatto per interventi e sopralluoghi. **Nessun «esito»**: la pratica si chiude quando l'ultimo passo è fatto, oppure si annulla con motivo. Semaforo: verde, **arancio** sotto il 25% del tempo (`soglia_arancio`), **rosso** scaduto. Controllo `privato.centralino_controlla_sla()` con pg_cron ogni 5 minuti (job `centralino_sla`) e all'apertura dell'area: evento `sla_scaduto` + campanella a centralino, direzione e admin (una volta per stadio).

### Modificare un flusso
`/centralino/impostazioni` › Flussi: JSON `stadi` = `[{key, nome, sla?, azione?, template?}]`, `sla` = `{"tipo":"minuti|ore|stesso_giorno|giorni_lav","valore":N,"da":"creazione|ingresso"}`, `azione` = `appuntamento|taylor`, `template` = codice modello suggerito. `sla_sottotipi` per SLA diversi per sottotipo. Il primo stadio resta `ricevuta`; non rinominare chiavi già usate (la storia le conserva).

## Appunti privati
Tabella `appunti` (chiave `bozza` nel nuovo contatto, `p:<id>` nella pratica), salvataggio automatico. RLS: solo l'autore legge e scrive; non vanno nella storia, alla direzione né nei report. Al salvataggio del nuovo contatto la bozza passa alla pratica.

## Procedura applicata (rev2, 0056)
| Regola | Dove / come |
|---|---|
| Rispondere entro 3 squilli + script | Promemoria in cima al nuovo contatto |
| Intervento/sopralluogo: **niente appuntamento** al primo contatto | `centralino_crea` chiede solo l'**urgenza** (Urgente oggi / Ordinario entro 2 gg lav.); allarme sonoro → urgente + suggerimento tacitazione; script «Entro 1 ora la ricontattiamo per confermarle l'appuntamento» |
| Inviato al coordinatore (10 min) | Referenti con «Coordinamento interventi/sopralluoghi», in ordine; primo disponibile preselezionato (`centralino_coordinatori`); email precompilata + interruttore «Telefonato» (basta uno dei due). Menu a gruppi (0061): Coordinatori · Altri referenti (`centralino_altri_referenti`, escluso «Tecnico») · Tecnici (`centralino_tecnici`, «in ferie oggi»). Scelto un tecnico: email a `dipendenti.email`, tecnico proposto nel passo successivo, avviso app facoltativo |
| Tecnico individuato (45 min) | `centralino_tecnici`: assenze e interventi di oggi; tecnico meno carico preselezionato; «quando» a scelta rapida (default da urgenza) o data/ora |
| Cliente informato (60 min) | Inviato insieme alla conferma del tecnico («Conferma e informa il cliente») |
| Buono creato e tecnico avvisato | N. buono + «Taylor + WhatsApp»; «Avviso urgente nell'app» facoltativo (`centralino_avviso_tecnico`, campanella al tecnico, registrato); poi chiusura automatica |
| Offerte passate al Tecnico Commerciale | Commerciale disponibile preselezionato; email al cliente (10 min) e riepilogo al commerciale (15 min) da un pulsante ciascuno; richiamo 2 ore per il commerciale |
| Offerte gestite da Jennifer | Le prepara e invia Jennifer |
| Mai l'anagrafica completa per email | Avviso nel nuovo contatto |

**Clic dopo la chiamata** (salvata la pratica si apre il primo passo e, fatto un passo, si apre da solo il successivo; scorciatoia `A` = prossimo passo, Invio = conferma):
- Manutenzione standard: coordinatore 1–2 (Invia e avanti; + Telefonato se fatto) · tecnico 2 (scelta tecnico + Conferma e informa il cliente; 1 se va bene quello proposto) · buono 2 (Taylor+WhatsApp + Chiudi; il numero si digita) → **6 clic** (5 col tecnico proposto).
- Sopralluogo: uguale → **6 clic**.
- Offerta passata al Tecnico Commerciale: Invia e avanti (cliente) + Invia e chiudi (riepilogo) → **2 clic** dopo il salvataggio.

## Campi obbligatori (0059)
| Dove | Obbligatorio | Perché |
|---|---|---|
| Nuovo contatto | Canale, tipo, cliente **o** telefono | Senza non si richiama nessuno |
| Intervento / sopralluogo | Urgenza (già proposta: allarme = Urgente, altrimenti Ordinario) | Decide l'obiettivo oggi / 2 gg lav. |
| Offerta | «Gestita da Jennifer» / «Passa al Tecnico Commerciale»; commerciale (primo disponibile già scelto) | Decide chi la fa |
| Inviato al coordinatore | Coordinatore (già scelto) + email **o** «Telefonato» | Prova che è stato avvisato |
| Tecnico individuato | Tecnico | «Quando» facoltativo (default «entro 1 ora» / «entro 2 giorni lavorativi») |
| Cliente informato / email al cliente (offerta passata al Tecnico Commerciale) / evasione modifica | Email **o** «Informato a voce» | Promessa al cliente mantenuta |
| Avviso al tecnico | Almeno uno: Taylor, WhatsApp, app | N. buono facoltativo |
| Riepilogo al commerciale, offerte passate al Tecnico Commerciale | Email | È il lavoro stesso del passo |
| Girate | Destinatario (già proposto dai Referenti) | — |
| Annulla | Motivo | Tracciabilità |

Tolti: n. buono, «quando» del tecnico, nome cliente se c'è il telefono, telefonata al coordinatore se c'è l'email, WhatsApp+Taylor insieme, fascia mattina/pomeriggio, blocco commerciale «occupato», dettaglio non in elenco (ora ignorato). SLA invariati.

## Stato del cliente
`pratiche.stato_cliente`: **attivo** (interventi Taylor negli ultimi `mesi_cliente_attivo` = 12 mesi), **ex cliente** (codice noto in `interventi_importati`/`impianti_posizione` ma niente di recente), **nuovo** (sconosciuto). Proposto automaticamente (trigger), modificabile a mano (`centralino_imposta_stato_cliente`, null = torna alla proposta). KPI e funnel divisi per stato.

## Chiamate per un responsabile (trasferimenti)
Tabella `chiamate_trasferite` (anche senza pratica). Due schede:
- **Trasferita**: si registra e si inviano le due email (nessun esito da scegliere).
- **Responsabile non disponibile**: «Vi ricontatteremo entro» 30 min / 1 ora / 2 ore / oggi pomeriggio / domani mattina / data-ora scelta dal cliente → scadenza del richiamo.
Campanella al destinatario se la sua email (`destinatari_trasferimento`) corrisponde a un account; promemoria 15 minuti prima; se scade: escalation a centralino + direzione. «Richiamato» (con breve esito) dal centralino o dal destinatario. Ogni trasferimento è anche un evento `chiamata` nella storia della pratica.
**Email di riepilogo obbligatoria**: dopo il salvataggio si apre il compositore con «Riepilogo telefonata – trasferita al referente» o «… vi ricontatteremo entro {entro}». Senza email: «Email non disponibile» con motivo. Finché manca: segnale rosso «Email di riepilogo non inviata» e KPI «% chiamate con email di riepilogo».

## Due email per ogni trasferimento (0049)
Dopo «Trasferita» o «Responsabile non disponibile» si apre il compositore con **due email in anteprima modificabile**: al referente (chi ha chiamato, stato cliente, contatti, sede, canale, argomento, richiesta — mai gli appunti —, importo, cosa deve fare ed entro quando, link alla pratica) e al cliente (presa in carico «la contatterà entro … (entro le hh:mm di …)» oppure riepilogo se la chiamata è passata). Per ognuna «Outlook → referente» / «Outlook → cliente» (ciascuno segna la sua email come inviata) e «Copia testo»; «Invia entrambe» solo con invio automatico. Email del referente mancante → «Aggiungi l'email di … in Impostazioni» (il trasferimento resta registrato). Cliente senza email → motivo dall'elenco. Colonne `email_referente_inviata_at`, `email_cliente_inviata_at`; segnale rosso finché ne manca una. Scadenza predefinita del richiamo: 2 ore d'ufficio (`ct_sla`).

## Numeri cliccabili e dettaglio (`/centralino/analisi`)
Ogni tessera, barra, contatore e cifra viene dal **registro KPI** (`src/lib/centralino/registro.ts`): la pagina `/centralino/analisi?kpi=…&da=…&a=…&dest=…&arg=…&stato=…&tipo=…&canale=…` (o `/direzione/centralino/analisi`) usa la stessa funzione `valuta()` → numero ed elenco coincidono (test `registro.test.ts`). Mostra spiegazione (numeratore/denominatore), filtri modificabili, riepilogo, elenco completo (clic → pratica), PDF/Excel dell'elenco.

## Conti alla rovescia
Ovunque compare una pratica o un richiamo: «mancano 47:12» / «mancano 1 g 03 h», «in ritardo da 00:18» in rosso; ore d'ufficio e festività, «in pausa fino a lun 08:30» fuori orario; regola mostrata («Procedura: Offerta inviata entro 60 min»); tempo totale «ricevuta da …»; nella storia il tempo passato in ogni fase.

## Tempo reale
Supabase Realtime su `pratiche`, `pratiche_eventi`, `chiamate_trasferite`, `notifiche` (RLS valida): le pagine si aggiornano da sole; avviso a comparsa (e suono, spento di default: menu utente) per scadenze e richiami. Scorciatoie: **N** nuovo contatto, **/** ricerca, **Esc** chiude.

## Rubrica contatti e anagrafica clienti (0050–0051)
`clienti_contatti` (più contatti per cliente/sede, preferito) con storia `clienti_contatti_storia` (solo in aggiunta). Scelto un cliente, il contatto preferito/più recente riempie i campi; menu per cambiarlo. Telefono normalizzato +39, email controllata. Se Jennifer cambia telefono/email: «Aggiorna anche nell'anagrafica del cliente?» (sì di default) → storia + conta come «aggiornamento anagrafica». Una pratica nuova aggiunge solo contatti nuovi.
**Impostazioni › Anagrafica clienti – Importa da Taylor**: Excel/CSV, colonne riconosciute per nome (mappa ricordata), **prova senza scrivere** (nuovi / aggiornati / invariati / protetti / errori + differenze), conferma; upsert per `cod_cliente` in `clienti` + contatto in rubrica; le modifiche manuali non si sovrascrivono senza «Sovrascrivi»; registro `clienti_importazioni` con rapporto errori scaricabile.

## Email: Outlook (bozza .eml formattata)
Decisione del titolare (10/11/2026): tutte le email partono dalla casella Outlook di Jennifer, **senza copia/incolla**. `centralino_impostazioni.invio_email` = `'outlook'` (predefinito) | `'automatico'` (Resend).
- **«Apri in Outlook»** (ovunque: passi, coordinatore/tecnico, riepilogo commerciale, compositore, due email del trasferimento) scarica subito una bozza **`.eml`** (`X-Unsent: 1`, To, Cc, Subject RFC 2047 UTF-8, `multipart/alternative` testo + HTML in base64, logo per URL assoluto, nessun allegato). Nome: `{numero} - {oggetto breve}.eml`, tipo `message/rfc822`. Aperta, Outlook desktop la mostra come messaggio nuovo pronto: si preme Invia. Toast: «Bozza pronta: aprila (si apre in Outlook) e premi Invia».
- Suggerimento una tantum (localStorage): in Chrome/Edge, freccia del download → «Apri sempre i file di questo tipo».
- Secondario **«Outlook testo semplice»**: `mailto:` (CRLF, `;`, ≤ 1900 caratteri; oltre, testo negli appunti) per Outlook nuovo/web dove l'.eml si apre in sola lettura.
- Il clic registra `email_inviata` con `modo='outlook'` e avanza il passo come prima.
- Codice: `src/lib/centralino/emailHtml.ts` (`costruisciEmailHtml`, `costruisciEmailTesto`, `costruisciEml`, `scaricaEml`, `nomeFileEml`), `mailto.ts` (`apriBozza`, `costruisciMailto`), `modelli.ts` (`emailDaModello`, `residui`); test `emailHtml.test.ts`.

## Email premium (0069)
Stile Apple Light, solo CSS inline, layout a tabelle (Outlook desktop): logo `https://molajoni-flotta.vercel.app/logo-molajoni.png`, linea rossa, etichetta («MOLAJONI ANTINCENDI · DAL 1930» o «CENTRALINO · USO INTERNO» se l'oggetto inizia con `[Centralino]`), titolo, **dati in evidenza** (tabella a 2 colonne; le righe vuote/«—» non compaiono), testo, firma «Jennifer Marchetti · Front office · Molajoni Antincendi s.r.l. · dal 1930 · tel. 06 6941 4281 · info@molajoni.it» oppure firma del **TMQ** scelto. Anteprima nel compositore, nelle due email del trasferimento e nell'editor dei modelli.
Colonne nuove di `email_template`: `titolo`, `dati` (jsonb `[[etichetta, "{segnaposto}"], …]`), `firma_tipo` (`front_office|tmq|nessuna`). Segnaposto nuovi: `{saluto}` (Buongiorno/Buonasera, cambio alle 14:00), `{tel_tecnico}` (« (tel. …)» o vuoto), `{rif_pratica}` (« – CT-…» o vuoto), `{scadenza}`, `{tmq}`; `{scadenza_richiamo}` ora è l'ora reale (creazione + 2 ore d'ufficio), `{urgenza}` = Urgente/Ordinario.

## Modelli email (revisione 0069, procedura Rev.01/2027 + decisioni del titolare)
Oggetti: parola chiave in MAIUSCOLO come nella procedura + cliente + numero pratica; interni `[Centralino] …`. Clienti: «Vi/Vostra», saluto finale della procedura. Revisione completa: `/mnt/user-data/outputs/centralino_revisione_email.md`.

| Flusso · passo | Modello | Oggetto |
|---|---|---|
| Manutenzione · coordinatore | `intervento_coordinatore` | [Centralino] Intervento da assegnare – {cliente} – {urgenza} |
| Manutenzione · cliente informato | `intervento_cliente` | INTERVENTO PROGRAMMATO – {cliente} – {numero} |
| Manutenzione (facoltativo) | `presa_intervento` | RICHIESTA INTERVENTO – PRESA IN CARICO – … |
| Sopralluogo · coordinatore | `sopralluogo_coordinatore` | [Centralino] Sopralluogo da assegnare – … |
| Sopralluogo · cliente (cc commerciale) | `sopralluogo_cliente` | CONFERMA APPUNTAMENTO – … (quando, Tecnico Commerciale, tel.) |
| Offerta gestita da Jennifer · conferma / offerta | `presa_offerta_piccola` / `invio_offerta` | PREVENTIVO – … («entro 60 minuti» / in allegato) |
| Offerta al Tecnico Commerciale · cliente / commerciale | `presa_offerta_grande` / `riepilogo_commerciale` | RICHIESTA PREVENTIVO – PRESA IN CARICO – … / [Centralino] Preventivo da gestire – … – richiamare entro le hh:mm |
| Offerta da tablet TMQ · inviato | `preventivo_tmq` (firma TMQ) | PREVENTIVO DA PARTE DEL TMQ VVF – … |
| Modifica · evasione | `modifica_evasa` (Anagrafica → `conferma_anagrafica`, Disdetta → `conferma_disdetta`, `src/lib/centralino/passi.ts`) | RICHIESTA EVASA / AGGIORNAMENTO DATI / DISDETTA – CONFERMA DI RICEZIONE – … |
| Girate | `girata_ufficio` | RICHIESTA INOLTRATA – … |
| Trasferimento · referente / cliente | `trasf_referente` / `riepilogo_trasferita` · `riepilogo_richiamo` | [Centralino] Chiamata trasferita – … / RIEPILOGO TELEFONATA – … · RICHIESTA PRESA IN CARICO – … |

Disattivati (non cancellati): `conferma_intervento`, `conferma_sopralluogo`, `conferma_modifica_calendario` (servivano data/fascia, non più raccolte), `conferma_urgente_allarme` (sostituito da `presa_intervento`), `followup_offerta` (nessun passo; «chi richiama per l'offerta» è ancora una domanda aperta della procedura).

## Offerte da tablet TMQ (B.1, 0069)
Canale «Tablet TMQ» + «Offerta» → tipo `offerta_tablet`: Ricevuta → **Verificato** (TMQ che firma, scelto tra i tecnici + casella «Preventivo verificato in tutte le sue parti», requisito `verificato` in `privato.ct_mancanti`) → **Inviato al cliente** (`preventivo_tmq`). SLA `{"tipo":"giorni_lav","valore":1,"ora":"12:00"}` = entro le 12:00 del giorno lavorativo successivo (nuovo campo `ora` in `privato.ct_sla` e `sla.ts`). Nel registro conta come «Offerte da tablet» (`tipo like 'offerta%' and canale = 'tablet_tmq'`).

## Risponditore e Emergenze h24
Nel Nuovo contatto (telefono) il promemoria del risponditore: 1 Manutenzione e Commerciale · 2 Fatture (pomeriggio cellulare di Simona Colagrossi) · 3 Fornitori lun/ven (Roberta Felci) · **4 Emergenze tecniche h24 (tel. da definire)**. «Emergenze h24» è anche un destinatario dei trasferimenti (`destinatari_trasferimento`, email da compilare).

## Registro del giorno
`centralino_registro_giorno(p_data)`: telefonate, WhatsApp, email, offerte da tablet / WA / cliente, aggiornamenti anagrafica (= pratiche «modifica»), chiuse — calcolati dalle pratiche (nessun doppio inserimento) + «+1 chiamata informativa» (`centralino_chiamate_info`).

## Assenza
`centralino_copertura()`: se un account centralino (collegato al dipendente) ha un'assenza approvata oggi, banner «Centralino coperto da Simona Colagrossi» (`sostituto`).

## Tastiera
Il Centralino si usa tutto senza mouse. Helper in `src/centralino/tastiera.ts` (test: `tastiera.test.ts`); l'elenco `SCORCIATOIE` alimenta il riquadro <kbd>?</kbd>.

**Ovunque** (non partono mentre si scrive in un campo, tranne <kbd>Esc</kbd> e <kbd>Ctrl</kbd>+<kbd>Invio</kbd>):
- <kbd>N</kbd> nuovo contatto · <kbd>/</kbd> cerca · <kbd>?</kbd> riquadro scorciatoie (anche pulsante «?» nella barra)
- <kbd>G</kbd> poi <kbd>O</kbd>/<kbd>P</kbd>/<kbd>T</kbd>/<kbd>C</kbd> → Oggi / Pratiche / Trasferimenti / Clienti (entro 1,2 s)
- <kbd>Esc</kbd> chiude la finestra; in un campo toglie il focus; sulla scheda pratica torna indietro

**Nuovo contatto**: all'apertura il focus è sul Canale. Canale, Cosa chiede, Dettaglio (sottotipo), Urgenza e Gestita da Jennifer / Passa al Tecnico Commerciale sono gruppi a scelta (`role="radiogroup"`, roving tabindex): <kbd>←</kbd><kbd>→</kbd>/<kbd>↑</kbd><kbd>↓</kbd> spostano, <kbd>Invio</kbd>/<kbd>Spazio</kbd> scelgono e portano al gruppo successivo, <kbd>1</kbd>–<kbd>9</kbd> scelgono la n-esima voce (il numero compare sulla voce quando il gruppo ha il focus). <kbd>Tab</kbd>/<kbd>Maiusc</kbd>+<kbd>Tab</kbd> tra gruppi e campi. Cliente: <kbd>↑</kbd><kbd>↓</kbd> nei suggerimenti, <kbd>Invio</kbd> sceglie, <kbd>Esc</kbd> chiude l'elenco. <kbd>Ctrl</kbd>+<kbd>Invio</kbd> salva da qualunque punto.

**Passo (Avanza)**: focus sul primo campo; tendine con le frecce; caselle e «Telefonato» con <kbd>Spazio</kbd>; «Quando» è un gruppo a scelta; <kbd>Invio</kbd> = Avanti; <kbd>Esc</kbd> = chiudi.

**Elenchi** (Oggi «Adesso», Pratiche, Trasferimenti): <kbd>J</kbd>/<kbd>K</kbd> o <kbd>↓</kbd>/<kbd>↑</kbd> spostano la riga evidenziata (focus reale sul link della riga), <kbd>Invio</kbd> apre, <kbd>A</kbd> fa il prossimo passo (pulsante `[data-k-avanza]` della card in Oggi; nella scheda pratica aperta, come prima).

Anello di focus: `--info` 2px + alone `--info-bg` (token Apple Light). Suggerimenti tasti `.k-hint` discreti, nascosti su dispositivi touch.

## RPC
`centralino_crea(p)`, `centralino_avanza(p_id, p_stadio, p_dati, p_testo)`, `centralino_chiudi(p_id, p_esito, p_testo)`, `centralino_nota(p_id, 'nota'|'chiamata', p_testo, p_dati)`, `centralino_aggiorna(p_id, p)`, `centralino_invia_email(...)`, `centralino_allegato(...)` (bucket privato `pratiche`, 10 MB, pdf/jpg/png/docx/xlsx/eml/msg, percorso `<pratica>/<uuid>.<ext>`), `centralino_chiamata_info`, `centralino_registro_giorno`, `centralino_clienti`, `centralino_sedi`, `centralino_persone`, `centralino_copertura`, `centralino_controlla_sla`, `centralino_sla_anteprima`, `centralino_stato_cliente`, `centralino_imposta_stato_cliente`, `centralino_trasferisci(p)`, `centralino_richiamato(p_id, p_nota)`, `centralino_trasf_email(...)`, `centralino_trasf_senza_email(p_id, p_motivo)`. Taylor: nessuna integrazione, solo la casella «Alert inviato su Taylor».

## Prove
- `npm test` → `src/lib/centralino/sla.test.ts` (SLA con weekend, festività, orario, ora legale; semaforo; modelli; KPI; trasferimenti).
- `supabase/prove/centralino_prove.sql`: blocco DO annullato (RLS per ruolo incl. anon, storia solo in aggiunta, SLA, contatori, SLA scaduto, **ordine rigido dei passi**, requisiti Taylor/email, annullo, spostamento, **appunti solo dell'autore**, **offerte per gestione** (Jennifer / Tecnico Commerciale, importo ignorato, compatibilità vecchi client, passaggio al commerciale) con richiamo 2 ore) + secondo blocco «PROVE TRASFERIMENTI OK» (richiamo, email al referente/cliente, richiamato, rubrica con storia e +39, import clienti con prova e protezione, permessi direzione/anon).
- QA visivo: Playwright con dati finti a 1440, 1280 e 1024 px (home, pratica, direzione, dettaglio, trasferimenti, impostazioni, nuovo contatto, email doppia): nessun elemento fuori larghezza. Da eseguire in SQL editor: risultato atteso `PROVE CENTRALINO OK`. Il calcolo SLA è stato verificato sul database con 8 casi (tutti ok).

## Azzera dati di prova (solo admin)
Impostazioni › «Zona pericolosa»: conteggi esatti (`admin_centralino_conteggi`), backup JSON scaricato in automatico, conferma scrivendo `AZZERA`, filtro facoltativo «Solo pratiche create prima del…», casella contatti `fonte='centralino'` (default spenta). RPC `admin_centralino_azzera(p_fino_a, p_contatti)`: cancella pratiche e collegati, file del bucket `pratiche` (dal client), trasferimenti, appunti, email/notifiche del centralino, chiamate informative e (senza data) `pratiche_contatori` → si riparte da CT-AAAA-000001. La storia ammette DELETE solo con `privato.azzera = on` (impostato dalla RPC). Registro non cancellabile: `centralino_azzeramenti`. Mai toccati: clienti Taylor, referenti, modelli, flussi, impostazioni.
**Stato**: SQL in `supabase/da_confermare/azzera_centralino.sql`, da applicare a mano (la migrazione con DELETE è stata bloccata dal controllo dell'ambiente). Finché non c'è, il pulsante mostra «In attesa di attivazione» e si attiva da solo dopo.

## Area Direzione
KPI nuovi nel registro: `cliente1h`, `sla_passo` (filtro `passo`), `urgenti_giornata`, `off_piccole(_inviate)`, `off_grandi(_passate)`, `comm_in_tempo`, `comm_scaduti`, `qual_email`, `annullate(_motivo)`, `senza_contatti`; filtri `ora`/`dow` (heatmap). Calcoli in `src/lib/direzione/analisi.ts` (test `analisi.test.ts`). Email delle 18:00: `supabase/da_confermare/direzione_digest.sql` (tabella `direzione_preferenze`, RPC `direzione_digest_imposta/stato`, job pg_cron `direzione_digest` lun–ven) **da applicare a mano**; finché manca, l'interruttore mostra «in attesa di attivazione». Resend in prova: l'email arriva solo all'indirizzo del titolare Resend. Prove RLS: `supabase/prove/direzione_prove.sql` (atteso `PROVE DIREZIONE OK`).

## Solo richieste dei clienti (0071–0073, 10/11/2026)

- Il centralino gestisce **solo richieste dei clienti**: niente selettore «Chi chiama» (nuovo contatto, liste, badge, filtri, KPI, Direzione). Colonna `tipo_contatto` e dati restano (predefinito `cliente`). «Collega / Tecnico» e «Tablet TMQ» restano come **canali** (fonte), il soggetto è sempre un cliente.
- Cosa chiede: Intervento manutenzione, Sopralluogo, Offerta (Gestita da Jennifer / Passata al Tecnico Commerciale), Offerta da tablet TMQ, Modifica calendario/anagrafica/disdetta, Informazione al cliente. «Chiamata per un responsabile» resta, solo clienti.
- **Fatture e Fornitori non sono pratiche**: flussi `amministrazione` e `fornitori` disattivati (dati conservati), esclusi da registro, KPI, Direzione e report. Restano solo le indicazioni del risponditore (tasto 2 → Simona Colagrossi, tasto 3 → Roberta Felci). `centralino_chiamata_girata` (0072) non è più eseguibile (0073); la colonna `centralino_chiamate_info.categoria` resta inutilizzata.
