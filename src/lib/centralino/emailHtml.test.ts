import { describe, expect, it } from 'vitest';
import { codificaIntestazione, costruisciEmailHtml, costruisciEml, LOGO_URL, nomeFileEml } from './emailHtml';
import { emailDaModello, residui, segnaposto } from './modelli';
import MODELLI from './modelli_email.json';

const dec = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\r\n/g, '')), c => c.charCodeAt(0)));

describe('email premium', () => {
  it('logo assoluto, linea rossa, dati a 2 colonne, firma; righe vuote saltate', () => {
    const h = costruisciEmailHtml({ titolo: 'Conferma appuntamento', dati: [['Numero pratica', 'CT-2026-000001'], ['Telefono', '—']], corpoHtml: '<p>Ciao</p>' });
    expect(h).toContain(`src="${LOGO_URL}"`);
    expect(LOGO_URL.startsWith('https://molajoni-flotta.vercel.app/')).toBe(true);
    expect(h).toContain('#E30613');
    expect(h).toContain('CT-2026-000001');
    expect(h).not.toContain('>Telefono<');
    expect(h).toContain('J. Marchetti');
    expect(h).toContain('06 6941 4281');
    expect(h).not.toMatch(/<style|class=/);
  });
  it('firma del TMQ', () => {
    expect(costruisciEmailHtml({ titolo: 'P', corpoHtml: '', firma: 'tmq', firmaDati: { nome: 'Danilo Di Bartolo' } })).toContain('Danilo Di Bartolo');
  });
});

describe('.eml', () => {
  const eml = costruisciEml({ a: 'a@x.it', cc: ['c@x.it'], oggetto: 'CONFERMA APPUNTAMENTO – Caffè – CT-1', html: '<p>è</p>', testo: 'riga 1\nriga è' }, 'B');
  it('X-Unsent, intestazioni, oggetto codificato RFC 2047', () => {
    expect(eml.startsWith('X-Unsent: 1\r\n')).toBe(true);
    expect(eml).toContain('To: a@x.it\r\n');
    expect(eml).toContain('Cc: c@x.it\r\n');
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(eml).toContain('MIME-Version: 1.0\r\n');
    const sogg = eml.split('\r\n').filter((r, i, a) => r.startsWith('Subject:') || (a[i - 1]?.startsWith('Subject:') && r.startsWith(' ')));
    expect(sogg.map(r => r.replace(/^Subject: |^ /, '')).map(w => dec(w.slice(10, -2))).join('')).toBe('CONFERMA APPUNTAMENTO – Caffè – CT-1');
  });
  it('multipart/alternative con testo e HTML, solo CRLF', () => {
    expect(eml).toContain('multipart/alternative; boundary="B"');
    expect(eml).toContain('Content-Type: text/plain; charset="utf-8"');
    expect(eml).toContain('Content-Type: text/html; charset="utf-8"');
    expect(eml).toContain('--B--');
    expect(eml.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const parti = eml.split('--B').slice(1, 3).map(p => dec(p.split('\r\n\r\n')[1].trim()));
    expect(parti[0]).toBe('riga 1\r\nriga è');
    expect(parti[1]).toBe('<p>è</p>');
  });
  it('ASCII non codificato; nome file pulito', () => {
    expect(codificaIntestazione('Ciao')).toBe('Ciao');
    expect(nomeFileEml('CT-2026-000001', 'PREVENTIVO – A/B: "x"')).toBe('CT-2026-000001 - PREVENTIVO – A B x.eml');
  });
});

describe('modelli rivisti: tutti i segnaposto compilati', () => {
  const p = { numero: 'CT-2026-000042', cliente_nome: 'Condominio Via Roma 10', contatto_nome: 'Sig. Rossi', appuntamento_data: null, appuntamento_fascia: null,
    commerciale_nome: 'Luca Esposito', tecnico_nome: 'Danilo Di Bartolo', urgenza: 'urgente', sottotipo: 'Guasto', descrizione: 'Centrale in avaria', indirizzo: 'Via Roma 10',
    cap: '00100', comune: 'Roma', telefono: '+39 333 1234567', email: 'r@x.it', tecnico_quando: 'oggi pomeriggio', importo_stimato: 800, stato_cliente: 'attivo',
    created_at: '2026-11-10T09:00:00Z', tecnico_telefono: '333 7654321' };
  const extra = { sede: 'Via Roma 10', canale: 'Telefono', richiesta: 'Preventivo', link: 'https://x', autore: 'Jennifer', ora_trasferimento: '10:00', richiesta_al_referente: 'richiama il cliente', scadenza: 'oggi entro le 15:30', argomento: 'Preventivo', referente: 'Simona Colagrossi' };
  for (const t of MODELLI as unknown as { codice: string; oggetto: string; corpo_html: string; titolo: string; dati: [string, string][]; firma_tipo: 'front_office' | 'tmq' }[]) {
    it(t.codice, () => {
      const v = { ...segnaposto(p, ''), ...extra };
      const e = emailDaModello(t, v);
      expect(residui(e.oggetto)).toEqual([]);
      expect(residui(e.html.replace(/#[0-9a-fA-F]{6}|https?:\/\/\S+/g, ''))).toEqual([]);
      expect(residui(e.testo)).toEqual([]);
      expect(e.oggetto).toMatch(/^(\[Centralino\] |[A-ZÀ-Ù ]+ – )/);
      if (!e.oggetto.startsWith('[Centralino]')) { expect(e.oggetto).toContain('CT-2026-000042'); expect(e.html).not.toMatch(/\bLei\b|\bla contatterà\b/); }
    });
  }
});
