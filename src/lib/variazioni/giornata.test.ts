import { describe, expect, it } from 'vitest';
import { anteprimaUrgenza, capDa, caricoResiduo, minutiViaggio, posizione, suggerisciRiassegnazione, suggerisciTecnici, type StimaTecnico, type TappaStima } from './giornata';

const tp = (key: string, arrivo: string, partenza: string, extra: Partial<TappaStima> = {}): TappaStima =>
  ({ key, luogo: key, arrivo, partenza, arrivo_stimato: arrivo, partenza_stimata: partenza, slittamento: 0, ...extra });
const stima = (id: number, tappe: TappaStima[], corrente: string | null, extra: Partial<StimaTecnico> = {}): StimaTecnico => ({
  tecnico_id: id, nome: `T${id}`, sigla: `TEC${id}`, assente: false, tappe, corrente, fine_stimata: tappe[tappe.length - 1]?.partenza_stimata ?? null, rientro_min: 0,
  ritardo_tot: 0, soglia: '18:00', finita: null, n_ritardi: 0, ritardi: [], urgenze: [], percorso_id: null, ...extra });

describe('anteprima urgenza', () => {
  const s = stima(1, [
    tp('a', '08:00', '10:00', { lat: 41.9, lon: 12.5 }),
    tp('b', '14:00', '17:00', { lat: 41.9, lon: 12.5, arrivo_stimato: '14:30', partenza_stimata: '17:30', slittamento: 30 }),
    tp('c', '17:30', '18:00', { arrivo_stimato: '18:00', partenza_stimata: '18:30', slittamento: 30 }),
  ], 'b', { fine_stimata: '18:30' });
  it('inserisce dopo la tappa corrente e fa slittare le successive', () => {
    const a = anteprimaUrgenza(s, { lat: 41.9, lon: 12.5, durata: 60 }, '15:00');
    expect(a.dopo_key).toBe('b');
    expect(a.arrivo).toBe('17:40'); // 17:30 + 10 min (stesso punto)
    expect(a.partenza).toBe('18:40');
    expect(a.ritardo_base).toBe(30);
    expect(a.spostamento).toBe(60); // 18:40 + 20 (senza coordinate) − 18:00
    expect(a.nuove[0]).toMatchObject({ key: 'c', arrivo: '19:00', partenza: '19:30' });
    expect(a.non_entrano).toEqual(['c']);
  });
  it('le tappe spostate non contano', () => {
    const a = anteprimaUrgenza(s, { lat: 41.9, lon: 12.5, durata: 60 }, '15:00', new Set(['c']));
    expect(a.nuove).toHaveLength(0);
    expect(a.fine_nuova).toBe('18:40');
  });
  it('se la tappa corrente è già finita parte da adesso', () => {
    const a = anteprimaUrgenza(s, { durata: 30 }, '18:00', new Set(), 'a');
    expect(a.arrivo).toBe('18:20');
  });
});

describe('suggerimenti', () => {
  const t1 = stima(1, [tp('a', '08:00', '12:00', { lat: 41.90, lon: 12.50 })], 'a');
  const t2 = stima(2, [tp('x', '08:00', '09:00', { lat: 41.80, lon: 12.40 })], 'x');
  const t3 = stima(3, [], null, { assente: true });
  it('zona CAP prima di tutto, assenti esclusi', () => {
    const l = suggerisciTecnici([t1, t2, t3], { cap: '00185', lat: 41.90, lon: 12.50 }, { '00185': 2 });
    expect(l.map(x => x.tecnico_id)).toEqual([2, 1]);
    expect(l[0].motivo).toContain('zona CAP 00185');
  });
  it('poi il più vicino', () => {
    const l = suggerisciTecnici([t1, t2], { lat: 41.80, lon: 12.40 }, {});
    expect(l[0].tecnico_id).toBe(2);
  });
  it('posizione e carico', () => {
    expect(posizione(t1)).toMatchObject({ lat: 41.9 });
    expect(caricoResiduo(t1)).toBe(240);
    expect(minutiViaggio(null, null)).toBe(20);
    expect(capDa({ indirizzo: 'Via Roma 1, 00185 Roma' })).toBe('00185');
  });
  it('riassegnazione: zona, poi vicino, poi meno carico', () => {
    const carichi = [
      { data: '2026-11-09', tecnico_id: 2, n: 4, minuti: 300, lat: 41.8, lon: 12.4 },
      { data: '2026-11-09', tecnico_id: 3, n: 1, minuti: 60, lat: null, lon: null },
    ];
    const c = { key: 'i:1', data: '2026-11-09', tecnico_id: 1, luogo: 'X', indirizzo: 'Via X, 00186 Roma', lat: 41.81, lon: 12.41 };
    expect(suggerisciRiassegnazione(c, carichi, { '00186': 3 }, {})?.tecnico_id).toBe(3);
    expect(suggerisciRiassegnazione(c, carichi, {}, {})?.motivo).toContain('più vicino');
    expect(suggerisciRiassegnazione({ ...c, lat: null, lon: null, indirizzo: null }, carichi, {}, {})?.tecnico_id).toBe(3);
  });
});
