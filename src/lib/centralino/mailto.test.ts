import { describe, expect, it } from 'vitest';
import { CORPO_BREVE, costruisciMailto, MAX_MAILTO } from './mailto';

describe('costruisciMailto', () => {
  it('codifica oggetto e testo con CRLF', () => {
    const m = costruisciMailto({ a: 'a@x.it', oggetto: 'Pratica #1 & co', testo: 'Riga 1\nRiga 2 è' });
    expect(m.troncato).toBe(false);
    expect(m.url).toBe(`mailto:a%40x.it?subject=${encodeURIComponent('Pratica #1 & co')}&body=Riga%201%0D%0ARiga%202%20%C3%A8`);
    expect(m.url).not.toContain('+');
  });
  it('più destinatari e CC separati da ;', () => {
    const m = costruisciMailto({ a: 'a@x.it, b@x.it', cc: ['c@x.it', ' d@x.it '], oggetto: 'O', testo: 'T' });
    expect(m.url.startsWith('mailto:a%40x.it;b%40x.it?cc=c%40x.it;d%40x.it&subject=O')).toBe(true);
  });
  it('senza CC non mette il parametro', () => {
    expect(costruisciMailto({ a: 'a@x.it', cc: '', oggetto: 'O', testo: 'T' }).url).not.toContain('cc=');
  });
  it('testo lungo: corpo breve e URL sotto il limite', () => {
    const m = costruisciMailto({ a: 'a@x.it', oggetto: 'O', testo: 'à'.repeat(1000) });
    expect(m.troncato).toBe(true);
    expect(m.url.length).toBeLessThanOrEqual(MAX_MAILTO);
    expect(m.url).toContain(encodeURIComponent(CORPO_BREVE));
    expect(m.testo).toBe('à'.repeat(1000));
  });
});
