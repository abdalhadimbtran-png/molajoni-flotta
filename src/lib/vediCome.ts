/**
 * «Vedi come»: l'amministratore vede il portale come lo vedrebbe un altro account.
 * Solo simulazione nel browser: nessun accesso come l'altra persona, nessun token, nessuna sessione.
 * Mentre è attiva il portale è in SOLA LETTURA: ogni scrittura verso Supabase viene bloccata qui.
 */

export const CHIAVE = 'molajoni_vedi_come';

export interface RuoliVista { admin: boolean; flotta: boolean; hr: boolean; formazione: boolean; centralino: boolean; direzione: boolean }
export interface VediCome { userId: string; nome: string; email: string; dipendenteId: number | null; ruoli: RuoliVista }

const BOOL = ['flotta', 'hr', 'formazione', 'centralino', 'direzione'] as const;

/** Valida il contenuto salvato: qualsiasi forma inattesa → null. L'account simulato non è mai amministratore. */
export function analizza(raw: string | null): VediCome | null {
  if (!raw) return null;
  try {
    const x = JSON.parse(raw) as Record<string, unknown>;
    const r = (x.ruoli ?? {}) as Record<string, unknown>;
    if (typeof x.userId !== 'string' || !/^[0-9a-f-]{36}$/i.test(x.userId) || typeof x.nome !== 'string') return null;
    const ruoli: RuoliVista = { admin: false, flotta: false, hr: false, formazione: false, centralino: false, direzione: false };
    for (const k of BOOL) ruoli[k] = r[k] === true;
    const dip = typeof x.dipendenteId === 'number' && Number.isFinite(x.dipendenteId) ? x.dipendenteId : null;
    return { userId: x.userId, nome: x.nome.slice(0, 120), email: typeof x.email === 'string' ? x.email : '', dipendenteId: dip, ruoli };
  } catch { return null; }
}

export function leggi(): VediCome | null {
  try { return analizza(sessionStorage.getItem(CHIAVE)); } catch { return null; }
}
export function salva(v: VediCome) {
  try { sessionStorage.setItem(CHIAVE, JSON.stringify(v)); } catch { /* storage non disponibile */ }
}
export function cancella() {
  try { sessionStorage.removeItem(CHIAVE); } catch { /* storage non disponibile */ }
}

/**
 * Ruoli effettivi: la vista vale solo se l'utente reale è amministratore.
 * Per chi non è amministratore la chiave (anche manomessa) viene ignorata.
 */
export function ruoliEffettivi<R extends RuoliVista>(reali: R, v: VediCome | null): R {
  if (!reali.admin || !v) return reali;
  return { ...reali, ...v.ruoli, admin: false };
}

/** Vista attiva in questa scheda? (Il blocco scritture è prudente: vale finché la chiave c'è.) */
export const attiva = () => leggi() !== null;
/** Id utente da usare nei filtri lato client (es. «le mie»): quello simulato se la vista è attiva. */
export const idEffettivo = (reale: string | null | undefined): string | null => leggi()?.userId ?? reale ?? null;

export const messaggioSolaLettura = (nome: string) => `Modalità sola lettura: stai vedendo come ${nome}`;

export class ErroreSolaLettura extends Error {
  status = 403;
  code = 'SOLA_LETTURA';
  constructor(nome: string) { super(messaggioSolaLettura(nome)); this.name = 'ErroreSolaLettura'; }
}

/** Funzioni RPC di sola lettura ammesse durante la vista (elenco chiuso: tutto il resto è bloccato). */
export const RPC_LETTURA = new Set([
  'is_admin', 'is_responsabile', 'is_hr', 'is_formazione', 'is_centralino', 'is_direzione',
  'admin_vedi_come',
  'admin_centralino_conteggi', 'admin_get_impostazioni', 'admin_personale_flotta_conteggi', 'analisi_admin', 'anomalie_carburante', 'anteprima_elimina_importazione',
  'centralino_altri_referenti', 'centralino_cerca', 'centralino_clienti', 'centralino_commerciali', 'centralino_contatti', 'centralino_coordinatori', 'centralino_copertura',
  'centralino_fornitori', 'centralino_prossimo', 'centralino_referenti_avvisi', 'centralino_registro_giorno', 'centralino_sedi', 'centralino_stato_cliente', 'centralino_tecnici',
  'conducente_alle', 'direzione_digest_stato', 'formazione_dati', 'geocache_leggi',
  'hr_anteprima', 'hr_anteprima_eliminazione', 'hr_calendario', 'hr_report', 'hr_richieste', 'hr_saldi',
  'piano_giorno', 'piano_modifiche_pendenti', 'prossimo_lavorativo', 'report_agenda', 'report_carburante', 'variazioni_da_riassegnare', 'variazioni_giornata',
]);

/**
 * La richiesta è ammessa in sola lettura? `basi` = URL di Supabase/funzioni da sorvegliare.
 * Ammesse: GET/HEAD/OPTIONS, autenticazione (rinnovo token, uscita), RPC dell'elenco di lettura.
 */
export function richiestaAmmessa(url: string, metodo: string | undefined, basi: string[]): boolean {
  const m = (metodo ?? 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  const base = basi.filter(Boolean).find(b => url.startsWith(b));
  if (!base) return true; // servizi esterni (mappe, percorsi): nessun dato del portale
  let percorso = url.slice(base.length);
  try { percorso = new URL(url).pathname; } catch { /* resta il resto dell'URL */ }
  if (/\/auth\/v1\//.test(percorso)) return true;
  const rpc = /\/rest\/v1\/rpc\/([a-z_0-9]+)/i.exec(percorso);
  return !!rpc && RPC_LETTURA.has(rpc[1]);
}

/** Avvolge fetch: in vista attiva le scritture verso il portale falliscono con un messaggio chiaro. */
export function conGuardia(base: typeof fetch, basi: string[], vista: () => VediCome | null = leggi): typeof fetch {
  return (input, init) => {
    const v = vista();
    if (v) {
      const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const m = init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : undefined);
      if (!richiestaAmmessa(u, m, basi)) return Promise.reject(new ErroreSolaLettura(v.nome));
    }
    return base(input, init);
  };
}

/** Controllo esplicito per i salvataggi (salva.ts, rpc): solleva l'errore di sola lettura se la vista è attiva. */
export function bloccaSeSolaLettura(vista: () => VediCome | null = leggi) {
  const v = vista();
  if (v) throw new ErroreSolaLettura(v.nome);
}

let installata = false;
/** Installa la guardia sul fetch globale (Supabase e funzioni lo usano al momento della chiamata). */
export function installaGuardia(basi: string[]) {
  if (installata || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  installata = true;
  const orig = window.fetch.bind(window);
  window.fetch = conGuardia(orig, basi);
}
