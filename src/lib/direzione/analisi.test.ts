import { describe, expect, it } from 'vitest';
import { giorniTra, heatmap, intervallo, perCommerciale, precedente, primaRisposta, slaPerPasso, trend, valore, variazione } from './analisi';
import { kpi, valuta, type Dataset, type RecPratica, type RecTrasf } from '../centralino/registro';

const P = (x: Partial<RecPratica>): RecPratica => ({ id: 1, numero: 'CT-1', tipo: 'manutenzione', sottotipo: null, canale: 'telefono', esito: 'aperta', esito_offerta: null, stato_corrente: 'ricevuta',
  cliente_nome: 'Rossi', importo_stimato: null, sla_rispettato: null, sla_scadenza: null, created_at: '2026-11-09T09:00:00Z', closed_at: null, telefono: '+39 06 1', ...x });
const D = (x: Partial<Dataset>): Dataset => ({ pratiche: [], aperte: [], trasf: [], eventi: [], info: [], chiuse: [], ...x });

describe('periodi', () => {
  const lun = new Date(2026, 10, 11); // mercoledì 11/11/2026
  it('settimana da lunedì, mese dal primo', () => {
    expect(intervallo('settimana', lun)).toEqual(['2026-11-09', '2026-11-11']);
    expect(intervallo('mese', lun)).toEqual(['2026-11-01', '2026-11-11']);
    expect(intervallo('oggi', lun)).toEqual(['2026-11-11', '2026-11-11']);
    expect(intervallo('personalizzato', lun, { da: '2026-11-05', a: '2026-11-01' })).toEqual(['2026-11-01', '2026-11-05']);
  });
  it('precedente della stessa lunghezza', () => {
    expect(precedente('2026-11-09', '2026-11-11')).toEqual(['2026-11-06', '2026-11-08']);
    expect(precedente('2026-11-01', '2026-11-30')).toEqual(['2026-10-02', '2026-10-31']);
    expect(giorniTra('2026-10-25', '2026-10-26')).toBe(2); // cambio d'ora
  });
  it('variazione', () => {
    expect(variazione(15, 10)).toEqual({ v: 50, su: true });
    expect(variazione(5, 10)).toEqual({ v: -50, su: false });
    expect(variazione(3, 0)).toBeNull();
    expect(variazione(80, 90, true)).toEqual({ v: -10, su: false });
    expect(variazione(null, 3)).toBeNull();
  });
});

describe('volumi', () => {
  it('heatmap in ora di Roma (lunedì 10:xx)', () => {
    const h = heatmap([{ created_at: '2026-11-09T09:15:00Z' }, { created_at: '2026-11-09T09:40:00Z' }, { created_at: '2026-11-10T21:30:00Z' }]);
    expect(h.m[0][10]).toBe(2); expect(h.m[1][22]).toBe(1); expect(h.max).toBe(2);
    expect(h.ore).toContain(22); expect(h.ore).toContain(8);
  });
  it('trend con giorni vuoti', () => {
    expect(trend([{ created_at: '2026-11-08T23:30:00Z' }], '2026-11-08', '2026-11-10')).toEqual([{ g: '2026-11-08', n: 0 }, { g: '2026-11-09', n: 1 }, { g: '2026-11-10', n: 0 }]);
  });
});

