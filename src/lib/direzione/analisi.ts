/** Calcoli puri dell'area Direzione (periodi, confronto, heatmap, trend, tempi). Test: analisi.test.ts */
import { dowR, oraR, type RecEvento, type RecPratica, type RecTrasf } from '../centralino/registro';

export type Periodo = 'oggi' | 'settimana' | 'mese' | 'personalizzato';
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const giornoDa = (s: string) => { const [y, m, g] = s.split('-').map(Number); return new Date(y, m - 1, g); };
export const piuGiorni = (s: string, n: number) => { const d = giornoDa(s); d.setDate(d.getDate() + n); return iso(d); };
export const giorniTra = (da: string, a: string) => Math.round((giornoDa(a).getTime() - giornoDa(da).getTime()) / 864e5) + 1;

/** Intervallo [da, a] del periodo (date locali, a = oggi). Settimana = da lunedì. */
export function intervallo(p: Periodo, oggi: Date, custom?: { da: string; a: string }): [string, string] {
  const o = iso(oggi);
  if (p === 'oggi') return [o, o];
  if (p === 'settimana') { const dw = (oggi.getDay() + 6) % 7; return [piuGiorni(o, -dw), o]; }
  if (p === 'mese') return [iso(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), o];
  const da = custom?.da || o, a = custom?.a || o;
  return da <= a ? [da, a] : [a, da];
}

/** Periodo precedente della stessa lunghezza, subito prima. */
export function precedente(da: string, a: string): [string, string] {
  const n = giorniTra(da, a);
  return [piuGiorni(da, -n), piuGiorni(da, -1)];
}

/** Variazione % rispetto al precedente; null se non confrontabile. Per percentuali: differenza in punti. */
export function variazione(att: number | null, prec: number | null, punti = false): { v: number; su: boolean } | null {
  if (att == null || prec == null) return null;
  if (punti) return { v: att - prec, su: att >= prec };
  if (prec === 0) return att === 0 ? { v: 0, su: true } : null;
  return { v: Math.round(((att - prec) / prec) * 100), su: att >= prec };
}

/** Matrice giorno della settimana (1–7) × ora (0–23) delle pratiche. */
export function heatmap(pr: { created_at: string }[]) {
  const m: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const p of pr) m[dowR(p.created_at) - 1][oraR(p.created_at)]++;
  const max = Math.max(0, ...m.flat());
  // ore con almeno un contatto, sempre comprese 8–18
  const ore = [...Array(24).keys()].filter(h => (h >= 8 && h <= 18) || m.some(r => r[h] > 0));
  return { m, max, ore };
}

/** Contatti per giorno (Roma) da `da` ad `a`, giorni senza contatti compresi. */
export function trend(pr: { created_at: string }[], da: string, a: string) {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });
  const c = new Map<string, number>();
  for (const p of pr) { const g = fmt.format(new Date(p.created_at)); c.set(g, (c.get(g) ?? 0) + 1); }
  const out: { g: string; n: number }[] = [];
  for (let g = da; g <= a; g = piuGiorni(g, 1)) out.push({ g, n: c.get(g) ?? 0 });
  return out;
}

/** Prima risposta: minuti medi dalla chiamata al primo passo fatto (evento «stato»). */
export function primaRisposta(pr: Pick<RecPratica, 'id' | 'created_at'>[], ev: Pick<RecEvento, 'pratica_id' | 'tipo' | 'at'>[]) {
  const primo = new Map<number, string>();
  for (const e of ev) if (e.tipo === 'stato') { const x = primo.get(e.pratica_id); if (!x || e.at < x) primo.set(e.pratica_id, e.at); }
  const l = pr.map(p => primo.has(p.id) ? (new Date(primo.get(p.id)!).getTime() - new Date(p.created_at).getTime()) / 60000 : null).filter((x): x is number => x != null && x >= 0);
  return { media: l.length ? Math.round(l.reduce((s, x) => s + x, 0) / l.length) : null, n: l.length };
}

/** % SLA per passo: dagli eventi «stato» con sla_stadio. */
export function slaPerPasso(ev: Pick<RecEvento, 'tipo' | 'dati'>[]) {
  const m: Record<string, { ok: number; n: number }> = {};
  for (const e of ev) {
    const s = e.tipo === 'stato' ? (e.dati?.sla_stadio as string | undefined) : undefined;
    if (!s || typeof e.dati?.sla_rispettato !== 'boolean') continue;
    const x = (m[s] ??= { ok: 0, n: 0 }); x.n++; if (e.dati.sla_rispettato) x.ok++;
  }
  return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, pct: Math.round((v.ok / v.n) * 100) }]));
}

/** Richiami dei commerciali per persona: totale, valutabili, in tempo, scaduti. */
export function perCommerciale(l: RecTrasf[], ora = new Date()) {
  const m: Record<string, { tot: number; val: number; inTempo: number; scaduti: number; pct: number | null }> = {};
  for (const t of l) {
    if (!t.solo_commerciale || !t.richiamo_scadenza) continue;
    const x = (m[t.destinatario_nome] ??= { tot: 0, val: 0, inTempo: 0, scaduti: 0, pct: null });
    x.tot++;
    const sc = new Date(t.richiamo_scadenza);
    if (t.richiamato_at) { x.val++; if (new Date(t.richiamato_at) <= sc) x.inTempo++; }
    else if (sc < ora) { x.val++; x.scaduti++; }
  }
  for (const x of Object.values(m)) x.pct = x.val ? Math.round((x.inTempo / x.val) * 100) : null;
  return m;
}

/** Somma degli importi. */
export const valore = (l: { importo_stimato: number | null }[]) => l.reduce((s, p) => s + Number(p.importo_stimato ?? 0), 0);
