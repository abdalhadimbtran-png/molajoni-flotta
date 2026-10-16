import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configurato = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Messaggio leggibile da un errore Supabase/PostgREST. */
export function testoErrore(e: unknown): string {
  if (!e) return 'Errore sconosciuto';
  if (typeof e === 'string') return e;
  const m = (e as { message?: string }).message;
  if (m) {
    if (m.includes('permission denied')) return 'Permesso negato per questa operazione.';
    if (m.includes('Failed to fetch')) return 'Connessione non disponibile. Controlla la rete e riprova.';
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
