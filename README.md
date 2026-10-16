# Molajoni · Gestione flotta

Gestione dei veicoli aziendali dei tecnici: pianificazione giornaliera, assegnazione dei veicoli, presa in carico e riconsegna con QR, chilometri, scadenze e segnalazioni.

Progetto **isolato**: repository, database Supabase (`molajoni-flotta`) e progetto Vercel propri. Non condivide nulla con altri progetti Molajoni.

## Due accessi

| Chi | Dove | Come entra |
|---|---|---|
| Responsabile flotta | `/cruscotto` | Email e password (Supabase Auth) + abilitazione nella tabella `responsabili` |
| Tecnico | `/t` oppure QR sul veicolo (`/t/v/<codice-qr>`) | Codice tecnico + PIN di 6 cifre impostato dal responsabile |

Il tecnico non ha accesso diretto alle tabelle: passa solo dalle funzioni `tecnico_*`, che verificano la sessione e applicano le regole.

## Regole principali (nel database, unica fonte)

- **Veicolo non assegnabile / non prendibile** se: dismesso, in officina, segnalazione "veicolo fermo" aperta, assicurazione o revisione scadute.
- **Avvisi**: scadenze entro 30 giorni, bollo scaduto, tagliando entro 1.500 km o superato, segnalazioni "da verificare", patente in scadenza.
- **Tecnico bloccato** se patente scaduta, non attivo o assente.
- **Km**: mai inferiori all'ultima lettura; salto > 1.000 km richiede conferma; correzioni solo come "rettifica" con motivo.
- **Un veicolo alla volta** per tecnico: prima di prenderne un altro deve riconsegnare.
- **Registro movimenti e segnalazioni**: nessuna cancellazione dall'app; modifiche ad anagrafiche e assegnazioni nell'`audit_log`.
- **Piano del giorno**: si conferma solo se nessun tecnico con interventi ha un blocco; ogni modifica successiva annulla la conferma.
- **Accesso tecnico**: 5 PIN errati → blocco 15 minuti; sessione valida 30 giorni; nuovo PIN = disconnessione da tutti i telefoni.

## Sviluppo

```bash
npm install
cp .env.example .env   # inserire la chiave publishable
npm run dev
```

Le migrazioni sono in `supabase/migrations/` (applicate al progetto `dhqvyxitcrbqwozgcgno`, regione eu-central-1).

## Versione 2 (16/10/2026)

- **Multe**: registro con ricerca automatica del conducente dal registro movimenti e conto alla rovescia dei 60 giorni (decurtazione punti).
- **Previsione tagliando** dai km medi giornalieri degli ultimi 90 giorni.
- **Notifiche**: in app e push (PWA). Il tecnico riceve il piano quando viene confermato e conferma "Ho visto"; il responsabile vede chi l'ha letto. Il responsabile riceve veicoli fermi/incidenti e il riepilogo scadenze del lunedì (pg_cron).
- **Foto** nelle segnalazioni (compresse sul telefono, bucket privato `foto`).
- **Documenti** del veicolo (bucket privato `documenti`), consultabili dal tecnico con link temporaneo.
- **Dotazioni di bordo** con scadenze (es. estintore di bordo) nei controlli del veicolo.
- **Carburante**: import CSV della carta carburante con mappatura colonne e anti-duplicati.
- **Report mensile** per veicolo con esportazione CSV.
- Funzione server `supabase/functions/flotta` (push, foto, documenti). Chiavi in `config_privata` (non esposta).

## Non ancora incluso

- Interventi e assenze importati da gestionale/HR (oggi inseriti a mano).
- Festività italiane nel calcolo del "prossimo giorno lavorativo" (oggi esclude solo sabato e domenica).
- Notifiche via email (oggi: in app e push).
