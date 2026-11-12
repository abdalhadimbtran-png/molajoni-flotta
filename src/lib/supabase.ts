import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configurato = Boolean(url && key);

/** Oltre questo tempo una richiesta (non di caricamento file) si interrompe con «Il server non risponde». */
export const TIMEOUT_MS = 30000;
/**
 * fetch con limite di tempo: senza, con Supabase lento un pulsante resterebbe su «Salvataggio…» per minuti.
 * Non si applica a chi passa già un proprio `signal` né ai caricamenti nello storage (file fino a 10 MB).
 */
export function fetchConTimeout(base: typeof fetch = (...a) => fetch(...a), ms = TIMEOUT_MS): typeof fetch {
  return (input, init) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (init?.signal || /\/storage\/v1\/object\//.test(u) || typeof AbortController === 'undefined') return base(input, init);
    const c = new AbortController();
    const k = setTimeout(() => c.abort(new DOMException('Timeout', 'TimeoutError')), ms);
    return base(input, { ...init, signal: c.signal }).finally(() => clearTimeout(k));
  };
}

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
  global: { fetch: fetchConTimeout() },
});

/** Messaggio leggibile da un errore Supabase/PostgREST. */
export function testoErrore(e: unknown): string {
  if (!e) return 'Errore sconosciuto';
  if (typeof e === 'string') return e;
  const m = (e as { message?: string }).message;
  if (m) {
    if (m.includes('permission denied')) return 'Permesso negato per questa operazione.';
    if (m.includes('Failed to fetch') || /NetworkError|Load failed/i.test(m)) return 'Connessione non disponibile. Controlla la rete e riprova.';
    if ((e as { name?: string }).name === 'TimeoutError' || (e as { name?: string }).name === 'AbortError' || /timed out|Timeout/.test(m)) return 'Il server non risponde: riprova tra poco. I dati inseriti non sono stati persi.';
    if (/JWT expired|invalid JWT|jwt/i.test(m) || (e as { code?: string }).code === 'PGRST301') return 'Sessione scaduta: ricarica la pagina e accedi di nuovo. Quello che hai scritto nel Nuovo contatto resta nella bozza.';
    if (m.includes('duplicate key') && m.includes('targa')) return 'Esiste già un veicolo con questa targa.';
    if (m.includes('duplicate key') && m.includes('codice')) return 'Esiste già un tecnico con questo codice.';
    if (m.includes('veicoli_targa_check')) return 'Targa non valida: usa solo lettere maiuscole, numeri e spazi (5–10 caratteri).';
    if (m.includes('tecnici_codice_check')) return 'Codice non valido: 2–12 caratteri, solo lettere maiuscole e numeri.';
    return m;
  }
  return 'Errore sconosciuto';
}

/** Chiamata RPC che solleva l'errore come eccezione. */
export async function rpc<T = unknown>(nome: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw error;
  return data as T;
}
