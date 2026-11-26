import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REPORT_CHIAMATE } from './testiDirezione';
import { intervallo, oggettoReport, variazione, type Periodo } from '../../../supabase/functions/report-direzione/render';

const sql = readFileSync('supabase/migrations/20261126_0103_report_direzione_chiamate.sql', 'utf8');
const P = (tipo: 'settimana' | 'mese', dal: string, al: string): Periodo => ({ tipo, dal, al, chiave: '', etichetta: '', file: '' });

describe('Report Direzione – chiamate', () => {
  it('SQL usa le stesse parole di testiDirezione (etichette e definizioni)', () => {
    for (const k of ['ricevute', 'aperte', 'collega', 'chiuse', 'of_in_tempo', 'of_accettate'] as const) {
      expect(sql).toContain(`'${REPORT_CHIAMATE[k].it}'`);
      expect(sql).toContain(`'${REPORT_CHIAMATE[k].def!.replace(/'/g, "''")}'`);
    }
    expect(sql).toContain(`'${REPORT_CHIAMATE.completate.def}'`);
    expect(sql).toContain(`'${REPORT_CHIAMATE.blocco.it}'`);
    expect(sql).not.toMatch(/\b(drop|delete|insert|update)\b/i);
  });
  it('oggetto email', () => {
    expect(oggettoReport(P('settimana', '2026-11-23', '2026-11-27'))).toBe('Report settimanale · 23–27 nov 2026');
    expect(oggettoReport(P('mese', '2026-11-01', '2026-11-30'))).toBe('Report mensile · Novembre 2026');
    expect(intervallo(P('settimana', '2026-11-30', '2026-12-04'))).toBe('30 nov–4 dic 2026');
  });
  it('variazione: punti per le %, verso e giudizio', () => {
    expect(variazione({ label: 'x', valore: 74, precedente: 69, unita: '%' })).toEqual({ testo: '+5 pt', verso: 1, tono: 'buono' });
    expect(variazione({ label: 'x', valore: 2, precedente: 1, delta: 100, meglio: 'giu' })?.tono).toBe('cattivo');
    expect(variazione({ label: 'x', valore: 3, confronta: false })).toBeNull();
  });
});
