import { describe, expect, it } from 'vitest';
import { almenoUno, controllaPassword, mailtoInvito, normalizza, NESSUN_PANNELLO, pannelliAperti, pannelloDi } from './account';

describe('account e ruoli', () => {
  it('admin apre tutti i pannelli', () => {
    expect(pannelliAperti({ ...NESSUN_PANNELLO, admin: true })).toHaveLength(6);
  });
  it('centralino + hr: due pannelli', () => {
    expect(pannelliAperti({ ...NESSUN_PANNELLO, centralino: true, hr: true })).toEqual(['hr', 'centralino']);
  });
  it('normalizza: admin spegne il resto', () => {
    expect(normalizza({ ...NESSUN_PANNELLO, admin: true, hr: true })).toEqual({ ...NESSUN_PANNELLO, admin: true });
    expect(almenoUno(NESSUN_PANNELLO)).toBe(false);
  });
  it('pannello dal percorso', () => {
    expect(pannelloDi('/centralino/pratiche')).toBe('centralino');
    expect(pannelloDi('/direzione/centralino')).toBe('direzione');
    expect(pannelloDi('/piano')).toBe('flotta');
  });
  it('mailto con testo codificato e a capo CRLF', () => {
    const m = mailtoInvito('jennifer@molajoni.it', 'Benvenuta nel Portale Molajoni', 'Ciao\nlink: https://x/y?a=1&b=2');
    expect(m.startsWith('mailto:jennifer%40molajoni.it?subject=Benvenuta%20nel')).toBe(true);
    expect(m).toContain('%0D%0A');
    expect(m).toContain('a%3D1%26b%3D2');
  });
  it('password', () => {
    expect(controllaPassword('corta1', 'corta1')).not.toBeNull();
    expect(controllaPassword('lunghissima', 'lunghissima')).not.toBeNull();
    expect(controllaPassword('Molajoni1930', 'Molajoni1931')).toMatch(/coincidono/);
    expect(controllaPassword('Molajoni1930', 'Molajoni1930')).toBeNull();
  });
});
