import { describe, expect, it } from 'vitest';
import { DEFS, contaDrill, defDrill, linkDrill, rigaDrill, righeDrill, MOTIVO_NON_SCRITTO, nomeCanaleD, type DatiDrill } from './drill';
import { conta, inRitardo, kpiOfferte, perPersona, type Offerta } from './offerte';
import { gruppoTipo } from './testiDirezione';
import type { RecPratica } from './registro';

const H = 3600e3, T = Date.parse('2026-11-20T10:00:00Z'), ora = new Date(T), iso = (ms: number) => new Date(ms).toISOString();
const off: Offerta[] = ([
  ['jennifer', 'Jennifer', -50, -49.5, 'accettata'], ['jennifer', 'Jennifer', -30, -28, 'non_accettata', 'Prezzo', 'Ritardo cliente'], ['jennifer', 'Jennifer', -3, null, 'da_inviare'],
  ['jennifer', 'Jennifer', -0.5, null, 'da_inviare'], ['collega', 'Luca', -80, -20, 'in_attesa'], ['collega', 'Luca', -120, -100, 'non_accettata', 'Tempi'],
  ['collega', 'Mario', -100, null, 'da_inviare'], ['collega', 'Mario', -10, -9, 'annullata', 'Non più necessario'], ['jennifer', 'Jennifer', -70, -60, 'in_attesa', null, null],
] as const).map(([g, chi, a, i, e, m, mr], k) => {
  const arr = T + a * H, sc = g === 'jennifer' ? arr + H : arr + 48 * H;
  return { pratica_id: 10 + k, gestione: g, gestita_da: chi, arrivata_il: iso(arr), scadenza: iso(sc), inviata_il: i == null ? null : iso(T + i * H), esito: e, esito_il: null,
    motivo: m ?? null, motivo_nota: null, motivo_ritardo: mr ?? null, numero_offerta_adhoc: null, aggiornata_il: iso(T), aggiornata_da: null,
    pratiche: { numero: `N${k}`, cliente_nome: `C${k}`, descrizione: 'x', canale: ['telefono', 'email', 'whatsapp'][k % 3], importo_stimato: null, tipo: g === 'jennifer' ? 'offerta_piccola' : 'offerta_grande' } } as Offerta;
});
const tipi = ['manutenzione', 'sopralluogo', 'offerta_piccola', 'offerta_grande', 'modifica', 'informazione'];
const pratiche: RecPratica[] = [...Array(17).keys()].map(k => ({ id: 100 + k, numero: `P${k}`, tipo: tipi[k % 6], sottotipo: null, canale: ['telefono', 'email', 'whatsapp', 'tablet_tmq'][k % 4],
  esito: ['aperta', 'chiusa_ok', 'chiusa_ko', 'annullata'][k % 4], esito_offerta: null, stato_corrente: 'ricevuta', cliente_nome: `X${k}`, importo_stimato: null, sla_rispettato: null, sla_scadenza: null,
  created_at: iso(T - k * 7 * H), closed_at: k % 4 ? iso(T - k * 5 * H) : null, registrata_dopo: k % 5 === 0 }));
const chiuse = pratiche.filter(p => p.closed_at);
const d: DatiDrill = { off, pratiche, chiuse };

