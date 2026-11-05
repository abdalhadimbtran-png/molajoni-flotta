import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Evento, Flusso, Impostazioni, Pratica, Template } from '../lib/centralino/tipi';
import { ORARIO_DEFAULT } from '../lib/centralino/sla';

export interface Config { flussi: Flusso[]; impostazioni: Impostazioni; modelli: Template[]; festivi: Set<string> }

const IMP_DEFAULT: Impostazioni = {
  orario: ORARIO_DEFAULT, soglia_arancio: 0.25, cc_offerte_grandi: [], amministrazione: { nome: 'Simona Colagrossi', email: '' },
  fornitori: { nome: 'Roberta Felci', email: '' }, commerciali: [], responsabili_info: [], firma: 'Jennifer Marchetti\nFront Office · Molajoni Antincendi', sostituto: 'Simona Colagrossi',
  destinatari_trasferimento: [], trasferimento_sla: { tipo: 'ore', valore: 2 }, mesi_cliente_attivo: 12,
  commerciali_offerte_grandi: [], motivi_annullamento: ['Altro'], motivi_senza_email: ['Altro'], motivi_spostamento: ['Altro'],
};

/** Flussi, impostazioni, modelli email e festività (una volta per area). */
export async function caricaConfig(): Promise<Config> {
  const anno = new Date().getFullYear();
  const [f, i, m, fe] = await Promise.all([
    supabase.from('pratiche_flussi').select('*').order('ordine'),
    supabase.from('centralino_impostazioni').select('chiave,valore'),
    supabase.from('email_template').select('*').order('ordine').order('nome'),
    supabase.from('festivita').select('data').eq('attiva', true).gte('data', `${anno - 1}-01-01`).lte('data', `${anno + 1}-12-31`),
  ]);
  const e = f.error || i.error || m.error; if (e) throw e;
  const imp = { ...IMP_DEFAULT } as Record<string, unknown>;
  for (const r of (i.data ?? []) as { chiave: string; valore: unknown }[]) imp[r.chiave] = r.valore;
  return {
    flussi: (f.data ?? []) as Flusso[], impostazioni: imp as unknown as Impostazioni, modelli: (m.data ?? []) as Template[],
    festivi: new Set(((fe.data ?? []) as { data: string }[]).map(x => x.data)),
  };
}

let cache: Promise<Config> | null = null;
export const config = (nuova = false) => { if (nuova || !cache) cache = caricaConfig().catch(e => { cache = null; throw e; }); return cache; };
export function useConfig() {
  const [c, setC] = useState<Config | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let ok = true; config().then(x => ok && setC(x), e => ok && setErr(String(e?.message ?? e))); return () => { ok = false; }; }, []);
  return { config: c, errore: err };
}

export const CAMPI_PRATICA = '*';

export async function praticheAperte(): Promise<Pratica[]> {
  const { data, error } = await supabase.from('pratiche').select(CAMPI_PRATICA).eq('esito', 'aperta').order('sla_scadenza', { ascending: true, nullsFirst: false }).limit(1000);
  if (error) throw error; return (data ?? []) as Pratica[];
}
export async function praticheChiuseDal(da: string): Promise<Pratica[]> {
  const { data, error } = await supabase.from('pratiche').select(CAMPI_PRATICA).neq('esito', 'aperta').gte('closed_at', da).order('closed_at', { ascending: false }).limit(500);
  if (error) throw error; return (data ?? []) as Pratica[];
}
export async function pratica(id: number) {
  const [p, e, a] = await Promise.all([
    supabase.from('pratiche').select(CAMPI_PRATICA).eq('id', id).maybeSingle(),
    supabase.from('pratiche_eventi').select('*').eq('pratica_id', id).order('at').order('id'),
    supabase.from('pratiche_allegati').select('*').eq('pratica_id', id).order('created_at'),
  ]);
  const err = p.error || e.error || a.error; if (err) throw err;
  if (!p.data) throw new Error('Pratica non trovata');
  return { pratica: p.data as Pratica, eventi: (e.data ?? []) as Evento[], allegati: (a.data ?? []) as Allegato[] };
}
export interface Allegato { id: number; pratica_id: number; path: string; nome_file: string | null; mime: string | null; dimensione: number | null; created_at: string }

/** Ricerca globale: numero pratica, cliente, contatto, telefono, email. */
export async function cerca(q: string): Promise<Pratica[]> {
  const x = q.trim().replace(/[,()*%\\]/g, ' ').trim();
  if (x.length < 2) return [];
  const tel = x.replace(/[\s./-]/g, '');
  const or = [`numero.ilike.*${x}*`, `cliente_nome.ilike.*${x}*`, `contatto_nome.ilike.*${x}*`, `email.ilike.*${x}*`, `cliente_codice.ilike.*${x}*`];
  if (/^\+?\d{3,}$/.test(tel)) or.push(`telefono.ilike.*${tel.slice(-6)}*`); else or.push(`telefono.ilike.*${x}*`);
  const { data, error } = await supabase.from('pratiche').select(CAMPI_PRATICA).or(or.join(',')).order('created_at', { ascending: false }).limit(30);
  if (error) throw error; return (data ?? []) as Pratica[];
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  eml: 'message/rfc822', msg: 'application/vnd.ms-outlook',
};
export const ESTENSIONI = Object.keys(MIME).map(e => '.' + e).join(',');

export async function caricaAllegato(praticaId: number, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 10 MB).');
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const mime = MIME[ext];
  if (!mime) throw new Error('Formato non ammesso: PDF, JPG, PNG, DOCX, XLSX, EML o MSG.');
  const path = `${praticaId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('pratiche').upload(path, file, { contentType: mime, upsert: false });
  if (error) throw new Error('Caricamento non riuscito. Riprova.');
  const r = await supabase.rpc('centralino_allegato', { p_id: praticaId, p_path: path, p_nome: file.name.slice(0, 200), p_mime: mime, p_dimensione: file.size });
  if (r.error) throw r.error;
}
export async function apriAllegato(path: string) {
  const w = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('pratiche').createSignedUrl(path, 300);
  if (error || !data) { w?.close(); throw new Error('File non disponibile'); }
  if (w) w.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

/** Ricarica periodica (30 s) e al ritorno sulla scheda. */
export function useAggiornamento(fn: () => void, ms = 30000) {
  useEffect(() => {
    const k = window.setInterval(fn, ms);
    const v = () => { if (document.visibilityState === 'visible') fn(); };
    document.addEventListener('visibilitychange', v);
    return () => { window.clearInterval(k); document.removeEventListener('visibilitychange', v); };
  }, [fn, ms]);
}

/** Orologio per i conti alla rovescia (ogni 30 s). */
export function useAdesso(ms = 30000) {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const k = window.setInterval(() => setT(new Date()), ms); return () => window.clearInterval(k); }, [ms]);
  return t;
}

/** Appunti privati (solo l'autore): salvataggio automatico. chiave = 'bozza' | 'p:<id>'. */
export async function leggiAppunti(chiave: string): Promise<string> {
  const { data } = await supabase.from('appunti').select('testo').eq('chiave', chiave).maybeSingle();
  return (data as { testo: string } | null)?.testo ?? '';
}
export async function salvaAppunti(chiave: string, testo: string) {
  const { data: u } = await supabase.auth.getUser(); if (!u.user) return;
  await supabase.from('appunti').upsert({ autore: u.user.id, chiave, testo, aggiornato_il: new Date().toISOString() }, { onConflict: 'autore,chiave' });
}
