# Portale Molajoni · Specifiche UX

Versione 1 · 20/10/2026 · per i tre sviluppatori frontend del modulo **Ferie e permessi**

> **Come leggere questo documento**
> - Qui trovi *cosa* vede e fa ogni persona e *quali testi* compaiono. Il *come* (tabelle e funzioni) è in `docs/API_portale.md`, scritto dall'agente database.
> - I nomi delle funzioni server in questo documento sono **provvisori** (segnati con `‹api›`). Quando arriva `docs/API_portale.md` vale quello: la tabella del § 0.4 serve a fare la sostituzione in un punto solo.
> - Testi tra virgolette « » = **testo esatto** da usare con `t('...')`. Le variabili sono tra graffe, come nel sistema i18n già in uso (`{n}`, `{d}`).
> - Il sistema di stile è quello di `src/styles.css` (design v5). Non si creano palette nuove: le poche classi nuove (§ 3.9) usano i token che già esistono.

---

## 0. Principi e decisioni di base

### 0.1 Cinque regole che valgono per ogni schermata

1. **Una cosa sola per schermata.** Si vede subito cosa fare. Massimo **3 azioni principali**. Il resto va in un link o nel menu `MenuAzioni`.
2. **Italiano di tutti i giorni.** Niente sigle (HR, ROL, PWA, token). Nell'app del dipendente si dice «Ufficio personale», non «HR».
3. **Date sempre in parole.** «martedì 13 ottobre», mai `2026-10-13` e mai solo `13/10` nell'app del dipendente. Nel pannello HR, nelle tabelle, si può usare `13/10` (`fmtData`).
4. **Il server calcola, lo schermo mostra.** Giorni conteggiati, festività escluse, saldo dopo la richiesta: li calcola sempre il database (`‹api› anteprima`). Il frontend non rifà i conti, così telefono, pannello HR e report danno sempre lo stesso numero.
5. **Si chiede conferma solo se non si torna indietro** (§ 4.4).

### 0.2 Profili

| Profilo | Come entra | Dove arriva | Lingua |
|---|---|---|---|
| **Dipendente** (tutte le categorie: UFFICIO, MAGAZZINO, ALTRO) | Codice + PIN su `/t` | `/t`: home dipendente | solo italiano |
| **Tecnico** (categoria TEC) | Codice + PIN su `/t`, oppure QR del veicolo | `/t`: home tecnico (come oggi) + riquadro ferie | solo italiano |
| **Ufficio personale** (Roberta, area `hr`) | Email + password su `/accesso` | `/hr`: «Da decidere» | solo italiano |
| **Responsabile flotta** (area `flotta`) | Email + password su `/accesso` | `/cruscotto` (come oggi) | solo italiano |
| **Amministratore** | Email + password su `/accesso` | `/admin` (come oggi) | italiano / arabo (solo dentro `/admin`) |

### 0.3 Nomi da usare nell'interfaccia (glossario)

| Concetto | Si scrive così | Non scrivere |
|---|---|---|
| Area di Roberta | «Ufficio personale» | HR, Risorse umane (solo nel pannello va bene come sottotitolo) |
| Richiesta | «richiesta» | pratica, ticket, istanza |
| Primo giorno | «Primo giorno di assenza» | data inizio, dal |
| Giorno di ritorno | «Giorno in cui torni al lavoro» (dipendente) / «Rientro» (pannello) | data fine, al |
| Saldo (dipendente) | «Ti restano {n} giorni di ferie» | saldo residuo, monte ore |
| Saldo (pannello) | «Saldo» | residuo |
| Permesso a ore | «Permesso (a ore)» | ROL, ex festività |
| Mezza giornata | «Mezza giornata: mattina / pomeriggio» | 0,5 gg |
| Stati | «In valutazione», «Approvata», «Rifiutata», «Annullata» | pending, in attesa, respinta |
| Codice di accesso | «Codice» (dipendente), «Codice (matricola)» (pannello) | username, ID |

### 0.4 Nomi provvisori delle funzioni server (da allineare a `docs/API_portale.md`)

| Uso nello schermo | Nome provvisorio `‹api›` | Note |
|---|---|---|
| Accesso dipendente | `tecnico_login` (esistente) | resta valido per tutte le categorie: stesso token `molajoni_flotta_token` |
| Dati della home dipendente | `dipendente_home` | nome, categoria, saldi, ultime richieste, notifiche; per TEC si chiama in più `tecnico_home` come oggi |
| Tipi di assenza attivi | `tipi_assenza` | elenco con unità (giorni / ore), se scala il saldo, ordine |
| Anteprima della richiesta | `richiesta_anteprima` | in: tipo, primo giorno, rientro / ore / metà; out: giorni o ore conteggiati, giorni esclusi con motivo, saldo oggi, saldo dopo, sovrapposizioni |
| Invio | `richiesta_invia` | |
| Le mie richieste | `mie_richieste` | |
| Annulla (dipendente) | `richiesta_annulla` | |
| HR: da decidere | `hr_da_decidere` | con impatto (§ 2.7) |
| HR: decidi | `hr_decidi` | esito `approvata` / `rifiutata` + motivo |
| HR: calendario | `hr_calendario` | mese, filtro categoria |
| HR: saldi / movimenti / rettifica | `hr_saldi`, `hr_movimenti_saldo`, `hr_rettifica` | |
| HR: festività / regole | tabelle `festivita`, `regole_ferie` | |
| Flotta: assenze del piano | dentro `piano_giorno` (esistente) | per riga: `assenza` = `null` \| `{ tipo: 'intera' \| 'mattina' \| 'pomeriggio' \| 'ore', dalle, alle, rientro, possibile }` **senza il tipo di assenza** |

Tabelle già create dalla migrazione `20261020_0009_dipendenti.sql` e usate qui: `dipendenti` (campi `categoria`, `reparto`, `data_assunzione`, `data_cessazione`, `contratto`, `ore_giornaliere`, `giorni_riposo`), vista `tecnici` (solo TEC), `responsabili.area` (`flotta` / `hr`), funzioni `is_hr()` e `admin_imposta_responsabile(p_user, p_ruolo 'admin'|'responsabile'|'hr', p_attivo)`.

### 0.5 Divisione del lavoro tra i tre sviluppatori

| Sviluppatore | Si occupa di | Possiede i componenti |
|---|---|---|
| **A · App dipendente** | § 2.1–2.6, accesso `/t`, barra in basso, notifiche del dipendente | `RiquadroSaldo`, `PillStato`, `SceltaPeriodo`, `RiepilogoRichiesta`, `PassiRichiesta`, `CardRichiesta`, `src/lib/periodo.ts` |
| **B · Ufficio personale** | § 2.7–2.12, `ShellHR`, `/accesso` per il ruolo HR | `ImpattoRichiesta`, `ModaleRifiuto`, `CalendarioAssenze`, `ModaleRettifica` |
| **C · Flotta, amministratore, infrastruttura** | § 1 (rotte, smistamento, manifest), § 2.13–2.15, campanella, service worker | `PillPresenza`, icone nuove in `Barra.tsx` |

Il giorno 1 lo sviluppatore A pubblica i componenti condivisi anche vuoti, con le props del § 3. Così B e C possono già usarli.

---

## 1. Rotte e navigazione

### 1.1 Mappa delle rotte

```
/                       → Smistamento (nuovo, vedi 1.2)
/t                      → App dipendente: home (tecnico o dipendente secondo la categoria)
/t/v/:qr                → Veicolo da QR            (INVARIATO, solo TEC)
/t/scansiona            → Lettore QR               (INVARIATO, solo TEC)
/t/elenco               → Elenco veicoli           (INVARIATO, solo TEC)
/t/ferie                → Le mie richieste         (nuovo)
/t/ferie/nuova          → Nuova richiesta, 3 passi (nuovo)  ?passo=1|2|3
/t/ferie/:id            → Dettaglio richiesta      (nuovo)
/t/profilo              → Profilo                  (nuovo)
/ferie                  → redirect a /t/ferie/nuova (link breve da stampare in bacheca)

/accesso                → Accesso ufficio (flotta, HR, amministratore)   (testi aggiornati)

/hr                     → Da decidere              (nuovo, home dell'ufficio personale)
/hr/calendario          → Calendario assenze
/hr/dipendenti          → Dipendenti e PIN
/hr/saldi               → Saldi e rettifiche
/hr/impostazioni        → Festività e regole
/hr/report              → Report del personale
/hr/installa            → Scheda accesso dipendente (Volantino generalizzato)

/cruscotto … /avvisi    → Pannello flotta (INVARIATO, con le modifiche del § 2.13)
/piano?data=AAAA-MM-GG  → il piano accetta la data nell'indirizzo (serve alla notifica)

/admin …                → Amministratore (INVARIATO) + /admin/dipendenti (vedi 2.15)
*                       → Smistamento (oggi va a /cruscotto: si cambia)
```

### 1.2 Smistamento (`/` e `*`)

Componente nuovo `Smistamento`, senza interfaccia (mostra solo «Caricamento…»):

1. C'è il token dipendente in `localStorage` (`molajoni_flotta_token`) → `/t`.
2. C'è una sessione Supabase → secondo il ruolo: amministratore → `/admin`; area `hr` → `/hr`; area `flotta` → `/cruscotto`.
3. Nessuna delle due → `/t` (la maggior parte delle persone sono dipendenti). La pagina di accesso dei dipendenti ha il link per l'ufficio (§ 2.1).

`useSessione()` (in `Shell.tsx`) va esteso: oltre ad `admin` restituisce `area: 'flotta' | 'hr' | null`, letta con `is_responsabile()` e `is_hr()`.

### 1.3 Chi può entrare dove