describe('servizio e offerte', () => {
  it('prima risposta media', () => {
    const r = primaRisposta([P({ id: 1 }), P({ id: 2 }), P({ id: 3 })], [
      { pratica_id: 1, tipo: 'stato', at: '2026-11-09T09:10:00Z' }, { pratica_id: 1, tipo: 'stato', at: '2026-11-09T09:30:00Z' },
      { pratica_id: 2, tipo: 'stato', at: '2026-11-09T09:20:00Z' }, { pratica_id: 3, tipo: 'nota', at: '2026-11-09T09:01:00Z' }]);
    expect(r).toEqual({ media: 15, n: 2 });
  });
  it('SLA per passo', () => {
    const s = slaPerPasso([{ tipo: 'stato', dati: { sla_stadio: 'coordinatore', sla_rispettato: true } }, { tipo: 'stato', dati: { sla_stadio: 'coordinatore', sla_rispettato: false } },
      { tipo: 'stato', dati: { sla_stadio: 'cliente', sla_rispettato: true } }, { tipo: 'nota', dati: {} }]);
    expect(s.coordinatore).toEqual({ ok: 1, n: 2, pct: 50 }); expect(s.cliente.pct).toBe(100);
  });
  it('richiami per commerciale', () => {
    const ora = new Date('2026-11-09T15:00:00Z');
    const t = (x: Partial<RecTrasf>): RecTrasf => ({ id: 1, pratica_id: 1, destinatario_nome: 'L. Esposito', esito: '', richiamo_scadenza: '2026-11-09T12:00:00Z', richiamato_at: null, at: '2026-11-09T10:00:00Z', cliente_nome: 'x', solo_commerciale: true, ...x });
    const m = perCommerciale([t({ richiamato_at: '2026-11-09T11:00:00Z' }), t({}), t({ richiamo_scadenza: '2026-11-09T16:00:00Z' }), t({ solo_commerciale: false })], ora);
    expect(m['L. Esposito']).toEqual({ tot: 3, val: 2, inTempo: 1, scaduti: 1, pct: 50 });
    const d = D({ trasf: [t({ richiamato_at: '2026-11-09T11:00:00Z' }), t({})] });
    expect(valuta(kpi('comm_in_tempo')!, d, {}, ora).pct).toBe(50);
    expect(valuta(kpi('comm_scaduti')!, d, {}, ora).n).toBe(1);
  });
  it('valore offerte', () => { expect(valore([{ importo_stimato: 400 }, { importo_stimato: null }, { importo_stimato: 250.5 }])).toBe(650.5); });
});

describe('nuovi KPI del registro', () => {
  const ev = (id: number, stadio: string, ok: boolean, at = '2026-11-09T09:40:00Z') => ({ pratica_id: id, tipo: 'stato', a_stato: stadio, dati: { sla_stadio: stadio, sla_rispettato: ok }, at });
  it('cliente informato entro 1 ora e SLA per passo', () => {
    const d = D({ pratiche: [P({ id: 1 }), P({ id: 2, tipo: 'sopralluogo' }), P({ id: 3, tipo: 'offerta_piccola' })], eventi: [ev(1, 'cliente', true), ev(2, 'cliente', false), ev(1, 'coordinatore', true), ev(2, 'coordinatore', true)] });
    expect(valuta(kpi('cliente1h')!, d)).toMatchObject({ n: 1, den: 2, pct: 50 });
    expect(valuta(kpi('sla_passo')!, d, { passo: 'coordinatore' })).toMatchObject({ n: 2, den: 2, pct: 100 });
    expect(valuta(kpi('sla_passo')!, d).den).toBe(0);
  });
  it('urgenze in giornata', () => {
    const d = D({ pratiche: [P({ id: 1, urgenza: 'urgente' }), P({ id: 2, urgenza: 'urgente' }), P({ id: 3, urgenza: 'urgente', esito: 'annullata' }), P({ id: 4, urgenza: 'ordinario' })],
      eventi: [ev(1, 'cliente', true), ev(2, 'cliente', true, '2026-11-10T08:00:00Z')] });
    expect(valuta(kpi('urgenti_giornata')!, d)).toMatchObject({ n: 1, den: 2, pct: 50 });
  });
  it('qualità: email, annullate con motivo, contatti incompleti', () => {
    const d = D({ pratiche: [P({ id: 1 }), P({ id: 2, telefono: null }), P({ id: 3, esito: 'annullata' }), P({ id: 4, esito: 'annullata', cliente_nome: '' })],
      eventi: [{ pratica_id: 1, tipo: 'email_inviata', a_stato: null, dati: {}, at: '2026-11-09T09:05:00Z' }, { pratica_id: 3, tipo: 'chiusa', a_stato: null, dati: {}, at: '2026-11-09T09:05:00Z', testo: 'Doppione' }] });
    expect(valuta(kpi('qual_email')!, d)).toMatchObject({ n: 1, den: 2, pct: 50 });
    expect(valuta(kpi('annullate_motivo')!, d)).toMatchObject({ n: 1, den: 2 });
    expect(valuta(kpi('senza_contatti')!, d).n).toBe(2);
  });
  it('filtri ora e giorno della settimana (heatmap → elenco)', () => {
    const d = D({ pratiche: [P({ id: 1, created_at: '2026-11-09T09:15:00Z' }), P({ id: 2, created_at: '2026-11-10T09:15:00Z' })] });
    expect(valuta(kpi('pratiche')!, d, { dow: '1', ora: '10' }).n).toBe(1);
    expect(valuta(kpi('pratiche')!, d, { ora: '10' }).n).toBe(2);
  });
});
