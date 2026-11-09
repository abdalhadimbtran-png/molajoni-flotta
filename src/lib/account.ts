/** Account e ruoli: pannelli, cambio pannello, testo per Outlook. Funzioni pure (testate). */

export type Pannello = 'admin' | 'flotta' | 'hr' | 'formazione' | 'centralino' | 'direzione';
export type Pannelli = Record<Pannello, boolean>;
export const NESSUN_PANNELLO: Pannelli = { admin: false, flotta: false, hr: false, formazione: false, centralino: false, direzione: false };

export const PANNELLI: { v: Pannello; l: string; d: string; home: string }[] = [
  { v: 'admin', l: 'Amministratore', d: 'Tutto il portale: account e ruoli, sicurezza, analisi e tutti i pannelli.', home: '/admin' },
  { v: 'flotta', l: 'Flotta e pianificazione', d: 'Piano giornaliero, veicoli, tecnici, interventi, segnalazioni, multe, carburante.', home: '/cruscotto' },
  { v: 'hr', l: 'Ufficio personale (HR)', d: 'Ferie e permessi, dipendenti, saldi, festività, report del personale.', home: '/hr' },
  { v: 'formazione', l: 'Formazione', d: 'Corsi e attestati dei dipendenti, scadenze, report della formazione.', home: '/formazione' },
  { v: 'centralino', l: 'Centralino', d: 'Front office: contatti dei clienti, pratiche, email ai clienti, registro del giorno.', home: '/centralino' },
  { v: 'direzione', l: 'Direzione', d: 'Sola lettura: monitoraggio del centralino e KPI.', home: '/direzione/centralino' },
];

/** Pannelli aperti da un account (l'amministratore li apre tutti). */
export function pannelliAperti(p: Pannelli): Pannello[] {
  if (p.admin) return PANNELLI.map(x => x.v);
  return PANNELLI.filter(x => x.v !== 'admin' && p[x.v]).map(x => x.v);
}

/** Pannello della pagina corrente, per evidenziarlo nel selettore. */
export function pannelloDi(percorso: string): Pannello {
  if (percorso.startsWith('/admin')) return 'admin';
  if (percorso.startsWith('/hr')) return 'hr';
  if (percorso.startsWith('/formazione')) return 'formazione';
  if (percorso.startsWith('/direzione')) return 'direzione';
  if (percorso.startsWith('/centralino')) return 'centralino';
  return 'flotta';
}

/** Normalizza le caselle: «Amministratore» comprende tutto, quindi le altre si spengono. */
export function normalizza(p: Pannelli): Pannelli {
  return p.admin ? { ...NESSUN_PANNELLO, admin: true } : p;
}
export const almenoUno = (p: Pannelli) => Object.values(p).some(Boolean);

export type StatoEmail = 'inviata' | 'in_coda' | 'non_consegnabile_test' | 'errore';
export const STATO_EMAIL: Record<StatoEmail, { l: string; s: 'ok' | 'warn' | 'ko' | 'na' }> = {
  inviata: { l: 'Email inviata', s: 'ok' },
  in_coda: { l: 'Email in coda', s: 'na' },
  non_consegnabile_test: { l: 'Non consegnabile in modalità test', s: 'warn' },
  errore: { l: 'Invio non riuscito', s: 'ko' },
};

/** mailto: con lo stesso testo dell'email, per inviarla dalla casella aziendale (Outlook). */
export function mailtoInvito(dest: string, oggetto: string, testo: string): string {
  return `mailto:${encodeURIComponent(dest)}?subject=${encodeURIComponent(oggetto)}&body=${encodeURIComponent(testo.replace(/\r?\n/g, '\r\n'))}`;
}

/** Regole minime della password scelta dall'utente. */
export function controllaPassword(pw: string, conferma: string): string | null {
  if (pw.length < 10) return 'La password deve avere almeno 10 caratteri.';
  if (pw.length > 72) return 'La password è troppo lunga (massimo 72 caratteri).';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Usa almeno una lettera e un numero.';
  if (pw !== conferma) return 'Le due password non coincidono.';
  return null;
}
