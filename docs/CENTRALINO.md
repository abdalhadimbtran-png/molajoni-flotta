# Centralino (front office) e monitoraggio Direzione

## Centralino semplificato (0095–0097, 24/11/2026) — VALE QUESTO
Decisione di Hadi dopo una settimana d'uso: pochissimi clic, email solo per le offerte. Le sezioni sotto su coordinatore/tecnico/sopralluogo, Informazione a 3 esiti, trasferimenti e email di riepilogo sono **storiche** (dati e colonne restano).
| Tipo | Cosa fa Jennifer | Clic dopo il modulo |
|---|---|---|
| Offerta · Gestita da Jennifer | «Salva e apri email» → Apri in Outlook (presa in carico «riceverete il preventivo entro 60 minuti», `presa_offerta_piccola`; senza email cliente: «Avvisato per telefono») → più tardi Apri in Outlook offerta (`invio_offerta`) → chiusa. L'offerta richiede l'email del cliente (requisito `email_inviata`). | 2 |
| Offerta · Passa al Tecnico Commerciale | Commerciale dai Referenti → «Apri in Outlook e chiudi» (`riepilogo_commerciale`: nome, codice, contatto, telefono, email, indirizzo, sede, cosa chiede) o «Avvisato per telefono» → chiusa. **Nessun richiamo 2 ore**, nessuna email al cliente. | 1 |
| Intervento · Sopralluogo · Modifiche/Disdetta · Informazione | Una schermata: tipo, cliente, nota, «Passata a» (facoltativo, Referenti), urgenza solo per Intervento (default Ordinario). **Salva e chiudi** (Ctrl+Invio) o **Salva da seguire** (Ctrl+Maiusc+Invio) → poi un solo «Chiudi» (`centralino_chiudi_semplice`, tasto A). Nessuna email, nessun SLA; promemoria leggero «da più di 24 ore». | 0 / 1 |
- Flussi (`pratiche_flussi`): non-offerte = `ricevuta → chiusa` senza SLA; `offerta_piccola` = ricevuta → conferma (10 min) → offerta (60 min); `offerta_grande` = ricevuta → riepilogo (15 min). Pratiche vecchie rimaste su passi tolti: pulsante «Chiudi».
- `centralino_crea`: `chiudi` (solo non-offerte), `assegnato_nome` = «Passata a», urgenza solo manutenzione; `centralino_passa_commerciale` senza richiamo; cron SLA solo offerte.
- Modelli attivi: `presa_offerta_piccola`, `invio_offerta`, `riepilogo_commerciale` (+ `preventivo_tmq` del canale Tablet TMQ); gli altri `attivo=false`.
- Tolti dall'interfaccia: passi Avanza per non-offerte, esiti Informazione, finestre email per non-offerte, «Per un responsabile», menu Trasferimenti (la pagina resta per lo storico), sezioni Servizio/Trasferimenti della Direzione.
- Direzione e Report Direzione (`privato.report_sez_centralino`, 0097): contatti per tipo/canale, offerte Jennifer vs Commerciale, % offerte inviate entro 60 min, da seguire aperte (KPI `da_seguire`).
- Prove: `supabase/prove/semplice_prove.sql` (atteso `PROVE SEMPLICE OK`).

