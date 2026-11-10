import { describe, expect, it } from 'vitest';
import { conto, daRoma, fineGiornoRoma, inizioGiornoRoma, primoDelMeseRoma, giornoRoma, orologio, riapertura, scadenzaSla, secondiUfficio, semaforo, testoRegola, testoResiduo } from './sla';
import { compila, segnaposto } from './modelli';
import { calcolaKpi, calcolaTrasf } from './kpi';

// stesse prove di supabase/prove/centralino_prove.sql
const FEST = new Set(['2026-12-08', '2026-12-25', '2026-12-26', '2027-01-01']);
const R = (y: number, m: number, g: number, h: number, mi = 0) => daRoma(y, m, g, h, mi);

describe('scadenzaSla', () => {
  it('minuti oltre la chiusura del venerdì continuano lunedì', () => {
    expect(scadenzaSla(R(2026, 11, 6, 17), { tipo: 'minuti', valore: 60 }, FEST)).toEqual(R(2026, 11, 9, 9));
  });
  it('60 minuti in orario', () => {
    expect(scadenzaSla(R(2026, 11, 5, 10, 15), { tipo: 'minuti', valore: 60 }, FEST)).toEqual(R(2026, 11, 5, 11, 15));
  });
  it('ore prima dell\'apertura partono alle 08:30', () => {
    expect(scadenzaSla(R(2026, 11, 9, 8), { tipo: 'ore', valore: 2 }, FEST)).toEqual(R(2026, 11, 9, 10, 30));
  });
  it('giorno lavorativo successivo salta il weekend', () => {
    expect(scadenzaSla(R(2026, 11, 6, 11), { tipo: 'giorni_lav', valore: 1 }, FEST)).toEqual(R(2026, 11, 9, 17, 30));
  });
  it('salta le festività', () => {
    expect(scadenzaSla(R(2026, 12, 7, 10), { tipo: 'giorni_lav', valore: 1 }, FEST)).toEqual(R(2026, 12, 9, 17, 30));
    expect(scadenzaSla(R(2026, 12, 24, 10), { tipo: 'giorni_lav', valore: 2 }, FEST)).toEqual(R(2026, 12, 29, 17, 30));
  });
  it('stesso giorno: sabato o dopo la chiusura → giorno lavorativo dopo', () => {
    expect(scadenzaSla(R(2026, 11, 7, 10), { tipo: 'stesso_giorno' }, FEST)).toEqual(R(2026, 11, 9, 17, 30));
    expect(scadenzaSla(R(2026, 11, 6, 18), { tipo: 'stesso_giorno' }, FEST)).toEqual(R(2026, 11, 9, 17, 30));
    expect(scadenzaSla(R(2026, 11, 5, 9), { tipo: 'stesso_giorno' }, FEST)).toEqual(R(2026, 11, 5, 17, 30));
  });
  it('orario d\'ufficio configurabile', () => {
    expect(scadenzaSla(R(2026, 11, 5, 17, 30), { tipo: 'minuti', valore: 30 }, FEST, { inizio: '09:00', fine: '18:00' })).toEqual(R(2026, 11, 5, 18));
    expect(scadenzaSla(R(2026, 11, 5, 17, 45), { tipo: 'minuti', valore: 30 }, FEST, { inizio: '09:00', fine: '18:00' })).toEqual(R(2026, 11, 6, 9, 15));
  });
  it('ora legale/solare: fine ottobre', () => {
    expect(scadenzaSla(R(2026, 10, 23, 17, 0), { tipo: 'ore', valore: 1 }, FEST)).toEqual(R(2026, 10, 26, 9));
  });
});

describe('semaforo e testi', () => {
  const i = R(2026, 11, 5, 9), s = R(2026, 11, 5, 10);
  it('verde, arancio sotto il 25%, rosso scaduto', () => {
    expect(semaforo(i, s, R(2026, 11, 5, 9, 10))).toBe('verde');
    expect(semaforo(i, s, R(2026, 11, 5, 9, 50))).toBe('arancio');
    expect(semaforo(i, s, R(2026, 11, 5, 10, 1))).toBe('rosso');
    expect(semaforo(i, null)).toBe('nessuno');
  });
  it('testo residuo', () => {
    expect(testoResiduo(s, R(2026, 11, 5, 9, 18))).toBe('tra 42 min');
    expect(testoResiduo(s, R(2026, 11, 5, 12))).toBe('scaduta da 2 h');
    expect(testoResiduo(R(2026, 11, 6, 17, 30), R(2026, 11, 5, 8))).toBe('domani 17:30');
  });
  it('giorno di Roma', () => { expect(giornoRoma(R(2026, 11, 5, 0, 30))).toBe('2026-11-05'); });
});

describe('modelli email', () => {
  it('sostituisce i segnaposto ed esegue l\'escape', () => {
    const v = segnaposto({ numero: 'CT-2026-000001', cliente_nome: 'Bar <Roma>', contatto_nome: null, appuntamento_data: '2026-11-10', appuntamento_fascia: 'mattina', commerciale_nome: null, tecnico_nome: null }, 'Jennifer\nFront Office');
    const c = compila('<p>Gentile {contatto}, {cliente} il {data_appuntamento} {fascia}</p>{firma}', v);
    expect(c).toContain('Bar &lt;Roma&gt;');
    expect(c).toContain('Gentile Cliente');
    expect(c).toContain('martedì 10/11/2026');
    expect(c).toContain('mattina (8:30–13:00)');
    expect(c).toContain('Jennifer<br>Front Office');
  });
});

