# Importa interventi del mese (/interventi)

Accesso: responsabile flotta e amministratore (`is_responsabile`). Menu Operatività → «Interventi del mese»; scheda riepilogo nella Panoramica amministratore.

## Flusso
1. **Importa file Excel**: trascina il «Listato interventi» (.xlsx) esportato da Taylor. Il file si legge nel browser (SheetJS `xlsx`, caricato a richiesta). Le colonne si cercano **per nome** nella riga d'intestazione (quella che contiene «ID intervento»), non per lettera.
2. Anteprima: righe valide, nuovi, aggiornati, fuori Lazio, senza tecnico, indirizzo incompleto, scartate (ID mancante o ripetuto).
3. Conferma → RPC `importa_interventi` (UPSERT per `id_intervento`, nessun duplicato; ritorna i conteggi; riga in `importazioni`).
4. Geocodifica automatica con barra di avanzamento (funzione `geocodifica`, a blocchi di ~40 s). «Continua geocodifica» riprende se interrotta.

## Colonne importate (solo queste)
`ID intervento` (chiave nascosta) · `Tecnici attivi` → tecnico_sigla · `Num/serie` → numero (senza «/» finale) · `Del` → data_riferimento (mese) · `Imp. num/serie` · `Cod. cli.` · `Cliente` · `Loc. imp.` · `CAP` (testo a 5 cifre) · `Prov.` · `Ubicazione` (originale + via/civico puliti) · `Tot. Comp.` · `Tipo di intervento` · `Famiglie servizi` (lista).
Le parti dell'indirizzo senza campo dedicato vanno in `note`: «Accesso: Piano 2, interno 4a, scala B · Altro: …».

## Pulizia indirizzo (`src/lib/interventi/indirizzo.ts`)
Toglie suffissi CAP («-00034»), piano/interno/scala/palazzina/stanza/c/o/parentesi (→ note), «N.»/«snc», km (→ note); espande V.LE, V.LO, P.ZZA/P.ZA, P.LE, L.GO, C.SO, CIRC.NE, V.; tiene il civico con lettere/intervalli (25/B, 20-22; per la ricerca il primo numero). Riconosce il formato Taylor con il civico in fondo («VIA X - piano 1 interno 1 28» → Via X 28).

## Lazio
Province RM, LT, FR, VT, RI (se la provincia manca o è sbagliata: CAP 00–04). Gli altri restano salvati con `fuori_lazio = true`, nascosti (interruttore «Mostra fuori Lazio»), non geocodificati ed esclusi dalla pianificazione.

## Geocodifica (`supabase/functions/geocodifica`)
**Fornitori**: Photon (photon.komoot.io, primo: risponde ai server) poi Nominatim. Nominatim risponde **HTTP 403** agli IP del server Supabase (verificato con `POST {"diagnosi":true}`, senza login, solo indirizzo di prova). Se tutti i fornitori sono in errore la funzione risponde `errore_servizio` e **non segna** le righe; il portale passa alla **geocodifica dal browser** (stessa logica `valida.ts`, Nominatim + Photon, ≤ 1 richiesta/s, cache tramite RPC `geocache_leggi/geocache_scrivi`). «Non trovato» segna `geo_tentato_at`; un errore di servizio mai. Pulsante «Riprova geocodifica» + contatore posizionati / da posizionare / da verificare.

### Coordinate permanenti per impianto (migrazioni 0040–0042)
`impianti_posizione` (chiave = Cod. cli. + Imp. num/serie normalizzati, **mai il solo cliente**: un cliente può avere centinaia di sedi): lat/lon, qualità, fonte (`photon|nominatim|manuale|import`), `verificato`. Un trigger la aggiorna ogni volta che un intervento riceve coordinate. Ogni importazione riusa le posizioni con lo stesso indirizzo (`geo_fonte = impianto`) e geocodifica solo impianti nuovi o con indirizzo cambiato. Correzione manuale (trascina) → `verificato = true`, mai sovrascritta da import/geocodifica con lo stesso indirizzo. Stesso impianto con **indirizzo diverso** → `indirizzo_cambiato = true` (segnalato), nuova geocodifica, vecchia posizione in `impianti_posizione_storico`.
Coordinate nel file: colonne Lat/Latitudine + Lon/Longitudine, oppure Coordinate «41.9,12.5» → usate direttamente (`fonte import`, non sopra una posizione verificata).

Server, una sola volta, coordinate salvate. Nominatim ricerca strutturata (street, postalcode, city, countrycodes=it), User-Agent `MolajoniPortale/1.0`, ≤ 1 richiesta/s, cache `geocache` per indirizzo normalizzato.
Ordine: via + civico → via + solo numero → via senza iniziali («Via G. Rossi» → «Via Rossi») → **via senza civico** (`via`: punto a metà del tratto di via entro 3 km dal centro CAP, dalla geometria Nominatim) → centro CAP (`centro_cap`) → centro comune (`centro_comune`).
Validazione (`valida.ts`): CAP del risultato = CAP della riga, oppure stesso comune ed entro 3 km dal centro CAP; altrimenti si passa al tentativo successivo. Accettati con dubbio → `geo_dubbio`.
Reimportazione: se via/civico/CAP/comune non cambiano la posizione resta; le posizioni `manuale` non si toccano mai.