## Ciclo delle offerte (0099–0100, 25/11/2026) — richiesta del titolare
**Stato DB**: migrazioni in `supabase/da_confermare/20261125_0099_offerte_ciclo.sql` e `20261125_0100_report_direzione_offerte.sql` (applicazione annullata dal controllo di approvazione: applicarle in quest'ordine). Finché non sono applicate le pagine mostrano «Il registro delle offerte non è ancora attivo».
- Tabella `pratiche_offerta` (1:1 con la pratica offerta_*): `gestione` jennifer/collega, `gestita_da` («Jennifer» o referente attivo), `arrivata_il` (default created_at, modificabile, non futura, max 60 giorni), `scadenza`, `inviata_il`, `esito` da_inviare/in_attesa/accettata/non_accettata/annullata, `motivo` (Prezzo, Tempi, Scelto un concorrente, Nessuna risposta del cliente, Non più necessario, Altro + nota), `motivo_ritardo`, `numero_offerta_adhoc`, `aggiornata_il/da`. Importo = `pratiche.importo_stimato`. RLS sola lettura `is_centralino_lettura()` (direzione legge).
- Scadenza `public.offerta_scadenza(arrivata, gestione)`: Jennifer +60 min; colleghi 2 giorni lavorativi (lun–ven, `festivita` escluse), stessa ora di Roma.
- Trigger `pratiche_offerta_sync` su pratiche: crea la riga, aggiorna il commerciale; offerta di Jennifer chiusa ok (email 2) → `inviata_il = closed_at`, in_attesa; pratica annullata → offerta annullata (Altro). L'offerta passata al collega resta aperta anche se la pratica del centralino è chiusa. Backfill di tutte le offerte esistenti.
- RPC `offerta_aggiorna(p_id, p jsonb)` e `offerta_nota(p_id, testo)` (SECURITY DEFINER, `is_centralino`, revocate ad anon/public), eventi `pratiche_eventi.tipo = 'offerta'`. Motivo obbligatorio per Non accettata/Annullata; motivo del ritardo obbligatorio **solo per le offerte di Jennifer** (decisione di Hadi 25/11: per i colleghi oltre i 2 giorni lo stato è «Scaduta», solo informativo).
- Impostazione `offerte_aggiornamento_obbligatorio` (default `false`): se `true`, le offerte aperte non aggiornate oggi sono «Da aggiornare oggi» (in cima alla pagina, banner in Oggi). Spenta: nessun obbligo.
- Pagina **Offerte** (`/centralino/offerte`, dopo Oggi): schede «Passate ai colleghi» / «Mie offerte», azioni Inviata · Accettata · Non accettata · Annullata · Nota (tasti I, Y, X, O; J/K; Invio apre). Riquadro «Offerta» nella scheda pratica (+ Modifica: arrivata il, gestita da, N. Ad Hoc, importo). Nuovo contatto › Offerta: campo «Arrivata il» (vuoto = adesso). Registra chiamata: «Quando» = arrivata il.
- **Direzione** riscritta (`src/direzione/Centralino.tsx`, «Centralino e offerte»): Offerte prima (6 numeri con definizione visibile, Tutte/Jennifer/Colleghi, per persona, motivi, canale, «Tutte le offerte» con filtri), poi Chiamate e richieste. Panoramica: numeri di oggi con definizione. Testi in `src/lib/centralino/testiDirezione.ts` (export: `scripts/esporta-testi-direzione.ts`).
- Report Direzione: sezione «Centralino e offerte» (0100) con gli stessi testi, per persona, motivi, offerte non accettate (per il controllo qualità), ancora da inviare.
- Prove: `supabase/prove/offerte_prove.sql` (atteso `PROVE OFFERTE OK`; verificato su Postgres 16 locale con schema minimo), `src/lib/centralino/offerte.test.ts`.

## Registra chiamata (0098, 25/11/2026)
Chiamate di prima che Jennifer non ha inserito in diretta. Pulsante «Registra chiamata» accanto a «Nuovo contatto» (barra in alto, solo icona sotto 1500 px) e in Oggi; tasto **R** (fuori dai campi). Una finestra:
- **Quando**: Oggi/Ieri + ora HH:MM (predefinita adesso). **Canale**: Telefono/WhatsApp/Email/Altro (tasti 1–4). **Chi**: ricerca clienti (come Nuovo contatto, cliente con codice → stato «attivo») oppure nome libero + telefono. **Cosa voleva** (obbligatorio) + tipo Intervento/Sopralluogo/Offerta/Modifiche/Informazione (predefinito Informazione). **Esito**: Gestita da me (G) / Passata a… (P → referente attivo, obbligatorio).
- **Registra** (Ctrl+Invio) · **Registra e nuova** (Ctrl+Maiusc+Invio: finestra aperta, campi svuotati, giorno e canale tenuti). Bozza in localStorage, nessuna chiusura con clic fuori.
- RPC `centralino_registra_chiamata(p jsonb)` (SECURITY DEFINER, `is_centralino()`, revocata ad anon/public): ora non nel futuro e non oltre 7 giorni; crea la pratica già **chiusa_ok** con `created_at = closed_at = ora scelta`, `registrata_dopo = true`, `inserito_il = now()`, `assegnato_nome` = Passata a, `sla_rispettato = null`; Offerta → `offerta_piccola` (gestita) / `offerta_grande` (passata). Nessuna email, passo o SLA.
- Etichetta «Registrata dopo» in Pratiche, scheda, Clienti, coda e Movimenti di Oggi. Direzione: KPI `registrate_dopo` (pagina e Report Direzione); contano nei volumi per tipo/canale, escluse da «% offerte entro 60 min» (lato SQL `report_sez_centralino`) e dai KPI di tempo (nessun evento SLA).
- Prove: `supabase/prove/registra_chiamata_prove.sql` (atteso `PROVE REGISTRA OK`). Logica pura: `src/lib/centralino/registra.ts` (+ test).

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
| `/direzione/centralino` | direzione, admin | Periodo Oggi/Settimana/Mese/Personalizzato con confronto ▲▼; Volumi (canale, tipo, chi chiama, stato cliente, heatmap giorno×ora, trend 30/90), Servizio (SLA per tipo e passo, tempi, prima risposta, scadute, urgenze in giornata), Offerte (gestite da Jennifer / passate al Tecnico Commerciale, richiami per commerciale), Trasferimenti, Qualità, Registro di Jennifer, Movimenti; «Report direzione» PDF/Excel; interruttore «Report settimanale e mensile (PDF)», «Scarica report settimana/mese», «Invia report di prova» (admin) – vedi `docs/REPORT_DIREZIONE.md` |
| `/direzione/centralino/pratica/:id` | direzione | Stessa scheda, sola lettura |

Scorciatoia **N** = nuovo contatto, **R** = registra chiamata (fuori dai campi). Ricerca in alto: cliente, contatto, telefono (ultime 6 cifre), email, `CT-…`. Scheda «Centralino oggi» nella Panoramica dell'amministratore.

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
| Manutenzione (rev2, 0056) | Ricevuta (urgenza) → ★Inviato al coordinatore (email + «Telefonato») → ★Assegnato dal coordinatore (al telefono, nessuna scelta) → ★Cliente informato (email «sarete contattati a breve da un nostro tecnico», senza nomi) → Buono creato e tecnico avvisato (n. buono + Taylor + WhatsApp, avviso app facoltativo) → chiusa | **10 / 45 / 60 min** dalla chiamata; obiettivo: urgente = oggi, ordinario = entro 2 gg lav. |
| Sopralluogo (rev2; ripristinato con 0076) | Ricevuta → ★Inviato al coordinatore sopralluoghi → ★Tecnico / commerciale individuato (Jennifer sceglie il Tecnico Commerciale + quando) → ★Cliente informato (email «appuntamento {quando} con il nostro Tecnico Commerciale {tecnico}{tel_tecnico}», cc commerciale) → Avviso inviato | 10 / 45 / 60 min |
| Offerta gestita da Jennifer (`offerta_piccola`) | come da flusso in `pratiche_flussi` (0055), senza passo «Esito» | conferma 10 min, offerta 60 min dalla richiesta |
| Offerta passata al Tecnico Commerciale (`offerta_grande`; L. Esposito / A. Chiaradonna / A. Querini, il primo disponibile) | Ricevuta (commerciale) → ★Email al cliente «Entro 2 ore la contatterà il nostro Tecnico Commerciale {nome}» → ★Email di riepilogo al commerciale → chiusa per Jennifer | **10 / 15 min**; richiamo 2 ore per il commerciale sempre creato |
| Modifica / anagrafica / disdetta | Ricevuta → ★Registrata → ★Evasione comunicata → Chiusa | in giornata; email entro giorno lav. successivo |
| Amministrazione · Fornitori (disattivati) | Ricevuta → ★Girata a Simona Colagrossi / Roberta Felci (lun/ven) → Chiusa | in giornata |
| Informazione (anche info@; 0083) | Ricevuta → ★Esito: 1 a voce · 2 via email · 3 girata a un responsabile → Chiusa (sempre chiusa_ok, nessun richiamo) | in giornata |
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
| Inviato al coordinatore (10 min) | Referenti con «Coordinamento interventi/sopralluoghi», in ordine; primo disponibile preselezionato (`centralino_coordinatori`); email precompilata + interruttore «Telefonato» (basta uno dei due). Menu a gruppi (0061): Coordinatori · Altri referenti (`centralino_altri_referenti`, escluso «Tecnico») (0075/0076: gruppo Tecnici nel menu **solo per i sopralluoghi**; per intervento/manutenzione niente tecnici) |
| Assegnato dal coordinatore (45 min) — solo intervento/manutenzione | **0075:** Jennifer non sceglie né nomina il tecnico: l'assegnazione la decide il coordinatore (Alberto/Antonella) al telefono. Il passo non ha requisiti (key `tecnico` invariata; colonne `tecnico_*` restano) |
| Cliente informato (60 min) | Intervento/manutenzione: email generica «sarete contattati a breve da un nostro tecnico» (anche la presa in carico); l'email interna al coordinatore dice che il tecnico lo assegna lui e contatta direttamente il cliente (0076). Sopralluogo: com'era prima (Tecnico Commerciale + quando, presa in carico «Vi ricontatteremo per comunicarVi il nome del Tecnico Commerciale») |
| Buono creato e tecnico avvisato | N. buono + «Taylor + WhatsApp»; «Avviso urgente nell'app» solo se la pratica ha già un tecnico registrato (`centralino_avviso_tecnico`, campanella al tecnico, registrato); poi chiusura automatica |
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

## Email: Outlook con un clic + «Avvisato per telefono»
Decisione del titolare (10/11/2026): tutte le email partono dalla casella Outlook di Jennifer, **senza copia/incolla**. `centralino_impostazioni.invio_email` = `'outlook'` (predefinito) | `'automatico'` (Resend).
- **«Apri in Outlook»** (ovunque: passi, coordinatore/tecnico, riepilogo commerciale, compositore, due email del trasferimento) apre subito Outlook con `mailto:` (A/CC con `;`, oggetto, testo semplice CRLF). Testo pulito da `testoMailto`: senza titolo/firma «--», chiusura «Grazie per la preferenza e distinti saluti» (o «Distinti saluti» per le email interne) + «Molajoni Antincendi s.r.l. / J. Marchetti». Limite URL 1800 caratteri: oltre, il corpo si accorcia (firma tenuta) e il testo completo va negli appunti.
- Secondario: l'altro formato (vedi sotto).
- **«Avvisato per telefono»** (tasto **T** nelle finestre email/passo): RPC `centralino_avvisato_telefono(p_pratica_id, p_trasf_id, p_chi, p_destinatario, p_template, p_avanza)` (migrazione 0074) → evento `nota` con `dati.canale='telefono'`, `comunicazione=true`; nei trasferimenti valorizza `email_referente_inviata_at` / `email_cliente_inviata_at` come l'email; nei passi il passo avanza come con l'email.
- Il clic registra `email_inviata` con `modo='outlook'` e avanza il passo come prima.
- Codice: `src/lib/centralino/emailHtml.ts` (`costruisciEmailHtml`, `costruisciEmailTesto`, `costruisciEml`, `scaricaEml`, `nomeFileEml`), `mailto.ts` (`apriEmail`, `testoMailto`, `costruisciMailto`, `apriBozza`), `modelli.ts` (`emailDaModello`, `residui`); test `emailHtml.test.ts`.

### Formattata in Outlook con un clic (17/11/2026)
- **«Apri in Outlook»** (pulsante unico ovunque) con formato **«Formattata (Outlook)»** (predefinito) scarica una bozza `.eml` (`X-Unsent: 1`, multipart/alternative testo+HTML base64, oggetto RFC 2047) chiamata `«{numero pratica} - {oggetto breve}.eml»`: Outlook la apre come messaggio nuovo pronto da inviare. Con **«Testo semplice»** resta il `mailto:`. Il link piccolo nel compositore («usa testo semplice / usa formattata») e il link secondario nelle email del trasferimento usano l'altro formato.
- **Mittente**: nessuna intestazione `From:` → Outlook usa l'account predefinito del PC (la casella di Jennifer `j.marchetti@molajoni.it`). `Reply-To` = email dell'account collegato (mai `info@`). Firma: nome da `responsabili.nome` (fallback «J. Marchetti») + «Molajoni Antincendi s.r.l.» + telefono aziendale. `info@` tolto da firma HTML/testo, piè di pagina, firma TMQ e (migrazione `0091`) da `centralino_impostazioni.firma` e `email_template.corpo_html`; la firma configurata viene comunque ripulita da `pulisciFirma`.
- **Preferenze di questo PC** (localStorage, `src/lib/centralino/preferenze.ts`), in Flussi e impostazioni → «Email su questo PC»: *Formato email* e *Firma automatica Outlook attiva* (predefinito no; se sì la nostra firma di testo/HTML e `{firma}` non si mettono, per non duplicare quella di Outlook).
- **Prima configurazione del PC di Jennifer** (suggerimento in 2 righe nel compositore, una volta sola): 1) Chrome/Edge: dopo il primo download clicca la freccia del file → «Apri sempre i file di questo tipo»; 2) Windows: Impostazioni → App → App predefinite → `.eml` → Outlook; 3) in Outlook verificare che l'account predefinito sia `j.marchetti@molajoni.it`; 4) disattivare la firma automatica per i *nuovi messaggi* in Outlook **oppure** attivare «Firma automatica Outlook attiva».