| Area | Componente guardia | Se non autorizzato |
|---|---|---|
| `/t/*` | `Tecnico` (esistente, rinominato in uso «App dipendente») | modulo di accesso |
| `/t/v`, `/t/scansiona`, `/t/elenco` | stesso, ma se `categoria ≠ TEC` | messaggio «Questa parte è per i tecnici.» + pulsante «Torna alla home» |
| `/hr/*` | `ShellHR` (nuovo, stesso schema di `Shell`) | non connesso → `/accesso`; connesso ma senza HR → pagina «Account non abilitato» (testo § 2.7.0) |
| Pannello flotta | `Shell` (esistente) | un account HR che apre `/cruscotto` va a `/hr`, senza errore |
| `/admin/*` | `AreaAdmin` (esistente) | come oggi |

L'amministratore entra ovunque. Nel suo menu utente compaiono: «Pannello flotta», «Ufficio personale», «Amministrazione».

### 1.4 Un solo accesso per tutti i dipendenti

- **La rotta resta `/t`.** Motivi: i QR stampati sui veicoli puntano a `/t/v/<codice-qr>`; le icone già installate sui telefoni dei tecnici hanno `start_url: /t` e `id: /t`. Se cambiano, il telefono vede un'altra app e il tecnico deve reinstallarla.
- **Stesso token, stessa durata** (30 giorni), stesso blocco dopo 5 PIN sbagliati. Cambia solo il contenuto della home in base a `categoria`.
- **Manifest** `manifest-tecnico.webmanifest`: si cambiano solo `name` → «Molajoni · Portale» e `short_name` → «Molajoni». **`id` e `start_url` restano `/t`.** In `manifest.js`: `apple-mobile-web-app-title` → «Molajoni». Le icone già installate tengono il vecchio nome «Flotta» finché non si reinstallano: va bene così, non va forzato niente.
- Il pannello (`manifest-gestione`) resta com'è. Roberta installa l'icona «Gestione» se lo desidera; il titolo iOS diventa «Molajoni Ufficio» (`apple-mobile-web-app-title` per i percorsi che non iniziano con `/t`).

### 1.5 Link QR e notifiche esistenti

| Link | Comportamento |
|---|---|
| `/t/v/<qr>` (QR sui veicoli) | **Invariato.** Se chi lo apre è connesso ed è TEC → pagina veicolo. Se non è connesso → accesso con il testo «Accedi una volta: poi il QR del veicolo ti porta direttamente all'operazione.» (già esistente). Se è un dipendente non TEC → «Questo è il QR di un veicolo. Serve solo ai tecnici.» + «Torna alla home». |
| Scheda/volantino con QR verso `/t` | Invariato: ora porta all'accesso di tutti. |
| Push con `url` che inizia per `/t` | Invariato (icona tecnico nel service worker). Nuove push del dipendente usano `/t/ferie/:id`. |
| Push del pannello | Nuove: `/hr?r=:id` (nuova richiesta), `/piano?data=…` (interventi da riassegnare). |

### 1.6 Navigazione dentro l'app del dipendente

**Telefono** (< 900 px): barra fissa in basso con 3 voci, icona sopra e testo sotto. Altezza 64 px + `env(safe-area-inset-bottom)`.

| Voce | Rotta | Icona |
|---|---|---|
| «Home» | `/t` | casa |
| «Ferie» | `/t/ferie` | calendario con spunta |
| «Profilo» | `/t/profilo` | persona |

- Nella barra in alto (`.tec-bar`) restano solo il logo (porta a `/t`) e, se ci sono, le notifiche. **«Esci» passa nel Profilo**: così non si tocca per sbaglio.
- La barra in basso **non compare**: sulla pagina di accesso, nei passi di «Nuova richiesta» (lì valgono «Indietro» e «Annulla»), nello scanner.
- **Computer** (≥ 900 px): niente barra in basso. Le 3 voci diventano link testuali a destra nella `.tec-bar`, più «Esci». La colonna centrale passa da 480 a 560 px. Il resto non cambia: è la stessa app.

---

## 2. Schermate

Formato di ogni scheda: **Scopo** · **Contenuto** (in ordine di importanza) · **Azioni** (★ = principale, max 3) · **Stati** · **Testi** · **Telefono / Computer**.

Stati comuni (non si ripetono in ogni scheda):

| Stato | Come si mostra | Testo |
|---|---|---|
| Caricamento | `Caricamento` (esistente) dopo 300 ms; prima niente, per evitare lo sfarfallio | «Caricamento…» |
| Errore di rete | `.ph-msg ko` (app) o `Errore` con «Riprova» (pannello) | «Connessione non disponibile. Controlla la rete e riprova.» (già tradotto) |
| Sessione scaduta | ritorno all'accesso (esistente `onScaduta`) | «Per sicurezza devi accedere di nuovo.» |
| Invio in corso | pulsante disattivato con testo in corso | «Invio…», «Salvataggio…» |
| Permesso negato | `Banner ko` | «Permesso negato per questa operazione.» (già tradotto) |

---

### 2.1 Accesso dipendente (`/t`, non connesso)

**Scopo:** ogni dipendente entra con codice e PIN, che sia tecnico o no.

**Contenuto**
1. Titolo grande (`.tec-hero-t`): «Ferie, permessi e la tua giornata di lavoro.»
2. Scheda `.tec-card form`: «Accedi» · sottotitolo «Codice e PIN te li dà l'ufficio personale.» · campo «Codice» · campo «PIN» (6 cifre, `inputMode="numeric"`, classe `.pin-input`).
3. Solo su computer: casella «Sono su un computer condiviso» (vedi Rischi R7).
4. `InstallaApp` (esistente).
5. Separatore «oppure» e link chiaro: «Sei un tecnico? Scansiona il QR del veicolo» (`.big-btn light`, va a `/t/scansiona`).
6. Piede: «Problemi di accesso? Chiama l'ufficio personale.» · link «Lavori in ufficio con email e password? Accesso ufficio» → `/accesso`.

**Azioni:** ★ «Accedi» (`.btn brand big`) · «Scansiona il QR del veicolo» · «Accesso ufficio».

**Messaggi**
- PIN o codice sbagliato: «Codice o PIN non corretti. Controlla e riprova.»
- Blocco: «Troppi tentativi sbagliati. Riprova tra 15 minuti oppure chiama l'ufficio personale.»
- Dipendente non attivo: «Il tuo accesso non è attivo. Chiama l'ufficio personale.»

**Telefono:** come oggi. **Computer:** scheda centrata, larghezza 440 px.

---

### 2.2 Home dipendente (`/t`, categoria UFFICIO / MAGAZZINO / ALTRO)

**Scopo:** vedere in un colpo d'occhio quante ferie restano e chiederne di nuove.

**Contenuto**
1. Notifiche non lette (card con «Ho visto»: § 2.16).
2. «Ciao {n}» (`.tec-h1`).
3. **`RiquadroSaldo` grande**: «Ti restano» · **«12,5 giorni di ferie»** · «e 16 ore di permesso» · riga piccola «Aggiornato al 1 ottobre. Il 1 novembre maturi altri 2,17 giorni.»
4. ★ `.big-btn primary`: «Chiedi ferie o permesso».
5. Se c'è: **prossima assenza approvata** (`CardRichiesta` compatta): «Le tue prossime ferie» · «da lunedì 7 dicembre · rientri mercoledì 9» · pill «Approvata».
6. Se ci sono: richieste «In valutazione» (massimo 2, poi «Vedi tutte»).
7. `AttivaNotifiche` e `InstallaApp` (esistenti), in fondo, solo se servono.

**Azioni:** ★ «Chiedi ferie o permesso» · «Le mie richieste» (link «Vedi tutte le richieste») · barra in basso.

**Stati**
- Nessuna richiesta: al posto dei punti 5–6, testo `.sub`: «Non hai richieste in corso.»
- Saldo non ancora caricato da HR: riquadro con «Il tuo saldo non è ancora pronto. Puoi già fare una richiesta.»
- Oggi assente (approvata): in cima, `.ph-msg info`: «Oggi sei in ferie. Torni al lavoro mercoledì 9 dicembre.»

**Telefono:** una colonna. **Computer:** colonna di 560 px, stesso ordine.

```
┌──────────────────────────────┐
│ [logo]                    🔔 │
│ Ciao Marta                   │
│ ┌──────────────────────────┐ │
│ │ Ti restano               │ │
│ │ 12,5 giorni di ferie     │ │
│ │ e 16 ore di permesso     │ │
│ │ Il 1 novembre maturi … │ │
│ └──────────────────────────┘ │
│ [ ＋ Chiedi ferie o permesso ]│  ← rosso, unico
│ Le tue prossime ferie        │
│ da lun 7 dic · rientri mer 9 │
│                 (Approvata)  │
├──────────────────────────────┤
│  Home     Ferie    Profilo   │
└──────────────────────────────┘
```

---

### 2.3 Home tecnico con riquadro ferie (`/t`, categoria TEC)

**Scopo:** la giornata di lavoro resta al primo posto. Le ferie si aggiungono in fondo, senza disturbare.

**Contenuto (ordine)** — tutto come oggi in `Tecnico.tsx › Home`, con queste aggiunte:
1. Notifiche (piano, avvisi, **più** esiti delle richieste).
2. «Ciao {n}», avvisi, veicolo in carico / di oggi, «Scansiona il QR del veicolo», «Il QR non si legge? Scegli il veicolo».
3. Schede «Oggi» / «Prossimo giorno lavorativo». Se c'è un'assenza approvata, la scheda mostra al posto del veicolo:
   - giornata intera: «Sei in ferie. Torni al lavoro {giorno}.» (per la malattia o altri tipi: «Sei assente. Torni al lavoro {giorno}.»)
   - mezza giornata: «Sei assente la mattina.» / «Sei assente il pomeriggio.» + gli interventi dell'altra metà
   - a ore: «Permesso dalle 14:00 alle 18:00.» sopra gli interventi
