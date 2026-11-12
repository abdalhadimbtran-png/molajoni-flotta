import { describe, expect, it } from 'vitest';
import MODELLI from './modelli_email.json';
import { controllaEmail, datiMancanti, destinatarioPerAzione, msgEmailMancante, RUOLO_MODELLO, ruoloModello, type ContestoDest } from './destinatari';
import { emailDaModello, segnaposto } from './modelli';

const CLIENTE = 'rossi@example.it';
const ALBERTO = { nome: 'Alberto Chiaradonna', email: 'ch.alberto@molajoni.it', disponibile: true };
const ANTONELLA = { nome: "Antonella D'Orazio", email: 'a.dorazio@molajoni.it', disponibile: true };
const REFERENTI = [
  { nome: 'Alberto Chiaradonna', email: 'ch.alberto@molajoni.it' }, { nome: "Antonella D'Orazio", email: 'a.dorazio@molajoni.it' },
  { nome: 'Luca Esposito', email: 'l.esposito@molajoni.it' }, { nome: 'Simona Colagrossi', email: 's.colagrossi@molajoni.it' },
  { nome: 'Roberta Felci', email: 'roberta.felci@molajoni.it' }, { nome: 'A. Querini', email: '' },
  { nome: 'Vecchio Referente', email: 'vecchio@molajoni.it', attivo: false },
];
const INTERNE = REFERENTI.map(r => r.email);
const pratica = { email: CLIENTE, contatto_nome: 'Sig. Rossi', cliente_nome: 'Condominio Via Roma 10', commerciale_nome: 'Luca Esposito', commerciale_email: 'l.esposito@molajoni.it', assegnato_nome: 'Simona Colagrossi', coordinatore_nome: null };
const ctx = (x: Partial<ContestoDest> = {}): ContestoDest => ({ pratica, coordinatori: [ALBERTO, ANTONELLA], referenti: REFERENTI, commerciali: REFERENTI, ...x });

/** Matrice completa: modello → ruolo → indirizzo atteso */
const MATRICE: [string, string, string][] = [
  ['presa_intervento', 'cliente', CLIENTE], ['intervento_coordinatore', 'coordinatore', ALBERTO.email], ['intervento_cliente', 'cliente', CLIENTE],
  ['presa_sopralluogo', 'cliente', CLIENTE], ['sopralluogo_coordinatore', 'coordinatore', ALBERTO.email], ['sopralluogo_cliente', 'cliente', CLIENTE],
  ['presa_offerta_piccola', 'cliente', CLIENTE], ['invio_offerta', 'cliente', CLIENTE], ['presa_offerta_grande', 'cliente', CLIENTE],
  ['riepilogo_commerciale', 'commerciale', 'l.esposito@molajoni.it'], ['preventivo_tmq', 'cliente', CLIENTE],
  ['modifica_evasa', 'cliente', CLIENTE], ['conferma_anagrafica', 'cliente', CLIENTE], ['conferma_disdetta', 'cliente', CLIENTE],
  ['girata_referente', 'referente', 's.colagrossi@molajoni.it'], ['girata_ufficio', 'cliente', CLIENTE], ['girata_fornitore', 'cliente', CLIENTE],
];

