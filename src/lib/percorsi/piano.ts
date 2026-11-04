/** Modello del percorso salvato (tabella public.percorsi) e calcolo del risultato. */
import { supabase } from '../supabase';
import { DEFAULT_FASCE, DEFAULT_FATTORE_BASE, fmtHM, hm, simula, type FasciaTraffico, type Giornata, type Matrice, type Parametri } from './ottimizza';

export interface Luogo { nome: string; indirizzo: string; lat: number | null; lon: number | null }
export interface Allegato { path: string; nome: string; tipo: string; size: number; caricato_il: string; rimosso?: boolean }
export interface Tappa extends Luogo { id: string; durata: number; prima: boolean; attivita?: string; note?: string; allegati?: Allegato[] }
export interface Opzioni { ora: string; pausa: boolean; margine: number; fasce: FasciaTraffico[]; fattoreBase: number; sogliaFine: string }
export interface Risultato {
  ordine: string[]; // id tappe nell'ordine
  righe: { tipo: 'tappa' | 'pausa' | 'rientro'; id?: string; luogo: string; attivita?: string; note?: string; arrivo: string; durata: number; partenza: string; min?: number; km?: number; fattore?: number }[];
  totali: { km: number; guida: number; lavoro: number; tappe: number; partenza: string; fine: string };
  avvisi: string[];
}
export interface Percorso {
  id?: number; data: string; tecnico_id: number | null; partenza: Luogo; stops: Tappa[]; opzioni: Opzioni;
  risultato: Risultato | null; stato: 'bozza' | 'confermato'; updated_at?: string;
}

export const OPZIONI_DEFAULT: Opzioni = { ora: '08:00', pausa: true, margine: 10, fasce: DEFAULT_FASCE, fattoreBase: DEFAULT_FATTORE_BASE, sogliaFine: '18:00' };

const CHIAVE_SEDE = 'molajoni_percorsi_sede';
export function leggiSede(): Luogo {
  try { const s = JSON.parse(localStorage.getItem(CHIAVE_SEDE) || 'null'); if (s && typeof s === 'object') return s; } catch { /* nulla */ }
  return { nome: 'Sede Molajoni', indirizzo: '', lat: null, lon: null };
}
export function salvaSede(s: Luogo) { try { localStorage.setItem(CHIAVE_SEDE, JSON.stringify(s)); } catch { /* nulla */ } }

export const nuovaTappa = (): Tappa => ({ id: Math.random().toString(36).slice(2, 10), nome: '', indirizzo: '', lat: null, lon: null, durata: 45, prima: false, attivita: '', note: '', allegati: [] });

export function parametri(o: Opzioni, tappe: Tappa[]): Parametri {
  return { partenza: hm(o.ora), durate: [0, ...tappe.map(t => t.durata)], margine: o.margine, pausa: o.pausa, pausaDa: hm('13:30'), pausaMin: 60, fasce: o.fasce, fattoreBase: o.fattoreBase };
}

/** Converte la giornata simulata nel risultato salvabile. `tappe` nell'ordine della matrice (indice i+1). */
export function risultatoDa(g: Giornata, ordine: number[], tappe: Tappa[], sede: Luogo, o: Opzioni): Risultato {
  const righe: Risultato['righe'] = [];
  const nome = (t: Tappa) => t.nome || t.indirizzo;
  for (let k = 0; k < g.passi.length; k++) {
    const p = g.passi[k];
    if (p.tipo === 'tappa') {
      const next = g.passi.slice(k + 1).find(x => x.tipo === 'tratto');
      const t = tappe[p.i - 1];
      righe.push({ tipo: 'tappa', id: t.id, luogo: nome(t), attivita: t.attivita || undefined, note: t.note || undefined, arrivo: fmtHM(p.arrivo), durata: p.durata, partenza: fmtHM(p.partenza),
        min: next && next.tipo === 'tratto' ? Math.round(next.guida + next.margine) : undefined, km: next && next.tipo === 'tratto' ? Math.round(next.km * 10) / 10 : undefined, fattore: next && next.tipo === 'tratto' ? next.fattore : undefined });
    } else if (p.tipo === 'pausa') {
      righe.push({ tipo: 'pausa', luogo: p.attesa > 0 ? `Pausa pranzo (attesa ${Math.round(p.attesa)} min)` : 'Pausa pranzo', arrivo: fmtHM(p.da), durata: Math.round(p.a - p.da), partenza: fmtHM(p.a) });
    }
  }
  righe.push({ tipo: 'rientro', luogo: `Rientro: ${sede.nome}`, arrivo: fmtHM(g.fine), durata: 0, partenza: '' });
  const avvisi: string[] = [];
  if (g.fine > hm(o.sogliaFine)) avvisi.push(`Fine giornata oltre le ${o.sogliaFine}`);
  return { ordine: ordine.map(i => tappe[i - 1].id), righe, avvisi,
    totali: { km: Math.round(g.km * 10) / 10, guida: Math.round(g.guida + g.margini), lavoro: g.lavoro, tappe: tappe.length, partenza: o.ora, fine: fmtHM(g.fine) } };
}

