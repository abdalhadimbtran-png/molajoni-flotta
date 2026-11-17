import { describe, expect, it } from 'vitest';
import { contaEsitiInfo, erroreEsito } from './informazione';

describe('informazione: esiti', () => {
  it('a voce non richiede nulla', () => expect(erroreEsito('voce', { email: null })).toBeNull());
  it('via email richiede l\'email del cliente', () => {
    expect(erroreEsito('email', { email: null })).toMatch(/Manca l'email del cliente.*a voce/);
    expect(erroreEsito('email', { email: 'x@y.it' })).toBeNull();
  });
  it('girata richiede il responsabile, non l\'email del cliente', () => {
    expect(erroreEsito('girata', { email: null }, '')).toMatch(/responsabile/);
    expect(erroreEsito('girata', { email: null }, 'Luca Esposito')).toBeNull();
  });
  it('senza scelta', () => expect(erroreEsito(null, {})).toMatch(/Scegli/));
  it('conta per KPI', () => {
    const c = contaEsitiInfo([
      { tipo: 'stato', dati: { esito_info: 'voce' } }, { tipo: 'stato', dati: { esito_info: 'email' } },
      { tipo: 'stato', dati: { esito_info: 'girata', assegnato_nome: 'Luca Esposito' } }, { tipo: 'stato', dati: { esito_info: 'girata', assegnato_nome: 'Luca Esposito' } },
      { tipo: 'stato', dati: { esito_info: 'girata', assegnato_nome: 'Simona' } }, { tipo: 'nota', dati: { esito_info: 'voce' } }, { tipo: 'stato', dati: null },
    ]);
    expect(c).toEqual({ voce: 1, email: 1, girata: 3, perReferente: { 'Luca Esposito': 2, Simona: 1 } });
  });
});
