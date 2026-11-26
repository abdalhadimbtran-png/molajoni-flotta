import { describe, expect, it } from 'vitest';
import { cambiaTutte, puoEliminareInfo, statoTutte } from './eliminaInfo';

describe('elimina contatti informativi', () => {
  it('solo admin fuori da «vedi come»', () => {
    expect(puoEliminareInfo(true, false)).toBe(true);
    expect(puoEliminareInfo(true, true)).toBe(false);
    expect(puoEliminareInfo(false, false)).toBe(false);
    expect(puoEliminareInfo(undefined, false)).toBe(false);
  });
  it('casella Tutte', () => {
    expect(statoTutte([1, 2], new Set())).toBe('nessuna');
    expect(statoTutte([1, 2], new Set([1]))).toBe('alcune');
    expect(statoTutte([1, 2], new Set([1, 2]))).toBe('tutte');
    expect([...cambiaTutte([1, 2], new Set([1]))]).toEqual([1, 2]);
    expect(cambiaTutte([1, 2], new Set([1, 2])).size).toBe(0);
  });
});
