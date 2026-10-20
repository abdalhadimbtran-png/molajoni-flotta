# Revisione critica del database · Portale Molajoni (Ferie e permessi + Flotta)

Revisore: agente "revisore DB" (sola lettura) · data: 20/10/2026 · progetto Supabase `dhqvyxitcrbqwozgcgno`
Migrazioni esaminate: 0001 → 0009, **0010_ferie_struttura**, **0010b_assenze_vista_elimina** (applicate in produzione alle 13:37–13:38 UTC), **0011_ferie_calcolo** (file del 15:41; funzioni `privato.*` presenti nel database e provate).

### In breve: i 6 punti da correggere per primi
1. **P0-1** `audit_log` → il responsabile flotta legge tipo `MAL` e note delle richieste (provato).
2. **P0-6** `notifiche` → il responsabile flotta legge "Malattia: registrata dall'ufficio personale" di qualsiasi dipendente, anche UFFICIO (provato).
3. **P0-2** `piano_giorno`/`conferma_piano` → piano confermabile con tecnico assente che ha interventi (provato).
4. **P0-4** `privato.saldo` → part-time: ferie dimezzate all'orizzontale (13 invece di 26) e piene al verticale di 3 giorni (26 invece di 15,6) (provato).
5. **P0-3** funzioni nuove in `public` eseguibili da `anon`: ogni `hr_*`/`dipendente_*` deve controllare l'accesso nel corpo.
6. **P1-3** approvare le ferie di un impiegato UFFICIO toglie la conferma al piano dei tecnici (provato).

Metodo: lettura delle migrazioni + verifica sul database reale con `SELECT` e blocchi `DO … raise exception` (tutto annullato, niente salvato). Per ogni problema c'è la **prova** (risultato reale) o un **esempio riproducibile**.

Legenda gravità: **P0** = da correggere prima di aprire il modulo ai dipendenti (rischio legale / privacy / dati sbagliati in busta) · **P1** = errore funzionale certo · **P2** = rischio o debito tecnico · **P3** = miglioramento.

---

## (a) Verifiche normative

Le fonti sono aperte. Distinguo **LEGGE** (obbligo), **CCNL** (dipende dal contratto applicato: va confermato dal consulente del lavoro) e **PRASSI**.

