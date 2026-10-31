/**
 * Formattazione di date, periodi e quantità per l'app del dipendente.
 * Le date sono SEMPRE stringhe AAAA-MM-GG (mai new Date('AAAA-MM-GG'), che sbaglia per il fuso).
 * Nessun calcolo di saldo qui: i conti li fa il server (dipendente_anteprima).
 */
import { oggiISO } from '../lib/format';

const utc = (d: string) => { const [y, m, g] = d.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, g, 12)); };
const iso = (x: Date) => x.toISOString().slice(0, 10);

export function addGiorni(d: string, n: number): string { const x = utc(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); }
/** Giorno della settimana ISO: 1 = lunedì … 7 = domenica. */
export const dowIso = (d: string) => ((utc(d).getUTCDay() + 6) % 7) + 1;
export const diffGiorni = (a: string, b: string) => Math.round((utc(b).getTime() - utc(a).getTime()) / 86400000);
export const fineMese = (d: string) => { const x = utc(d); return iso(new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth() + 1, 0, 12))); };

const fmt = (d: string, o: Intl.DateTimeFormatOptions) => utc(d).toLocaleDateString('it-IT', { ...o, timeZone: 'UTC' });
const stessoAnno = (d: string) => d.slice(0, 4) === oggiISO().slice(0, 4);

/** «martedì 13 ottobre» (con l'anno se non è quello in corso). */
export const giornoLungo = (d: string) => fmt(d, { weekday: 'long', day: 'numeric', month: 'long', ...(stessoAnno(d) ? {} : { year: 'numeric' }) });
/** «mar 13 ott» */
export const giornoBreve = (d: string) => fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
/** «13 ottobre» */
export const dataLunga = (d: string) => fmt(d, { day: 'numeric', month: 'long', ...(stessoAnno(d) ? {} : { year: 'numeric' }) });
export const nomeMese = (d: string) => fmt(d, { month: 'long' });
export const nomeGiorno = (d: string) => fmt(d, { weekday: 'long' });
/** «20 ottobre, 09:12» da un timestamp */
export const momento = (ts: string) => new Date(ts).toLocaleString('it-IT', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
export const dataDaTs = (ts: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

/** Numero all'italiana con al massimo 2 decimali: 12,5 · 2,17 · −0,5 */
export function num(n: number): string {
  const s = Math.abs(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
  return (n < 0 ? '−' : '') + s;
}

export type Unita = 'giorni' | 'ore';

function oreMinuti(q: number): string {
  const tot = Math.round(Math.abs(q) * 60); const h = Math.floor(tot / 60); const m = tot % 60;
  const parti = [h ? `${h} ${h === 1 ? 'ora' : 'ore'}` : '', m ? `${m} minuti` : ''].filter(Boolean);
  return (q < 0 ? '−' : '') + (parti.join(' e ') || '0 ore');
}

/** Quantità di una richiesta: «mezza giornata», «1 giorno», «2,5 giorni», «2 ore e 30 minuti», «45 minuti». */
export function fmtQuantita(q: number, unita: Unita): string {
  if (unita === 'ore') return oreMinuti(q);
  if (q === 0.5) return 'mezza giornata';
  return `${num(q)} ${Math.abs(q) === 1 ? 'giorno' : 'giorni'}`;
}

/** Saldo: «12,5 giorni», «−0,5 giorni», «16 ore», «63,5 ore». */
export const fmtSaldo = (q: number, unita: Unita) => `${num(q)} ${unita === 'ore' ? (Math.abs(q) === 1 ? 'ora' : 'ore') : (Math.abs(q) === 1 ? 'giorno' : 'giorni')}`;

/** «da lunedì 7 a martedì 8 dicembre» oppure «martedì 13 ottobre». */
export function intervallo(primo: string, ultimo: string, breve = false): string {
  const g = breve ? giornoBreve : giornoLungo;
  if (primo === ultimo) return g(primo);
  if (breve) return `${giornoBreve(primo)} – ${giornoBreve(ultimo)}`;
  const stessoMese = primo.slice(0, 7) === ultimo.slice(0, 7);
  const inizio = stessoMese ? `${nomeGiorno(primo)} ${Number(primo.slice(8, 10))}` : giornoLungo(primo);
  return `da ${inizio} a ${giornoLungo(ultimo)}`;
}

export interface PeriodoRichiesta {
  primo_giorno: string; ultimo_giorno: string; rientro?: string | null;
  ora_inizio?: string | null; ora_fine?: string | null; mezza_giornata?: boolean;
  meta?: 'mattina' | 'pomeriggio' | null;
}

/** Periodo per elenchi e notifiche. Lungo: «da lunedì 7 a martedì 8 dicembre · rientri mercoledì 9 dicembre». */
export function fmtPeriodo(r: PeriodoRichiesta, breve = false): string {
  const g = breve ? giornoBreve : giornoLungo;
  if (r.ora_inizio) return `${g(r.primo_giorno)} · ${r.ora_inizio}–${r.ora_fine}`;
  if (r.mezza_giornata) return `${g(r.primo_giorno)}, ${r.meta ? `la ${r.meta}` : 'mezza giornata'}`;
  const rientro = r.rientro ?? addGiorni(r.ultimo_giorno, 1);
  return `${intervallo(r.primo_giorno, r.ultimo_giorno, breve)} · ${breve ? 'rientro' : 'rientri'} ${g(rientro)}`;
}

/** Calendario del dipendente (giorni di riposo «0000011» = sabato e domenica + festività). */
export interface Calendario { riposo: string; festivita: { data: string; nome: string }[] }
export const festivitaDi = (c: Calendario, d: string) => c.festivita.find(f => f.data === d)?.nome ?? null;
export const eRiposo = (c: Calendario, d: string) => c.riposo.charAt(dowIso(d) - 1) === '1';
export const eLavorativo = (c: Calendario, d: string) => !eRiposo(c, d) && !festivitaDi(c, d);
/** Primo giorno lavorativo DOPO d (solo per proporre il rientro: il conteggio vero lo fa il server). */
export function prossimoLavorativo(c: Calendario, d: string): string {
  let x = addGiorni(d, 1);
  for (let i = 0; i < 30 && !eLavorativo(c, x); i++) x = addGiorni(x, 1);
  return x;
}
const NOMI_GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'];
/** «sabato e domenica» dai giorni di riposo. */
export function giorniRiposoTesto(riposo: string): string {
  const l = NOMI_GIORNI.filter((_, i) => riposo.charAt(i) === '1');
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}`;
}

/** Minuti tra due orari «HH:MM». */
export const minuti = (a: string, b: string) => { const [h1, m1] = a.split(':').map(Number); const [h2, m2] = b.split(':').map(Number); return h2 * 60 + m2 - (h1 * 60 + m1); };
export const piuOre = (a: string, ore: number) => { const [h, m] = a.split(':').map(Number); const t = Math.min(h * 60 + m + ore * 60, 23 * 60 + 45); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
