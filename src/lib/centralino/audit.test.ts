import { describe, expect, it, vi } from 'vitest';
import { tutteLeRighe } from '../../centralino/comune';
import { campiCambiati, conTecnicoScelto, RUOLI_ASSEGNA, TIPI_DISMESSI } from './tipi';
import { fetchConTimeout, testoErrore } from '../supabase';
import { costruisciEml } from './emailHtml';
import { costruisciMailto } from './mailto';

describe('tutteLeRighe (limite API 1000 righe)', () => {
  const tabella = Array.from({ length: 2350 }, (_, i) => i);
  const pagina = vi.fn((da: number, a: number) => Promise.resolve({ data: tabella.slice(da, Math.min(a, da + 999) + 1), error: null }));
  it('legge a blocchi fino alla fine', async () => {
    pagina.mockClear();
    expect(await tutteLeRighe(pagina, 5000)).toHaveLength(2350);
    expect(pagina.mock.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it('si ferma al massimo richiesto', async () => {
    pagina.mockClear();
    expect(await tutteLeRighe(pagina, 1500)).toHaveLength(1500);
    expect(pagina.mock.calls).toEqual([[0, 999], [1000, 1499]]);
  });
  it('propaga l\'errore', async () => {
    await expect(tutteLeRighe(() => Promise.resolve({ data: null, error: new Error('giù') }))).rejects.toThrow('giù');
  });
});

describe('Dati e assegnazione: solo i campi cambiati', () => {
  const prima = { cliente_nome: 'Rossi', telefono: '06 1', descrizione: '', nota: '' };
  it('niente cambi → oggetto vuoto (nessuna scrittura)', () => expect(campiCambiati(prima, { ...prima, nota: 'motivo' })).toEqual({}));
  it('manda solo il campo toccato + motivo', () =>
    expect(campiCambiati(prima, { ...prima, telefono: '06 2', nota: ' cambio ' })).toEqual({ telefono: '06 2', nota: 'cambio' }));
});

describe('scelte dismesse', () => {
  it('niente amministrazione/fornitori tra i ruoli proposti', () => expect(RUOLI_ASSEGNA.map(r => r.v)).not.toContain('amministrazione'));
  it('tipi dismessi', () => expect(TIPI_DISMESSI).toEqual(['amministrazione', 'fornitori']));
  it('tecnico scelto solo per sopralluogo / tablet TMQ', () => {
    expect(conTecnicoScelto('sopralluogo')).toBe(true);
    expect(conTecnicoScelto('manutenzione')).toBe(false);
  });
});

describe('fetch con limite di tempo', () => {
  it('interrompe una richiesta che non risponde', async () => {
    const lenta: typeof fetch = (_i, init) => new Promise((_, rej) => init?.signal?.addEventListener('abort', () => rej(init.signal!.reason)));
    await expect(fetchConTimeout(lenta, 20)('https://x.supabase.co/rest/v1/pratiche')).rejects.toMatchObject({ name: 'TimeoutError' });
  });
  it('non tocca i caricamenti nello storage', async () => {
    const base = vi.fn((_i: RequestInfo | URL, _init?: RequestInit) => Promise.resolve(new Response('ok')));
    await fetchConTimeout(base as unknown as typeof fetch, 20)('https://x.supabase.co/storage/v1/object/pratiche/1/a.pdf', { method: 'POST' });
    expect(base.mock.calls[0][1]?.signal).toBeUndefined();
  });
  it('messaggi leggibili per timeout e sessione scaduta', () => {
    expect(testoErrore({ name: 'TimeoutError', message: 'TimeoutError: Timeout' })).toMatch(/non risponde/);
    expect(testoErrore({ message: 'JWT expired', code: 'PGRST301' })).toMatch(/Sessione scaduta/);
  });
});

describe('nessuna iniezione di intestazioni', () => {
  it('.eml: a capo nell\'oggetto e nei destinatari non creano nuove intestazioni', () => {
    const eml = costruisciEml({ a: 'a@x.it\r\nBcc: spia@x.it', oggetto: 'Ciao\r\nBcc: spia@x.it', html: '<p>x</p>', testo: 'x' }, 'B');
    const intest = eml.split('\r\n\r\n')[0].split('\r\n');
    expect(intest.some(r => /^Bcc:/i.test(r))).toBe(false);
  });
  it('mailto: tutto codificato', () => {
    const m = costruisciMailto({ a: 'a@x.it', oggetto: 'x\r\nBcc: y@x.it', testo: 'riga\nriga' });
    expect(m.url).not.toMatch(/[\r\n]/);
    expect(m.url).toContain('subject=x%0D%0ABcc%3A%20y%40x.it');
  });
});
