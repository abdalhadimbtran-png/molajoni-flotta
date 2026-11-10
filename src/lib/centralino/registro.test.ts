import { describe, expect, it } from 'vitest';
import { KPI, valuta, type Dataset } from './registro';
import { calcolaKpi, calcolaTrasf } from './kpi';

const ora = new Date('2026-11-05T15:00:00Z');
const P = (id: number, x: Partial<Dataset['pratiche'][0]>): Dataset['pratiche'][0] => ({ id, numero: `CT-2026-${id}`, tipo: 'manutenzione', sottotipo: null, canale: 'telefono', esito: 'aperta', esito_offerta: null,
  stato_corrente: 'ricevuta', cliente_nome: `Cliente ${id}`, stato_cliente: 'nuovo', importo_stimato: null, sla_rispettato: null, sla_scadenza: null, created_at: '2026-11-05T08:00:00Z', closed_at: null, ...x });
const T = (id: number, x: Partial<Dataset['trasf'][0]>): Dataset['trasf'][0] => ({ id, pratica_id: null, destinatario_nome: 'A. Querini', esito: 'risposto', modalita: 'trasferita', richiamo_scadenza: null, richiamato_at: null,
  at: '2026-11-05T09:00:00Z', cliente_nome: 'X', tipo_argomento: 'Offerta del Tecnico Commerciale', stato_cliente: 'attivo', ...x });
const pr = [
  P(1, { tipo: 'offerta_piccola', esito: 'chiusa_ok', esito_offerta: 'accettata', stato_corrente: 'contratto', sla_rispettato: true, closed_at: '2026-11-05T10:00:00Z' }),
  P(2, { tipo: 'offerta_piccola', stato_corrente: 'offerta', canale: 'tablet_tmq' }),
  P(3, { sottotipo: 'Allarme sonoro attivo', esito: 'chiusa_ok', sla_rispettato: false, closed_at: '2026-11-05T12:00:00Z' }),
  P(4, { tipo: 'modifica', canale: 'email', stato_cliente: 'attivo' }),
  P(5, { tipo: 'offerta_grande', canale: 'whatsapp', stato_corrente: 'presa', sla_scadenza: '2026-11-05T09:30:00Z', stato_cliente: 'ex_cliente' }),
];
const D: Dataset = {
  pratiche: pr, aperte: pr.filter(p => p.esito === 'aperta'), chiuse: pr.filter(p => p.closed_at),
  eventi: [
    { pratica_id: 1, tipo: 'stato', a_stato: 'offerta', dati: { sla_stadio: 'offerta', sla_rispettato: true }, at: '2026-11-05T08:40:00Z' },
    { pratica_id: 2, tipo: 'stato', a_stato: 'offerta', dati: { sla_stadio: 'offerta', sla_rispettato: false }, at: '2026-11-05T09:30:00Z' },
  ],
  trasf: [
    T(1, {}), T(2, { esito: 'non_risposto', richiamo_scadenza: '2026-11-05T11:00:00Z', richiamato_at: '2026-11-05T10:00:00Z', email_referente_inviata_at: '2026-11-05T09:01:00Z' }),
    T(3, { destinatario_nome: 'L. Esposito', modalita: 'richiamo', esito: 'richiamera', richiamo_scadenza: '2026-11-05T11:00:00Z', email_cliente_inviata_at: '2026-11-05T09:02:00Z' }),
  ],
  info: [{ id: 1, canale: 'telefono', nota: 'orari', at: '2026-11-05T09:00:00Z' }],
  agg: [{ contatto_id: 7, at: '2026-11-05T09:00:00Z', campo: 'telefono', a: '+39061', autore_nome: 'J' }, { contatto_id: 7, at: '2026-11-05T10:00:00Z', campo: 'email', a: 'x@y.it', autore_nome: 'J' }],
};

describe('registro KPI: tessera = elenco di dettaglio', () => {
  it.each(KPI.map(k => [k.id, k]))('%s', (_id, k) => {
    for (const f of [{}, { stato: 'attivo' }, { dest: 'A. Querini' }, { canale: 'telefono' }]) {
      const v = valuta(k, D, f, ora);
      expect(v.righe.length).toBe(v.n);              // il numero mostrato è la lunghezza dell'elenco
      if (v.den != null) expect(v.n).toBeLessThanOrEqual(v.den);
    }
  });
  it('coincide con i calcoli KPI indipendenti', () => {
    const k = calcolaKpi(pr, D.eventi), t = calcolaTrasf(D.trasf, ora);
    const v = (id: string) => valuta(KPI.find(x => x.id === id)!, D, {}, ora);
    expect(v('sla').pct).toBe(k.slaPct);
    expect(v('offerte60').pct).toBe(k.offerte60Pct);
    expect(v('off_richieste').n).toBe(k.funnel.richieste);
    expect(v('off_inviate').n).toBe(k.funnel.inviate);
    expect(v('interventi1h').pct).toBe(k.interventi1hPct);
    expect(v('trasf_in_tempo').pct).toBe(t.richiamatiInTempoPct);
    expect(v('trasf_scadute').n).toBe(t.scaduti);
    expect(v('trasf_email_ref').pct).toBe(t.referentePct);
    expect(v('trasf_email_cli').pct).toBe(t.clientePct);
  });
  it('registro del giorno', () => {
    const v = (id: string) => valuta(KPI.find(x => x.id === id)!, D, {}, ora).n;
    expect(v('reg_telefonate')).toBe(2 + 1);   // 2 pratiche al telefono + 1 informativa
    expect(v('reg_tablet')).toBe(1);
    expect(v('reg_wa_offerte')).toBe(1);
    expect(v('reg_anagrafica')).toBe(1 + 1);   // 1 pratica «modifica» + 1 contatto modificato (2 campi, conta una volta)
    expect(v('in_ritardo')).toBe(1);
  });
});
