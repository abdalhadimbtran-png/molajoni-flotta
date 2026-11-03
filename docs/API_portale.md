# API portale ferie / flotta (Supabase RPC)

Chiamata: `supabase.rpc(nome, { parametri })`. Tutte restituiscono `jsonb` salvo diversa indicazione.
Errori: eccezione con messaggio in italiano pronto da mostrare.

## Dipendente (app con codice + PIN) — ruolo `anon`, autenticazione via `p_token`
| RPC | Parametri |
|---|---|
| `dipendente_login` | `p_codice, p_pin` → `{token,...}` |
| `dipendente_logout` | `p_token` (void) |
| `dipendente_home` | `p_token` |
| `dipendente_saldi` | `p_token, p_anno` |
| `dipendente_richieste` | `p_token, p_anno` |
| `dipendente_anteprima` | `p_token, p_tipo, p_primo_giorno, p_rientro?, p_ora_inizio?, p_ora_fine?, p_mezza_giornata=false, p_meta?` |
| `dipendente_invia_richiesta` | come anteprima + `p_note?` (prima di `p_meta`) |
| `dipendente_annulla_richiesta` | `p_token, p_id` |
| `dipendente_notifiche` / `dipendente_notifica_letta` | `p_token` / `p_token, p_id` |
| `dipendente_salva_push` | `p_token, p_endpoint, p_p256dh, p_auth, p_lingua` |

`p_meta` = parte della giornata: `'mattina' | 'pomeriggio'`, **obbligatorio** se `p_mezza_giornata=true`, vietato altrimenti.
`p_rientro` = primo giorno di nuovo al lavoro (ultimo giorno assenza = rientro − 1).

## Ufficio personale — `authenticated` + `richiedi_hr()` (ruolo hr/admin), altrimenti "Accesso riservato all'ufficio HR"
| RPC | Parametri |
|---|---|
| `hr_anteprima` | `p_dipendente, p_tipo, p_primo_giorno, p_rientro?, p_ora_inizio?, p_ora_fine?, p_mezza_giornata, p_meta?` |
| `hr_inserisci_richiesta` | come anteprima + `p_note?, p_approva=true`, poi `p_meta?` |
| `hr_decidi_richiesta` | `p_id, p_decisione ('approvata'/'rifiutata'), p_motivo?` |
| `hr_annulla_richiesta` | `p_id, p_motivo` |
| `hr_impatto_richiesta` | `p_id` |
| `hr_richieste` | `p_stato?, p_da?, p_a?, p_categoria?, p_dipendente?` |
| `hr_calendario` | `p_da, p_a, p_categoria?, p_dipendente?` |
| `hr_saldi` | `p_anno, p_categoria?, p_dipendente?, p_alla?` |
| `hr_rettifica_saldo` | `p_dipendente, p_anno, p_tipo, p_quantita, p_motivo` |
| `hr_report` | `p_tipo ('riepilogo'/'presenze'/'registro'/'ingiustificate'), p_da, p_a, p_categoria?, p_dipendente?` (riepilogo: anche `ing_gg`, `ing_ore`) |
| `hr_registra_ingiustificata` | `p_dipendente, p_primo_giorno, p_rientro?, p_ora_inizio?, p_ora_fine?, p_mezza_giornata=false, p_meta?, p_note?` → tipo `ING`, già approvata, nessun saldo, nessuna email |
| `hr_anteprima_conversione` | `p_id, p_tipo ('FERIE'/'ROL'/'EXF')` → come `hr_anteprima`; `ok=false` se il saldo non basta |
| `hr_converti_ingiustificata` | `p_id, p_tipo, p_note?` → originale `annullata` con `convertita_in`, nuova approvata con `convertita_da` |
| `hr_imposta_pin` / `hr_genera_pin` / `hr_sblocca_accesso` | `p_dipendente[, p_pin]` |
| `hr_genera_festivita` | `p_anno` → integer |

## Responsabile flotta / admin — `authenticated`
| RPC | Parametri | Note |
|---|---|---|
| `piano_giorno` | `p_data` | per tecnico: `assenza` ("Assente", mai il tipo), `rientro`, `parte_giornata`, `note_assenza`, `messaggi` |
| `report_dati` | `p_tipo, p_da, p_a, p_veicolo?, p_tecnico?` | `assenze`: `motivo` = Assente / Assenza / Formazione / Trasferta / Altro |
| vista `assenze` | — | unione assenze manuali + richieste approvate |

Notifiche al responsabile flotta per assenze approvate/annullate: `link = /piano?data=AAAA-MM-GG`.

## Edge function `flotta` (verify_jwt off, controlli interni)
- `/account` (solo admin, JWT): `azione` = `elenco` (campi: user_id, nome, email, ruolo, area, dipendente_id, attivo, creato_il, ultimo_accesso, io) · `crea` · `password` · `stato`.
- `/push` (solo database, header segreto) · `/foto`, `/documento` (token tecnico).

Nota: le RPC `hr_*` hanno EXECUTE anche per `anon` (grant di default), ma rifiutano chi non è HR.

Assenza ingiustificata (`ING`): solo HR, mai richiedibile (vincolo), unità ore; la flotta vede solo "Assente". Annullo con `hr_annulla_richiesta` (motivo obbligatorio).

## Formazione — `authenticated` + `is_formazione()` (responsabile con `responsabili.formazione=true`, o admin)
Ruolo: `admin_imposta_responsabile(p_user, 'formazione', p_attivo)` (area resta `flotta` per il CHECK esistente, `is_responsabile()` esclude questi account).
| RPC | Parametri | Note |
|---|---|---|
| `formazione_cruscotto` | — | `{validi, in_scadenza, scaduti, mancanti, lista}`; anche HR |
| `formazione_scadenze` | `p_giorni=60` | anche HR |
| `formazione_report` | `p_tipo ('per_dipendente'/'scadenze'), p_categoria?, p_dipendente?, p_giorni=60` | anche HR |
| `formazione_registra` | `p_corso, p_dipendenti bigint[], p_data, p_scadenza?, p_ente?, p_ore?, p_note?, p_attestato?` | rinnovo = nuova riga |
| `formazione_stato_tecnici` | — | flotta: solo `valido`/`scaduto` per tecnico |
| `dipendente_corsi` | `p_token` | app dipendente, sola lettura |
Tabelle `corsi`, `corsi_dipendente` (scadenza automatica da trigger), vista `corsi_attuali`; bucket privato `attestati`.
Archivio: `corsi_attestati` (più file per registrazione). Avvisi: `formazione_impostazioni.soglie_mesi` (6/3/1), `formazione_controlla()` (pg_cron 06:17 + apertura area; una notifica per registrazione/soglia, email riepilogo max 1/giorno). `formazione_dati()` per cruscotto/report.
Attestato dal dipendente solo su richiesta: `formazione_chiedi_attestato(p_registrazioni[])`, `formazione_ricorda_attestato(p_id)`, `formazione_approva_richiesta(p_id)`, `formazione_rifiuta_richiesta(p_id, p_motivo)`; app: `dipendente_attestati_richiesti(p_token)`; edge `/carica-attestato` (form: token, richiesta_id, file ≤10 MB jpg/png/heic/pdf) e `/attestato` (token, id → URL 120 s, solo propri).
