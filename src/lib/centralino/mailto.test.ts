import { describe, expect, it } from 'vitest';
import { costruisciMailto, MAX_MAILTO, SALUTO_CLIENTE, testoMailto } from './mailto';

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
  it('testo lungo: corpo accorciato, firma tenuta, URL sotto il limite', () => {
    const t = testoMailto(`${'parola à '.repeat(300)}\n\n${SALUTO_CLIENTE}`);
    const m = costruisciMailto({ a: 'a@x.it', oggetto: 'O', testo: t });
    expect(m.troncato).toBe(true);
    expect(m.url.length).toBeLessThanOrEqual(MAX_MAILTO);
    expect(decodeURIComponent(m.url)).toContain('J. Marchetti');
    expect(decodeURIComponent(m.url)).toContain('parola');
  });
});

describe('testoMailto', () => {
  it('toglie titolo e firma «--», mette chiusura e firma di Jennifer', () => {
    const t = testoMailto(`CONFERMA APPUNTAMENTO\n\nPratica: 12\n\nGentile cliente,\nconfermiamo.\n\n${SALUTO_CLIENTE}\n\n--\nMolajoni Antincendi s.r.l.\nJ. Marchetti\ntel. 06`);
    expect(t).toBe(`Pratica: 12\n\nGentile cliente,\nconfermiamo.\n\n${SALUTO_CLIENTE}\nMolajoni Antincendi s.r.l.\nJ. Marchetti`);
  });
  it('senza «Grazie per la preferenza» chiude con Distinti saluti', () => {
    expect(testoMailto('Ciao,\nti giro la richiesta.').endsWith('Distinti saluti\nMolajoni Antincendi s.r.l.\nJ. Marchetti')).toBe(true);
  });
});
