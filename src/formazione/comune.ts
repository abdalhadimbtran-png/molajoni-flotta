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

export interface Registrazione {
  id: number; dipendente_id: number; nome: string; categoria: string; attivo: boolean; corso_id: number; corso: string;
  data_conseguimento: string; data_scadenza: string | null; ente: string | null; ore: number | null; n_attestati: number; attuale: boolean;
}
export interface Attestato { id: number; corso_dipendente_id: number; path: string; nome_file: string | null; mime: string | null; created_at: string; caricato_da_dipendente: boolean }
export interface Richiesta { id: number; corso_dipendente_id: number; stato: 'richiesto' | 'da_verificare' | 'approvato' | 'rifiutato'; path: string | null; nome_file: string | null; mime: string | null; motivo: string | null; richiesto_il: string; ultimo_promemoria: string | null; caricato_il: string | null }
export interface Tutto { oggi: string; righe: RigaStato[]; registrazioni: Registrazione[]; corsi: Corso[]; dip: DipBase[]; attestati: Attestato[]; richieste: Richiesta[] }

/** Tutti i dati dell'area in una volta (pochi dipendenti: calcoli nel browser). */
export async function caricaTutto(): Promise<Tutto> {
  const [d, c, p, a, pr] = await Promise.all([
    supabase.rpc('formazione_dati'),
    supabase.from('corsi').select('*').order('ordine').order('nome'),
    supabase.from('dipendenti').select('id,codice,nome,cognome,categoria,reparto,attivo').eq('attivo', true).order('cognome').order('nome'),
    supabase.from('corsi_attestati').select('*').order('created_at', { ascending: false }),
    supabase.from('richieste_attestato').select('*').order('richiesto_il', { ascending: false }),
  ]);
  const e = d.error || c.error || p.error || a.error || pr.error; if (e) throw e;
  const x = d.data as { oggi: string; righe: RigaStato[]; registrazioni: Registrazione[] };
  return { ...x, corsi: (c.data ?? []) as Corso[], dip: (p.data ?? []) as DipBase[], attestati: (a.data ?? []) as Attestato[], richieste: (pr.data ?? []) as Richiesta[] };
}

/** Riduce le foto grandi prima del caricamento (JPEG, lato lungo 2000 px). PDF e foto piccole restano uguali. */
export async function comprimi(f: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size < 1.5 * 1024 * 1024) return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 2000 / Math.max(img.width, img.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
    cv.getContext('2d')!.drawImage(img, 0, 0, cv.width, cv.height);
    const b = await new Promise<Blob | null>(r => cv.toBlob(r, 'image/jpeg', 0.82));
    return b && b.size < f.size ? new File([b], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}

export async function caricaFile(f: File): Promise<{ path: string; nome: string; mime: string }> {
  const g = await comprimi(f);
  return { path: await caricaAttestato(g), nome: g.name.slice(0, 120), mime: g.type };
}

export const iniziali = (n: string, c: string) => `${(c[0] ?? '').toUpperCase()}${(n[0] ?? '').toUpperCase()}`;
export const COLORE: Record<StatoCorso, string> = { valido: 'var(--ok)', in_scadenza: 'var(--warn)', scaduto: 'var(--ko)', mancante: 'var(--ko)' };

export const richiestaAperta = (t: Tutto, cd: number) => t.richieste.find(r => r.corso_dipendente_id === cd && r.stato !== 'approvato') ?? null;
export async function chiediAttestato(ids: number[]) {
  const { data, error } = await supabase.rpc('formazione_chiedi_attestato', { p_registrazioni: ids });
  if (error) throw error;
  return (data as { richieste: number }).richieste;
}
