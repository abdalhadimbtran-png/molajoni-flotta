import { describe, expect, it } from 'vitest';
import { aBlocchi, dividiEmail, dividiLocalita, dividiTelefoni, preparaRighe, riconosci } from './importa';

describe('import clienti Taylor', () => {
  it('riconosce le intestazioni reali (spazi, maiuscole, accenti) e ignora le altre', () => {
    const m = riconosci([' Codice ', 'Ragione sociale', 'LOCALITÀ', 'Telefono', 'Email', 'Colonna strana']);
    expect(m.cod_cliente).toBe(' Codice ');
    expect(m.nome).toBe('Ragione sociale');
    expect(m.localita).toBe('LOCALITÀ');
    expect(m.telefono).toBe('Telefono');
    expect(m.email).toBe('Email');
    expect(Object.values(m)).not.toContain('Colonna strana');
    expect(riconosci(['Cod. cli.', 'Cliente', 'Loc.', 'Tel', 'E-mail']).cod_cliente).toBe('Cod. cli.');
  });
  it('divide i telefoni: fisso, cellulare, altri', () => {
    expect(dividiTelefoni('06 1234567 / 333 1234567; 06 7654321')).toEqual({ telefono: '061234567', cellulare: '3331234567', altri: ['067654321'] });
    expect(dividiTelefoni('+39 347 1112223')).toEqual({ telefono: null, cellulare: '+393471112223', altri: [] });
    expect(dividiTelefoni('06-1234567')).toEqual({ telefono: '061234567', cellulare: null, altri: [] });
    expect(dividiTelefoni('')).toEqual({ telefono: null, cellulare: null, altri: [] });
  });
  it('divide le email e riconosce la PEC', () => {
    expect(dividiEmail('info@ditta.it; amministrazione@pec.ditta.it, ufficio@ditta.it')).toEqual({ email: 'info@ditta.it', pec: 'amministrazione@pec.ditta.it', altri: ['ufficio@ditta.it'] });
    expect(dividiEmail('ditta@legalmail.it').pec).toBe('ditta@legalmail.it');
  });
  it('località con CAP e provincia', () => {
    expect(dividiLocalita('00186 ROMA (RM)')).toEqual({ cap: '00186', comune: 'Roma', prov: 'RM' });
    expect(dividiLocalita('00040 MONTE PORZIO CATONE RM')).toEqual({ cap: '00040', comune: 'Monte Porzio Catone', prov: 'RM' });
    expect(dividiLocalita('Frascati')).toEqual({ cap: null, comune: 'Frascati', prov: null });
  });
  it('prepara le righe: doppioni per codice, extra in rubrica', () => {
    const m = riconosci(['Codice', 'Ragione sociale', 'Località', 'Telefono', 'Email']);
    const r = preparaRighe([
      { Codice: 'C1', 'Ragione sociale': 'Alfa', 'Località': '00186 ROMA (RM)', Telefono: '06 1 234567 / 333 1234567 / 06 999999', Email: 'a@alfa.it; b@alfa.it' },
      { Codice: 'C1', 'Ragione sociale': 'Alfa Srl', 'Località': '00186 ROMA (RM)', Telefono: '', Email: '' },
      { Codice: 'C2', 'Ragione sociale': 'Beta', 'Località': '', Telefono: '', Email: 'beta@pec.it' },
    ], m);
    expect(r.righe).toHaveLength(2);
    expect(r.doppi).toBe(1);
    expect(r.righe[0]).toMatchObject({ cod_cliente: 'C1', nome: 'Alfa Srl', cap: '00186', comune: 'Roma', prov: 'RM' });
    expect(r.righe[1].pec).toBe('beta@pec.it');
    expect(r.extra.map(x => x.telefono ?? x.email)).toEqual(['06999999', 'b@alfa.it']);
  });
  it('10.000 righe in blocchi da 500, in fretta', () => {
    const m = riconosci(['Codice', 'Ragione sociale', 'Località', 'Telefono', 'Email']);
    const t0 = Date.now();
    const r = preparaRighe(Array.from({ length: 10000 }, (_, i) => ({ Codice: `C${i}`, 'Ragione sociale': `Cliente ${i}`, 'Località': '00100 ROMA (RM)', Telefono: '06 1234567 / 333 7654321', Email: `c${i}@x.it` })), m);
    expect(r.righe).toHaveLength(10000);
    expect(aBlocchi(r.righe)).toHaveLength(20);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});
