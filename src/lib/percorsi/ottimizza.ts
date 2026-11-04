/**
 * Percorso giornaliero: ordine delle tappe e timeline della giornata.
 * Logica pura (nessuna rete): riceve la matrice dei tempi/distanze e restituisce la giornata.
 *
 * Indici: 0 = sede (partenza e rientro), 1..n = tappe.
 * Tempi in minuti dalla mezzanotte; matrice in secondi e metri (come OSRM).
 *
 * Regola pausa pranzo (se attiva, finestra 13:30–14:30):
 *  - prima di iniziare un tratto o un intervento, se la pausa non è ancora stata fatta:
 *    a) se l'ora corrente è ≥ inizio pausa → la pausa inizia adesso e dura 60 min;
 *    b) se l'attività successiva finirebbe dopo l'inizio pausa e l'ora corrente è ≥ inizio − 60 min
 *       → il tecnico attende fino all'inizio pausa e fa la pausa 13:30–14:30 (nulla dentro la finestra);
 *    c) altrimenti l'attività parte (un intervento lungo iniziato prima delle 12:30 può superare le 13:30:
 *       la pausa si fa appena il tecnico è libero).
 *  - durante la pausa non si guida e non si lavora.
 */

export interface Matrice { durate: number[][]; distanze: number[][] }
export interface FasciaTraffico { da: string; a: string; fattore: number }
export interface Parametri {
  partenza: number;              // minuti, es. 480 = 08:00
  durate: number[];              // durata intervento per indice (indice 0 ignorato)
  margine: number;               // minuti aggiunti a ogni tratto
  pausa: boolean;
  pausaDa: number;               // 810 = 13:30
  pausaMin: number;              // 60
  fasce: FasciaTraffico[];
  fattoreBase: number;           // fuori fascia
}

export type Passo =
  | { tipo: 'tratto'; da: number; a: number; inizio: number; fine: number; guida: number; margine: number; km: number; fattore: number }
  | { tipo: 'tappa'; i: number; arrivo: number; partenza: number; durata: number }
  | { tipo: 'pausa'; da: number; a: number; attesa: number };

export interface Giornata { passi: Passo[]; fine: number; km: number; guida: number; lavoro: number; margini: number; pausa: number }

export const DEFAULT_FASCE: FasciaTraffico[] = [
  { da: '07:30', a: '09:30', fattore: 1.35 },
  { da: '12:30', a: '14:00', fattore: 1.15 },
  { da: '17:00', a: '19:30', fattore: 1.35 },
];
export const DEFAULT_FATTORE_BASE = 1.1;

export const hm = (s: string): number => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const fmtHM = (min: number): string => {
  const x = Math.round(min); const h = Math.floor(x / 60), m = x % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

export function fattoreTraffico(ora: number, fasce: FasciaTraffico[], base: number): number {
  for (const f of fasce) if (ora >= hm(f.da) && ora < hm(f.a)) return f.fattore;
  return base;
}

/** Simula la giornata con l'ordine dato (solo tappe, senza la sede) con rientro in sede. */
export function simula(ordine: number[], m: Matrice, p: Parametri): Giornata {
  const passi: Passo[] = [];
  let t = p.partenza, pos = 0, pausaFatta = !p.pausa;
  let km = 0, guida = 0, lavoro = 0, margini = 0, pausa = 0;
  const forsePausa = (durataProssima: number) => {
    if (pausaFatta) return;
    if (t >= p.pausaDa) { passi.push({ tipo: 'pausa', da: t, a: t + p.pausaMin, attesa: 0 }); pausa += p.pausaMin; t += p.pausaMin; pausaFatta = true; return; }
    if (t + durataProssima > p.pausaDa && t >= p.pausaDa - 60) {
      const attesa = p.pausaDa - t;
      passi.push({ tipo: 'pausa', da: t, a: p.pausaDa + p.pausaMin, attesa });
      pausa += p.pausaMin + attesa; t = p.pausaDa + p.pausaMin; pausaFatta = true;
    }
  };
  const tratto = (a: number) => {
    const sec = m.durate[pos]?.[a];
    if (sec == null || !isFinite(sec)) throw new Error('tratto non raggiungibile');
    const stima = () => { const f = fattoreTraffico(t, p.fasce, p.fattoreBase); return { f, g: (sec / 60) * f }; };
    let { g } = stima();
    forsePausa(g + p.margine);
    const s = stima(); g = s.g;
    const d = (m.distanze[pos]?.[a] ?? 0) / 1000;
    passi.push({ tipo: 'tratto', da: pos, a, inizio: t, fine: t + g + p.margine, guida: g, margine: p.margine, km: d, fattore: s.f });
    t += g + p.margine; guida += g; margini += p.margine; km += d; pos = a;
  };
  for (const i of ordine) {
    tratto(i);
    const dur = p.durate[i] ?? 0;
    const arrivo = t;
    forsePausa(dur); // se la pausa cade all'arrivo, l'intervento inizia dopo la pausa
    passi.push({ tipo: 'tappa', i, arrivo, partenza: t + dur, durata: dur });
    t += dur; lavoro += dur;
  }
  tratto(0);
  return { passi, fine: t, km, guida, lavoro, margini, pausa };
}

function permutazioni<T>(a: T[]): T[][] {
  if (a.length <= 1) return [a.slice()];
  const out: T[][] = [];
  a.forEach((x, i) => { for (const r of permutazioni([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...r]); });
  return out;
}

/** Ordine migliore: tappa fissa (se c'è) in testa, poi minimizza l'ora di rientro (≤ 8 libere: ricerca esatta, altrimenti vicino più vicino + 2-opt). */
export function ottimizza(tappe: number[], fissa: number | null, m: Matrice, p: Parametri): number[] {
  const testa = fissa != null && tappe.includes(fissa) ? [fissa] : [];
  const libere = tappe.filter(x => x !== fissa || !testa.length);
  const costo = (o: number[]) => { try { const g = simula([...testa, ...o], m, p); return g.fine * 1000 + g.km; } catch { return Infinity; } };
  if (libere.length <= 8) {
    let best = libere, bc = Infinity;
    for (const o of permutazioni(libere)) { const c = costo(o); if (c < bc) { bc = c; best = o; } }
    return [...testa, ...best];
  }
  // vicino più vicino
  const resto = new Set(libere); const o: number[] = [];
  let pos = testa.length ? testa[0] : 0;
  while (resto.size) {
    let b = -1, bd = Infinity;
    for (const x of resto) { const d = m.durate[pos][x]; if (d < bd) { bd = d; b = x; } }
    o.push(b); resto.delete(b); pos = b;
  }
  // 2-opt
  let best = o, bc = costo(o), migliorato = true;
  while (migliorato) {
    migliorato = false;
    for (let i = 0; i < best.length - 1; i++) for (let k = i + 1; k < best.length; k++) {
      const c = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
      const cc = costo(c);
      if (cc < bc - 1e-6) { best = c; bc = cc; migliorato = true; }
    }
  }
  return [...testa, ...best];
}
