import { describe, expect, it } from 'vitest';
import { fattoreTraffico, ottimizza, simula, DEFAULT_FASCE, hm, type Matrice, type Parametri } from './ottimizza';

// 0 = sede, 1..4 tappe in linea: 0 - 1 - 2 - 3 - 4, 10 minuti tra vicini
const N = 5;
const lin: Matrice = {
  durate: Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => Math.abs(i - j) * 600)),
  distanze: Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => Math.abs(i - j) * 5000)),
};
const base = (x: Partial<Parametri> = {}): Parametri => ({
  partenza: hm('08:00'), durate: [0, 45, 45, 45, 45], margine: 10, pausa: true, pausaDa: hm('13:30'), pausaMin: 60,
  fasce: [], fattoreBase: 1, ...x,
});

describe('traffico', () => {
  it('fasce', () => {
    expect(fattoreTraffico(hm('08:00'), DEFAULT_FASCE, 1.1)).toBe(1.35);
    expect(fattoreTraffico(hm('13:00'), DEFAULT_FASCE, 1.1)).toBe(1.15);
    expect(fattoreTraffico(hm('11:00'), DEFAULT_FASCE, 1.1)).toBe(1.1);
    expect(fattoreTraffico(hm('18:00'), DEFAULT_FASCE, 1.1)).toBe(1.35);
  });
});

describe('ottimizza', () => {
  it('ordine lineare ottimo', () => {
    const o = ottimizza([3, 1, 4, 2], null, lin, base());
    expect(simula(o, lin, base()).guida).toBe(80); // minimo: 8 tratti da 10 min (andata e ritorno)
  });
  it('tappa obbligatoria resta prima', () => {
    const o = ottimizza([1, 2, 3, 4], 3, lin, base());
    expect(o[0]).toBe(3);
    expect(o).toHaveLength(4);
  });
  it('euristica per molte tappe', () => {
    const n = 11;
    const m: Matrice = {
      durate: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => Math.abs(i - j) * 300)),
      distanze: Array.from({ length: n }, () => Array(n).fill(0)),
    };
    const p = base({ durate: Array(n).fill(15), pausa: false });
    const o = ottimizza([5, 2, 9, 1, 7, 3, 10, 4, 8, 6], null, m, p);
    expect(new Set(o).size).toBe(10);
    const g = simula(o, m, p);
    expect(g.guida).toBe(100); // andata fino a 10 e ritorno: 20 × 5 min
  });
});

describe('timeline', () => {
  it('orari, margine e rientro', () => {
    const g = simula([1, 2], lin, base({ pausa: false }));
    // 08:00 +10+10 → 08:20 arrivo 1, 09:05 parte, +20 → 09:25, 10:10 parte, +30 rientro 10:40
    const t = g.passi.filter(p => p.tipo === 'tappa');
    expect(t[0]).toMatchObject({ arrivo: hm('08:20'), partenza: hm('09:05') });
    expect(t[1]).toMatchObject({ arrivo: hm('09:25') });
    expect(g.fine).toBe(hm('10:40'));
    expect(g.km).toBe(20);
  });
  it('pausa: attesa fino alle 13:30 se il lavoro la attraverserebbe', () => {
    const g = simula([1], lin, base({ partenza: hm('12:40'), durate: [0, 60] }));
    // arrivo 13:00, lavoro 60 → supererebbe 13:30: attesa, pausa 13:00–14:30, lavoro 14:30–15:30
    const pausa = g.passi.find(p => p.tipo === 'pausa')!;
    expect(pausa).toMatchObject({ da: hm('13:00'), a: hm('14:30'), attesa: 30 });
    const tp = g.passi.find(p => p.tipo === 'tappa')!;
    expect(tp).toMatchObject({ partenza: hm('15:30') });
  });
  it('pausa al primo momento libero dopo le 13:30', () => {
    const g = simula([1, 2], lin, base({ partenza: hm('11:00'), durate: [0, 180, 30] }));
    // arrivo 11:20, lavoro fino a 14:20 (iniziato prima delle 12:30) → pausa 14:20–15:20
    const pausa = g.passi.find(p => p.tipo === 'pausa')!;
    expect(pausa).toMatchObject({ da: hm('14:20'), a: hm('15:20') });
  });
  it('nessuna pausa se disattivata', () => {
    const g = simula([1, 2, 3, 4], lin, base({ partenza: hm('12:00'), pausa: false }));
    expect(g.passi.some(p => p.tipo === 'pausa')).toBe(false);
  });
});
