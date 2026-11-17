import { afterEach, describe, expect, it } from 'vitest';
import { costruisciEml, costruisciEmailHtml, costruisciEmailTesto, firmaRighe } from './emailHtml';
import { impostaFirmaOutlook, impostaOperatore, pulisciFirma } from './preferenze';
import { testoMailto } from './mailto';

const dec = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, '')), c => c.charCodeAt(0)));
const parti = (eml: string) => eml.split(/\r\n--B(?:--)?\r\n/);

afterEach(() => { impostaOperatore({}); impostaFirmaOutlook(false); });

describe('.eml dalla casella dell\'operatore', () => {
  it('nessun From, nessun info@, Reply-To = operatore', () => {
    impostaOperatore({ nome: 'Jennifer Marchetti', email: 'j.marchetti@molajoni.it' });
    const html = costruisciEmailHtml({ titolo: 'Conferma', corpoHtml: '<p>Ciao</p>' });
    const eml = costruisciEml({ a: 'cli@x.it', oggetto: 'O', html, testo: costruisciEmailTesto({ titolo: 'Conferma', corpoHtml: '<p>Ciao</p>' }) }, 'B');
    expect(eml).not.toMatch(/^From:/mi);
    expect(eml).not.toMatch(/info@/i);
    expect(eml).toContain('Reply-To: j.marchetti@molajoni.it\r\n');
    expect(eml.startsWith('X-Unsent: 1\r\n')).toBe(true);
    expect(eml).toContain('Content-Type: multipart/alternative; boundary="B"');
    const h = dec(parti(eml)[2].split('\r\n\r\n')[1]);
    expect(h).toContain('Jennifer Marchetti');
    expect(h).toContain('06 6941 4281');
    expect(h).not.toMatch(/info@/i);
  });
  it('info@ non diventa mai Reply-To; senza operatore nessun Reply-To', () => {
    impostaOperatore({ email: 'info@molajoni.it' });
    expect(costruisciEml({ a: 'a@x.it', oggetto: 'O', html: '', testo: '' }, 'B')).not.toContain('Reply-To');
    expect(costruisciEml({ a: 'a@x.it', oggetto: 'O', html: '', testo: '', replyTo: 'info@molajoni.it' }, 'B')).not.toContain('Reply-To');
  });
  it('accenti e € codificati: oggetto RFC 2047, corpo base64 a righe ≤ 76', () => {
    const eml = costruisciEml({ a: 'a@x.it', oggetto: 'Offerta – Caffè 1.200,00 €', html: `<p>${'Importo 1.200,00 € è perché '.repeat(40)}</p>`, testo: 'Città € àèìòù' }, 'B');
    const sogg = eml.match(/^Subject: (.*(?:\r\n .*)*)/m)![1];
    expect(sogg).toMatch(/^=\?UTF-8\?B\?/);
    const dSogg = sogg.split('\r\n ').map(w => dec(w.replace(/^=\?UTF-8\?B\?|\?=$/g, ''))).join('');
    expect(dSogg).toBe('Offerta – Caffè 1.200,00 €');
    for (const r of eml.split('\r\n')) expect(r.length).toBeLessThanOrEqual(78);
    expect(eml).not.toMatch(/[^\x00-\x7F]/);
    expect(dec(parti(eml)[1].split('\r\n\r\n')[1])).toBe('Città € àèìòù');
    expect(dec(parti(eml)[2].split('\r\n\r\n')[1])).toContain('1.200,00 € è perché');
  });
});

describe('firma', () => {
  it('nome operatore o «J. Marchetti»; vuota con firma automatica Outlook', () => {
    expect(firmaRighe('front_office')).toEqual(['J. Marchetti', 'Molajoni Antincendi s.r.l.', 'tel. 06 6941 4281']);
    impostaOperatore({ nome: 'Jennifer Marchetti' });
    expect(firmaRighe('front_office')[0]).toBe('Jennifer Marchetti');
    impostaFirmaOutlook(true);
    expect(firmaRighe('front_office')).toEqual([]);
    expect(testoMailto('Ciao')).toBe('Ciao\n\nDistinti saluti');
  });
  it('pulisciFirma toglie info@', () => {
    expect(pulisciFirma('Jennifer Marchetti\nFront Office\nTel. 06 6941 4281 · info@molajoni.it')).toBe('Jennifer Marchetti\nFront Office\nTel. 06 6941 4281');
  });
});
