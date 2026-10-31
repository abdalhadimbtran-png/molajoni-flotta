# Prove fasi 2–4 (31/10/2026) — progetto dhqvyxitcrbqwozgcgno

Ogni prova: `execute_sql` con `set_config('request.jwt.claims', ...)` dentro un blocco `DO` chiuso da `raise exception` (tutto annullato).

## Dati di prova (DATI DI TEST, da disattivare in produzione)
Migrazione `20261031_0021_dipendenti_prova_non_tec.sql`.
| Codice | Categoria | Reparto | PIN |
|---|---|---|---|
| ZUFF1 | UFFICIO | Amministrazione | 616367 |
| ZMAG1 | MAGAZZINO | Magazzino | 857709 |
| ZALT1 | ALTRO | Servizi | 080216 |

## Risultati
| # | Prova | Esito |
|---|---|---|
| 1 | Migrazioni 0018–0020 applicate (list_migrations) | OK |
| 2 | Edge `flotta` v5 deployata; `/account elenco` legge `area`, `dipendente_id` (colonne presenti) | OK |
| 3 | ZUFF1 login con PIN | OK, token |
| 4 | `dipendente_anteprima` mezza giornata senza `p_meta` | rifiutata: "Scegli se sei assente la mattina o il pomeriggio." |
| 5 | anteprima + invio mezza giornata `pomeriggio` | OK, `meta=pomeriggio` salvato |
| 6 | Secondo invio stessa mezza giornata | rifiutato: "Per questa parte della giornata c'è già una richiesta…" |
| 7 | HR (admin) `hr_anteprima` / `hr_inserisci_richiesta` ZMAG1 mattina | OK, approvata, `meta=mattina` |
| 8 | HR richiesta a giorni (9→rientro 12/11) | OK, approvata |
| 9 | `piano_giorno` tecnico con mezza giornata | `assenza=null`, `parte_giornata=pomeriggio`, messaggio "Assente il pomeriggio" |
| 10 | `piano_giorno` tecnico assente giorni interi | `assenza="Assente"` (una sola volta, niente "Assente: Assente"), `rientro=2026-11-12` |
| 11 | Link notifiche responsabile flotta | trigger genera `/piano?data=AAAA-MM-GG` (verificato nel codice della funzione; scatta solo con interventi/piano confermato) |
| 12 | Vista `assenze` / report `assenze` | motivi solo "Assente" (richieste) e "Assenza" (vecchie manuali) |
| 13 | `anon` chiama `hr_saldi` | rifiutato: "Accesso riservato all'ufficio HR" |
| 14 | Frontend: `p_meta` passato da NuovaRichiesta (dipendente) e form HR (nuovo selettore Mattina/Pomeriggio); `npm run build` | OK |
