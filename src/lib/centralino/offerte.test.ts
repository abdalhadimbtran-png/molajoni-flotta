import { describe, expect, it } from 'vitest';
import { aggiornamentoObbligatorio, daAggiornareOggi, durataTesto, erroreAzione, giornoScadenzaCollega, kpiOfferte, perPersona, statoOfferta, type Offerta } from './offerte';
import { DIR, JEN, KPI_OFFERTE, STATI_OFFERTA } from './testiDirezione';

const ORA = new Date('2026-11-25T15:00:00Z'); // mercoledì 16:00 a Roma
const o = (x: Partial<Offerta>): Offerta => ({
  pratica_id: 1, gestione: 'collega', gestita_da: 'Luca', arrivata_il: '2026-11-25T08:00:00Z', scadenza: '2026-11-27T08:00:00Z', inviata_il: null,
  esito: 'da_inviare', esito_il: null, motivo: null, motivo_nota: null, motivo_ritardo: null, numero_offerta_adhoc: null, aggiornata_il: '2026-11-25T08:00:00Z', aggiornata_da: null, ...x,
});

describe('offerte', () => {
  it('scadenza colleghi: 2 giorni lavorativi, salta weekend e festivi', () => {
    expect(giornoScadenzaCollega('2026-11-25T09:00:00Z')).toBe('2026-11-27'); // mer → ven
    expect(giornoScadenzaCollega('2026-11-27T15:30:00Z')).toBe('2026-12-01'); // ven → mar
    expect(giornoScadenzaCollega('2026-11-28T08:00:00Z')).toBe('2026-12-01'); // sab → mar
    expect(giornoScadenzaCollega('2026-11-27T15:30:00Z', new Set(['2026-11-30']))).toBe('2026-12-02');
    expect(giornoScadenzaCollega('2026-12-23T09:00:00Z', new Set(['2026-12-25', '2026-12-26']))).toBe('2026-12-28'); // mer → gio, lun
  });
  it('stato e ritardo', () => {
    expect(statoOfferta(o({}), ORA)).toBe('da_inviare');
    expect(statoOfferta(o({ scadenza: '2026-11-25T09:00:00Z' }), ORA)).toBe('scaduta'); // collega: solo informativo
    expect(statoOfferta(o({ gestione: 'jennifer', scadenza: '2026-11-25T09:00:00Z' }), ORA)).toBe('in_ritardo');
    expect(statoOfferta(o({ esito: 'in_attesa', inviata_il: '2026-11-25T10:00:00Z' }), ORA)).toBe('in_attesa');
  });
  it('da aggiornare oggi solo se aperta e non toccata oggi', () => {
    expect(daAggiornareOggi(o({ aggiornata_il: '2026-11-24T16:00:00Z' }), ORA)).toBe(true);
    expect(daAggiornareOggi(o({ aggiornata_il: '2026-11-24T23:30:00Z' }), ORA)).toBe(false); // 00:30 a Roma del 25
    expect(daAggiornareOggi(o({ esito: 'accettata', aggiornata_il: '2026-11-20T10:00:00Z' }), ORA)).toBe(false);
  });
  it('aggiornamento giornaliero: spento per default', () => {
    expect(aggiornamentoObbligatorio({})).toBe(false); expect(aggiornamentoObbligatorio({ offerte_aggiornamento_obbligatorio: true })).toBe(true);
  });
  it('KPI e per persona', () => {
    const l = [
      o({ inviata_il: '2026-11-26T08:00:00Z', esito: 'accettata' }),
      o({ inviata_il: '2026-11-28T08:00:00Z', esito: 'non_accettata', motivo: 'Prezzo' }),
      o({ gestita_da: 'Jennifer', gestione: 'jennifer', scadenza: '2026-11-25T09:00:00Z' }),
      o({ esito: 'annullata', motivo: 'Altro' }),
    ];
    expect(kpiOfferte(l, ORA)).toEqual({ arrivate: 4, in_tempo: 1, in_ritardo: 1, da_inviare: 1, da_inviare_scadute: 1, inviate: 2, accettate: 1, non_accettate: 1, annullate: 1 });
    const p = perPersona(l);
    expect(p[0]).toMatchObject({ persona: 'Luca', arrivate: 3, in_tempo: 1, inviate: 2, accettate: 1 });
    expect(durataTesto(p[0].medio)).toBe('2 giorni');
    expect(durataTesto(45 * 60e3)).toBe('45 min');
    expect(durataTesto(3.5 * 3600e3)).toBe('3,5 ore');
  });
  it('motivi obbligatori', () => {
    const b = o({});
    expect(erroreAzione({ esito: 'non_accettata' }, b, ORA)).toBe('Scegli il motivo');
    expect(erroreAzione({ esito: 'annullata', motivo: 'Altro' }, b, ORA)).toMatch(/nota/);
    expect(erroreAzione({ esito: 'accettata' }, b, ORA)).toMatch(/inviata/);
    const jen = o({ gestione: 'jennifer', scadenza: '2026-11-25T09:00:00Z' });
    expect(erroreAzione({ inviata_il: '2026-11-25T14:00:00Z' }, jen, ORA)).toMatch(/ritardo/);
    expect(erroreAzione({ inviata_il: '2026-11-25T14:00:00Z', motivo_ritardo: 'ferie' }, jen, ORA)).toBeNull();
    expect(erroreAzione({ inviata_il: '2026-11-25T14:00:00Z' }, o({ scadenza: '2026-11-25T09:00:00Z' }), ORA)).toBeNull(); // collega: nessun motivo
    expect(erroreAzione({ inviata_il: '2026-11-26T14:00:00Z' }, b, ORA)).toMatch(/futuro/);
    expect(erroreAzione({ esito: 'annullata', motivo: 'Prezzo' }, jen, ORA)).toMatch(/ritardo/);
    expect(erroreAzione({ esito: 'annullata', motivo: 'Non più necessario' }, jen, ORA)).toBeNull();
    expect(erroreAzione({ esito: 'annullata', motivo: 'Prezzo' }, o({ scadenza: '2026-11-25T09:00:00Z' }), ORA)).toBeNull();
  });
  it('testi: niente inglese o parole vietate, ogni KPI ha la definizione', () => {
    const tutti = [...Object.values(KPI_OFFERTE), ...Object.values(DIR), ...Object.values(JEN), ...Object.values(STATI_OFFERTA)];
    for (const x of tutti) {
      expect(`${x.it} ${'def' in x ? x.def : ''}`).not.toMatch(/\b(KPI|SLA|tessera|stesso calcolo|dashboard|follow|lead|funnel|trend)\b/i);
      expect(x.ar.length).toBeGreaterThan(1);
    }
    for (const x of Object.values(KPI_OFFERTE)) expect(x.def.length).toBeGreaterThan(10);
  });
});