describe('kpi', () => {
  it('percentuali SLA e funnel offerte', () => {
    const base = { canale: 'telefono', sottotipo: null, importo_stimato: 500, esito_offerta: null, closed_at: null, sla_rispettato: null, stato_corrente: 'ricevuta', created_at: '2026-11-05T08:00:00Z' };
    const k = calcolaKpi([
      { ...base, id: 1, tipo: 'offerta_piccola', esito: 'chiusa_ok', esito_offerta: 'accettata', sla_rispettato: true, stato_corrente: 'contratto' },
      { ...base, id: 2, tipo: 'offerta_piccola', esito: 'aperta', stato_corrente: 'offerta' },
      { ...base, id: 3, tipo: 'manutenzione', sottotipo: 'Allarme sonoro attivo', esito: 'chiusa_ok', sla_rispettato: false },
    ], [
      { pratica_id: 1, tipo: 'stato', a_stato: 'offerta', dati: { sla_stadio: 'offerta', sla_rispettato: true }, at: '2026-11-05T08:30:00Z' },
      { pratica_id: 2, tipo: 'stato', a_stato: 'offerta', dati: { sla_stadio: 'offerta', sla_rispettato: false }, at: '2026-11-05T09:30:00Z' },
    ]);
    expect(k.totale).toBe(3);
    expect(k.slaPct).toBe(50);
    expect(k.funnel.richieste).toBe(2);
    expect(k.funnel.inviate).toBe(2);
    expect(k.offerte60Pct).toBe(50);
    expect(k.interventi1hPct).toBe(null);
  });
});

describe('kpi trasferimenti', () => {
  it('richiamati in tempo, email', () => {
    const k = calcolaTrasf([
      { destinatario_nome: 'A', esito: 'risposto', richiamo_scadenza: null, richiamato_at: null, email_riepilogo_at: '2026-11-05T09:00:00Z' },
      { destinatario_nome: 'A', esito: 'non_risposto', richiamo_scadenza: '2026-11-05T11:00:00Z', richiamato_at: '2026-11-05T10:00:00Z' },
      { destinatario_nome: 'B', esito: 'richiamera', modalita: 'richiamo', richiamo_scadenza: '2026-11-05T11:00:00Z', richiamato_at: null, email_non_disponibile: 'nessuna' },
    ], new Date('2026-11-05T12:00:00Z'));
    expect(k.richiamatiInTempoPct).toBe(50);
    expect(k.scaduti).toBe(1);
    expect(k.senzaEmail).toBe(1);
    expect(k.perDestinatario.A.tot).toBe(2);
  });
});

describe('conto alla rovescia', () => {
  it('formati', () => {
    expect(orologio(47 * 60 + 12)).toBe('47:12');
    expect(orologio(3 * 3600 + 5)).toBe('3:00:05');
    expect(orologio(86400 + 3 * 3600)).toBe('1 g 03 h');
    expect(testoRegola({ tipo: 'minuti', valore: 60 })).toBe('entro 60 min');
    expect(testoRegola({ tipo: 'stesso_giorno' })).toBe('in giornata');
  });
  it('si ferma fuori orario e nel weekend', () => {
    // venerdì 17:00 → lunedì 09:00: 30 min venerdì + 30 lunedì = 3600 s
    expect(secondiUfficio(R(2026, 11, 6, 17), R(2026, 11, 9, 9), FEST)).toBe(3600);
    expect(riapertura(R(2026, 11, 7, 11), FEST)).toEqual(R(2026, 11, 9, 8, 30));
    expect(riapertura(R(2026, 11, 5, 10), FEST)).toBeNull();
    const c = conto(R(2026, 11, 6, 17), R(2026, 11, 9, 9), R(2026, 11, 7, 11), FEST)!;
    expect(c.testo).toBe('mancano 30:00');
    expect(c.pausa).toBe('in pausa fino a lun 08:30');
  });
  it('dopo la scadenza conta il ritardo in rosso', () => {
    const c = conto(R(2026, 11, 5, 9), R(2026, 11, 5, 10), R(2026, 11, 5, 10, 18), FEST)!;
    expect(c).toMatchObject({ testo: 'in ritardo da 00:18', colore: 'rosso', scaduto: true });
  });
});

describe('limiti del giorno di Roma', () => {
  it('inverno (UTC+1) e estate (UTC+2)', () => {
    expect(inizioGiornoRoma('2026-11-10')).toBe('2026-11-09T23:00:00.000Z');
    expect(fineGiornoRoma('2026-11-10')).toBe('2026-11-10T22:59:59.999Z');
    expect(inizioGiornoRoma('2026-07-01')).toBe('2026-06-30T22:00:00.000Z');
  });
  it('primo del mese secondo Roma', () => {
    expect(primoDelMeseRoma(new Date('2026-10-31T23:30:00Z'))).toBe('2026-11-01');
    expect(primoDelMeseRoma(new Date('2026-11-10T12:00:00Z'))).toBe('2026-11-01');
  });
});