describe('destinatarioPerAzione: matrice', () => {
  it('ogni modello attivo ha un ruolo esplicito', () => {
    for (const t of MODELLI as { codice: string }[]) expect(RUOLO_MODELLO[t.codice], t.codice).toBeTruthy();
  });
  it('i modelli interni hanno oggetto [Centralino] e viceversa', () => {
    for (const t of MODELLI as { codice: string; oggetto: string }[]) expect(/^\[Centralino\]/.test(t.oggetto), t.codice).toBe(ruoloModello(t.codice) !== 'cliente');
  });
  for (const [codice, ruolo, email] of MATRICE) {
    it(`${codice} → ${ruolo}`, () => {
      const d = destinatarioPerAzione(codice, ctx());
      expect(d.ruolo).toBe(ruolo);
      expect(d.email).toBe(email);
      if (ruolo !== 'cliente') expect(d.email).not.toBe(CLIENTE);
      else expect(INTERNE).not.toContain(d.email);
    });
  }
  it('trasferimento: referente dal trasferimento, cliente dal trasferimento', () => {
    const trasf = { cliente_email: 'bianchi@example.it', cliente_nome: 'Bianchi', destinatario_nome: 'Luca Esposito', referente_email: null };
    expect(destinatarioPerAzione('trasf_referente', ctx({ trasf })).email).toBe('l.esposito@molajoni.it');
    expect(destinatarioPerAzione('riepilogo_trasferita', ctx({ trasf })).email).toBe('bianchi@example.it');
    expect(destinatarioPerAzione('riepilogo_richiamo', ctx({ trasf, pratica: null })).email).toBe('bianchi@example.it');
  });
  it('coordinatore: fallback Alberto → Antonella se Alberto non disponibile o senza email', () => {
    expect(destinatarioPerAzione('intervento_coordinatore', ctx({ coordinatori: [{ ...ALBERTO, disponibile: false }, ANTONELLA] })).email).toBe(ANTONELLA.email);
    expect(destinatarioPerAzione('intervento_coordinatore', ctx({ coordinatori: [{ ...ALBERTO, email: null }, ANTONELLA] })).email).toBe(ANTONELLA.email);
    expect(destinatarioPerAzione('sopralluogo_coordinatore', ctx({ coordinatori: [{ ...ALBERTO, attivo: false }, ANTONELLA] })).email).toBe(ANTONELLA.email);
  });
  it('coordinatore scelto nel passo / già salvato sulla pratica vince', () => {
    expect(destinatarioPerAzione('intervento_coordinatore', ctx({ coordinatoreScelto: ANTONELLA })).nome).toBe("Antonella D'Orazio");
    expect(destinatarioPerAzione('intervento_coordinatore', ctx({ pratica: { ...pratica, coordinatore_nome: "Antonella D'Orazio" } })).email).toBe(ANTONELLA.email);
  });
  it('referente inattivo mai usato', () => {
    const d = destinatarioPerAzione('girata_referente', ctx({ pratica: { ...pratica, assegnato_nome: 'Vecchio Referente' } }));
    expect(d.email).toBeNull();
    expect(d.errore).toContain('Vecchio Referente (referente)');
  });
  it('email mancante: messaggio chiaro con nome e ruolo, mai «del cliente» per un collega', () => {
    const d = destinatarioPerAzione('girata_referente', ctx({ pratica: { ...pratica, assegnato_nome: 'A. Querini' } }));
    expect(d.errore).toBe("Manca l'email di A. Querini (referente): aggiungila in Referenti oppure usa «Avvisato per telefono».");
    const c = destinatarioPerAzione('intervento_coordinatore', ctx({ coordinatori: [{ ...ALBERTO, email: null }] }));
    expect(c.errore).toContain('Alberto Chiaradonna (coordinatore)');
    expect(c.errore).not.toContain('cliente');
    expect(destinatarioPerAzione('presa_intervento', ctx({ pratica: { ...pratica, email: null } })).errore).toContain('Sig. Rossi (cliente)');
    expect(msgEmailMancante('commerciale', null)).toContain('del Tecnico Commerciale');
  });
  it('commerciale senza email in pratica: da elenco commerciali', () => {
    expect(destinatarioPerAzione('riepilogo_commerciale', ctx({ pratica: { ...pratica, commerciale_email: null } })).email).toBe('l.esposito@molajoni.it');
  });
  it('modello sconosciuto: interno se oggetto [Centralino]', () => {
    expect(ruoloModello('nuovo', '[Centralino] X')).toBe('referente');
    expect(ruoloModello('nuovo', 'CIAO')).toBe('cliente');
  });
});

