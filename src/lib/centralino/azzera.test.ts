import { describe, expect, it } from 'vitest';
import { confermaValida, finoA, nomeBackup, totale } from './azzera';
describe('azzera centralino', () => {
  it('conferma solo con AZZERA', () => { expect(confermaValida('AZZERA')).toBe(true); expect(confermaValida('azzera')).toBe(false); expect(confermaValida('')).toBe(false); });
  it('totale', () => expect(totale({ pratiche: 3, pratiche_eventi: 10, contatori_azzerati: true, allegati_path: [] })).toBe(13));
  it('data in ora di Roma', () => { expect(finoA('2026-11-09')).toBe('2026-11-08T23:00:00.000Z'); expect(finoA('2026-07-01')).toBe('2026-06-30T22:00:00.000Z'); expect(finoA('')).toBeNull(); });
  it('nome backup', () => expect(nomeBackup(new Date('2026-11-09T10:20:30Z'))).toBe('backup-centralino-2026-11-09-10-20-30.json'));
});