## Email premium (0069)
Stile Apple Light, solo CSS inline, layout a tabelle (Outlook desktop): logo `https://molajoni-flotta.vercel.app/logo-molajoni.png`, linea rossa, etichetta («MOLAJONI ANTINCENDI · DAL 1930» o «CENTRALINO · USO INTERNO» se l'oggetto inizia con `[Centralino]`), titolo, **dati in evidenza** (tabella a 2 colonne; le righe vuote/«—» non compaiono), testo, firma dell'operatore collegato («Jennifer Marchetti» / fallback «J. Marchetti» · Molajoni Antincendi s.r.l. · tel. 06 6941 4281, **mai info@**) oppure firma del **TMQ** scelto. Anteprima nel compositore, nelle due email del trasferimento e nell'editor dei modelli.
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
| Informazione · via email | `risposta_informazione` | RISPOSTA ALLA VOSTRA RICHIESTA DI INFORMAZIONI – {cliente} – {numero} |
| Informazione · girata (responsabile / cliente facoltativa) | `girata_referente` / `girata_ufficio` | [Centralino] Richiesta da gestire – … / RICHIESTA INOLTRATA – … («il nostro responsabile {referente} Vi ricontatterà») |
| Trasferimento · referente / cliente | `trasf_referente` / `riepilogo_trasferita` · `riepilogo_richiamo` | [Centralino] Chiamata trasferita – … / RIEPILOGO TELEFONATA – … · RICHIESTA PRESA IN CARICO – … |

Disattivati (non cancellati): `conferma_intervento`, `conferma_sopralluogo`, `conferma_modifica_calendario` (servivano data/fascia, non più raccolte), `conferma_urgente_allarme` (sostituito da `presa_intervento`), `followup_offerta` (nessun passo; «chi richiama per l'offerta» è ancora una domanda aperta della procedura).

## Offerte da tablet TMQ (B.1, 0069)
Canale «Tablet TMQ» + «Offerta» → tipo `offerta_tablet`: Ricevuta → **Verificato** (TMQ che firma, scelto tra i tecnici + casella «Preventivo verificato in tutte le sue parti», requisito `verificato` in `privato.ct_mancanti`) → **Inviato al cliente** (`preventivo_tmq`). SLA `{"tipo":"giorni_lav","valore":1,"ora":"12:00"}` = entro le 12:00 del giorno lavorativo successivo (nuovo campo `ora` in `privato.ct_sla` e `sla.ts`). Nel registro conta come «Offerte da tablet» (`tipo like 'offerta%' and canale = 'tablet_tmq'`).

## Risponditore e Emergenze h24
Il promemoria del risponditore non è più mostrato nel Nuovo contatto (rimosso su richiesta). «Emergenze h24» è anche un destinatario dei trasferimenti (`destinatari_trasferimento`, email da compilare).

## Registro del giorno
`centralino_registro_giorno(p_data)`: telefonate, WhatsApp, email, offerte da tablet / WA / cliente, aggiornamenti anagrafica (= pratiche «modifica»), chiuse — calcolati dalle pratiche (nessun doppio inserimento) + «+1 chiamata informativa» (`centralino_chiamate_info`).

## Assenza
`centralino_copertura()`: se un account centralino (collegato al dipendente) ha un'assenza approvata oggi, banner «Centralino coperto da Simona Colagrossi» (`sostituto`).

## Tastiera
Il Centralino si usa tutto senza mouse. Helper in `src/centralino/tastiera.ts` (test: `tastiera.test.ts`); l'elenco `SCORCIATOIE` alimenta il riquadro <kbd>?</kbd>.

**Ovunque** (non partono mentre si scrive in un campo né con una finestra aperta; <kbd>Esc</kbd> esce dal campo):
- <kbd>N</kbd> nuovo contatto · <kbd>/</kbd> cerca · <kbd>?</kbd> riquadro scorciatoie (anche pulsante «?» nella barra)
- <kbd>G</kbd> poi <kbd>O</kbd>/<kbd>P</kbd>/<kbd>C</kbd> → Oggi / Pratiche / Clienti (entro 1,2 s)
- <kbd>Esc</kbd> chiude la finestra (non Nuovo contatto); in un campo toglie il focus; sulla scheda pratica torna indietro
- Nota: la pagina Clienti apre con il focus nella ricerca: premi <kbd>Esc</kbd> prima di <kbd>N</kbd>.

**Nuovo contatto** (gestore `keydown` sul document nella finestra, funziona anche col focus «da nessuna parte»): all'apertura il focus è sul Canale. Gruppi a scelta (`role="radiogroup"`, roving tabindex, `data-k-gruppo`): <kbd>←</kbd><kbd>→</kbd>/<kbd>↑</kbd><kbd>↓</kbd> spostano, <kbd>Invio</kbd>/<kbd>Spazio</kbd> scelgono e portano al gruppo successivo, <kbd>1</kbd>–<kbd>9</kbd> scelgono nel gruppo che ha il focus. Con il focus fuori da campi e gruppi (`tastoNuovo`): le cifre scelgono il Canale se non ancora fatto, poi la Richiesta; con Offerta <kbd>1</kbd>/<kbd>2</kbd> = Gestita da Jennifer / Passa al Commerciale; con Intervento le cifre vanno al Dettaglio e <kbd>U</kbd>/<kbd>O</kbd> = Urgente/Ordinario (anche dentro i gruppi). Cliente: <kbd>↑</kbd><kbd>↓</kbd> nei suggerimenti, <kbd>Invio</kbd> sceglie, <kbd>Esc</kbd> chiude l'elenco. <kbd>Ctrl</kbd>+<kbd>Invio</kbd> = Salva e chiudi (offerta: Salva e apri email), <kbd>Ctrl</kbd>+<kbd>Maiusc</kbd>+<kbd>Invio</kbd> = Salva da seguire, da qualunque punto. <kbd>Esc</kbd> esce solo dal campo: la finestra non si chiude (dati al sicuro).

**Passo (Avanza, solo offerte)**: focus sul primo campo; <kbd>T</kbd> = «Avvisato per telefono» (presa in carico offerta, email al commerciale); tendine con le frecce; caselle e «Telefonato» con <kbd>Spazio</kbd>; «Quando» è un gruppo a scelta; <kbd>Invio</kbd> = Avanti; <kbd>Esc</kbd> = chiudi.

**Elenchi** (Oggi «Adesso», Pratiche; disattivati con una finestra aperta): <kbd>J</kbd>/<kbd>K</kbd> o <kbd>↓</kbd>/<kbd>↑</kbd> spostano la riga evidenziata (focus reale sul link della riga), <kbd>Invio</kbd> apre, <kbd>A</kbd> fa il prossimo passo (pulsante `[data-k-avanza]` della card in Oggi; nella scheda pratica aperta, come prima).

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
KPI nuovi nel registro: `cliente1h`, `sla_passo` (filtro `passo`), `urgenti_giornata`, `off_piccole(_inviate)`, `off_grandi(_passate)`, `comm_in_tempo`, `comm_scaduti`, `qual_email`, `annullate(_motivo)`, `senza_contatti`; filtri `ora`/`dow` (heatmap). Calcoli in `src/lib/direzione/analisi.ts` (test `analisi.test.ts`). Email delle 18:00: **dismessa il 17/11/2026** (job `direzione_digest` rimosso, funzione no-op), sostituita dal Report Direzione settimanale/mensile in PDF (`docs/REPORT_DIREZIONE.md`). Storico: `supabase/da_confermare/direzione_digest.sql` (tabella `direzione_preferenze`, RPC `direzione_digest_imposta/stato`, job pg_cron `direzione_digest` lun–ven) **da applicare a mano**; finché manca, l'interruttore mostra «in attesa di attivazione». Resend in prova: l'email arriva solo all'indirizzo del titolare Resend. Prove RLS: `supabase/prove/direzione_prove.sql` (atteso `PROVE DIREZIONE OK`).

## Solo richieste dei clienti (0071–0073, 10/11/2026)

- Il centralino gestisce **solo richieste dei clienti**: niente selettore «Chi chiama» (nuovo contatto, liste, badge, filtri, KPI, Direzione). Colonna `tipo_contatto` e dati restano (predefinito `cliente`). «Tablet TMQ» resta come **canale** (fonte); «Collega / Tecnico» non è più selezionabile nel Nuovo contatto (scorciatoie 1 Telefono · 2 WhatsApp · 3 Email · 4 Tablet TMQ · 5 Altro), il valore `collega` resta leggibile nello storico, il soggetto è sempre un cliente.
- Cosa chiede: Intervento manutenzione, Sopralluogo, Offerta (Gestita da Jennifer / Passata al Tecnico Commerciale), Offerta da tablet TMQ, Modifica calendario/anagrafica/disdetta, Informazione al cliente. «Chiamata per un responsabile» resta, solo clienti.
- **Fatture e Fornitori non sono pratiche**: flussi `amministrazione` e `fornitori` disattivati (dati conservati), esclusi da registro, KPI, Direzione e report. Restano solo le indicazioni del risponditore (tasto 2 → Simona Colagrossi, tasto 3 → Roberta Felci). `centralino_chiamata_girata` (0072) non è più eseguibile (0073); la colonna `centralino_chiamate_info.categoria` resta inutilizzata.

## Revisione E2E (0080, 10/11/2026)
- Annullando una pratica, il richiamo automatico «2 ore» del Tecnico Commerciale si chiude («Pratica annullata»): niente promemoria, escalation o contatori per pratiche annullate.
- «Avvisato per telefono» al coordinatore con avanzamento: nome del coordinatore e telefonata valgono come dati del passo. Il compositore non propone più «Segna anche come fatto» per il passo coordinatore (si usa la finestra del passo); per Anagrafica/Disdetta lo propone col modello giusto (`avanzaConModello`, test `passi.test.ts`).
- Email dopo un passo (presa in carico, email al cliente del sopralluogo) si apre **dopo** il ricaricamento della pratica: segnaposto aggiornati (tecnico, quando) e il passo successivo non la sostituisce. Passo senza dati (Assegnato dal coordinatore) → si apre da solo il passo successivo.
- Filtri per data (Pratiche, Report, Analisi, Direzione) sul giorno di Roma (`inizioGiornoRoma`, `fineGiornoRoma`, `primoDelMeseRoma` in `sla.ts`): prima «Mese» partiva dall'ultimo giorno del mese precedente.

## Destinatari delle email (0081, 12/11/2026)
Regola unica in `src/lib/centralino/destinatari.ts` (`RUOLO_MODELLO`, `destinatarioPerAzione`, `controllaEmail`), test in `destinatari.test.ts`.
- **Cliente** (presa_*, intervento_cliente, sopralluogo_cliente, invio_offerta, presa_offerta_grande, preventivo_tmq, modifica_evasa, conferma_anagrafica/disdetta, girata_ufficio, girata_fornitore, riepilogo_trasferita/richiamo): A = email della pratica (o del trasferimento). Mai un indirizzo di un collega.
- **Coordinatore** (intervento_/sopralluogo_coordinatore): scelto nel passo; altrimenti il primo coordinatore attivo disponibile con email (Alberto Chiaradonna → Antonella D'Orazio).
- **Tecnico Commerciale** (riepilogo_commerciale): commerciale_email della pratica, altrimenti dall'elenco commerciali.
- **Referente** (girata_referente, trasf_referente): dai Referenti attivi (destinatari_trasferimento); i referenti disattivati non sono mai usati.
- Le email interne hanno l'oggetto «[Centralino] …{rif_pratica}» (numero pratica) e non possono andare all'email del cliente (A o CC): controllato nel browser e in `privato.ct_controlla_destinatario` (centralino_invia_email, centralino_trasf_email, centralino_trasf_email_referente).
- Prima di «Apri in Outlook»/.eml/invio: oggetto con numero pratica, nessun «{…}» rimasto, dati essenziali presenti (sopralluogo_cliente: tecnico e quando; presa_offerta_grande/riepilogo_commerciale: commerciale; girate: referente). Email mancante → «Manca l'email di Nome (ruolo)… oppure usa «Avvisato per telefono»».
- Nella finestra email la riga «A: Nome (ruolo) · indirizzo» mostra chi riceve.
- Fuori dal Centralino: riepilogo Direzione → email dell'account che l'ha attivato (0067); notifiche ferie/flotta invariate.

## Audit finale (0082, 12/11/2026)
Verificato (non rifatto): revisione E2E, matrice destinatari, grant 0078, `salva.ts`, `Protezione.tsx`.
- **Carico** (transazione annullata: 20k pratiche, 100k eventi, 12k clienti, 3k trasferimenti; ruolo centralino con RLS): Oggi/contatori/richiami/dettaglio/Direzione mese 0,2–14 ms. Prima della 0082: ricerca globale 185–193 ms senza risultati, registro del giorno 167 ms, autocompletamento clienti 92 ms. **0082**: `pg_trgm` + indici trigram su pratiche/clienti, RPC `centralino_cerca` (SECURITY DEFINER: con la RLS gli `ilike` non usano indici) → 2–9 ms; `centralino_registro_giorno` con intervalli sul giorno di Roma (risultati identici su 10 giorni) → 7,7 ms; autocompletamento 39 ms. Cron SLA: 485 ms solo al primo giro con ~300 scadenze insieme, poi 1 ms.
- **Limite 1000 righe dell'API**: `.limit(5000)` veniva tagliato a 1000 senza errore (KPI Direzione, trend 90 gg, elenco Pratiche). Ora `tutteLeRighe()` (`comune.ts`) legge a blocchi con ordinamento stabile; l'elenco Pratiche avvisa oltre 2000.
- **Rete lenta/assente**: richieste interrotte dopo 30 s (`fetchConTimeout`, storage escluso) con messaggio «Il server non risponde»; sessione scaduta → messaggio chiaro (la bozza del Nuovo contatto resta); un aggiornamento in background fallito non sostituisce più la scheda con l'errore (finestre e testo aperti restano, avviso una volta al minuto); i contatori in alto non vanno a 0 per un errore; la ricerca ignora risposte arrivate fuori ordine.
- **Modifiche concorrenti**: «Dati e assegnazione» invia solo i campi cambiati (`campiCambiati`), niente doppio invio; passi ed email già protetti (blocco riga + «un passo alla volta», `useSalva`).
- **Residui tolti**: ricerca per «fornitore/collega», ruoli Amministrazione/Fornitori nell'assegnazione (restano se già presenti), tipi dismessi nel filtro Pratiche, appuntamento data/fascia e «Tecnico» per intervento/manutenzione nella finestra dati, esportazioni morte (`inTesto`, `guscioEmail`, `praticheChiuseDal`, `ESITI_TRASF`, `richiedeAppuntamento`, `pctG`), trend Direzione senza fatture/fornitori.
- **Sicurezza**: RLS provata per anon, autenticato senza ruolo, centralino, direzione, admin (letture/scritture dirette, storia, appunti, email, storage); anteprime email in iframe `sandbox`; bucket `pratiche` senza `application/octet-stream`; nessun segreto nel bundle; mailto/.eml senza iniezione di intestazioni (test `audit.test.ts`).

## Informazione con 3 esiti (0083, 17/11/2026)
Nessuna email obbligatoria per default. Passo «Esito» (`requisiti: ["esito_info"]`), schede come le sotto-opzioni dell'offerta, tasti <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> (`src/centralino/AvanzaInformazione.tsx`, regole in `src/lib/centralino/informazione.ts`, test `informazione.test.ts`).
1. **Risposto a voce** → chiusa subito (chiusa_ok), nessuna email.
2. **Risposto via email** → «Apri in Outlook» all'email della pratica con `risposta_informazione` (Jennifer scrive la risposta al posto di «[scrivere qui la risposta]»), poi chiusa. Serve l'email del cliente: se manca, messaggio + link «Passa a Risposto a voce».
3. **Girata a un responsabile** → responsabile dai Referenti attivi; email interna `girata_referente` («Apri in Outlook») oppure «Avvisato per telefono» (<kbd>T</kbd>); casella «Email al cliente» (`girata_ufficio`, predefinita se c'è l'email: in Outlook si apre subito dopo nel compositore); chiusa. Nessun richiamo creato.
- Storia: evento `stato` con `dati.esito_info` (`voce`|`email`|`girata`) e `dati.assegnato_nome`. Direzione › «Informazioni»: conteggi a voce / via email / girate per referente (`contaEsitiInfo`).
- DB (`privato.ct_mancanti`, requisito `esito_info`): email → email della pratica + email `risposta_informazione` registrata; girata → `assegnato_nome` + email `girata_referente` o telefonata al referente (un'email al cliente non basta).
- `girata_referente`: tolto il residuo «({chi_chiama})» e la riga «Chi chiama».
- Prove: `supabase/prove/informazione_prove.sql` (atteso `PROVE INFORMAZIONE OK`: voce, email senza indirizzo → voce, email, girata con email, girata per telefono).
