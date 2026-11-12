import { describe, expect, it } from 'vitest';
import { emailDaModello, segnaposto, SEGNAPOSTO, templatePasso, richiedeAllegato } from './modelli';
import MODELLI from './modelli_email.json';

/** Copia dei modelli attivi (public.email_template, attivo = true) e dei flussi in cui sono usati (public.pratiche_flussi). */
type M = { codice: string; oggetto: string; corpo_html: string; titolo: string; dati: [string, string][]; firma_tipo: 'front_office' | 'tmq'; tipo_pratica: string | null };
const ATTIVI = MODELLI as unknown as M[];
const USO: Record<string, string[]> = {
  presa_intervento: ['manutenzione'], intervento_coordinatore: ['manutenzione'], intervento_cliente: ['manutenzione'],
  presa_sopralluogo: ['sopralluogo'], sopralluogo_coordinatore: ['sopralluogo'], sopralluogo_cliente: ['sopralluogo'],
  presa_offerta_piccola: ['offerta_piccola'], invio_offerta: ['offerta_piccola'], presa_offerta_grande: ['offerta_grande'], riepilogo_commerciale: ['offerta_grande'],
  preventivo_tmq: ['offerta_tablet'], modifica_evasa: ['modifica'], conferma_anagrafica: ['modifica'], conferma_disdetta: ['modifica'],
  girata_referente: ['amministrazione', 'fornitori', 'informazione'], girata_ufficio: ['amministrazione', 'informazione'], girata_fornitore: ['fornitori'],
};
// segnaposto aggiunti dal pannello dei trasferimenti (EmailTrasferimento / ModaleEmail)
const TRASF = { sede: 'Via Roma 10, 00100 Roma', canale: 'Telefono', richiesta: 'Preventivo estintori', link: 'https://molajoni-flotta.vercel.app/centralino/pratica/42', autore: 'Jennifer Marchetti',
  ora_trasferimento: '10:15', richiesta_al_referente: 'ti ho passato questa richiesta: <b>richiama il cliente oggi entro le 12:15</b>.', scadenza: 'oggi entro le 12:15', argomento: 'Preventivo', referente: 'Luca Esposito' };

