import { describe, expect, it } from 'vitest';
import { istante, mancaReg, normOra, nuovaReg, payloadReg, tastoReg, vuotoReg } from './registra';

const ADESSO = new Date('2026-11-25T15:00:00Z'); // 16:00 a Roma

describe('registra chiamata', () => {
  it('normalizza l\'ora', () => {
    expect(normOra('9:30')).toBe('09:30'); expect(normOra('930')).toBe('09:30'); expect(normOra('14.05')).toBe('14:05');
    expect(normOra('25:00')).toBeNull(); expect(normOra('abc')).toBeNull();
  });
  it('istante di oggi e ieri in ora di Roma', () => {
    expect(istante('oggi', '10:15', ADESSO)).toBe('2026-11-25T09:15:00.000Z');
    expect(istante('ieri', '10:15', ADESSO)).toBe('2026-11-24T09:15:00.000Z');
    expect(istante('oggi', '10:15', new Date('2026-07-10T12:00:00Z'))).toBe('2026-07-10T08:15:00.000Z');
  });
  it('validazione', () => {
    const s = vuotoReg('10:00');
    expect(mancaReg(s, ADESSO)).toEqual(['cliente o telefono', 'cosa voleva', 'esito']);
    const ok = { ...s, nome: 'Rossi', cosa: 'orari', esito: 'gestita' as const };
    expect(mancaReg(ok, ADESSO)).toEqual([]);
    expect(mancaReg({ ...ok, esito: 'passata' }, ADESSO)).toEqual(['a chi è stata passata']);
    expect(mancaReg({ ...ok, ora: '17:30' }, ADESSO)).toEqual(['ora non nel futuro']);
    expect(mancaReg({ ...ok, giorno: 'ieri', ora: '17:30' }, ADESSO)).toEqual([]);
  });
  it('payload e nuova', () => {
    const s = { ...vuotoReg('10:00', 'oggi', 'whatsapp'), cliente: { codice: 'C1', nome: 'ACME' }, cosa: ' x ', esito: 'passata' as const, passata: 'Mario' };
    expect(payloadReg(s, ADESSO)).toMatchObject({ canale: 'whatsapp', cliente_codice: 'C1', cliente_nome: 'ACME', passata_a: 'Mario', descrizione: 'x', tipo: 'informazione' });
    expect(payloadReg({ ...s, esito: 'gestita' }, ADESSO).passata_a).toBeNull();
    const n = nuovaReg({ ...s, giorno: 'ieri' }, '16:00');
    expect(n).toMatchObject({ giorno: 'ieri', canale: 'whatsapp', ora: '16:00', cosa: '', cliente: null, esito: null });
  });
  it('tasti', () => {
    expect(tastoReg('2')).toEqual({ canale: 'whatsapp' }); expect(tastoReg('G')).toEqual({ esito: 'gestita' });
    expect(tastoReg('p')).toEqual({ esito: 'passata' }); expect(tastoReg('5')).toBeNull();
  });
});