## Viste (scala: clienti con 500+ sedi)
- Lettura a blocchi da 1000 righe; marcatori aggiunti in blocco (`chunkedLoading`), popup creati al clic.
- Filtro cliente con suggerimenti (nome o codice); vista **Sedi del cliente**: elenco clienti per numero di sedi, poi elenco sedi paginato + mappa del solo cliente + conteggi (posizionati, da verificare, indirizzo cambiato).
- **Esporta per OsmAnd/Google (GPX)**, **KML** (cartelle per tecnico), **CSV con coordinate** (`;`, Excel) della selezione filtrata (tecnico, cliente, tipo…): nome = numero intervento + cliente, descrizione = indirizzo, impianto, attività, note.
- **Controllo qualità**: conteggi per qualità e fonte; punti a più di 3 km dalla mediana dei punti del loro CAP, approssimati o con indirizzo cambiato; link «Apri in Google Maps».
- Tabelle paginate (100 righe).

- KPI: totale del mese, per tecnico, **senza tecnico** (rosso), da verificare, fuori Lazio, componenti.
- **Mappa**: raggruppamento (leaflet.markercluster), colore per tecnico, forma per qualità (pieno = civico, anello = via, tratteggiato con «?» = centro CAP/comune o dubbio, quadrato = manuale), filtri tecnico/tipo/famiglia/stato/qualità, popup, legenda.
- **Tabella**: ricerca + stessi filtri, esporta Excel. Colonna «Durata: da definire».
- **Senza tecnico**: suggerimento = tecnico della zona CAP (`cap_zone`), altrimenti baricentro più vicino degli interventi del mese di quel tecnico («CAP 00186 → TECI» / «più vicino: TECB, 1,2 km»); Accetta / scegli altro / Accetta tutti.
- **Da verificare**: trascina il segnaposto o scrivi un indirizzo migliore → `geo_qualita = manuale`; «Riprova geocodifica».
- **Sigle tecnici**: collega TECA… ai dipendenti TEC; `tecnico_id` si aggiorna da solo (trigger).

## Dati (migrazione 0038)
`interventi_importati`, `importazioni`, `tecnici_sigle` (seed TECA, TECB, TECE, TECI, TECF, TECC, TECH), `cap_zone` (8 zone di Roma), `geocache` (solo service role), `regole_durata` (famiglia, minuti_base, minuti_per_componente — **vuota**, da compilare). Campo `durata_minuti` per ogni intervento, oggi nullo. Separate da `interventi` (piano giornaliero). RLS: solo `is_responsabile()`.

## Test
`npm test` → `src/lib/interventi/interventi.test.ts` (pulizia indirizzi, lettura colonne per nome, Lazio, validazione, punto medio via, suggerimenti) con indirizzi inventati. Il file reale con dati clienti non va mai messo nel repository.

## Eliminazione e cestino (migrazione 0054)
- Eliminazione **reversibile**: `eliminato_at/eliminato_da/motivo_eliminazione` su `interventi_importati` e `importazioni`; lo stato passa ad `annullato` (il precedente è in `stato_prima_eliminazione` e torna al ripristino). Gli eliminati spariscono da mappa, tabella, KPI, suggerimenti e geocodifica.
- **Elimina importazione** (storico importazioni): anteprima «N interventi, di cui P già pianificati / con percorso o assegnati a un giorno» (stato pianificato/eseguito o urgenza collegata); scelta «Elimina anche quelli pianificati» / «solo non pianificati»; motivo obbligatorio (File sbagliato / Duplicato / Mese errato / Altro + testo).
- **Elimina intervento**: popup della mappa, riga della tabella, scheda «Da verificare»; selezione multipla in tabella.
- «Elimina anche le posizioni salvate» nasconde le posizioni impianto non più usate (`impianti_posizione.eliminato_at`); una nuova coordinata le riattiva.
- **Cestino** (vista): ripristino per importazione, per gruppo o singolo, entro 30 giorni. Reimportando un file, gli eliminati sono **saltati** e contati, salvo «Ripristina eliminati» nell'anteprima (`importa_interventi_v2`).
- Registro: `interventi_cestino_log` (elimina / ripristina / ripristina_da_import / svuota).
- **Svuota cestino** (solo amministratore, cancellazione definitiva): `supabase/da_confermare/svuota_cestino_interventi.sql`, **non ancora applicato** (contiene DELETE, richiede conferma). Il pulsante avvisa finché non è attivo.