4. **Nuovo: riquadro «Ferie e permessi»** (`RiquadroSaldo` compatto, dentro `.tec-card`):
   - riga: «Ti restano **12,5 giorni** di ferie e **16 ore** di permesso»
   - se c'è: «In valutazione: 1 richiesta» con `PillStato`
   - pulsante `.big-btn light`: «Chiedi ferie o permesso»
5. «Le tue segnalazioni» (esistente).

**Azioni principali:** restano le 3 di oggi («Apri il veicolo», «Scansiona il QR del veicolo» e, in quel riquadro, «Chiedi ferie o permesso»). «Chiedi ferie» **non è mai rosso** nella home del tecnico: il rosso resta per il veicolo.

**Stati:** se `dipendente_home` fallisce, la parte flotta si mostra lo stesso. Il riquadro ferie mostra «Ferie non disponibili in questo momento. Riprova più tardi.»

---

### 2.4 Nuova richiesta in 3 passi (`/t/ferie/nuova`)

**Scopo:** chiedere un'assenza senza sbagliare le date e sapendo subito quanti giorni costa.

Comune ai 3 passi:
- In alto, `PassiRichiesta`: «Passo {n} di 3» + tre trattini (classe `.passi`).
- In fondo: pulsante principale a tutta larghezza (`.btn brand big`) + `.back-link` «Indietro» (al passo 1: «Annulla»).
- La bozza si salva in `sessionStorage` (`molajoni_bozza_richiesta`) a ogni modifica: se il telefono blocca lo schermo o la rete cade, non si perde niente. Si cancella dopo l'invio.
- Cambiando passo, lo schermo torna in cima e il focus va sul titolo del passo.
- Il passo sta in `?passo=`: il tasto «indietro» del telefono torna al passo precedente, non esce.

#### Passo 1 · «Cosa ti serve?»

**Contenuto:** griglia `.tiles` di 2 colonne, massimo 4 riquadri (`.tile`), presi da `‹api› tipi_assenza` nell'ordine stabilito da HR:

| Riquadro | Sottotesto | Unità |
|---|---|---|
| «Ferie» | «Uno o più giorni» | giorni |
| «Permesso» | «Qualche ora» | ore |
| «Malattia» (se attivata da HR) | «Avvisa l'ufficio» | giorni |
| «Altro motivo» (se attivato) | «Visita, lutto, …» | giorni o ore |

Se HR attiva più di 4 tipi, il quarto diventa «Altro motivo» e apre un elenco `.seg` con gli altri.

Toccando un riquadro si va **subito** al passo 2 (non serve «Avanti»).

**Testi:** titolo «Cosa ti serve?» · «Annulla».

#### Passo 2 · «Quando?»

Tre varianti, decise dal tipo scelto.

**a) Giorni interi** (Ferie, Malattia, …)
1. `.segmented` in alto: «Giorni interi» | «Mezza giornata» (default: giorni interi).
2. Campo «Primo giorno di assenza» (`input type=date`, aperto sul calendario del telefono). Default: vuoto.
3. Campo «Giorno in cui torni al lavoro». **Si compila da solo** con il primo giorno lavorativo dopo il primo giorno di assenza (usando giorni di riposo e festività del dipendente). Si può cambiare.
4. **Frase di controllo** (`.ph-msg info`, `aria-live="polite"`), aggiornata a ogni modifica:
   «Sei assente **martedì 13 ottobre**. Torni al lavoro **mercoledì 14 ottobre**.»
   «Sei assente **da lunedì 7 a martedì 8 dicembre**. Torni al lavoro **mercoledì 9 dicembre**.»
5. **Conteggio** subito sotto, preso da `‹api› richiesta_anteprima`: «**1 giorno di ferie**» + se ci sono esclusioni: «Non contano: martedì 8 dicembre (Immacolata).» / «Non contano: sabato e domenica.»

**b) Mezza giornata**
1. Campo «Giorno».
2. `.segmented`: «Mattina» | «Pomeriggio».
3. Frase: «Sei assente **martedì 13 ottobre, la mattina**. Il pomeriggio lavori.»
4. Conteggio: «**Mezza giornata** di ferie».

**c) A ore** (Permesso)
1. Campo «Giorno».
2. Due campi affiancati: «Dalle» · «Alle» (`input type=time`, `step=900`).
3. Scorciatoie `.scelte` (facoltative): «1 ora», «2 ore», «4 ore» — riempiono «Alle» partendo da «Dalle».
4. Frase: «Martedì 13 ottobre **dalle 14:00 alle 16:30**.»
5. Conteggio: «**2 ore e 30 minuti** di permesso».

