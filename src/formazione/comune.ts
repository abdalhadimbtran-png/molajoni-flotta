import { supabase } from '../lib/supabase';
import type { Livello } from '../lib/format';

export type StatoCorso = 'valido' | 'in_scadenza' | 'scaduto' | 'mancante';
export const STATO_CORSO: Record<StatoCorso, [Livello, string]> = {
  valido: ['ok', 'Valido'], in_scadenza: ['warn', 'In scadenza'], scaduto: ['ko', 'Scaduto'], mancante: ['ko', 'Mancante'],
};

export interface Corso { id: number; nome: string; descrizione: string | null; validita_mesi: number | null; obbligatorio_per_tec: boolean; attivo: boolean; ordine: number }
export interface CorsoFatto {
  id: number; dipendente_id: number; corso_id: number; data_conseguimento: string; data_scadenza: string | null;
  ente: string | null; ore: number | null; note: string | null; attestato_path: string | null; created_at: string;
}
export interface DipBase { id: number; codice: string; nome: string; cognome: string; categoria: string; reparto: string | null; attivo: boolean }
export interface RigaStato {
  dipendente_id: number; nome: string; categoria: string; corso_id: number; corso: string; obbligatorio: boolean;
  data_conseguimento: string | null; data_scadenza: string | null; ente: string | null; ore: number | null; stato: StatoCorso; giorni: number | null;
}

/** Stessa regola del database: scaduto prima di oggi, in scadenza entro 60 giorni. */
export function statoDi(scadenza: string | null, oggi: string): StatoCorso {
  if (!scadenza) return 'valido';
  if (scadenza < oggi) return 'scaduto';
  const d = new Date(oggi + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 60);
  return scadenza <= d.toISOString().slice(0, 10) ? 'in_scadenza' : 'valido';
}

/** Data + mesi (come Postgres: fine mese se il giorno non esiste). */
export function piuMesi(iso: string, mesi: number): string {
  const [y, m, g] = iso.split('-').map(Number);
  const tot = m - 1 + mesi, ny = y + Math.floor(tot / 12), nm = ((tot % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(g, ultimo))).toISOString().slice(0, 10);
}

export const testoValidita = (m: number | null) => (m == null ? 'Nessuna scadenza' : m % 12 === 0 ? `${m / 12} ${m === 12 ? 'anno' : 'anni'}` : `${m} mesi`);

export async function caricaAttestato(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 10 MB).');
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'pdf';
  const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('attestati').upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error('Caricamento dell\'attestato non riuscito. Riprova.');
  return path;
}

export async function apriAttestato(path: string) {
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('attestati').createSignedUrl(path, 300);
  if (error || !data) { w?.close(); throw new Error('Attestato non disponibile'); }
  if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}
