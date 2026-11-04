# Variazioni della giornata (/giornata) e notifiche del piano

Accesso: responsabile flotta e amministratore (`is_responsabile`). Menu Operatività → «Variazioni giornata». Pulsante «Nuova urgenza» anche in Pianificazione (giorno e settimana) e Percorsi.
Decisioni del titolare: il tecnico **non** tocca arrivato/finito per intervento; tocca solo «Segnala ritardo» e una volta «Giornata finita». Le urgenze partono **solo** con «Invia urgente al tecnico».

## Tappe del giorno (`privato.giornata_tappe`)
Percorso salvato del giorno se c'è (chiave `p:<id tappa>`), altrimenti `interventi` per ora (`i:<id>`, fine = `ora_fine` o +60 min). Le urgenze (`u:<id>`) si inseriscono dopo `dopo_key`.
`privato.giornata_stima`: orari **pianificati** invariati, in più `arrivo_stimato` / `partenza_stimata`. Un ritardo sulla tappa k sposta la fine di k e tutte le successive; traffico/veicolo spostano anche l'arrivo di k. Un'urgenza sposta le successive di `spostamento_min` (calcolato nell'anteprima). Tappa corrente = prima con partenza stimata dopo l'ora attuale (Roma).

## Tecnico (app /t, home) — RPC con token
| RPC | Note |
|---|---|
| `tecnico_giornata(p_token)` | tappe con stimati, corrente, fine stimata, ritardi, urgenze inviate, giornata finita |
| `tecnico_segnala_ritardo(p_token, p_key, p_motivo, p_minuti, p_nota?)` | motivo `cliente/tempo/traffico/veicolo/altro` (altro: nota obbligatoria). Campanella responsabile: «TECB +30 min (cliente) – fine giornata stimata 17:40»; livello urgente se oltre soglia, con «Suggerito: spostare «X»» |
| `tecnico_giornata_finita(p_token, p_tutto_fatto, p_non_fatti text[], p_nota?)` | `giornate_lavoro`; i non fatti vanno in `da_ripianificare` |
| `tecnico_urgenza_letta(p_token, p_id)` | «Ho letto» sul banner rosso |

## Responsabile
| RPC | Note |
|---|---|
| `variazioni_giornata(p_data)` | per tecnico: stato (in giro / finito alle / fine non segnalata / assente), ritardi, urgenze con lettura, `cap_zone`, `da_ripianificare` |
| `variazioni_imposta_soglia(p_soglia)` | default 18:00 (`variazioni_impostazioni`) |
| `variazioni_crea_urgenza(...)` | inserisce l'intervento urgente (il piano confermato resta confermato) + riga `urgenze` + spostamenti scelti (`domani` / altro tecnico) |
| `variazioni_invia_urgenza(p_id)` / `variazioni_annulla_urgenza(p_id)` | notifica `avviso` urgente con indirizzo, attività, note, link Google Maps |
| `variazioni_indisponibile(p_tecnico, p_dal, p_al)` | riga in `assenze_manuali` (motivo «Altro») |
| `variazioni_da_riassegnare(p_da, p_a)` | attività dei tecnici assenti (max 31 gg), carico/posizione degli altri, rientro e primo giorno libero, interventi del mese «pianificati» del tecnico assente |
| `variazioni_applica(p_azioni)` | assegna / rimanda / lascia; le tappe di percorso spostate diventano interventi del destinatario e il percorso torna bozza con avviso «ricalcola» |
| `report_variazioni(p_tipo 'ritardi'/'giornate', p_da, p_a, p_tecnico?)` | report «Ritardi» e «Fine giornata» in /report (PDF/Excel con esporta) |

Suggerimenti (logica pura `src/lib/variazioni/giornata.ts`, test `giornata.test.ts`): urgenza → zona CAP, poi più vicino alla posizione stimata (tappa corrente con coordinate), poi meno lavoro residuo; esclusi assenti e chi ha finito. Riassegnazione → stessa zona CAP, poi più vicino (baricentro del giorno), poi meno carico. Viaggio stimato: km in linea d'aria × 1,3 a 30 km/h + 10 min (20 min senza coordinate). Le interventi senza coordinate (piano giornaliero) contano solo per CAP nel testo e carico.

## Notifiche del piano (migrazione 0040)
- Fotografia per (giorno, tecnico) in `piano_inviato` (già usata da `conferma_piano`): veicolo, interventi (urgenze escluse), tappe del percorso.
- `pubblica_piano(p_tipo 'giorno'|'settimana'|'mese', p_data)`: **una** notifica `piano` per tecnico: «Piano di lun 9 nov: 5 interventi, partenza 08:00» / «Piano settimana 9–13 nov pronto: 22 interventi» / «Piano di novembre pronto: …». Se il periodo era già inviato → elenco modifiche.
- `conferma_piano(p_data)` ora usa lo stesso meccanismo (nessun doppione).
- Modifiche successive (aggiunto, tolto, spostato di giorno/ora, riassegnato, cambio veicolo) si raccolgono e partono con «Invia aggiornamenti» (`variazioni_invia_aggiornamenti`, da oggi a +31, solo giorni già inviati o toccati dalle riassegnazioni): «Spostato: Via X da mar 10 nov a gio 12 nov 08:00».
- `piano_modifiche_pendenti()`: badge «N modifiche non inviate» per tecnico + registro `notifiche_piano` (tecnico, tipo, periodo, dettaglio, inviata_at) con lettura da `notifiche.letta_il`.
- App: il link porta a `/t?data=…`; l'app mostra oggi e il prossimo giorno.

## Tabelle (0039–0040, RLS: solo `is_responsabile`; il tecnico passa dalle RPC)
`ritardi`, `giornate_lavoro`, `da_ripianificare`, `urgenze`, `variazioni_da_inviare` (giorni da includere), `variazioni_impostazioni`, `notifiche_piano`.

## Prove
Blocchi `DO` con `raise exception` finale (rollback) sul progetto: ritardo +30 → fine 18:00→18:30 e suggerimento; «altro» senza nota rifiutato; urgenza inserita dopo la corrente, banner solo dopo l'invio, «Ho letto» registrato; giornata finita con non fatti; indisponibile → da riassegnare e rimanda al primo giorno libero; pubblica settimana (seconda pubblicazione senza modifiche = nessuna notifica), spostamento/riassegnazione → righe «Spostato/Tolto/Aggiunto», badge azzerato dopo l'invio; anon bloccato.
