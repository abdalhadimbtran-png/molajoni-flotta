import { describe, expect, it } from 'vitest';
import { nomeFile } from './Digest';

describe('nomeFile report direzione', () => {
  it('settimana in corso (ISO)', () => {
    expect(nomeFile('settimana', new Date(2026, 10, 17))).toBe('Report_Direzione_Settimana_2026-W47.pdf');
    expect(nomeFile('settimana', new Date(2026, 10, 22))).toBe('Report_Direzione_Settimana_2026-W47.pdf');
    expect(nomeFile('settimana', new Date(2027, 0, 1))).toBe('Report_Direzione_Settimana_2026-W53.pdf');
  });
  it('mese in corso', () => {
    expect(nomeFile('mese', new Date(2026, 10, 30))).toBe('Report_Direzione_Novembre_2026.pdf');
    expect(nomeFile('mese', new Date(2027, 0, 10))).toBe('Report_Direzione_Gennaio_2027.pdf');
  });
});
