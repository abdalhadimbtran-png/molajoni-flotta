import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { dataIt, giorniRiposo, numeroIt, validaTutto } from './anagrafiche';
import { creaModello } from './modelliExcel';
import { confermaPfValida, totalePf } from './azzeraPersonale';

describe('formati italiani', () => {
  it('date', () => {
    expect(dataIt('01/03/2020')).toBe('2020-03-01');
    expect(dataIt('1-3-25')).toBe('2025-03-01');
    expect(dataIt('2026-12-31')).toBe('2026-12-31');
    expect(dataIt('31/02/2026')).toBe('ERR');
    expect(dataIt('')).toBeNull();
    expect(dataIt(45658)).toBe('2025-01-01');
  });
  it('numeri', () => { expect(numeroIt('45.000')).toBe(45000); expect(numeroIt('1.234,5')).toBe(1234.5); expect(numeroIt('')).toBeNull(); expect(numeroIt('abc')).toBeNaN(); });
  it('giorni di riposo', () => {
    expect(giorniRiposo('Sab, Dom')).toBe('0000011'); expect(giorniRiposo('domenica')).toBe('0000001');
    expect(giorniRiposo('mer e ven')).toBe('0010100'); expect(giorniRiposo('')).toBe('0000011'); expect(giorniRiposo('xyz')).toBe('ERR');
  });
});

describe('validazione dipendenti', () => {
  const H = ['Codice *', 'Nome *', 'Cognome *', 'Categoria *', 'Email', 'Sigla zona', 'Data assunzione', 'Contratto', 'Attivo', 'Codice fiscale'];
  it('righe valide, errori, duplicati, email già usata', () => {
    const { righe } = validaTutto('dipendenti', [H,
      ['rossim', 'Mario', 'Rossi', 'Tecnico', 'M.Rossi@x.it', 'teca', '01/03/2020', 'Full-time', 'Sì', 'RSSMRA...'],
      ['ROSSIM', 'Doppio', 'X', 'Ufficio', '', '', '', '', '', ''],
      ['BIANCHI', '', 'Bianchi', 'Capo', 'nonvalida', '', '32/13/2020', 'boh', 'forse', ''],
      ['VERDI', 'Anna', 'Verdi', 'Magazzino', 'usata@x.it', '', '', '', 'No', ''],
    ], { 'usata@x.it': 'ALTRO' });
    expect(righe).toHaveLength(4);
    expect(righe[0].errori).toEqual([]);
    expect(righe[0].valori).toMatchObject({ codice: 'ROSSIM', categoria: 'TEC', email: 'm.rossi@x.it', sigla: 'TECA', data_assunzione: '2020-03-01', contratto: 'full-time', attivo: true, ore_giornaliere: 8, giorni_riposo: '0000011' });
    expect(righe[0].valori).not.toHaveProperty('codice_fiscale');
    expect(righe[1].errori.join()).toMatch(/ripetuto/);
    expect(righe[2].errori.length).toBeGreaterThanOrEqual(5);
    expect(righe[3].errori.join()).toMatch(/già usata da ALTRO/);
    expect(righe[3].valori.attivo).toBe(false);
  });
  it('senza colonna chiave', () => { expect(validaTutto('dipendenti', [['Nome'], ['x']]).mancaChiave).toBe(true); });
});

describe('validazione veicoli', () => {
  it('targa normalizzata, scelte, numeri', () => {
    const { righe } = validaTutto('veicoli', [['Targa *', 'Marca e modello *', 'Proprietà', 'Alimentazione', 'Km attuali', 'Scadenza revisione'],
      ['ab 123-cd', 'Fiat Ducato', 'Noleggio', 'Gasolio', '45.000', '30/04/2027'],
      ['AB123CD', 'Altro', 'Mia', 'Acqua', '-3', 'ieri']]);
    expect(righe[0].errori).toEqual([]);
    expect(righe[0].valori).toMatchObject({ targa: 'AB123CD', proprieta: 'noleggio', alimentazione: 'diesel', km_attuali: 45000, scad_revisione: '2027-04-30' });
    expect(righe[1].errori.length).toBe(5);
  });
});

describe('modelli Excel', () => {
  it('il modello generato si reimporta (intestazioni riconosciute)', async () => {
    for (const tipo of ['dipendenti', 'veicoli'] as const) {
      const wb = XLSX.read(new Uint8Array(await creaModello(ExcelJS, tipo)), { type: 'array' });
      expect(wb.SheetNames[1]).toBe('Istruzioni');
      const mat = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      expect(validaTutto(tipo, mat).mancaChiave).toBe(false);
    }
  });
});

describe('azzeramento personale/flotta', () => {
  it('conferma e totale', () => {
    expect(confermaPfValida(' CANCELLA ')).toBe(true); expect(confermaPfValida('cancella')).toBe(false);
    expect(totalePf({ dipendenti: 17, veicoli: 8, file: { attestati: ['a'] }, scollega_pratiche: 6 })).toBe(25);
  });
});