describe('drill-down Direzione: numero = lunghezza dell\'elenco', () => {
  it('KPI offerte coincidono con kpiOfferte e con l\'elenco', () => {
    const k = kpiOfferte(off, ora);
    expect(contaDrill('of_arrivate', d, {}, ora)).toBe(k.arrivate);
    expect(contaDrill('of_in_tempo', d, {}, ora)).toBe(k.in_tempo);
    expect(contaDrill('of_in_ritardo', d, {}, ora)).toBe(k.in_ritardo);
    expect(contaDrill('of_da_inviare', d, {}, ora)).toBe(k.da_inviare);
    expect(contaDrill('of_inviate', d, {}, ora)).toBe(k.inviate);
    expect(contaDrill('of_accettate', d, {}, ora)).toBe(k.accettate);
    expect(contaDrill('of_non_accettate', d, {}, ora)).toBe(k.non_accettate);
    expect(contaDrill('of_da_inviare_scadute', d, {}, ora)).toBe(k.da_inviare_scadute);
    expect(contaDrill('of_aperte_scadute', d, {}, ora)).toBe(k.da_inviare_scadute);
    expect(k.arrivate).toBe(9); expect(k.non_accettate).toBe(2);
  });
  it('filtro Jennifer / Colleghi', () => {
    for (const chi of ['jennifer', 'collega'] as const) {
      const k = kpiOfferte(off.filter(o => o.gestione === chi), ora);
      expect(contaDrill('of_arrivate', d, { chi }, ora)).toBe(k.arrivate);
      expect(contaDrill('of_da_inviare', d, { chi }, ora)).toBe(k.da_inviare);
    }
  });
  it('celle per persona, motivi, canali', () => {
    for (const r of perPersona(off)) {
      expect(contaDrill('of_arrivate', d, { persona: r.persona }, ora)).toBe(r.arrivate);
      expect(contaDrill('of_in_tempo', d, { persona: r.persona }, ora)).toBe(r.in_tempo);
      expect(contaDrill('of_accettate', d, { persona: r.persona }, ora)).toBe(r.accettate);
      expect(contaDrill('of_inviate', d, { persona: r.persona }, ora)).toBe(r.inviate);
    }
    for (const m of conta(off.filter(o => o.esito === 'non_accettata'), o => o.motivo)) expect(contaDrill('of_non_accettate', d, { motivo: m.l }, ora)).toBe(m.n);
    for (const m of conta(off.filter(inRitardo), o => o.motivo_ritardo ?? MOTIVO_NON_SCRITTO)) expect(contaDrill('of_in_ritardo', d, { motivo_rit: m.l }, ora)).toBe(m.n);
    for (const c of conta(off, o => nomeCanaleD(o.pratiche?.canale))) expect(contaDrill('of_arrivate', d, { canale: c.l }, ora)).toBe(c.n);
  });
  it('richieste: totale, per tipo, per canale, per giorno; richieste chiuse = chiusa_ok con data di chiusura', () => {
    expect(contaDrill('pr_richieste', d)).toBe(17);
    for (const g of ['manutenzione', 'sopralluogo', 'offerta', 'modifica', 'informazione']) expect(contaDrill('pr_richieste', d, { gruppo: g })).toBe(pratiche.filter(p => gruppoTipo(p.tipo) === g).length);
    for (const c of ['telefono', 'email', 'whatsapp', 'tablet_tmq']) expect(contaDrill('pr_richieste', d, { canale: c })).toBe(pratiche.filter(p => p.canale === c).length);
    const g = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(ora);
    expect(contaDrill('pr_richieste', d, { giorno: g })).toBeGreaterThan(0);
    expect(contaDrill('pr_chiuse', d)).toBe(pratiche.filter(p => p.esito === 'chiusa_ok' && p.closed_at).length);
    expect(righeDrill(defDrill('pr_chiuse')!, d).every(p => (p as RecPratica).esito === 'chiusa_ok')).toBe(true);
  });
  it('ogni definizione: conteggio = righe e ogni riga ha l\'id della pratica', () => {
    for (const def of DEFS) {
      const r = righeDrill(def, d, {}, ora);
      expect(contaDrill(def.id, d, {}, ora)).toBe(r.length);
      for (const x of r) { const y = rigaDrill(x, ora); expect(y.id).toBeGreaterThan(0); expect(y.arrivo).toBeTruthy(); }
    }
  });
  it('«Registrata dopo» resta solo come etichetta della riga; nessun numero «registrate dopo»', () => {
    expect(DEFS.some(x => /registrat/i.test(x.id + x.t.it))).toBe(false);
    expect(rigaDrill(pratiche[0]).dopo).toBe(true);
  });
  it('link con periodo e filtri; le offerte aperte non hanno periodo', () => {
    expect(linkDrill('/b', 'of_arrivate', '2026-11-01', '2026-11-20', { persona: 'Luca' })).toBe('/b/elenco?n=of_arrivate&da=2026-11-01&a=2026-11-20&persona=Luca');
    expect(linkDrill('/b', 'of_aperte_in_attesa', '2026-11-01', '2026-11-20')).toBe('/b/elenco?n=of_aperte_in_attesa');
  });
});