const base = { numero: 'CT-2026-000042', clienteEmail: CLIENTE, emailInterne: INTERNE };
describe('controllaEmail', () => {
  it('email interna al cliente: bloccata (A e CC)', () => {
    expect(controllaEmail({ ...base, codice: 'intervento_coordinatore', oggetto: '[Centralino] Intervento – CT-2026-000042', testo: 'x', a: CLIENTE })).toMatch(/interna/);
    expect(controllaEmail({ ...base, codice: 'riepilogo_commerciale', oggetto: '[Centralino] P – CT-2026-000042', testo: 'x', a: 'l.esposito@molajoni.it', cc: [CLIENTE] })).toMatch(/interna/);
  });
  it('email al cliente a un collega: bloccata', () => {
    expect(controllaEmail({ ...base, codice: 'sopralluogo_cliente', oggetto: 'CONFERMA – CT-2026-000042', testo: 'x', a: 'a.dorazio@molajoni.it' })).toMatch(/collega/);
  });
  it('oggetto senza numero pratica: bloccato', () => {
    expect(controllaEmail({ ...base, codice: 'invio_offerta', oggetto: 'PREVENTIVO', testo: 'x', a: CLIENTE })).toMatch(/numero pratica/);
  });
  it('segnaposto vuoti / dati essenziali mancanti: bloccati', () => {
    expect(controllaEmail({ ...base, codice: 'invio_offerta', oggetto: 'P CT-2026-000042', testo: 'Ciao {tecnico}', a: CLIENTE })).toMatch(/\{tecnico\}/);
    expect(controllaEmail({ ...base, codice: 'sopralluogo_cliente', oggetto: 'P CT-2026-000042', testo: 'ok', a: CLIENTE, dati: { tecnico_nome: 'Mario', tecnico_quando: '' } })).toMatch(/quando/);
    expect(datiMancanti('presa_offerta_grande', { commerciale_nome: null })).toHaveLength(1);
  });
  it('email corretta: nessun errore; destinatario mancante: nome e ruolo', () => {
    expect(controllaEmail({ ...base, codice: 'presa_intervento', oggetto: 'X – CT-2026-000042', testo: 'ok', a: CLIENTE, cc: ['l.esposito@molajoni.it'] })).toBeNull();
    expect(controllaEmail({ ...base, codice: 'intervento_coordinatore', oggetto: '[Centralino] X – CT-2026-000042', testo: 'ok', a: '', nomeDest: 'Alberto Chiaradonna' })).toContain('Alberto Chiaradonna (coordinatore)');
  });
});

describe('modelli reali: oggetto con numero pratica e A giusto', () => {
  const p = { id: 42, numero: 'CT-2026-000042', cliente_nome: 'Condominio Via Roma 10', contatto_nome: 'Sig. Rossi', appuntamento_data: null, appuntamento_fascia: null,
    commerciale_nome: 'Luca Esposito', tecnico_nome: 'Danilo', tecnico_quando: 'oggi pomeriggio', email: CLIENTE, assegnato_nome: 'Simona Colagrossi', descrizione: 'Nota interna' } as const;
  for (const t of MODELLI as unknown as { codice: string; oggetto: string; corpo_html: string; titolo: string; dati: [string, string][] }[]) {
    it(t.codice, () => {
      const v = { ...segnaposto(p, ''), argomento: 'Preventivo', referente: 'Luca Esposito', scadenza: 'oggi', autore: 'J', sede: '-', canale: 'Telefono', richiesta: '-', ora_trasferimento: '10:00', richiesta_al_referente: '-' } as never;
      const e = emailDaModello(t, v);
      expect(e.oggetto, t.codice).toContain('CT-2026-000042');
      const trasf = { cliente_email: CLIENTE, cliente_nome: 'Sig. Rossi', destinatario_nome: 'Luca Esposito', referente_email: null };
      const d = destinatarioPerAzione(t.codice, ctx({ trasf: /trasf|riepilogo_(trasferita|richiamo)/.test(t.codice) ? trasf : null }), t.oggetto);
      expect(controllaEmail({ ...base, codice: t.codice, oggetto: e.oggetto, testo: e.testo, a: d.email ?? '', dati: { ...p }, nomeDest: d.nome }), t.codice).toBeNull();
    });
  }
});