/** Avvisi che non richiedono calcolo (per il cruscotto). */
export function avvisiStatici(p: Percorso): string[] {
  const a: string[] = [];
  const senza = p.stops.filter(s => s.lat == null).length;
  if (senza) a.push(`${senza} tappe senza indirizzo valido`);
  if (p.partenza.lat == null) a.push('Sede senza indirizzo');
  if (p.stops.length && !p.risultato) a.push('Percorso non calcolato');
  return a;
}
export const avvisiTutti = (p: Percorso) => [...avvisiStatici(p), ...(p.risultato?.avvisi ?? [])];

export function calcola(m: Matrice, ordine: number[], tappe: Tappa[], sede: Luogo, o: Opzioni): Risultato {
  return risultatoDa(simula(ordine, m, parametri(o, tappe)), ordine, tappe, sede, o);
}

const SEL = 'id,data,tecnico_id,partenza,stops,opzioni,risultato,stato,updated_at';
export async function percorsiDel(da: string, a: string = da): Promise<Percorso[]> {
  const { data, error } = await supabase.from('percorsi').select(SEL).gte('data', da).lte('data', a).order('data');
  if (error) throw error; return data as Percorso[];
}
export async function percorso(id: number): Promise<Percorso> {
  const { data, error } = await supabase.from('percorsi').select(SEL).eq('id', id).single();
  if (error) throw error; return data as Percorso;
}
export async function salva(p: Percorso): Promise<number> {
  const riga = { data: p.data, tecnico_id: p.tecnico_id, partenza: p.partenza, stops: p.stops, opzioni: p.opzioni, risultato: p.risultato, stato: p.stato };
  if (p.id) { const { error } = await supabase.from('percorsi').update(riga).eq('id', p.id); if (error) throw error; return p.id; }
  const { data, error } = await supabase.from('percorsi').insert(riga).select('id').single();
  if (error) throw error; return (data as { id: number }).id;
}

export const isoGiorno = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const domani = () => { const d = new Date(); d.setDate(d.getDate() + 1); return isoGiorno(d); };
export const oggi = () => isoGiorno(new Date());

// ---------- allegati delle tappe (bucket privato percorsi-allegati) ----------
export const BUCKET_ALLEGATI = 'percorsi-allegati';
export const MAX_ALLEGATO = 10 * 1024 * 1024;
export const TIPI_ALLEGATO = '.jpg,.jpeg,.png,.heic,.heif,.pdf,.docx,.xlsx';
const MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
export const allegatiAttivi = (t: Tappa) => (t.allegati ?? []).filter(a => !a.rimosso);

export async function caricaAllegato(data: string, tappa: string, f: File): Promise<Allegato> {
  const est = (f.name.split('.').pop() || '').toLowerCase();
  const tipo = MIME[est];
  if (!tipo) throw new Error(`Formato non ammesso: ${f.name}`);
  if (f.size > MAX_ALLEGATO) throw new Error(`File oltre 10 MB: ${f.name}`);
  const pulito = f.name.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-80);
  const path = `${data}/${tappa}/${Date.now().toString(36)}-${pulito}`;
  const { error } = await supabase.storage.from(BUCKET_ALLEGATI).upload(path, f, { contentType: tipo, upsert: false });
  if (error) throw error;
  return { path, nome: f.name, tipo, size: f.size, caricato_il: new Date().toISOString() };
}
export async function apriAllegato(a: Allegato) {
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from(BUCKET_ALLEGATI).createSignedUrl(a.path, 300);
  if (error || !data) { w?.close(); throw error ?? new Error('Allegato non disponibile'); }
  if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}