| # | Tema | Cosa dice | Livello | Fonte |
|---|---|---|---|---|
| N1 | Ferie minime | Almeno **4 settimane** l'anno; **2 settimane** (consecutive se chieste dal lavoratore) nell'anno di maturazione, le altre 2 **entro 18 mesi** dalla fine dell'anno di maturazione (salvo CCNL). Le 4 settimane minime **non si monetizzano** se non alla cessazione. | LEGGE (D.Lgs. 66/2003 art. 10) | [Ministero del Lavoro](https://lavoro.gov.it/node/16077) · [testo su Normattiva](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2003-04-08;66) |
| N2 | Ferie metalmeccanico industria | 4 settimane; **+1 giorno oltre 10 anni** di anzianità, **5 settimane oltre 18 anni**. Settimana corta: 20 giorni/anno (≈1,67 gg/mese). Frazione di mese **superiore a 15 giorni** = mese intero. Festività che cadono nelle ferie **non** si contano come ferie. Part-time: stessi giorni, ore proporzionali. | CCNL | [Lexplain – ferie metalmeccanici](https://www.lexplain.it/ferie-contratto-metalmeccanici-industria-guida/) |
| N3 | Ferie commercio (terziario) | 26 giorni su settimana convenzionale di 6 giorni: con 5 giorni lavorati ogni giorno di ferie "pesa" 1,2. Il mese matura con **almeno 15 giorni** (≥15, non >15). Part-time verticale: proporzionale ai giorni. | CCNL (fonte secondaria, da verificare sul testo) | [PMI.it](https://www.pmi.it/economia/lavoro/448692/ferie-ccnl-commercio-maturazione-calcolo-giorni.html) |
| N4 | ROL ed ex festività metalmeccanico | **104 ore/anno** = 72 ROL + 32 ex festività (4 gruppi da 8 h). Fruizione a giornate o **mezze giornate da 4 h**. Non goduti: conto ore per **24 mesi**, poi pagati. Part-time: proporzionali alle ore. | CCNL | [Lexplain – PAR/ROL](https://www.lexplain.it/permessi-par-e-rol-metalmeccanici-fino-a-104-ore-retribuite-compreso-ex-festivita/) |
| N5 | ROL commercio | 56 h (fino a 15 dipendenti) o 72 h (oltre 15) + 32 h ex festività; **neo-assunti** (dal 2011): 0% primi 2 anni, 50% terzo e quarto, 100% dal quinto. | CCNL | [BusinessOnline](https://www.businessonline.it/news/quanto-ore-di-rol-permessi-si-maturano-al-mese-e-allanno-nei-diversi-cotratti-ccnl_n65555.html) |
| N6 | CCNL probabile | La manutenzione di estintori e impianti antincendio rientra di solito nel **metalmeccanico** (industria Federmeccanica, PMI Confapi o **artigianato** "installazione impianti"); a volte commercio. **Il CCNL va letto sul cedolino**: cambia regola dei 15 giorni, ROL dei neo-assunti, unità (ore/giorni). | PRASSI | [CCNL metalmeccanici artigianato](https://www.studiocerbone.com/ccnl-metalmeccanici-artigianato-settori-metalmeccanica-installazione-impianti-orafi-argentieri-ed-affini-imprese-odontotecniche/) |
| N7 | Festività nazionali | L. 260/1949 art. 2 (elenco). **L. 8 ottobre 2025 n. 151** (GU Serie Generale n. 236 del 10/10/2025) aggiunge il **4 ottobre, San Francesco d'Assisi**, dal 2026. **Nel 2026 il 4 ottobre è domenica** (effetto pratico sui giorni lavorativi dal **2027**, lunedì 4/10/2027). | LEGGE | [Fiscal Focus](https://www.fiscal-focus.it/quotidiano/il-quotidiano/articoli-lavoro/istituita-la-festa-nazionale-di-san-francesco-d-assisi-il-4-ottobre-diventa-giorno-festivo-dal-2026,3,178265) · [Informazione Fiscale](https://www.informazionefiscale.it/4-ottobre-festa-nazionale-busta-paga-novita) · [EC News](https://www.ecnews.it/lavoro/rapporto-di-lavoro/gestione-del-rapporto/camera-dei-deputati-ripristinata-la-festivita-dedicata-san-francesco-dassisi/) |
| N8 | 4 ottobre ed ex festività | Nessuna fonte consultata dice che le **32 ore di ex festività** cambino. Le 4 giornate compensate sono storicamente San Giuseppe, Ascensione, Corpus Domini, SS. Pietro e Paolo; il 4 ottobre non è tra queste. **Da confermare col consulente**: non toccare le 32 h in automatico. | DA VERIFICARE | [Geopop](https://www.geopop.it/4-ottobre-torna-festa-nazionale-san-francesco-d-assisi-cosa-cambia-perche-abolita/) |
| N9 | Santo Patrono | **Non è legge nazionale ma CCNL**: patrono del comune della **sede di lavoro indicata nel contratto individuale** (o altro giorno concordato). Se cade di domenica: 1/26 in più in busta (non è un giorno di riposo in più). | CCNL | [Lexplain – festività metalmeccanici](https://www.lexplain.it/festivita-nel-ccnl-metalmeccanici-industria-guida/) |
| N10 | Festività di domenica / sabato | Domenica: solo trattamento economico (busta paga), nessun effetto sul calendario. Sabato con settimana corta: non è giorno lavorativo, **nessun effetto sui conteggi di ferie**; il trattamento economico dipende dal CCNL ed è materia del consulente paghe. | CCNL / PRASSI | come N9 |
| N11 | Malattia: cosa sa il datore | L'attestato per il datore contiene solo **prognosi** (inizio e durata), la **diagnosi va solo all'INPS**. Il lavoratore non deve consegnare copia; se il datore lo chiede deve comunicare il **numero di protocollo (PUC)**. Il datore consulta gli attestati sul portale INPS. | LEGGE / INPS | [INPS – FAQ certificati telematici](https://www.inps.it/content/dam/inps-site/pdf/allegati/FAQ_Certificati_di_malattia_telematici.pdf) |
| N12 | Malattia = dato sanitario | Anche la **sola notizia** dell'assenza per malattia, senza diagnosi, è un dato relativo alla salute (punto 61). Va **conservata separatamente** (punto 81) e trattata solo da **incaricati specifici** (82-83); "vietata la diffusione". Base: GDPR art. 9 par. 2 lett. b e art. 88; Codice privacy art. 2-septies. | LEGGE + Garante | [Garante – Linee guida lavoro privato 23/11/2006](https://www.garanteprivacy.it/home/docweb/-/docweb-display/docweb/1364939) |
| N13 | Conservazione | LUL: **5 anni dall'ultima registrazione** (DM 9/7/2008 art. 6); prospetti paga 5 anni; contributi: prescrizione 5 anni (L. 335/1995), 10 se c'è denuncia. Oltre questi termini vale il principio di **limitazione della conservazione** (GDPR art. 5.1.e): i dati di malattia non vanno tenuti "per sempre". | LEGGE | [EC News – conservazione documenti](https://www.ecnews.it/lavoro/speciale-della-settimana/documentazione-lavoro-conservazione-rispetto-privacy/) |
| N14 | Congedo parentale | I periodi di congedo parentale contano per l'anzianità **ma non maturano ferie né tredicesima** (D.Lgs. 151/2001 art. 34 c. 5); il congedo di maternità obbligatorio invece matura ferie. Malattia e infortunio: maturano. | LEGGE (da confermare col consulente) | [Normattiva – D.Lgs. 151/2001](https://www.normattiva.it/uri-res/N2Ls?urn:nir:stato:decreto.legislativo:2001-03-26;151) |

**Conseguenze per il progetto**
- La regola "giorni minimi" è **diversa tra CCNL** (>15 nel metalmeccanico, ≥15 nel commercio): il valore `15` in `config_azienda.maturazione_giorni_minimi` non basta, serve anche l'operatore (`>` o `>=`).
- La spettanza **non è uguale per tutti** (anzianità 10/18 anni nel metalmeccanico, neo-assunti nel commercio): serve una spettanza per dipendente.
- La conservazione dei dati di malattia richiede una **scadenza**; "nessuna cancellazione di record" va conciliato con il GDPR (vedi P2-6 e domanda D9).

---

## (b) Problemi trovati, ordinati per gravità

### P0-1 · `audit_log` mostra al responsabile flotta le richieste di malattia, con tipo e note  ✅ PROVATO
- **Dove:** trigger `audit_richieste_assenza` (0010) → `tg_audit()` → `public.audit_log`; policy `resp_audit` = `is_responsabile()` (vero per il responsabile flotta e per l'admin).
- **Prova** (blocco DO annullato): ho creato una richiesta `tipo='MAL'`, `note='protocollo 123456 - influenza'` per un tecnico di prova; poi, come responsabile **flotta**:
  `select dopo->>'tipo', dopo->>'note' from audit_log where tabella='richieste_assenza'` → **`MAL / protocollo 123456 - influenza`**.
  La tabella `richieste_assenza` è correttamente chiusa (0 righe), ma il registro la duplica in chiaro. Via REST basta `GET /rest/v1/audit_log?tabella=eq.richieste_assenza`.
- Lo stesso vale per: `audit_tecnici` su `dipendenti` (il flotta vede nel registro i dati di **UFFICIO/MAGAZZINO**: contratto, date, reparto — provato: 1 riga visibile per un dipendente UFFICIO), `audit_assenze` sulle assenze manuali (motivo), `saldi_iniziali`, `rettifiche_saldo` (motivo libero), `spettanze`.
- Al contrario **Roberta (HR) non vede nessun audit**, nemmeno delle sue tabelle.
- **Correzione (senza DROP/REVOKE):** `alter policy resp_audit on public.audit_log using (...)` con regola per area, per esempio:
  - admin: tutto;
  - flotta: solo `tabella in ('veicoli','segnalazioni','assegnazioni','multe','dotazioni','interventi')` + `tabella in ('dipendenti','tecnici') and coalesce(dopo,prima)->>'categoria' = 'TEC'` + `tabella = 'assenze_manuali'` (senza mostrare il motivo: meglio escludere);
  - HR: tabelle HR + `dipendenti`.
  E in `tg_audit` per `richieste_assenza` escludere le colonne `note`, `motivo_decisione`, `motivo_annullamento`, `avvisi` (argomenti del trigger: `create or replace trigger ... execute function tg_audit('aggiornato_il','note',...)` — `create or replace trigger` non richiede DROP).
  Valutare un `audit_log_hr` separato (stesso trucco schema `privato`), così i due mondi non si toccano mai.

### P0-2 · Il piano si conferma anche se un tecnico assente ha interventi: gli interventi spariscono in silenzio  ✅ PROVATO
- **Dove:** `piano_giorno()` (0001, ancora attiva): se `ass is not null` aggiunge solo `info "Assente: …"` (e un `warn` per il veicolo in carico) → livello **`na`/`warn`, mai `ko`**. `conferma_piano()` blocca solo i `ko`.
- **Prova:** tecnico di prova con intervento "Collaudo idranti" il 04/11/2026 + ferie/malattia approvata lo stesso giorno → `livello=na, n_interventi=1`; `conferma_piano('2026-11-04')` → **`{"ok": true, "notificati": 0}`**. Nessuno riceve l'intervento, il cliente resta scoperto.
- Con le ferie che arrivano **da sole** dall'HR (decisione di progetto) questo diventa il caso normale, non un'eccezione: Roberta approva il 10/11, il piano del 12/11 era confermato → la conferma viene tolta (`tg_annulla_piano`), il responsabile riconferma e il sistema lo lascia fare senza riassegnare.
- **Correzione:** in `piano_giorno`, se assente **e** `jsonb_array_length(ints) > 0` → messaggio `ko` "Ha N interventi da riassegnare". Aggiungere in `conferma_piano` il controllo esplicito. Facoltativo: funzione `riassegna_interventi(p_da_tecnico, p_a_tecnico, p_data)`.

### P0-3 · Ogni nuova funzione in `public` è eseguibile da `anon` (e nessuna migrazione può toglierlo)  ✅ PROVATO
- **Prova:** `proacl` di `is_hr` = `{=X/postgres,…}` e di `richiedi_hr`, `tg_assenze_vista`, `tg_tipi_assenza_blocco` = `{=X/postgres,…}` → `PUBLIC` ha EXECUTE. L'advisor Supabase lo segnala (`anon_security_definer_function_executable` per `is_hr`). Il `alter default privileges in schema public revoke execute … from public` della 0001 **non ha effetto** sul permesso predefinito di PUBLIC (in Postgres i default per schema possono solo aggiungere).
- **Rischio:** ogni `hr_*` / `dipendente_*` `security definer` creata in `public` sarà chiamabile da chiunque via `/rest/v1/rpc/...` con la sola chiave publishable. Oggi le funzioni HR non esistono ancora: è il momento di fissare la regola.
- **Correzione (regola vincolante per le fasi 2-4):**
  1. ogni funzione esposta deve iniziare con `perform public.richiedi_hr()` / `richiedi_admin()` / `_dipendente_da_token(p_token)` — **nessuna eccezione**, compresi i "lettori" (es. calcolo saldi);
  2. le funzioni di servizio (calcolo giorni, saldi, festività) vanno in **`privato`** (schema senza USAGE per anon/authenticated: verificato `nspacl = null`) e chiamate solo da funzioni `security definer`;
  3. un test automatico: `select proname from pg_proc where pronamespace='public'::regnamespace and proacl::text like '%=X/%' and prosecdef` deve restituire solo funzioni con guardia nel corpo (controllo testuale `prosrc ~ 'richiedi_|_da_token'`).

### P0-4 · La maturazione "proporzionale al part-time" con le ore sbaglia le **ferie** del part-time  ✅ PROVATO (0011)
- **Dove:** `privato.saldo()`: `fattore := least(1, d.ore_giornaliere / config 'ore_giornaliere_full_time')`, applicato a **tutti** i tipi, anche a `FERIE` in giorni; `giorni_riposo` non entra nel fattore.
- **Prova** (spettanza di esempio 26): part-time orizzontale 4 h lun-ven → `fattore=0.5, maturato=13.00`; part-time verticale 8 h lun-mer (`giorni_riposo='0001111'`) → `fattore=1.0, maturato=26.00`, mentre una settimana di ferie gli scala solo 3 giorni (`calcola_richiesta` 2-8/11 → `quantita=3`). Il primo perde metà delle ferie, il secondo ne ottiene il 67% in più.
- **Esempio:** impiegata part-time **orizzontale** 4 h/giorno lun-ven. CCNL metalmeccanico (N2): le ferie in **giorni** restano 20/anno (pagate a 4 h). Con la proporzione 4/8 il sistema le darebbe **10 giorni**, e ogni giorno goduto ne scala 1 → a metà anno risulta "saldo insufficiente" pur avendone diritto. Per il part-time **verticale** (es. lun-mer, 8 h) è il contrario: i giorni vanno ridotti a 3/5 e la proporzione per ore (8/8 = 1) non riduce nulla → **matura 20 giorni invece di 12**.
- **Correzione:** per le unità in **giorni** la proporzione va fatta sui **giorni lavorativi settimanali** (`5 − n.riposi`) / 5; per le unità in **ore** (ROL, EXF) sulle **ore settimanali** / 40. Ancora meglio: tenere **tutti** i saldi in **ore** (come fa la maggior parte dei cedolini metalmeccanici) e convertire in giorni solo per la visualizzazione, usando l'orario del giorno.

### P0-5 · Al responsabile flotta arriva il "perché" dell'assenza (Ferie / Permesso / Malattia)
- **Decisione:** "il responsabile flotta vede solo *assente* senza motivo".
- **Dove:**
  - `tipi_assenza.etichetta_piano` ∈ ('Ferie','Permesso','Assente') → `assenze_da_richieste.etichetta` → vista `assenze.motivo` → `piano_giorno` "Assente: Ferie", `report_dati('assenze')`, `report_dati('giornaliero')`, `controlli_tecnico` ("Assente: …"). Provato: il flotta legge `Assente@richiesta` per la malattia (giusto) ma leggerebbe `Ferie` per le ferie: chi è assente "senza etichetta Ferie/Permesso" diventa per esclusione **malato** → il dato sanitario si ricava (N12, punto 61).
  - le assenze **manuali** del flotta mantengono `motivo` libero (oggi menù `Ferie, Permesso, Assenza, Formazione, Altro` in `src/admin/Tecnici.tsx`, ma la colonna accetta qualsiasi testo, anche "Malattia", e via REST si scrive senza passare dal menù). Oggi in produzione c'è 1 sola riga, con `motivo='Ferie'`.
- **Correzione:** un'unica etichetta per il flotta: **"Assente"** (giornata intera) / **"Assente dalle 9 alle 11"** (ore) / **"Possibile assenza"** (in attesa). Oppure chiedere al cliente se "Ferie" può essere mostrato (domanda D3): in quel caso tutte le assenze non-ferie devono avere la stessa etichetta "Assente" (malattia, L.104, lutto, congedi insieme), mai categorie più fini. Vincolo `check (motivo in (...))` su `assenze_manuali` per nuove righe (`not valid` per non toccare le vecchie).

### P0-6 · Le notifiche HR dei dipendenti sono leggibili dal responsabile flotta  ✅ PROVATO (0011)
- **Dove:** `privato.notifica_dipendente()` inserisce in `public.notifiche (tecnico_id = dipendente, tipo 'avviso', dati.titolo = '<descrizione tipo>: …')`; policy `resp_notifiche_sel`: `tecnico_id is not null and is_responsabile()`.
- **Prova:** ferie approvate a un impiegato UFFICIO + malattia registrata da HR per un tecnico; come responsabile **flotta**, `select dati->>'titolo', dati->>'testo' from notifiche` →
  `Ferie: richiesta approvata [il 10/11/2026 … RF-TEST-0101] ;; Malattia: registrata dall'ufficio personale [dal 12/11/2026 al 13/11/2026 … RF-TEST-0102]`.
  In più il rifiuto/annullamento mette nel testo il **motivo** scritto da Roberta. Via REST: `GET /rest/v1/notifiche?select=dati`.
- Nota: i dipendenti non-TEC **non possono leggere** queste notifiche (`tecnico_notifiche` accetta solo token TEC): oggi sono visibili **solo** al flotta e all'admin, cioè proprio a chi non dovrebbe.
- **Correzione:** `alter policy resp_notifiche_sel on public.notifiche using (user_id = auth.uid() or (tecnico_id is not null and is_responsabile() and coalesce(dati->>'categoria','') <> 'ferie' and exists (select 1 from tecnici t where t.id = tecnico_id)))`; nel titolo non mettere mai la descrizione del tipo ("Aggiornamento sulla tua richiesta RF-2026-0012"): il push compare anche sullo **schermo bloccato** del telefono.

### P1-1 · Il responsabile flotta può scrivere assenze e PIN di dipendenti NON tecnici (prima della 0010)  ✅ PROVATO / parzialmente corretto
- **Prova (prima della 0010):** come flotta, `insert into assenze (tecnico_id = <id UFFICIO>, motivo='Malattia')` → **OK**; `imposta_pin(<id UFFICIO>, '583920')` → **OK** (`security definer` senza filtro categoria: aggiorna `dipendenti` e revoca le sessioni).
- La 0010 ha corretto le assenze (policy `assenze_man_resp` con `exists (select 1 from tecnici …)`). **`imposta_pin` resta aperta**: se in fase 3 i dipendenti UFFICIO accederanno con codice+PIN, il responsabile flotta potrà **cambiare il PIN di Roberta o di un impiegato** e chiedere le ferie a suo nome.
- **Correzione:** in `imposta_pin` e `genera_pin`: `update public.dipendenti … where id = p_tecnico and categoria = 'TEC'` + `if not found then raise exception`. Il PIN dei non-TEC lo gestisce solo `richiedi_hr()`.

### P1-2 · Token dei dipendenti e funzioni veicolo: tenere separate le due porte
- Oggi `_tecnico_da_token` fa join sulla **vista `tecnici`** (solo TEC) e `tecnico_login` filtra `categoria='TEC'`: un UFFICIO non ottiene token e un token di un ex-TEC passato a UFFICIO viene rifiutato (corretto).
- **Rischio di regressione:** per far entrare tutti i dipendenti nel portale è facile "allargare" `_tecnico_da_token` o `tecnico_login` a `dipendenti`. Da quel momento un impiegato UFFICIO potrebbe chiamare `tecnico_movimento` (prendere in carico un furgone), `tecnico_segnalazione`, `tecnico_documenti` (libretto, assicurazione), `tecnico_elenco_veicoli`.
- **Esempio riproducibile da mettere nei test:** login UFFICIO → `rpc/tecnico_veicolo {p_token, p_qr}` deve dare `SESSIONE_NON_VALIDA`.
- **Correzione:** nuova `privato._dipendente_da_token()` (tutti) per le funzioni `dipendente_*`; `_tecnico_da_token` resta legata alla vista TEC. Le sessioni restano nella stessa tabella `sessioni_tecnico` ma la verifica della categoria è nella funzione.
- Nota: se un dipendente passa da TEC a UFFICIO e poi torna TEC, le vecchie sessioni (30 giorni) "rivivono". Revocarle al cambio di categoria (trigger `before update of categoria`).

### P1-3 · Approvare o annullare una richiesta toglie la conferma del piano **senza avvisare nessuno**
- **Dove:** `tg_annulla_piano` (cancella la riga di `piani`) ora anche su `assenze_da_richieste`; in più, prima della 0010, scattava per assenze di **qualsiasi** categoria (✅ provato: ferie di un UFFICIO il 03/11 → piano del 03/11 non più confermato). Con la 0010 le assenze manuali sono solo TEC, ma `assenze_da_richieste` è per **tutti i dipendenti**: il trigger non filtra la categoria → Roberta approva le ferie della contabile e il piano dei tecnici di quei giorni torna "non confermato".
- Inoltre i tecnici vedono in app `confermato=false` senza sapere perché, e il responsabile non riceve notifica.
- **Prova (dopo 0011):** piano del 10/11 confermato → richiesta ferie **in attesa** di un UFFICIO: piano ancora confermato (giusto) → **approvazione**: `righe piani = 0`, la conferma è sparita per un'assenza che col piano non c'entra.
- **Correzione:** nel trigger, agire solo se `exists (select 1 from public.tecnici t where t.id = coalesce(new.dipendente_id, old.dipendente_id))`; in `hr_approva`/`hr_annulla` inserire una notifica al responsabile flotta "Il piano del 12/11 va rivisto: un tecnico risulta assente" (senza motivo).
- **Esempio "annullamento dopo piano confermato":** ferie approvate 12/11 → piano 12/11 confermato **senza** il tecnico → il dipendente annulla le ferie l'11/11 → il piano torna "non confermato", il tecnico è disponibile ma **non ha interventi** né veicolo; serve la stessa notifica.

### P1-4 · Conteggio sbagliato se le ore/mezze giornate si sovrappongono (o non si possono più chiedere due permessi)
- Nello schema non c'è un vincolo di non sovrapposizione: si affida alle funzioni (non ancora pubblicate). Casi da far passare/fallire:
  - ✅ deve passare: ROL 9:00–11:00 + ROL 15:00–17:00 lo stesso giorno (due richieste, ore **non** sovrapposte);
  - ❌ deve fallire: ROL 9:00–11:00 + ROL 10:00–12:00; ferie giornata intera + qualsiasi permesso lo stesso giorno; somma ore del giorno > orario del giorno; mezza giornata ferie + permesso di 4 h su un orario di 8 h → passa solo se le fasce non si sovrappongono.
- **Mezza giornata:** non si sa **quale** metà (mattina/pomeriggio): il piano non può dire se il tecnico è disponibile per l'intervento delle 14:00. Aggiungere `meta text check (meta in ('mattina','pomeriggio'))` oppure salvare sempre `ora_inizio/ora_fine` anche per la mezza giornata (oggi il vincolo `richieste_orario_check` lo **vieta**: `not mezza_giornata`).
- ✅ **Provato su `privato.calcola_richiesta` (0011):** ROL 15–17 dopo 9–11 → ok ✅; ROL 10–12 dopo 9–11 → rifiutato ✅; ferie giornata intera stesso giorno → rifiutato ✅; ROL di sabato → rifiutato ✅; ven 06/11 con rientro lun 09/11 → 1 giorno ✅.
  ❌ ROL **08:00–18:00 (10 h) su orario di 8 h → accettato** con solo un avviso, e scala 10 ore: deve essere un errore (oppure tagliato all'orario).
  ⚠️ Mezza giornata di ferie dopo ROL 9–11 → accettata: senza sapere quale metà, non si può escludere la sovrapposizione.
- **Concorrenza:** `calcola_richiesta` è `stable` e `salva_richiesta` non blocca nulla: due invii contemporanei (doppio tocco sul telefono, due dispositivi) superano entrambi il controllo di sovrapposizione. Nella funzione pubblica, prima di calcolare: `perform pg_advisory_xact_lock(hashtext('richieste'), p_dip::int)`.
- **Correzione:** il controllo nella funzione deve leggere `richieste_assenza_giorni` + orari delle richieste attive (`in_attesa`, `approvata`) con `for update` sulla riga del dipendente (due richieste inviate in contemporanea da due telefoni: race condition). Un vincolo `exclude using gist (dipendente_id with =, tsrange(...) with &&)` sarebbe la soluzione più solida (richiede `btree_gist`).

### P1-5 · Saldo iniziale dal cedolino: rischio di contare due volte le ferie del mese del cedolino
- `saldi_iniziali(data_riferimento, residuo, goduto_anno)` + richieste approvate. **Esempio:** cedolino di ottobre (data_riferimento 31/10) già contiene le ferie del 27-28/10; se Roberta le ha anche approvate nel portale, il calcolo `residuo − goduto` le sottrae **due volte**. Viceversa una richiesta approvata il 25/10 per il 05/11 non è nel cedolino e va sottratta.
- **Correzione:** regola esplicita: si sottraggono solo i **giorni** (`richieste_assenza_giorni.giorno`) **> data_riferimento**; la maturazione parte dal **mese successivo** a `data_riferimento`. Scriverlo nel commento della tabella e coprirlo con un test.
- **Mancano** nella tabella: la distinzione **anno precedente / anno corrente** (serve per la scadenza dei 18 mesi, N1, e dei 24 mesi dei ROL, N4); l'unità (ore o giorni) del cedolino, che può differire da `tipi_assenza.unita`.
- `unique (dipendente_id, anno, tipo)`: un solo saldo per anno. Se a febbraio arriva il cedolino di gennaio corretto, si **sovrascrive** il precedente (update) perdendo la storia; l'audit lo registra, ma il calcolo non saprebbe da quale data ripartire per il 2° import. Meglio righe successive con `data_riferimento` crescente e "vale l'ultima".

### P1-6 · Richiesta a cavallo d'anno: va spezzata sugli anni per saldi e scadenze
- **Esempio (calendario reale 2026/27):** ferie dal **lun 28/12/2026**, rientro **gio 07/01/2027** → giorni lavorativi: 28, 29, 30, 31/12 (**4 nel 2026**) + 4, 5/01 (**2 nel 2027**); 1/1 (ven) e 6/1 (mer) festivi, 2-3/1 weekend. Totale **6 giorni**, non 8 (giorni di calendario lavorativi senza festività) e non 10 (calendario).
- ✅ **Provato (0011):** `calcola_richiesta(28/12/2026 → rientro 07/01/2027)` = `quantita 6`, saldi `2026: 4`, `2027: 2`. Corretto.
- ❌ **Ma il residuo 2026 non passa al 2027** se il dipendente non ha un `saldi_iniziali` di un anno precedente: in `privato.saldo` il riporto scatta solo con `exists (saldi_iniziali … anno < p_anno)`. Nella prova il 2027 parte da 0 (`saldo 1.08`, solo gennaio maturato) e la richiesta risulta **"saldo insufficiente −0,92"** mentre nel 2026 restavano 9 giorni. Colpisce tutti gli **assunti dopo l'import** dei saldi iniziali. Correzione: riporto sempre dall'anno precedente se il dipendente era in forza (data_assunzione < 1/1).
- ❌ **Festività degli anni non generati** ✅ PROVATO: il dipendente può chiedere fino a 18 mesi avanti (`oggi + 548`), ma `festivita` contiene solo 2026-2027. `calcola_richiesta(24/04/2028 → rientro 26/04/2028)` = **2 giorni** e `festivita_escluse = []`: il 25 aprile 2028 viene scalato come ferie. Correzione: `calcola_richiesta` chiama `privato.genera_festivita(anno)` per ogni anno toccato (o rifiuta se l'anno non è generato).
- `richieste_assenza_giorni` per giorno è la scelta giusta: verificare che il saldo 2026 scali 4 e il 2027 scali 2 (oppure tutto dal residuo più vecchio, regola "FIFO" da chiedere: D6). Prerequisito: le festività del 2027 devono **esistere prima** che un dipendente chieda ferie nel 2027 (oggi generate 2026 e 2027; serve un job annuale o la generazione al volo in `privato.giorni_lavorativi`).

### P1-7 · Santo Patrono e sedi
- `config_azienda.comune_sede` è **null** e `festivita` è "non lavorativa **per tutti**". Se Molajoni ha più sedi (o tecnici assunti su sede diversa), il patrono non è uguale per tutti (N9: conta la sede del contratto individuale).
- **Correzione:** colonna `sede` (o `comune_sede`) su `dipendenti`; `festivita` con `sede null = tutti`. Finché `comune_sede` è null, i conteggi di quell'anno vanno segnalati come "provvisori" (avviso in `richieste_assenza.avvisi`).

### P1-8 · `prossimo_lavorativo()` ignora le festività ed è `IMMUTABLE`
- `tecnico_home` mostra "domani" = prossimo lun-ven: il 24/12/2026 (gio) mostra il 25/12 (Natale) come giorno di lavoro.
- Se viene corretta leggendo `festivita`, **deve diventare `STABLE`**: una funzione `immutable` che legge una tabella può dare risultati vecchi (costanti piegate nei piani di query). `create or replace function … stable` è ammesso (nessun DROP).

### P1-9 · Spettanze uguali per tutti: mancano anzianità e neo-assunti
- `spettanze (anno, tipo)` = un valore per azienda. Metalmeccanico: +1 giorno oltre 10 anni, 5 settimane oltre 18 (N2); commercio: ROL 0%/50%/100% nei primi anni (N5).
- **Esempio:** magazziniere assunto il 01/03/2014 → dal 01/03/2024 ha 10+ anni → 21 giorni; il sistema gliene dà 20 (o 26 col valore di esempio).
- **Correzione:** tabella `spettanze_dipendente(dipendente_id, tipo, dal, quantita)` che prevale su `spettanze`; campo `data_anzianita_convenzionale` su `dipendenti` (spesso diversa dalla data di assunzione).

### P1-10 · Assunzione e cessazione a metà mese: la regola dei 15 giorni non è univoca
- `maturazione_giorni_minimi = '15'` senza operatore. **Esempi** (mese di 31 giorni):
  - assunto il **16/03** → 16 giorni a marzo → matura sia con ">15" sia con "≥15";
  - assunto il **17/03** → 15 giorni → matura **solo** col commercio (≥15), **non** col metalmeccanico (>15);
  - febbraio 2027 (28 giorni), assunto il 14/02 → 15 giorni: stesso dubbio.
- ✅ **Provato (0011):** `privato.mesi_maturati` usa `>=` → assunto il 17/03/2026 = **10 mesi** (regola commercio); col metalmeccanico (>15) sarebbero 9. Assunto il 18/03 = 9.
- `data_assunzione` è **nullable** in `dipendenti`: ✅ **provato** che senza data `privato.saldo` matura **12 mesi pieni** (`coalesce(p_assunzione, x.ini)`) → la funzione deve rifiutare o avvisare, non assumere il 1° gennaio.
- Mancano i periodi che **sospendono** la maturazione (congedo parentale, aspettativa non retribuita: N14) → `tipi_assenza.matura_ferie boolean`.

### P2-1 · Le CHECK sulle "liste di valori" non si potranno più allargare
- Per allargare una `check (x in (...))` bisogna fare `DROP CONSTRAINT`, che in questo ambiente **annulla la migrazione**. Esempi: `tipi_assenza.etichetta_piano`, `unita`, `richieste_assenza.stato`, `annullata_da`, `creata_da`, `festivita.origine`, `dipendenti_categoria_check` (nuova categoria "COMMERCIALE"?), `responsabili.area` (un secondo approvatore?), e già oggi `notifiche_tipo_check`: **le notifiche HR (`ferie_approvata`, `ferie_rifiutata`) non si possono inserire in `notifiche`** senza toccare quella CHECK.
- **Correzione:** per i valori che possono crescere usare una tabella di riferimento + FK (aggiungere un valore = `insert`); per `notifiche` prevedere una tabella `notifiche_hr` (vedi anche P2-2).

### P2-2 · Notifiche HR nella tabella `notifiche`
- Diventato **P0-6** con la 0011 (provato). Resta il punto di progetto: la 0011 aggira la CHECK usando `tipo='avviso'` + `dati.categoria='ferie'`; funziona, ma `report_dati('avvisi')` e `analisi_admin` (conteggio "avvisi" e "avvisi letti" dei tecnici) ora **contano anche le notifiche HR** come avvisi del responsabile flotta e le mostrano nel report con titolo ("Malattia: …"). Filtrare `dati->>'categoria' is distinct from 'ferie'` in quelle due funzioni.

### P2-3 · Tecnico con veicolo in carico in ferie lunghe
- Decisione: "veicolo in carico disponibile". Ma la regola d'oro del progetto è "il veicolo in carico cambia **solo** con un movimento" (km!). Se l'approvazione delle ferie azzerasse `veicoli.tecnico_in_carico`, si perderebbero i km di riconsegna e `conducente_alle()` (multe!) attribuirebbe al tecnico in ferie le infrazioni commesse da chi usa il furgone dopo.
- **Esempio:** tecnico in ferie dal 03 al 21/08 con il furgone a casa; il 05/08 il furgone serve: `proponi_assegnazioni` lo propone già a un altro (giusto: condizione `exists assenze … v.tecnico_in_carico`), ma il nuovo tecnico deve fare la **presa** con km (crea "Passaggio da …"). Se nessuno fa la presa, una multa del 10/08 risulta del tecnico in ferie.
- **Correzione:** non toccare `veicoli`; all'approvazione di ferie ≥ N giorni di un TEC con veicolo in carico → notifica al flotta "organizzare la riconsegna prima del 03/08" + avviso al tecnico. Il piano già segnala "recuperare il veicolo" solo nei giorni di assenza: anticiparlo al giorno lavorativo **precedente**.

### P2-4 · Vista `assenze` con `limit 1` senza ordine e unione: risultati non deterministici
- `piano_giorno`, `controlli_tecnico`, `tecnico_home`, `report_dati('giornaliero')` fanno `select motivo … from assenze … limit 1` senza `order by`: con un'assenza manuale e una richiesta nello stesso giorno, il testo mostrato cambia a caso. Innocuo oggi, ma se si aggiunge la riga "possibile" alla vista, una richiesta **in attesa** potrebbe "coprire" un'assenza confermata.
- **Prestazioni:** 10 tecnici, pochi dati → nessun problema oggi (`piano_giorno` esegue ~6 accessi alla vista per tecnico + `controlli_veicolo`). Con 50 tecnici × 365 giorni di report giornaliero sono decine di migliaia di accessi alla vista in `report_dati('giornaliero')`: restano accettabili grazie agli indici `assenze_da_richieste_dip_idx (dipendente_id, dal, al) where attiva` e `assenze_tecnico_id_dal_al_idx`. Suggerito: `order by origine` e un `EXPLAIN ANALYZE` di `report_dati('giornaliero', 1 anno)` dopo le fasi 3-4.
- **GROUP BY sulle viste** ✅ PROVATO: `select t.id, t.nome from tecnici t group by t.id` → errore *column "t.nome" must appear in the GROUP BY*; idem su `assenze`. Ogni nuova funzione che aggrega deve raggruppare sulla **tabella** (`dipendenti`, `assenze_da_richieste`) o elencare tutte le colonne. (Le funzioni attuali girano tutte: provati i 13 report, `analisi_admin`, `piano_giorno`, `v_veicoli` come admin → ok.)

### P2-5 · Viste in `public` e vecchia vista con `pin_hash`
- `tecnici` e `tecnici_v1_da_eliminare` hanno **tutti i privilegi** per `anon` e `authenticated` (privilegi di default; le `grant` per colonna della 0009 sono state inutili). Sono protette solo perché `security_invoker = true` e `dipendenti` non ha permessi a livello di tabella. **Provato:** `anon` e un utente qualunque su `tecnici_v1_da_eliminare` → `permission denied for table dipendenti`.
- **Rischio:** basta un futuro `grant select on public.dipendenti to authenticated` (comodo per l'HR) per esporre `pin_hash` (hash bcrypt) a chiunque sia autenticato, attraverso la vecchia vista.
- **Correzione senza DROP:** `alter view public.tecnici_v1_da_eliminare set schema privato;` (stesso trucco della 0010). Regola: **mai** `grant … on public.dipendenti` a livello di tabella, solo per colonna; ogni nuova vista **sempre** `security_invoker = true` (una vista senza, di proprietà di `postgres`, salterebbe tutta la RLS e sarebbe leggibile da `anon`).

### P2-6 · Conservazione e "nessuna cancellazione"
- Le richieste di malattia, le note e l'audit restano per sempre. Il GDPR (N13, art. 5.1.e) chiede un limite. Proposta: dopo il termine (es. 5 anni dalla fine dell'anno, o quello indicato dal DPO) **anonimizzare** (`note = null`, `tipo` MAL → mantenuto solo per il conteggio) invece di cancellare; vale anche per `audit_log`. Da decidere col cliente (D9).
- `richieste_assenza.note` è testo libero fino a 500 caratteri: il commento dice "MAI diagnosi", ma nulla lo impedisce. Per `MAL`: niente note libere, solo `protocollo_inps text check (protocollo_inps ~ '^[0-9]{6,12}$')` (formato PUC da verificare) e date. Avviso visibile nel modulo.

### P2-7 · `service_role` senza permessi sulle nuove tabelle
- Il trucco `privato → public` crea tabelle **senza** permessi anche per `service_role` (relacl verificato: solo `postgres` e `authenticated`). Se la funzione server `flotta` (o una nuova per le email a Roberta) legge `richieste_assenza` con la chiave service, riceverà `permission denied` (la service key salta la RLS, non i GRANT). Aggiungere `grant select … to service_role` dove serve.

### P2-8 · Storico del contratto
- `dipendenti.contratto`, `ore_giornaliere`, `giorni_riposo` sono valori **correnti**. Se una dipendente passa da full-time a part-time il 01/07, ricalcolare i saldi di gennaio-giugno con il nuovo orario li cambia **retroattivamente**.
- **Correzione:** tabella `orari_dipendente(dipendente_id, dal, ore_lun … ore_dom)` (anche orari diversi per giorno: part-time misto, venerdì corto). `ore_giornaliere` unico non rappresenta "lun-gio 8 h, ven 4 h".
- `attivo` e `data_cessazione` sono indipendenti: un cessato con `attivo = true` continua a fare login e a maturare. Allineare (trigger o controllo nelle funzioni).

### P2-9 · Saldo: ferie "anticipate", scadenze e sincronizzazione (0011)
- `calcola_richiesta` confronta con il saldo maturato **fino alla fine del mese dell'ultimo giorno richiesto**: a ottobre si possono chiedere a dicembre ferie che matureranno a novembre e dicembre. È una scelta legittima ma va decisa (D11), e il saldo mostrato al dipendente deve dire "comprese le ferie che maturerai entro il …".
- Nessuna **scadenza**: il riporto è illimitato. Ferie oltre i 18 mesi (N1) e ROL oltre i 24 mesi (N4, poi pagati) restano nel saldo per sempre. Serve almeno un avviso "residuo 2025 da godere entro il 30/06/2027".
- `tg_richiesta_sincronizza` scatta solo su `insert or update of stato`: se una funzione HR correggesse date o orari di una richiesta già approvata senza cambiare stato, la riga del piano (`assenze_da_richieste`) resterebbe quella vecchia. Regola: date mai modificabili (annulla e rifai), oppure trigger anche su `primo_giorno, ultimo_giorno, ora_inizio, ora_fine, mezza_giornata`.
- `privato.saldo` usa `ore_giornaliere` **di oggi** per tutto l'anno (vedi P2-8).

### P3 · Minori
- `privato.genera_festivita` inserisce anche **Pasqua** (sempre domenica): innocuo, ma nel calendario HR può confondere.
- `genera_festivita` usa `on conflict do nothing`: se HR ha disattivato per errore una festività nazionale, la rigenerazione non la ripristina (va bene, ma documentarlo).
- `richieste_assenza.quantita numeric(7,2)` con ore: 7 h 20 min = 7,333… → arrotondato a 7,33; sommando molti permessi si accumulano errori di centesimi. Meglio **minuti interi**.
- `tg_assenze_vista`: un UPDATE su una riga **annullata** non fa nulla e non dà errore (`where … and not annullata`): il pannello pensa di aver salvato.
- Vigilia di Natale / 31 dicembre: per legge sono giorni lavorativi pieni; "mezza giornata alla vigilia" è solo prassi aziendale → se esiste, va modellata come festività parziale o permesso collettivo, non a mano (D7).

---

## (c) Domande aperte per il cliente

1. **D1 – CCNL applicato** (dal cedolino): metalmeccanico industria, PMI Confapi, artigianato o commercio? Decide 15 giorni ">" o "≥", ore ROL, neo-assunti, anzianità.
2. **D2 – Unità del cedolino**: ferie e permessi sono espressi in **ore** o in **giorni**? Ci sono residui separati anno precedente / anno corrente?
3. **D3 – Cosa vede il responsabile flotta**: solo "Assente" per tutto, oppure "Ferie" sì e tutto il resto "Assente"? (Con la seconda scelta il flotta deduce indirettamente la malattia: sconsigliato.)
4. **D4 – Sedi**: una sola sede (quale comune, per il patrono) o più sedi/cantieri con dipendenti assunti su sedi diverse?
5. **D5 – Orari**: ci sono part-time verticali o misti, venerdì corto, turni? Serve l'orario per giorno della settimana?
6. **D6 – Ordine di consumo**: le ferie godute scalano prima il residuo dell'anno precedente (prassi) o dell'anno corrente?
7. **D7 – Prassi aziendali**: chiusure collettive (agosto, ponti), mezza giornata alle vigilie, ponti decisi dall'azienda: vanno scalati in automatico a tutti?
8. **D8 – Ferie lunghe con veicolo**: oltre quanti giorni il tecnico deve riconsegnare il furgone in sede? Chi fa la riconsegna se è già partito?
9. **D9 – Conservazione**: per quanto tempo tenere richieste, note e protocolli di malattia? Chi è il DPO / il consulente privacy? Va bene "anonimizzare dopo N anni" al posto della cancellazione?
10. **D10 – Malattia nel portale**: il dipendente comunica solo date + protocollo PUC? Roberta deve poter allegare l'attestato (che non contiene diagnosi) o basta il protocollo? Chi oltre Roberta può vedere le malattie (l'admin sì per decisione: anche il titolare)?
11. **D11 – Saldi negativi**: si può approvare con saldo insufficiente (ferie anticipate)? Fino a quanto?
12. **D12 – Congedi**: congedo parentale, aspettativa, L. 104: devono fermare la maturazione (N14)? Chi li inserisce?

---

## Registro delle verifiche eseguite (riproducibili)

| Verifica | Esito |
|---|---|
| Utente autenticato estraneo (non responsabile) legge `tecnici`, `dipendenti`, `assenze`, `responsabili` | 0 righe ovunque ✅ |
| `anon` / estraneo su `tecnici_v1_da_eliminare` (con `pin_hash`) | `permission denied for table dipendenti` ✅ |
| Flotta legge riga `dipendenti` di un UFFICIO | 0 righe ✅ |
| Flotta legge `audit_log` di un UFFICIO / di una richiesta MAL | **visibile** ❌ (P0-1) |
| Piano con tecnico assente e 1 intervento → `conferma_piano` | **ok: true** ❌ (P0-2) |
| `proacl` funzioni nuove | `PUBLIC` EXECUTE ❌ (P0-3) |
| Flotta `imposta_pin` su UFFICIO | **OK** ❌ (P1-1) |
| Assenza UFFICIO toglie la conferma del piano (prima della 0010) | **sì** ❌ (P1-3) |
| `GROUP BY` sulle viste `tecnici` / `assenze` | errore ✅ atteso (P2-4) |
| 13 report + `analisi_admin` + `piano_giorno` + `v_veicoli` come admin | tutti ok ✅ |
| Flotta legge `notifiche` HR (ferie UFFICIO, malattia TEC) | **visibili con tipo e periodo** ❌ (P0-6) |
| Approvazione ferie UFFICIO con piano confermato | **conferma tolta** ❌ (P1-3) |
| `privato.saldo` part-time orizzontale / verticale | 13 / 26 giorni ❌ (P0-4) |
| `privato.saldo` senza `data_assunzione` | 12 mesi ❌ (P1-10) |
| `calcola_richiesta` a cavallo d'anno 28/12 → 07/01 | 6 giorni (4+2) ✅ · riporto 2026→2027 assente ❌ (P1-6) |
| `calcola_richiesta` 24-25/04/2028 | 2 giorni, Liberazione non esclusa ❌ (P1-6) |
| Sovrapposizioni a ore (5 casi) | 4 corretti ✅, ROL 10 h su 8 accettato ❌ (P1-4) |
| Schema `privato`: `nspacl` | null (nessun accesso API) ✅ |
| Nuove tabelle: permessi a `anon` | nessuno ✅ (trucco `privato → public` funziona) |

*Il file viene aggiornato quando compaiono nuove migrazioni (0011+) e `docs/API_portale.md`.*
