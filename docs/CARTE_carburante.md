# Carte carburante (Q8)

Proprietario: **ufficio personale (HR) + admin** — gestione completa. Responsabile flotta: sola lettura.
Mai salvare il numero completo (PAN) né il PIN: solo `ultime4`.

## Dati (migrazione `20261031_0022_carte_carburante.sql`)
- `carte_carburante`: ultime4, circuito (Q8), veicolo_id?, scadenza, stato (attiva/sospesa/smarrita/restituita), note.
- `carte_assegnazioni`: storico, mai sovrascritto (dipendente_id?/veicolo_id?, dal, al?, consegnata_da, restituita_a). Solo via RPC.
- `rifornimenti` + `carta_id`, `ora`, `dipendente_id`. Trigger all'import: dipendente = assegnazione carta valida quel giorno, altrimenti tecnico pianificato (`assegnazioni`); veicolo dalla carta se manca la targa.
- `veicoli` + `capacita_serbatoio`, `alimentazione` (da compilare per i controlli litri/prodotto).

## RPC
| RPC | Chi | Note |
|---|---|---|
| `carta_assegna(p_carta, p_dipendente, p_veicolo, p_dal, p_consegnata_da?, p_note?)` | HR | chiude l'assegnazione aperta al giorno prima |
| `carta_restituisci(p_carta, p_al, p_restituita_a?, p_note?)` | HR | |
| `anomalie_carburante(p_da?, p_a?)` | HR, flotta | default ultimi 90 gg; `tipo`: ferie, orario, litri, prodotto, km, ravvicinati, cessato, carta |
| `carte_da_ritirare()` | HR, flotta | carte attive di dipendenti cessati |
| `report_carburante(p_tipo, p_da, p_a, p_veicolo?, p_tecnico?)` | HR, flotta | `consumi_veicoli` (l/100 km da letture QR), `spesa_mensile` |
| `dipendente_carta(p_token)` | dipendente | ultime 4 + stato (profilo /t) |

## UI
- HR: `/hr/carte` (elenco, assegna/restituisci, storico, stato), `/hr/carburante` (import CSV Q8 + anomalie).
- Flotta: `/carte`, `/carburante` in sola lettura; voce nel Cruscotto con il numero di rifornimenti anomali; report «Consumi carburante per veicolo» e «Spesa carburante mensile».
- Import: mappatura colonne libera (formato Q8 ancora da confermare): data, ora, targa, numero carta (match ultime 4, preferita la carta attiva), litri, importo, km, prodotto. Dedup su `riga_hash`.

## Dati di prova
Carta `•••• 0000` (note `[TEST]`, assegnata a ZUFF1) e 2 rifornimenti `importazione = 'TEST'` — da eliminare a mano.
