# Percorsi giornalieri (/percorsi)

Accesso: responsabile flotta e amministratore (`is_responsabile`). Non ancora collegato alla Pianificazione.

- `/percorsi` — cruscotto del giorno (Oggi / Domani / data): una scheda per tecnico attivo con tappe, km, guida, lavoro, partenza → rientro, stato (Nessun percorso / Bozza / Confermato), avvisi; Apri / Crea / Duplica da altro giorno; totali del giorno.
- `/percorsi/nuovo?data=&tecnico=` e `/percorsi/:id` — pianificatore.
- Riepilogo "Percorsi di domani" nel Cruscotto flotta; "oggi" + "domani" nella Panoramica amministratore.

## Dati
- Tabella `public.percorsi` (migrazione 0036): `data, tecnico_id → dipendenti.id, partenza, stops, opzioni, risultato, stato bozza|confermato`, unica per (data, tecnico). RLS: solo `is_responsabile()`.
- Ogni tappa (`stops[]`): indirizzo + coordinate, nome, attività (da `attivita_predefinite`, prefill della durata), note, durata, prima obbligatoria, `allegati[]`.
- Allegati: bucket privato `percorsi-allegati` (migrazione 0037), max 10 MB, jpg/png/heic/pdf/docx/xlsx; apertura con URL firmato (5 min); rimozione solo logica (`rimosso: true`, il file resta).
- localStorage: sede predefinita (`molajoni_percorsi_sede`), bozza automatica per data+tecnico, cache geocodifica (max 400 ricerche).

## Calcolo
- Codice: `src/lib/percorsi/ottimizza.ts` (logica pura, test in `ottimizza.test.ts`, `npm test`), `routing.ts` (fornitore), `piano.ts` (modello e DB).
- Ordine: tappa obbligatoria in testa, poi minimo orario di rientro: ricerca esatta fino a 8 tappe libere, oltre vicino più vicino + 2-opt. Riordino manuale con ricalcolo immediato.
- Traffico: OSRM **non ha traffico reale**. Ogni tratto × fattore della fascia in cui parte: 07:30–09:30 ×1,35 · 12:30–14:00 ×1,15 · 17:00–19:30 ×1,35 · altrimenti ×1,1 (modificabili in "Impostazioni stima"). Più un margine fisso per tratto (5/7/10 min).
- Pausa pranzo 13:30–14:30: prima di un tratto o intervento, se l'ora è ≥ 13:30 la pausa inizia subito (60 min); se l'attività successiva supererebbe le 13:30 e sono già le 12:30 o più, il tecnico attende e fa la pausa 13:30–14:30; un intervento lungo iniziato prima delle 12:30 può attraversare le 13:30 e la pausa si fa appena libero. Durante la pausa non si guida né si lavora.
- Avviso se il rientro supera la soglia (default 18:00).

## Limiti dei servizi
- Nominatim e `router.project-osrm.org` sono server **dimostrativi pubblici**: nessuna garanzia di disponibilità, limiti d'uso stretti (Nominatim: 1 richiesta/s, niente uso massivo). L'app rispetta 1 richiesta ogni 1,1 s, attende 1 s dopo l'ultima battuta e mette in cache le ricerche.
- Per la produzione: OpenRouteService (chiave gratuita, geocodifica + matrix + directions), oppure OSRM/Nominatim in self-hosting, oppure Google (traffico reale, a pagamento). Basta sostituire `geocodifica`, `matrice`, `traccia` in `routing.ts`.
- "Apri in Google Maps" accetta max 9 tappe intermedie.
- Tessere mappa: OpenStreetMap ("© OpenStreetMap contributors"); per traffico intenso serve un fornitore di tessere dedicato.
