import { describe, expect, it } from 'vitest';
import { compila, segnaposto } from './modelli';

const p = { numero: 'CT-2026-1', cliente_nome: 'Cond. Roma 1', contatto_nome: 'Rossi', appuntamento_data: null, appuntamento_fascia: null, commerciale_nome: null, tecnico_nome: 'Mario', tecnico_quando: 'entro 1 ora', urgenza: 'urgente', indirizzo: 'Via Roma 1', cap: '00100', comune: 'Roma', importo_stimato: 1500 };
describe('segnaposto procedura rev2', () => {
  it('compila tecnico, quando, urgenza, indirizzo, importo', () => {
    const v = segnaposto(p, 'Jennifer');
    expect(compila('La contatterà il nostro tecnico {tecnico} {quando}', v, false)).toBe('La contatterà il nostro tecnico Mario entro 1 ora');
    expect(v.urgenza).toBe('Urgente');
    expect(v.obiettivo).toBe('da fare oggi');
    expect(v.indirizzo).toBe('Via Roma 1, 00100 Roma');
    expect(v.importo).toMatch(/^1\.?500,00 €$/);
  });
  it('ordinario = entro 2 giorni lavorativi', () => {
    expect(segnaposto({ ...p, urgenza: 'ordinario' }, '').obiettivo).toBe('entro 2 giorni lavorativi');
  });
});
