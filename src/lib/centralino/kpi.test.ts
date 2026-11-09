import { describe, expect, it } from 'vitest';
import { calcolaKpi, calcolaTrasf, type PraticaKpi } from './kpi';
import { base, KPI, type Dataset, type RecPratica } from './registro';

const p = (id: number, tipo_contatto: string | undefined, stato_cliente: string | null, tipo = 'informazione'): PraticaKpi & RecPratica => ({
  id, numero: `CT-${id}`, cliente_nome: 'X', sla_scadenza: null, tipo, sottotipo: null, canale: 'telefono', esito: 'aperta', esito_offerta: null, importo_stimato: 100,
  sla_rispettato: null, stato_corrente: 'ricevuta', created_at: '2026-11-09T09:00:00Z', closed_at: null, stato_cliente, tipo_contatto,
});

describe('tipo di contatto', () => {
  const pr = [p(1, 'cliente', 'attivo', 'offerta_piccola'), p(2, undefined, null), p(3, 'fornitore', 'attivo', 'offerta_piccola'), p(4, 'collega', null)];
  it('KPI per chi chiama; stato cliente conta solo i clienti', () => {
    const k = calcolaKpi(pr, []);
    expect(k.perTipoContatto).toEqual({ cliente: 2, fornitore: 1, collega: 1 });
    expect(k.perStatoCliente).toEqual({ attivo: 1, nuovo: 1 });
    expect(k.funnelPerStato.attivo.richieste).toBe(1);
    expect(k.funnel.richieste).toBe(2);
  });
  it('trasferimenti: per chi chiama, stato solo clienti', () => {
    const t = calcolaTrasf([{ destinatario_nome: 'A', esito: 'risposto', richiamo_scadenza: null, richiamato_at: null, tipo_contatto: 'fornitore', stato_cliente: 'attivo' }, { destinatario_nome: 'A', esito: 'risposto', richiamo_scadenza: null, richiamato_at: null }]);
    expect(Object.keys(t.perTipoContatto).sort()).toEqual(['cliente', 'fornitore']);
    expect(Object.keys(t.perStatoCliente)).toEqual(['non indicato']);
  });
  it('registro: filtro chi e stato', () => {
    const d: Dataset = { pratiche: pr, aperte: [], trasf: [], eventi: [], info: [], chiuse: [] };
    const def = KPI.find(x => x.id === 'pratiche')!;
    expect(base(def, d, { chi: 'fornitore' }).length).toBe(1);
    expect(base(def, d, { chi: 'cliente' }).length).toBe(2);
    expect(base(def, d, { stato: 'attivo' }).length).toBe(1);
  });
});
