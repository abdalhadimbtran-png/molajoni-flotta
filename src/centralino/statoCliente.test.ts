import { describe, expect, it } from 'vitest';
import { chiaveCliente, statoPerCliente, type StatoSel } from './statoCliente';

const A = { codice: 'C001', nome: 'Rossi Srl', fonte: 'taylor' };
const B = { codice: 'C002', nome: 'Bianchi Spa', fonte: 'taylor' };
const vuoto: StatoSel = { stato: null, man: false, chiave: null };

describe('statoPerCliente', () => {
  it('cliente collegato → attivo', () => {
    expect(statoPerCliente(vuoto, A)).toEqual({ stato: 'attivo', man: false, chiave: chiaveCliente(A) });
  });
  it('scelta manuale resta finché il cliente non cambia', () => {
    const man: StatoSel = { stato: 'ex_cliente', man: true, chiave: chiaveCliente(A) };
    expect(statoPerCliente(man, A)).toBe(man);
    expect(statoPerCliente(man, B)).toEqual({ stato: 'attivo', man: false, chiave: chiaveCliente(B) });
  });
  it('scollegato → nuovo solo se non manuale', () => {
    expect(statoPerCliente({ stato: 'attivo', man: false, chiave: chiaveCliente(A) }, null)).toEqual({ stato: 'nuovo', man: false, chiave: null });
    expect(statoPerCliente({ stato: 'ex_cliente', man: true, chiave: chiaveCliente(A) }, null)).toEqual({ stato: 'ex_cliente', man: true, chiave: null });
  });
  it('bozza ripristinata: stato salvato mantenuto', () => {
    const bozza: StatoSel = { stato: 'ex_cliente', man: false, chiave: chiaveCliente(A) };
    expect(statoPerCliente(bozza, { ...A })).toBe(bozza);
  });
  it('cliente da pratiche senza codice', () => {
    expect(statoPerCliente(vuoto, { codice: null, nome: 'Verdi', fonte: 'pratiche' }).stato).toBe('attivo');
  });
});