const pratica = (tipo: string) => ({
  id: 42, tipo, numero: 'CT-2026-000042', cliente_nome: tipo === 'fornitori' ? 'Ferramenta Bianchi srl' : 'Condominio Via Roma 10', contatto_nome: 'Sig. Rossi',
  tipo_contatto: tipo === 'fornitori' ? 'fornitore' : 'cliente', appuntamento_data: null, appuntamento_fascia: null, commerciale_nome: 'Luca Esposito', tecnico_nome: 'Danilo Di Bartolo',
  urgenza: 'urgente', sottotipo: tipo === 'manutenzione' ? 'Guasto' : null, descrizione: 'Centrale antincendio in avaria al piano terra', indirizzo: 'Via Roma 10', cap: '00100', comune: 'Roma',
  telefono: '+39 333 1234567', email: 'rossi@example.it', tecnico_quando: 'oggi pomeriggio', importo_stimato: 800, stato_cliente: 'attivo', created_at: '2026-11-10T09:00:00Z',
  tecnico_telefono: '333 7654321', assegnato_nome: tipo === 'fornitori' ? 'Roberta Felci' : tipo === 'amministrazione' ? 'Simona Colagrossi' : 'Antonella D\'Orazio',
});
const VIETATI = [/\{/, /undefined/, /\bnull\b/, /00:00/, /xxx/i];
const pulito = (s: string) => s.replace(/https?:\/\/[^\s"]+/g, '');
const controlla = (s: string) => VIETATI.filter(r => r.test(pulito(s))).map(String);

describe('modelli attivi: segnaposto compilati in ogni flusso', () => {
  it('20 modelli attivi, tutti coperti', () => {
    expect(ATTIVI.length).toBe(20);
    for (const t of ATTIVI) if (t.tipo_pratica !== 'trasferimento' && t.tipo_pratica !== 'trasferimento_referente') expect(USO[t.codice], t.codice).toBeTruthy();
  });
  for (const t of ATTIVI) {
    const trasf = t.tipo_pratica === 'trasferimento' || t.tipo_pratica === 'trasferimento_referente';
    for (const tipo of trasf ? ['trasferimento'] : USO[t.codice] ?? []) {
      it(`${t.codice} · ${tipo}`, () => {
        const usati = [...`${t.oggetto} ${t.titolo} ${t.corpo_html} ${JSON.stringify(t.dati)}`.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]);
        const noti = new Set<string>([...SEGNAPOSTO, ...(trasf ? Object.keys(TRASF) : [])]);
        expect(usati.filter(k => !noti.has(k))).toEqual([]);
        const v = { ...segnaposto(pratica(tipo), ''), ...(trasf ? TRASF : {}) };
        const e = emailDaModello(t, v);
        expect(controlla(e.oggetto)).toEqual([]);
        expect(controlla(e.html)).toEqual([]);
        expect(controlla(e.testo)).toEqual([]);
      });
    }
  }
});

describe('girata e firme', () => {
  it('girata_referente: email interna al referente con chi chiama, link e sintesi', () => {
    const t = ATTIVI.find(x => x.codice === 'girata_referente')!;
    const e = emailDaModello(t, segnaposto(pratica('fornitori'), ''));
    expect(e.oggetto).toBe('[Centralino] Richiesta da gestire – CT-2026-000042 – Ferramenta Bianchi srl – Fornitori');
    expect(e.testo).toContain('Ciao Roberta Felci,');
    expect(e.testo).toContain('Chi chiama: fornitore');
    expect(e.html).toContain('/centralino/pratica/42');
  });
  it('conferma della girata: variante neutra per i fornitori', () => {
    expect(templatePasso({ tipo: 'fornitori', tipo_contatto: 'fornitore' }, 'girata_ufficio')).toBe('girata_fornitore');
    expect(templatePasso({ tipo: 'amministrazione', tipo_contatto: 'fornitore' }, 'girata_ufficio')).toBe('girata_fornitore');
    expect(templatePasso({ tipo: 'amministrazione', tipo_contatto: 'cliente' }, 'girata_ufficio')).toBe('girata_ufficio');
    const t = ATTIVI.find(x => x.codice === 'girata_fornitore')!;
    expect(emailDaModello(t, segnaposto(pratica('fornitori'), '')).testo).not.toContain('Grazie per la preferenza');
  });
  it('email ai clienti: «Grazie per la preferenza e distinti saluti» + Molajoni Antincendi s.r.l. + J. Marchetti', () => {
    const clienti = ATTIVI.filter(t => !t.oggetto.startsWith('[Centralino]') && t.firma_tipo === 'front_office' && !['girata_fornitore', 'conferma_disdetta'].includes(t.codice));
    expect(clienti.length).toBeGreaterThan(10);
    for (const t of clienti) {
      const e = emailDaModello(t, { ...segnaposto(pratica(USO[t.codice]?.[0] ?? 'manutenzione'), ''), ...TRASF });
      expect(e.testo, t.codice).toMatch(/Grazie per la preferenza e distinti saluti\.\n\n--\nMolajoni Antincendi s\.r\.l\.\nJ\. Marchetti\n/);
    }
  });
  it('preventivo_tmq: firma del TMQ con il tecnico scelto', () => {
    const t = ATTIVI.find(x => x.codice === 'preventivo_tmq')!;
    expect(emailDaModello(t, segnaposto(pratica('offerta_tablet'), '')).testo).toContain('--\nIl TMQ – Tecnico Manutentore Qualificato dal Corpo Nazionale dei Vigili del Fuoco\nDanilo Di Bartolo\n');
  });
  it('promemoria allegato per i modelli «in allegato il preventivo»', () => {
    expect(ATTIVI.filter(richiedeAllegato).map(t => t.codice).sort()).toEqual(['invio_offerta', 'preventivo_tmq']);
  });
});