**Sotto tutte le varianti:** campo facoltativo «Vuoi aggiungere una nota? (facoltativo)», `textarea` di 2 righe, segnaposto «Es. visita medica, matrimonio di mio fratello». Sotto: «Non vuoi scrivere? Premi il microfono sulla tastiera e parla.» (frase già usata nelle segnalazioni). Per «Malattia» il campo si chiama «Numero di protocollo del certificato (se ce l'hai)».

**Azione:** ★ «Avanti» (disattivato finché le date non sono valide) · «Indietro».

**Controlli e messaggi** (mostrati sotto i campi, `.ph-msg`, mai in finestre pop-up):

| Caso | Livello | Testo |
|---|---|---|
| Rientro uguale o prima del primo giorno | ko | «Il giorno in cui torni deve essere dopo il primo giorno di assenza.» |
| Rientro su un giorno di riposo o festivo | warn | «Sabato 17 è un giorno di riposo. Di solito si torna lunedì 19.» + pulsante `.btn-ghost btn-sm` «Usa lunedì 19» |
| Primo giorno su un giorno di riposo o festivo | warn | «Domenica 1 novembre non lavori già. Scegli il primo giorno in cui saresti al lavoro.» |
| Nessun giorno lavorativo nel periodo | ko | «In questi giorni non lavori già: non serve una richiesta.» |
| «Alle» prima di «Dalle» | ko | «L'ora di fine deve essere dopo l'ora di inizio.» |
| Ore oltre la giornata | warn | «Sono più ore della tua giornata di lavoro ({n} ore). Forse ti serve un giorno di ferie?» |
| Si sovrappone a un'altra richiesta | ko | «Hai già una richiesta per questi giorni ({periodo}). Scegli altre date oppure annulla quella richiesta.» + link «Apri la richiesta» |
| Giorno nel passato | warn | «Questa data è già passata. Puoi inviarla lo stesso: l'ufficio personale la vedrà come comunicazione.» |
| Preavviso sotto il minimo stabilito da HR | warn | «Mancano solo {n} giorni. Invia lo stesso, ma avvisa anche a voce l'ufficio personale.» |

#### Passo 3 · «Controlla e invia»

**Contenuto:** `RiepilogoRichiesta`:

```
Ferie
Assente      da lunedì 7 a martedì 8 dicembre
Torni        mercoledì 9 dicembre
Conteggio    1 giorno di ferie
             Non conta martedì 8 dicembre (Immacolata)
Nota         Matrimonio di mio fratello
─────────────────────────────────
Ferie che ti restano
  oggi          12,5 giorni
  dopo questa   11,5 giorni
```

- Se il saldo dopo è negativo: `.ph-msg warn`: «Dopo questa richiesta ti mancano {n} giorni di ferie. Puoi inviarla lo stesso: decide l'ufficio personale.» (Non si blocca: con la maturazione mensile, a dicembre il saldo può tornare positivo.)
- Se il tipo non scala il saldo (es. Malattia): al posto del blocco saldo, «Questa assenza non tocca le tue ferie.»
- Ogni riga ha a destra il link «Cambia», che riporta al passo giusto.

**Azioni:** ★ «Invia richiesta» · «Indietro».

**Dopo l'invio:** schermata di conferma (stessa rotta, stato interno):
- icona di spunta verde grande, titolo «Richiesta inviata»
- testo: «L'ufficio personale ti risponde qui e con una notifica. Di solito entro 2 giorni lavorativi.»
- ★ «Torna alla home» · link «Vedi le mie richieste».

**Errori di invio:** «La richiesta non è stata inviata. Controlla la connessione e premi di nuovo Invia.» La bozza resta.

**Telefono:** campi a tutta larghezza, altezza 52 px (già impostata per `.tec-main input`). **Computer:** stessa colonna; il campo data mostra il calendario del browser.

---

### 2.5 Le mie richieste (`/t/ferie`) e dettaglio (`/t/ferie/:id`)

**Scopo:** sapere a che punto è ogni richiesta, senza dover chiedere.

**Contenuto (elenco)**
1. Titolo «Le mie richieste».
2. `RiquadroSaldo` compatto.
3. ★ «Nuova richiesta» (`.btn brand big`).
4. Gruppo «In corso e future»: prima le «In valutazione», poi le approvate future, in ordine di data.
5. Gruppo «Passate» (ultimi 12 mesi, poi «Mostra altre»).

Ogni `CardRichiesta` (tutta toccabile, porta al dettaglio):
- riga 1: tipo in grassetto + `PillStato` a destra
- riga 2: «da lun 7 a mar 8 dicembre · rientri mer 9» (per le ore: «mar 13 ottobre · 14:00–16:30»)
- riga 3 `.sub`: «1 giorno» / «2 ore e 30 minuti» · «inviata il 20 ottobre»
- se Rifiutata: riga in `.msg ko`: «Motivo: {motivo}»
- se In valutazione da più di 3 giorni: `.sub` «In valutazione da {n} giorni»

**Dettaglio**
1. Tipo + `PillStato` grande.
2. `RiepilogoRichiesta` (senza «Cambia»).
3. **Storia** (elenco con puntini `.msg`): «Inviata · 20 ottobre, 09:12» → «Approvata dall'ufficio personale · 21 ottobre, 11:40» / «Rifiutata · motivo: …».
4. Azione secondaria, solo se possibile:
   - In valutazione → `.big-btn light` «Annulla la richiesta»
   - Approvata e non ancora iniziata → «Annulla la richiesta» (l'ufficio personale riceve un avviso)
   - Iniziata o passata → testo `.sub`: «Per cambiare questa richiesta parla con l'ufficio personale.»

**Conferma di annullamento** (`Modal`, è irreversibile):
- titolo «Annullare la richiesta?»
- testo: «Le ferie di lunedì 7 dicembre non saranno più chieste. I giorni tornano nel tuo saldo.»
- pulsanti: «Sì, annulla» (`.btn brand`) · «No, la tengo» (`.btn-ghost`)
- dopo: `toast` «Richiesta annullata»

**Stato vuoto:** «Non hai ancora fatto richieste.» + ★ «Chiedi ferie o permesso».

---

### 2.6 Profilo (`/t/profilo`)

**Scopo:** i propri dati, il dettaglio del saldo e l'uscita.

**Contenuto**
1. Nome e cognome (`.tec-h1`), sotto `.sub`: «Codice {codice} · {reparto o categoria}».
2. **«Il tuo saldo»** (`.tec-card`, `.mini-stat` a 2 colonne):
   - Ferie: «Maturate quest'anno», «Usate», «Già approvate (future)», «Ti restano»
   - Permessi: le stesse voci, in ore
   - `.sub`: «Maturi {n} giorni di ferie e {m} ore di permesso ogni mese.» · «Dall'anno scorso ti restano {r} giorni.» (se > 0)
3. «Notifiche sul telefono» (`AttivaNotifiche`, esistente).
4. `InstallaApp` (se non installata).
5. «Hai dimenticato il PIN? Chiedi un nuovo PIN all'ufficio personale.» (per TEC: «… all'ufficio personale o al responsabile flotta.»)
6. ★ «Esci» (`.big-btn light`). Su un telefono personale non serve conferma: si rientra con codice e PIN.

**Dati sbagliati:** in fondo, `.sub`: «Vedi un dato sbagliato? Avvisa l'ufficio personale.» Il dipendente non modifica i dati da qui.

---

### 2.7 Ufficio personale · Da decidere (`/hr`, home di Roberta)

**2.7.0 Struttura comune dell'area HR**

`ShellHR` usa il `Layout` esistente di `Barra.tsx`:
- `prodotto` = «Ufficio personale»
- gruppi:
  - **«Richieste»**: «Da decidere» (`/hr`, `end: true`, con contatore rosso `.bell-n` accanto se > 0) · «Calendario assenze» (`/hr/calendario`)
  - **«Persone»**: «Dipendenti» (`/hr/dipendenti`) · «Saldi» (`/hr/saldi`)
  - **«Impostazioni»**: «Festività e regole» (`/hr/impostazioni`) · «Report» (`/hr/report`)
- `utilita` = `InstallaApp variante="admin"` + `Campanella`
- menu utente: «Esci» (e per l'amministratore: «Pannello flotta», «Amministrazione»)
- Account non abilitato: titolo «Account non abilitato» · testo «L'account {email} non è abilitato per l'ufficio personale. Chiedi all'amministratore di abilitarlo.» · «Esci».

**Scopo:** decidere le richieste sapendo subito cosa succede al lavoro.

**Contenuto**
1. `.page-hero`: titolo «Da decidere» · sottotitolo «{n} richieste aspettano una risposta» (0 → «Nessuna richiesta in attesa»).
2. Elenco di **card richiesta HR** (`.panel`, una sotto l'altra), in ordine di **primo giorno di assenza** (la più vicina in alto). Ogni card ha due colonne su computer:

   **Sinistra — la richiesta**
   - nome e cognome (grassetto) · `.sub` categoria e reparto («Tecnico», «Ufficio · Amministrazione»)
   - tipo + periodo: «Ferie · da lun 7 a mar 8 dic · rientro mer 9»
   - conteggio: «1 giorno» · saldo: «Saldo 12,5 → 11,5 giorni» (in `.msg warn` se diventa negativo: «Saldo 0,5 → −0,5 giorni»)
   - nota del dipendente, in corsivo, se c'è
   - `.sub`: «Inviata il 20/10 · inizia tra {n} giorni» (in `.msg ko` se inizia entro 2 giorni: «Inizia domani»)

   **Destra — `ImpattoRichiesta`** (titolo `.lbl-sm` «Cosa cambia»), righe `.msg`:
   - `info` «Nello stesso periodo sono assenti: Luca Bianchi (lun 7), Anna Verdi (lun 7–mar 8).» oppure `ok` «Nessun altro assente in quei giorni.»
   - `info` / `warn` copertura del reparto: «In Amministrazione restano 2 persone su 4.» (`warn` se resta meno della metà)
   - solo TEC, `warn`: «Ha 3 interventi pianificati: lun 7 alle 09:00 Rossi Srl, …» + `.sub` «Se approvi, il responsabile flotta riceve l'avviso di riassegnarli.»
   - solo TEC, `info`: «Il veicolo AB 123 CD resta libero per altri tecnici.»
   - solo TEC, `ok`: «Nessun intervento pianificato in quei giorni.»

3. Sotto le due colonne, le azioni della card.

**Azioni (per card):** ★ «Approva» (`.btn`) · «Rifiuta» (`.btn-ghost`) · link «Vedi nel calendario» (va al mese giusto con la persona evidenziata).

- **Approva:** nessuna conferma (si può annullare dopo, § 2.8). La card sparisce con un'animazione breve; `toast` «Approvata. {nome} riceve la notifica.» Per un TEC con interventi: «Approvata. Il responsabile flotta riceve l'avviso per {n} interventi.»
- **Rifiuta:** apre `ModaleRifiuto`:
  - titolo «Rifiuta la richiesta di {nome}»
  - «Motivo» (obbligatorio), scorciatoie `.scelte-tec`: «Troppe persone assenti in quel periodo», «Periodo di lavoro intenso», «Ferie non sufficienti», «Altro»; sotto `textarea` precompilata dalla scorciatoia e modificabile
  - testo `.hint`: «{nome} vedrà questo motivo nell'app.»
  - pulsanti: «Rifiuta richiesta» (`.btn brand`) · «Annulla»
  - dopo: `toast` «Richiesta rifiutata. {nome} riceve la notifica.»

**Casi speciali**
- **Richiesta di Roberta stessa** (il dipendente collegato all'account HR): la card mostra `Banner warn` «Questa è una tua richiesta: la decide l'amministratore.» e niente «Approva / Rifiuta». Per l'amministratore la card è normale.
- **Richiesta già decisa da un altro** (ad esempio dall'amministratore in contemporanea): «Questa richiesta è già stata decisa.» e la lista si ricarica.
- **Più di 10 richieste:** compare sopra l'elenco una ricerca «Cerca per nome».
- Il contatore nel menu e il titolo della scheda del browser («(3) Da decidere») si aggiornano ogni 60 s, come la campanella.

**Stato vuoto:** illustrazione assente; testo grande «Nessuna richiesta da decidere.» + `.sub` «Le nuove richieste arrivano qui e nella campanella.» + link «Apri il calendario assenze».

**Telefono:** le due colonne diventano una (prima la richiesta, poi «Cosa cambia»). I pulsanti sono a tutta larghezza, «Approva» sopra. Roberta deve poter approvare dal telefono in 2 tocchi.

```
┌───────────────────────────────────────────────────────────────────┐
│ Mario Rossi · Tecnico                    │ Cosa cambia            │
│ Ferie · lun 7 – mar 8 dic · rientro mer 9│ • Assenti: Luca (lun 7)│
│ 1 giorno · Saldo 12,5 → 11,5 giorni      │ ▲ 3 interventi pianif. │
│ "Matrimonio di mio fratello"             │   da riassegnare       │
│ Inviata il 20/10 · inizia tra 48 giorni  │ • Veicolo AB123CD lib. │
│ [ Approva ]  [ Rifiuta ]   Vedi nel calendario                    │
└───────────────────────────────────────────────────────────────────┘
```

---

### 2.8 Calendario assenze (`/hr/calendario`)

**Scopo:** vedere chi manca e quando; inserire assenze per chi non usa l'app.

**Contenuto**
1. `.page-hero`: «Calendario assenze» · a destra ★ «Inserisci un'assenza» (`.btn`).
2. Barra comandi: «‹» «Ottobre 2026» «›» · «Oggi» · `.segmented` «Tutti | Tecnici | Ufficio | Magazzino» · su computer `.segmented` «Mese | Elenco».
3. **Vista Mese** (computer, default): tabella in `.table-wrap`. Righe = dipendenti raggruppati per categoria (riga di gruppo come `.rep-gr`). Colonne = giorni del mese, intestazione «L 5», «M 6», …
   - giorno di riposo / festività: colonna grigia (`--surface-2`), festività con il nome nel tooltip
   - ferie approvate: cella piena `--ink` con lettera bianca «F»
   - permesso a ore: mezza cella piena + lettera «P»
   - mezza giornata: metà superiore (mattina) o inferiore (pomeriggio)
   - malattia: «M» (solo HR e admin la vedono)
   - **in valutazione**: cella con bordo tratteggiato `--warn-line` e lettera in `--warn`
   - riga in alto «Assenti» con il numero per giorno; in `warn` se supera la soglia fissata in Impostazioni
   - **legenda** sempre visibile sotto la tabella, con lettera **e** colore (mai solo colore)
4. **Vista Elenco** (telefono, sempre; computer, se scelta): per ogni giorno lavorativo del mese, titolo «martedì 13 ottobre · 3 assenti» e righe «Mario Rossi · Ferie · rientra mer 14» con `PillStato` se in valutazione.
5. Clic su una cella / riga → `Modal` con `RiepilogoRichiesta` + storia + azioni:
   - in valutazione: «Approva» · «Rifiuta» (come § 2.7)
   - approvata: «Annulla l'assenza» (conferma: «Annullare l'assenza di {nome}? {nome} riceve una notifica e i giorni tornano nel saldo.» → «Sì, annulla» / «No»)

**«Inserisci un'assenza»** (per chi non ha il telefono, per malattia comunicata a voce, per correzioni): `Modal` con lo stesso flusso a 3 passi del dipendente (`SceltaPeriodo` + `RiepilogoRichiesta`) più, in testa, «Dipendente» (`select` con ricerca). In fondo: casella già spuntata «Approvata subito» e casella «Avvisa il dipendente con una notifica» (spuntata). Pulsante «Salva assenza».

**Azioni:** ★ «Inserisci un'assenza» · cambio mese · filtro. «Stampa» va nel `MenuAzioni` «Altro» (usa `@media print`, orizzontale).

**Stati:** mese senza assenze: in vista Elenco «Nessuna assenza in questo mese.»; in vista Mese la tabella resta, vuota, con la legenda.

---

### 2.9 Dipendenti e PIN (`/hr/dipendenti`)

**Scopo:** un solo archivio per tutto il personale, e codici di accesso.

**Contenuto**
1. `.section-title`: «Dipendenti» `.meta` {n} · `.segmented` «Tutti | Tecnici | Ufficio | Magazzino | Altro» · casella «Mostra non attivi» · ★ «Nuovo dipendente» (`.btn btn-sm`).
2. Tabella: «Dipendente» (nome + `.sub` telefono/email) · «Codice» (`.mono`) · «Categoria» (`Pill na`) · «Reparto» · «Accesso app» (`Pill`: «PIN attivo» ok / «PIN da impostare» warn / «Bloccato» ko — come in `Tecnici.tsx`) · «Ferie» (saldo, es. «12,5 gg») · azioni.
3. Azioni di riga: «Modifica» (`.btn-ghost btn-sm`) · «Scheda accesso + PIN» (`.btn btn-sm`, riusa `ModaleScheda` → `/hr/installa`) · `MenuAzioni` «Altro»: «Nuovo PIN», «Sblocca» (se bloccato), «Vedi saldo», «Inserisci un'assenza».

**Modulo dipendente** (`Modal`, `form grid2`), in tre blocchi con `.lbl-sm` come titolo:
- **«Dati personali»**: «Nome», «Cognome», «Telefono», «Email (per inviare la scheda di accesso)»
- **«Lavoro»**: «Codice (matricola)» · «Categoria» (`select`: «Tecnico», «Ufficio», «Magazzino», «Altro») · «Reparto» · «Data di assunzione» · «Contratto» («Tempo pieno» / «Part-time») · «Ore di lavoro al giorno» (default 8) · «Giorni di riposo»: 7 pulsanti `.scelte` «L M M G V S D», sabato e domenica già attivi
- **«Patente»** (solo se categoria = Tecnico): «Categoria patente», «Scadenza patente»
- In modifica, in fondo: «Data di fine rapporto» + casella «Attivo».

**Messaggi**
- Categoria che passa da Tecnico ad altro: `Banner warn` «Non comparirà più nella pianificazione e non potrà prendere veicoli.»
- Nuovo dipendente salvato: `toast` «Dipendente aggiunto: ora crea la scheda di accesso con il PIN.»
- Codice già usato: «Questo codice è già di un altro dipendente.»
- **Fine rapporto** (data di cessazione): conferma `Modal` «Chiudere il rapporto di {nome} dal {data}? Dopo quella data non potrà più accedere. Lo storico resta.» → «Conferma» / «Annulla». I dipendenti non si cancellano mai.

**Telefono:** la tabella scorre in orizzontale (`.table-wrap`); le colonne «Reparto» e «Ferie» si nascondono sotto i 700 px.

---

### 2.10 Saldi e rettifiche (`/hr/saldi`)

**Scopo:** saldi giusti per tutti e correzioni tracciate.

**Contenuto**
1. `.section-title`: «Saldi» · `select` «Anno» · `.segmented` «Ferie | Permessi» · ★ «Rettifica un saldo».
2. Riga di sintesi `.rep-riepilogo`: «Dipendenti» · «Giorni maturati» · «Giorni usati» · «Saldi negativi» (in `ko` se > 0).
3. Tabella (Ferie, in giorni con una cifra decimale; Permessi, in ore e minuti): «Dipendente» · «Dall'anno scorso» · «Maturati» · «Usati» · «Approvati futuri» · «Rettifiche» · **«Saldo»** (grassetto; `Pill ko` se negativo).
4. Clic su una riga → `Modal` «Movimenti di {nome}»: elenco cronologico `.rep-tab` «Data · Cosa · Quantità · Saldo dopo», es. «01/10 · Maturazione di settembre · +2,17 · 12,50», «13/10 · Ferie (richiesta n. 41) · −1,00 · 11,50», «15/10 · Rettifica: giorno di recupero · +1,00 · 12,50». In fondo: «Rettifica questo saldo».
5. `.hint`: «La maturazione è automatica il primo giorno di ogni mese. Prossima maturazione: 1 novembre 2026.»

**`ModaleRettifica`**: «Dipendente» · «Cosa» («Ferie» / «Permessi») · `.segmented` «Aggiungi» | «Togli» · «Quantità» (giorni con mezzi giorni, oppure ore e minuti) · «Data» (default oggi) · «Motivo» (obbligatorio, es. «Saldo iniziale», «Correzione errore», «Giorno di recupero»).
Anteprima, sempre visibile: «Il saldo di {nome} passa da **12,5** a **13,5 giorni**.» → «Salva rettifica». Nessuna conferma in più: si corregge con un'altra rettifica, e tutto resta nello storico.

**Primo avvio (saldi iniziali):** finché qualche dipendente non ha un saldo iniziale, in cima compare un `Banner warn` «{n} dipendenti non hanno ancora il saldo di partenza.» con il pulsante «Inserisci i saldi di partenza». Si apre una tabella con una riga per persona, due campi («Ferie (giorni)», «Permessi (ore)») e «Salva tutti». Ogni valore diventa una rettifica con motivo «Saldo iniziale al {data}».

---

### 2.11 Festività e regole (`/hr/impostazioni`)

**Scopo:** dare al calcolo le regole giuste, una volta all'anno.

**Contenuto** (tre `.panel` uno sotto l'altro):

1. **«Festività {anno}»** · `select` anno · «Aggiungi festività».
   - Elenco: data in parole + nome + `Pill na` «Nazionale» o `Pill info` «Aziendale / locale».
   - Le nazionali arrivano già compilate (Pasquetta calcolata) e non si cancellano; si può solo aggiungere. Il **Santo patrono** va aggiunto a mano: lo ricorda un `Banner warn` «Aggiungi il santo patrono della sede, se è un giorno di festa.»
   - Le festività aggiunte si possono togliere con «Togli», senza conferma. Dopo: `toast` «Festività tolta.» con il pulsante «Annulla» per 8 secondi.
   - Modulo «Aggiungi festività»: «Data», «Nome» (es. «Santo patrono», «Chiusura aziendale»).
2. **«Ferie e permessi all'anno»**: «Giorni di ferie all'anno (tempo pieno)» · «Ore di permesso all'anno (tempo pieno)» · `.hint` «Per i part-time il sistema calcola la parte in proporzione alle ore. Ogni mese matura un dodicesimo.» · «Il saldo dell'anno precedente si porta avanti» (sì / no) · «Salva».
3. **«Richieste»**:
   - «Tipi di assenza» (elenco con interruttore attivo/non attivo e ordine: Ferie, Permesso, Malattia, Altro motivo; i primi due non si disattivano)
   - «Preavviso consigliato: {n} giorni» (solo avviso al dipendente, non blocca)
   - «Avvisami se nello stesso giorno sono assenti più di {n} persone»
   - «Ricordami le richieste in attesa da più di {n} giorni» (default 2)

**Avviso di modifica regole:** se cambiano i giorni annui a metà anno: `Banner warn` «La modifica vale dalla prossima maturazione ({data}). I saldi già maturati non cambiano.»

---

### 2.12 Report del personale (`/hr/report`)

**Scopo:** dare i numeri al consulente del lavoro e alla direzione, in PDF o Excel.

Si riusa **il centro report esistente** (`Report.tsx`, `rep-layout`, `catalogo.ts`, `esporta.ts`):
- in `catalogo.ts`, `gruppo` si estende con `'Personale'`; i report del gruppo «Personale» si vedono **solo** con `is_hr()` (il responsabile flotta non li vede, e i report flotta non compaiono in `/hr/report`).
- report da aggiungere:

| id | Titolo | Periodo | Colonne principali |
|---|---|---|---|
| `riepilogo_paghe` | «Riepilogo mensile per le paghe» | mese | Dipendente, Codice, Giorni di ferie, Ore di permesso, Giorni di malattia, Altre assenze, Note |
| `assenze_periodo` | «Assenze nel periodo» | intervallo | Dipendente, Tipo, Primo giorno, Rientro, Giorni/ore, Stato |
| `saldi_data` | «Saldi ferie e permessi» | alla data | Dipendente, Dall'anno scorso, Maturati, Usati, Approvati futuri, Saldo |
| `richieste_stato` | «Richieste e decisioni» | intervallo | Inviata il, Dipendente, Tipo, Periodo, Stato, Deciso il, Motivo |

«Riepilogo mensile per le paghe» è **il primo** del gruppo e si apre già selezionato sul mese precedente. Formato PDF orizzontale, con intestazione e logo come i report flotta.

---

### 2.13 Pannello flotta · modifiche

#### a) Piano (`/piano`)

- Legge `?data=` dall'indirizzo (serve alla notifica «Interventi da riassegnare»).
- Pill nuove sotto il giorno, accanto a quelle esistenti: `Pill na` «{n} assenti».
- **Per riga** (`PillPresenza`, sotto il nome del tecnico):

| Situazione | Pill | Riga | Comportamento |
|---|---|---|---|
| Assenza approvata, giorno intero | `na` «Assente» + `.sub` «rientra mer 14» | `row-ok` tolto, riga attenuata (`tr.muted`) | veicolo disattivato, «+ Aggiungi intervento» nascosto (già così) |
| Mezza giornata | `na` «Assente la mattina» / «Assente il pomeriggio» | normale | interventi possibili; quelli nella metà assente hanno `.msg warn` «Intervento durante l'assenza» |
| Permesso a ore | `info` «Non disponibile 14:00–18:00» | normale | interventi in quella fascia: `.msg warn` «Alle 15:00 il tecnico non è disponibile» |
| Richiesta in valutazione | `warn` «Possibile assenza» + `.sub` «in attesa di risposta» | normale | **non blocca** niente; serve solo ad avvisare |
| Assente con interventi già pianificati | `ko` «Da riassegnare» | `row-ko` | ogni intervento ha il pulsante «Sposta a…» (`select` con i tecnici presenti quel giorno) |

- **Il tipo di assenza non compare mai** (né ferie né malattia): si dice solo «Assente» o «Non disponibile».
- Se l'assenza arriva dopo la conferma del piano: la conferma si annulla (regola esistente) e in cima compare `Banner warn` «Il piano non è più confermato: {nome} sarà assente. {n} interventi da riassegnare.»
- Testo `.hint` in fondo: aggiungere «Le assenze arrivano dall'ufficio personale e aggiornano il piano da sole.»

#### b) Tecnici (`/tecnici`)

- Sezione «Assenze in corso e future» → **sola lettura**:
  - si tolgono `NuovaAssenza` e il pulsante «Elimina»
  - colonne: «Tecnico» · «Primo giorno» · «Rientro» · «Assenza» (sempre «Assente», oppure «Mattina», «Pomeriggio», «14:00–18:00»)
  - le richieste «In valutazione» compaiono con `Pill warn` «Possibile»
  - `.hint` al posto di quello di oggi: «Le assenze le gestisce l'ufficio personale. Per una correzione contatta l'ufficio personale.»
- **Da confermare con Hadi:** «Nuovo tecnico» resta al responsabile flotta (crea un dipendente con categoria TEC, come permette la migrazione) oppure passa solo all'ufficio personale. La proposta UX è **una sola porta d'ingresso**: il pulsante diventa un `.hint` «I nuovi tecnici li inserisce l'ufficio personale.». Il responsabile flotta continua a modificare patente e PIN. Così non si creano doppioni.

#### c) Notifiche (`Campanella`)

Nuovo tipo `interventi_da_riassegnare`:
- titolo «Interventi da riassegnare»
- `.sub`: «{nome} sarà assente {periodo}. {n} interventi da spostare.»
- link → `/piano?data={primo giorno con interventi}`
- push: titolo «Interventi da riassegnare», testo uguale

Nuovo tipo `assenza_nel_piano` (assenza approvata su un giorno già confermato, senza interventi): «{nome} sarà assente {giorno}. Il piano va riconfermato.»

**Il responsabile flotta non riceve notifiche per le richieste in valutazione** (le vede solo nel piano come «Possibile assenza»): così riceve meno avvisi.

#### d) Cruscotto

Nell'elenco «Da gestire» (`.exc-list`) si aggiunge la riga `ko` «{n} interventi da riassegnare per assenze» → link al piano. Nessun nuovo indicatore in alto.

---

### 2.14 Accesso ufficio (`/accesso`) · testi aggiornati

- Titolo: «Accedi all'area ufficio»
- Sottotitolo: «Per responsabile flotta, ufficio personale e amministratore.»
- Link in basso: «Sei un dipendente? Entra con codice e PIN» → `/t` (sostituisce «Sei un tecnico? Vai alla tua giornata»)
- Dopo l'accesso: smistamento per ruolo (§ 1.2). Se c'è `state.da`, si va lì solo se il ruolo può aprire quella pagina.

---

### 2.15 Amministratore · modifiche

**Account (`/admin/account`)**
- Riquadro `.livelli`: quattro schede:
  - «Amministratore» — «Tutto il sistema: account, analisi, sicurezza, flotta e personale.»
  - «Responsabile flotta» — «Piano, veicoli, tecnici, segnalazioni, avvisi, multe, carburante.»
  - «Ufficio personale» — «Ferie e permessi, dipendenti, saldi, festività, report del personale.»
  - «Dipendente» — «App con codice e PIN: ferie e permessi; i tecnici anche veicolo e km.»
- Colonna «Ruolo»: `Pill info` «Amministratore» · `Pill na` «Responsabile flotta» · `Pill na` «Ufficio personale».
- I due pulsanti «Rendi responsabile / Rendi amministratore» diventano **un solo** «Cambia ruolo». Apre un `Modal` con tre opzioni `.seg` (radio grandi con descrizione) e pulsante «Salva ruolo». Chiama `admin_imposta_responsabile(p_ruolo: 'admin' | 'responsabile' | 'hr')`. Il `window.confirm` di oggi si toglie: la scelta nel modale fa già da conferma.
- «Nuovo account»: il campo ruolo ha le stesse tre opzioni.
- **Collegamento con il dipendente:** nel modale account, campo facoltativo «È anche il dipendente…» (`select` dei dipendenti). Serve a riconoscere le richieste di Roberta (§ 2.7). Nome del campo da `docs/API_portale.md`.

**Navigazione admin**
- Gruppo «Amministrazione»: «Tecnici» diventa «Dipendenti» → `/admin/dipendenti`. Usa lo stesso componente di `/hr/dipendenti` dentro `AreaBilingue`: tutte le sue stringhe passano da `t()` e vanno aggiunte in `AR` (vedi § 4.6).
- Menu utente: «Pannello flotta», «Ufficio personale», «Esci».
- `Panoramica`: un indicatore in più, «Richieste da decidere», che apre `/hr`.

---

### 2.16 Notifiche del dipendente (in app e push)

Nell'app sono card in cima alla home, come quelle del piano: `.tec-card notifica`, pulsante ★ «Ho visto».

| Evento | Etichetta (`.lbl-sm`) | Titolo (`.tec-h2`) | Testo | Push |
|---|---|---|---|---|
| Approvata | «Richiesta approvata» | «Ferie · lun 7 – mar 8 dicembre» | «Torni al lavoro mercoledì 9 dicembre. Buone ferie!» | «Le tue ferie sono approvate» |
| Rifiutata | «Richiesta rifiutata» | stesso formato | «Motivo: {motivo}» + link «Fai una nuova richiesta» | «La tua richiesta non è stata approvata» |
| Annullata dall'ufficio | «Assenza annullata» | stesso | «L'ufficio personale ha annullato questa assenza. Se hai dubbi, chiamalo.» | «Un'assenza è stata annullata» |
| Inserita dall'ufficio | «Assenza registrata» | stesso | «L'ufficio personale ha registrato questa assenza per te.» | «Assenza registrata» |

La card «Approvata» usa il bordo `--ok-line`; «Rifiutata» e «Annullata» usano la classe esistente `.notifica.cambio` (bordo `--warn-line`). Mai il rosso urgente: non sono emergenze.

Notifiche HR (`Campanella` in `/hr`): «Nuova richiesta» — «{nome}: {tipo}, {periodo} ({quantità})» → `/hr?r={id}` · «Richiesta annullata» — «{nome} ha annullato {tipo} del {periodo}» · «Richieste in attesa» (ogni mattina, solo se ce ne sono oltre la soglia) — «{n} richieste aspettano da più di {g} giorni».

---

## 3. Componenti riutilizzabili

Cartelle suggerite: `src/personale/` (app dipendente e componenti condivisi), `src/hr/` (area ufficio personale), `src/lib/periodo.ts` (formattazione). Tutti i testi passano da `t()`.

### 3.1 `src/lib/periodo.ts` — formattazione (nessun calcolo di saldo)

```ts
fmtQuantita(q: number, unita: 'giorni' | 'ore'): string
//  0.5 → «mezza giornata» · 1 → «1 giorno» · 2.5 → «2,5 giorni»
//  ore: 2.5 → «2 ore e 30 minuti» · 1 → «1 ora» · 0.75 → «45 minuti»
fmtPeriodo(r: { primo: string; rientro?: string; meta?: 'mattina'|'pomeriggio'; dalle?: string; alle?: string }, breve?: boolean): string
//  «da lunedì 7 a martedì 8 dicembre · rientri mercoledì 9»   (breve: «lun 7 – mar 8 dic · rientro mer 9»)
//  «martedì 13 ottobre, la mattina» · «martedì 13 ottobre · 14:00–16:30»
fmtSaldo(q: number, unita): string   // «12,5 giorni», «−0,5 giorni», «16 ore»
ultimoGiorno(rientro: string, festivita, riposo): string // solo per mostrare «da … a …»; il conteggio lo fa il server
```

Le date si trattano **sempre come stringhe `AAAA-MM-GG`** con le funzioni di `format.ts` (`fmtGiorno`, `oggiISO`), mai con `new Date('2026-10-13')`, che sbaglia il giorno per il fuso orario.

### 3.2 `RiquadroSaldo`

```ts
props: { ferie: number | null; permessiOre: number | null; maturazione?: { data: string; ferie: number }; variante: 'grande' | 'compatto' | 'riga' }
```
- `grande` (home dipendente): `.tec-card` + nuova classe `.saldo` · numero in `.saldo-num` (34 px, `--f-head`, 700) · testo secondario `.sub`
- `compatto` (home tecnico, le mie richieste): `.tec-card` con una frase sola, numeri in `<b>`
- `riga` (pannello HR): testo in linea «12,5 gg · 16 h»
- `null` → «Il tuo saldo non è ancora pronto.»
- Numero negativo → colore `--ko` e segno «−» (meno tipografico, non trattino)

### 3.3 `PillStato`

```ts
props: { stato: 'in_valutazione' | 'approvata' | 'rifiutata' | 'annullata'; grande?: boolean }
```
Usa `Pill` di `ui.tsx`: `in_valutazione` → `warn` «In valutazione» · `approvata` → `ok` «Approvata» · `rifiutata` → `ko` «Rifiutata» · `annullata` → `na` «Annullata». `grande` aggiunge `.pill-lg` (14 px, padding 5/12) per il dettaglio. Mappa da esportare come `STATI_RICHIESTA` in `format.ts`, sullo schema di `STATI_SEGN`.

### 3.4 `PillPresenza` (flotta, sviluppatore C)

```ts
props: { assenza: { tipo: 'intera'|'mattina'|'pomeriggio'|'ore'; dalle?: string; alle?: string; rientro?: string; possibile?: boolean } | null }
```
Testi del § 2.13 a. Non riceve mai il tipo di assenza.

### 3.5 `SceltaPeriodo` — selettore date con rientro

```ts
props: {
  unita: 'giorni' | 'ore';
  valore: { primo?: string; rientro?: string; meta?: 'mattina'|'pomeriggio'; dalle?: string; alle?: string };
  onChange: (v) => void;
  anteprima: AnteprimaRichiesta | null;  // dal server: conteggio, esclusi, avvisi
  calendario: { festivita: {data: string; nome: string}[]; riposo: string };  // per il rientro automatico e gli avvisi
}
```
- Classi: `.field`, input nativi `type=date` / `type=time` (le dimensioni grandi in `.tec-main` ci sono già), `.segmented` per Giorni/Mezza e Mattina/Pomeriggio, `.scelte` per le scorciatoie ore, `.ph-msg info|warn|ko` per frase di controllo e avvisi, `.btn-ghost btn-sm` per «Usa lunedì 19».
- Rientro automatico: quando cambia `primo`, `rientro` diventa il primo giorno lavorativo successivo, **solo se** l'utente non l'ha già cambiato a mano.
- Chiamata `‹api› richiesta_anteprima` con attesa di 300 ms dopo l'ultima modifica. Mentre aspetta, il conteggio mostra «Calcolo…» (`.sub`), senza far saltare l'impaginazione (altezza minima fissa).
- Funziona anche nel `Modal` HR (§ 2.8): fuori da `.tec-main` usa le dimensioni del pannello.

### 3.6 `RiepilogoRichiesta`

```ts
props: { richiesta; anteprima; modificabile?: (passo: 1|2) => void; mostraSaldo?: boolean }
```
- Struttura `<dl class="riepilogo">` con righe `<dt>` / `<dd>` (classe nuova, § 3.9), link «Cambia» (`.link`) se `modificabile`.
- Blocco saldo con `.mini-stat` (2 celle: «oggi» / «dopo questa»).
- Usato in: passo 3, dettaglio richiesta, modale del calendario HR, `Modal` di «Inserisci un'assenza».

### 3.7 `PassiRichiesta`, `CardRichiesta`, `BarraDipendente`

- `PassiRichiesta { passo: 1|2|3 }` → `.passi` (3 trattini, quello attivo `--ink`) + testo `.sub` «Passo {n} di 3». `aria-label` uguale al testo.
- `CardRichiesta { r; compatta? }` → `<Link className="tec-card card-richiesta">` con le righe del § 2.5. Tutta la card si tocca (altezza minima 72 px).
- `BarraDipendente` → `<nav class="tec-nav">` con 3 `NavLink`; voce attiva con colore `--brand` e testo in grassetto.

### 3.8 Componenti HR (sviluppatore B)

- `ImpattoRichiesta { impatto }` → `.msgs` con `.msg info|warn|ok|ko` (classi esistenti).
- `ModaleRifiuto { nome; onConferma(motivo) }` → `Modal` + `.scelte-tec` + `textarea`.
- `CalendarioAssenze { mese; filtro; vista }` → `.table-wrap` + classe nuova `.cal`.
- `ModaleRettifica` → `Modal` + `form` + `.segmented`.

### 3.9 Classi CSS esistenti da riusare e poche nuove

**Da riusare così come sono:** `.tec`, `.tec-bar`, `.tec-main`, `.tec-card`, `.tec-h1`, `.tec-h2`, `.tec-hero-t`, `.lbl-sm`, `.big-btn` (`primary`, `light`), `.btn` (`brand`, `big`, `btn-sm`), `.btn-ghost`, `.back-link`, `.link`, `.tiles`/`.tile`, `.scelte`, `.scelte-tec`, `.segmented`, `.seg`, `.field`, `.form`, `.grid2`, `.ph-msg`, `.msg`/`.msgs`, `.pill`, `.banner`, `.panel`, `.table-wrap`, `.mini-stat`, `.rep-*`, `.page-hero`, `.section-title`, `.kpis`/`.kpi`, `.exc-list`, `.modal`, `.toast`, `.notifica`, `.notifica.cambio`, `.menu-az`, `.bell-n`, `.sub`, `.hint`, `.mono`, `tr.muted`, `tr.row-ko|warn|ok`.

**Nuove (da aggiungere in fondo a `styles.css`, sezione `/* ---------- Portale: ferie e permessi ---------- */`, solo con i token esistenti):**

| Classe | Uso | Note |
|---|---|---|
| `.tec-nav` | barra in basso | `position:fixed; bottom:0`; sfondo `rgba(255,255,255,.88)` + sfocatura come `.tec-bar`; 3 colonne; voci di altezza minima 56 px; `padding-bottom: env(safe-area-inset-bottom)`; nascosta da 900 px in su |
| `.tec-main.con-nav` | spazio per la barra | `padding-bottom: calc(96px + env(safe-area-inset-bottom))` |
| `.saldo`, `.saldo-num` | riquadro saldo | numero 34 px, `font-variant-numeric: tabular-nums` |
| `.passi` | indicatore dei passi | 3 trattini 4 px, `--line-strong` / `--ink` |
| `.riepilogo` | `dl` del riepilogo | griglia `auto 1fr`, righe separate da `--sep` |
| `.card-richiesta` | card dell'elenco | `text-decoration:none; color:inherit; min-height:72px` |
| `.pill-lg` | pill grande | |
| `.cal`, `.cal-f`, `.cal-p`, `.cal-m`, `.cal-v`, `.cal-off` | celle del calendario | celle 28 px; `.cal-v` bordo tratteggiato `--warn-line`; `.cal-off` sfondo `--surface-2` |
| `.notifica.ok` | card «approvata» | bordo `--ok-line` |

**Icone nuove** in `Barra.tsx › P` (griglia 24×24, tratto 1,75, come le altre): `richieste` (vassoio con spunta), `calendario` (si può riusare `piano`), `saldi` (clessidra), `festivita` (calendario con stella), `dipendenti` (si riusa `tecnici`). Per l'app del dipendente, in `Tecnico.tsx`: `IcoCasa`, `IcoFerie`, `IcoProfilo`, `IcoPiu` (tratto 2, come le icone esistenti).

---

## 4. Accessibilità e semplicità

### 4.1 Tocco e dimensioni
- App dipendente: ogni elemento toccabile è **alto almeno 48 px** (`.big-btn`, `.tile`, `.btn.big` lo sono già). Pannello: almeno **40 px** (`.btn`); i `.btn-sm` (32 px) solo nelle tabelle su computer.
- Almeno **8 px** di spazio tra due elementi toccabili vicini (es. «Approva» e «Rifiuta»).
- Testo dell'app dipendente: **almeno 16 px**, campi 17 px (già impostati in `.tec-main`). Le informazioni importanti non vanno mai in `.sub` sotto i 14 px.
- Lo zoom del telefono non si blocca mai (niente `maximum-scale`).

### 4.2 Contrasto e colore
- Testo normale con contrasto di almeno **4,5:1** (WCAG AA). `--ink-3` (#6E6E73) su `--bg` (#F5F5F7) è circa 4,6:1: va bene solo per testo secondario, mai per date, numeri o stati.
- **Il colore da solo non basta**: stato = colore **+ parola** (pill), calendario = colore **+ lettera** (F, P, M) + legenda.
- Il rosso `--brand` si usa solo per l'azione principale e per gli allarmi. Una richiesta rifiutata non è un allarme: pill `ko` sì, card rossa no.

### 4.3 Parole
- Frasi **brevi**: al massimo 15 parole, un'idea per frase.
- **I pulsanti dicono cosa fanno, con un verbo**: «Invia richiesta», «Approva», «Sì, annulla». Mai «OK», «Procedi», «Conferma» da solo.
- Si parla al «tu» nell'app del dipendente, come già fa l'app tecnico.
- Un messaggio di errore dice **cosa è successo e cosa fare**: «Il giorno in cui torni deve essere dopo il primo giorno di assenza.»
- Niente gergo (glossario § 0.3), niente codici di errore a schermo. I testi tecnici del server passano da `tm()` / `testoErrore`.
- Numeri all'italiana: «12,5», «2 ore e 30 minuti», «14:00».

### 4.4 Conferme: solo se non si torna indietro

| Azione | Conferma? | Perché |
|---|---|---|
| Invia richiesta | No (c'è già il passo 3 «Controlla») | si può annullare |
| Annulla richiesta (dipendente) | **Sì** | non si recupera, bisogna rifarla |
| Approva | No | si può annullare dal calendario |
| Rifiuta | Il modale con il motivo fa da conferma | |
| Annulla un'assenza approvata (HR) | **Sì** | il dipendente l'ha già pianificata |
| Rettifica saldo | No, ma con l'anteprima «da … a …» | si corregge con un'altra rettifica |
| Togli festività | No, `toast` con «Annulla» per 8 s | |
| Fine rapporto | **Sì** | toglie l'accesso |
| Nuovo PIN | Avviso già esistente «il dipendente viene disconnesso» | |
| Cambia ruolo account | Il modale fa da conferma | |

Le conferme usano sempre `Modal` (mai `window.confirm`, che su iPhone come app installata è brutto e poco chiaro). Il pulsante che esegue è a sinistra, «No» a destra, ed è **«No» ad avere il focus** quando si apre.

### 4.5 Tastiera, lettori di schermo, movimento
- Ogni campo ha un `label` visibile (non solo il segnaposto).
- Frase di controllo e conteggio con `aria-live="polite"`. Errori con `role="alert"`.
- Cambiando passo, il focus va sul titolo del passo. Chiudendo un `Modal`, torna al pulsante che l'aveva aperto.
- Il calendario HR si usa anche con la tastiera (frecce tra le celle; Invio apre).
- Animazioni solo con `prefers-reduced-motion: no-preference` (come già fa `styles.css`).

### 4.6 Lingua
- L'app del dipendente, l'area HR e il pannello flotta sono **solo in italiano** (`LinguaProvider` fuori da `AreaBilingue` restituisce sempre `it`).
- Il componente Dipendenti mostrato in `/admin/dipendenti` è dentro `AreaBilingue`: le sue stringhe vanno aggiunte nel dizionario `AR` di `src/lib/i18n.tsx` (sezione `// dipendenti`), scritte a mano, non tradotte in automatico. Se manca una chiave si vede l'italiano: non è un errore bloccante.
- Ogni stringa nuova si scrive come chiave italiana in `t('...')`, anche nelle aree solo italiane, così il dizionario resta l'unico posto dei testi.
- Date con `fmtGiorno(d, locale)`: in arabo usa già `ar-u-nu-latn`.

### 4.7 Telefono e iPhone (app installata)
- Su iPhone le notifiche push funzionano **solo** con l'app aggiunta alla schermata Home (`AttivaNotifiche` lo spiega già: «Su iPhone: premi Condividi…»). Per questo le notifiche importanti compaiono **anche** come card nella home: chi non ha attivato le push le vede lo stesso.
- Barra in basso e barra in alto rispettano `env(safe-area-inset-*)`.
- Niente `hover` come unico modo di vedere un'informazione (il tooltip del calendario c'è anche nel `Modal` al tocco).

---

## 5. Rischi UX e come li evitiamo

| # | Rischio | Come lo evitiamo |
|---|---|---|
| R1 | **Il dipendente mette come «rientro» l'ultimo giorno di ferie** (errore di un giorno) | Campo con nome esplicito «Giorno in cui torni al lavoro», compilato da solo; frase di controllo «Sei assente… Torni al lavoro…» con i giorni della settimana; riepilogo al passo 3 |
| R2 | **Il saldo non si capisce** (maturazione mensile, anno precedente) | Nell'app: una sola frase «Ti restano…» + «il 1 novembre maturi altri …»; dettaglio solo nel Profilo; al passo 3 «oggi / dopo questa». I conti li fa solo il server (§ 0.1 regola 4) |
| R3 | **Saldo negativo bloccante** che crea telefonate | Non si blocca: avviso chiaro, decide HR, che vede «12,5 → −0,5» in evidenza |
| R4 | **Su iPhone l'app installata e Safari non condividono l'accesso**: il tecnico che inquadra il QR con la fotocamera finisce in Safari e gli si chiede di nuovo il PIN | Si tiene il testo esistente «Accedi una volta: poi il QR…»; sessione di 30 giorni anche in Safari; dopo l'accesso da QR si va subito al veicolo. Nella scheda di installazione: «Usa sempre l'icona Molajoni sulla schermata Home» |
| R5 | **Le icone installate si duplicano o si perdono** cambiando manifest | `id` e `start_url` restano `/t`; si cambiano solo nomi e titoli (§ 1.4) |
| R6 | **I dipendenti non tecnici vedono veicoli e QR** e si confondono | Home e rotte decise da `categoria`; le pagine veicolo per i non TEC rispondono con una frase chiara e «Torna alla home» |
| R7 | **Computer condiviso in ufficio**: la sessione di 30 giorni resta aperta per il collega dopo | Casella «Sono su un computer condiviso» (solo su schermi larghi): token in `sessionStorage` invece di `localStorage`, quindi l'accesso finisce chiudendo il browser; «Esci» visibile nella barra su computer |
| R8 | **Chi non ha lo smartphone resta escluso** | HR «Inserisci un'assenza» per conto del dipendente; scheda di accesso stampabile; l'app si usa anche da un computer dell'ufficio |
| R9 | **Roberta approva le proprie ferie** | Le sue richieste le decide l'amministratore (§ 2.7); collegamento account ↔ dipendente nell'admin |
| R10 | **Due fonti di assenze nel periodo di passaggio** (inserimento manuale della flotta e richieste) | All'uscita del modulo: l'inserimento manuale sparisce; le assenze già inserite vengono migrate come «Approvata» con nota «importata dalla flotta»; la sezione Tecnici diventa sola lettura |
| R11 | **Privacy: il responsabile flotta vede malattie o motivi** | Il piano e la pagina Tecnici ricevono dal server solo «assente / fascia oraria / rientro» (§ 0.4); i report del personale sono solo per HR; la nota del dipendente la vede solo HR |
| R12 | **Approvazione che rompe un piano già confermato senza che nessuno se ne accorga** | Impatto mostrato a HR **prima** di approvare; notifica «Interventi da riassegnare» al responsabile con link al giorno giusto; banner nel piano e riga «Da riassegnare» con «Sposta a…» |
| R13 | **Richieste dimenticate «In valutazione»** | Contatore nel menu HR e nel titolo della scheda; promemoria dopo {n} giorni; il dipendente vede «In valutazione da 4 giorni» (sa che non è sparita) |
| R14 | **Errori di un giorno per il fuso orario** | Date solo come stringhe `AAAA-MM-GG` e funzioni di `format.ts`; mai `new Date('AAAA-MM-GG')` |
| R15 | **Mezza giornata e ore confuse con i giorni** | Varianti separate nel passo 2 (Giorni interi / Mezza giornata; Permesso solo a ore); la mezza giornata vale `ore_giornaliere / 2` per i part-time, calcolata dal server |
| R16 | **Troppi tipi di assenza** che rendono difficile il passo 1 | Al massimo 4 riquadri; gli altri dentro «Altro motivo»; HR decide quali attivare |
| R17 | **Perdita della richiesta a metà** (chiamata, schermo bloccato, rete) | Bozza in `sessionStorage`, passo nell'indirizzo, messaggio di errore che dice «premi di nuovo Invia» |
| R18 | **PIN dimenticato** | Testo chiaro in accesso e Profilo; HR rigenera il PIN da «Dipendenti» (il responsabile flotta, per i TEC); blocco dopo 5 tentativi con istruzione |
| R19 | **Push non attive** | Tutte le notifiche compaiono anche come card nella home / campanella |
| R20 | **Rifiuto senza spiegazione** | Motivo obbligatorio, con scorciatoie; il dipendente lo legge nella card e nel dettaglio |
| R21 | **I tre sviluppatori creano componenti doppi o nomi diversi** | Nomi, props e proprietario del § 0.5 e § 3; componenti condivisi pubblicati il giorno 1 dallo sviluppatore A; nomi API in un punto solo (§ 0.4) |
| R22 | **Arabo che compare fuori dall'area admin, o pagine admin metà in italiano** | Solo `AreaBilingue` abilita l'arabo (già così); per `/admin/dipendenti` le chiavi `AR` vanno scritte insieme al componente |

---

## Allegato · Lista di controllo prima del rilascio

- [ ] Un tecnico già connesso apre l'app installata: vede la sua giornata come prima, più il riquadro ferie in fondo.
- [ ] Un QR stampato su un veicolo apre ancora la pagina del veicolo.
- [ ] Un dipendente d'ufficio entra con codice e PIN e non vede niente della flotta.
- [ ] Richiesta «assente martedì 13, rientra mercoledì 14» → 1 giorno; «lunedì 7 – rientro mercoledì 9 dicembre» → 1 giorno (8 dicembre festivo).
- [ ] Roberta approva dal telefono in 2 tocchi; rifiuta solo con un motivo.
- [ ] Approvando le ferie di un tecnico con interventi, il responsabile flotta riceve «Interventi da riassegnare» e il piano mostra «Da riassegnare».
- [ ] Il responsabile flotta non vede mai la parola «malattia» né il tipo di assenza.
- [ ] Nell'area HR e nell'app dipendente non compare mai l'arabo; in `/admin/dipendenti` sì.
- [ ] Tutti i pulsanti dell'app dipendente sono alti almeno 48 px; nessuna informazione importante è data solo dal colore.
