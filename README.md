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

## Non ancora incluso (versione 1)

- Foto nelle segnalazioni.
- Interventi e assenze importati da gestionale/HR (oggi inseriti a mano).
- Festività italiane nel calcolo del "prossimo giorno lavorativo" (oggi esclude solo sabato e domenica).
- Notifiche automatiche delle scadenze (email/messaggi).
