/**
 * Drill-down della Direzione: OGNI numero della pagina «Centralino e offerte» (e della Panoramica) viene da `elenco()`.
 * Il numero mostrato = `elenco(...).length` → numero e lista coincidono sempre (vedi drill.test.ts).
 * URL: /direzione/centralino/elenco?n=<id>&da=…&a=…&chi=…&persona=…&motivo=…&motivo_rit=…&canale=…&gruppo=…&giorno=…&tutte=1
 */
import { giornoRoma } from './sla';
import { inRitardo, inTempo, statoOfferta, type Offerta } from './offerte';
import type { RecPratica } from './registro';
import { CANALI_NOMI, DRILL, ESITI_NOMI, STATI_OFFERTA, TIPI_RICHIESTA, gruppoTipo, type Testo } from './testiDirezione';

export type FonteDrill = 'offerte' | 'offerte_aperte' | 'pratiche' | 'chiuse';
export interface DefDrill { id: string; fonte: FonteDrill; t: Testo; num: (r: Offerta | RecPratica, ora: Date) => boolean }
export type ParDrill = Partial<Record<'chi' | 'persona' | 'stato' | 'motivo' | 'motivo_rit' | 'canale' | 'gruppo' | 'giorno', string>>;
export interface DatiDrill { off: Offerta[] | null; pratiche: RecPratica[]; chiuse: RecPratica[] }
export interface RigaDrill {
  id: number; numero: string; arrivo: string; cliente: string; cosa: string; canale: string; tipo: string; gestita: string; stato: string;
  inviata: string | null; esito: string; motivo: string; dopo: boolean;
}

const O = (r: Offerta | RecPratica) => r as Offerta;
const P = (r: Offerta | RecPratica) => r as RecPratica;
export const MOTIVO_NON_SCRITTO = 'Motivo non scritto';
export const nomeCanaleD = (c: string | null | undefined) => (CANALI_NOMI as Record<string, Testo>)[c ?? 'altro']?.it ?? CANALI_NOMI.altro.it;

export const DEFS: DefDrill[] = [
  { id: 'of_arrivate', fonte: 'offerte', t: DRILL.of_arrivate, num: () => true },
  { id: 'of_in_tempo', fonte: 'offerte', t: DRILL.of_in_tempo, num: r => inTempo(O(r)) },
  { id: 'of_in_ritardo', fonte: 'offerte', t: DRILL.of_in_ritardo, num: r => inRitardo(O(r)) },
  { id: 'of_da_inviare', fonte: 'offerte', t: DRILL.of_da_inviare, num: r => !O(r).inviata_il && O(r).esito === 'da_inviare' },
  { id: 'of_da_inviare_scadute', fonte: 'offerte', t: DRILL.of_da_inviare_scadute, num: (r, ora) => !O(r).inviata_il && O(r).esito === 'da_inviare' && new Date(O(r).scadenza) < ora },
  { id: 'of_inviate', fonte: 'offerte', t: DRILL.of_inviate, num: r => !!O(r).inviata_il },
  { id: 'of_accettate', fonte: 'offerte', t: DRILL.of_accettate, num: r => O(r).esito === 'accettata' },
  { id: 'of_non_accettate', fonte: 'offerte', t: DRILL.of_non_accettate, num: r => O(r).esito === 'non_accettata' },
  { id: 'of_aperte_da_inviare', fonte: 'offerte_aperte', t: DRILL.of_aperte_da_inviare, num: r => !O(r).inviata_il && O(r).esito === 'da_inviare' },
  { id: 'of_aperte_scadute', fonte: 'offerte_aperte', t: DRILL.of_aperte_scadute, num: (r, ora) => !O(r).inviata_il && O(r).esito === 'da_inviare' && new Date(O(r).scadenza) < ora },
  { id: 'of_aperte_in_attesa', fonte: 'offerte_aperte', t: DRILL.of_aperte_in_attesa, num: r => O(r).esito === 'in_attesa' },
  { id: 'pr_richieste', fonte: 'pratiche', t: DRILL.pr_richieste, num: () => true },
  { id: 'pr_chiuse', fonte: 'chiuse', t: DRILL.pr_chiuse, num: r => P(r).esito === 'chiusa_ok' && !!P(r).closed_at },
];
export const defDrill = (id: string) => DEFS.find(d => d.id === id);

function passaOfferta(o: Offerta, p: ParDrill, ora: Date) {
  if (p.stato && statoOfferta(o, ora) !== p.stato) return false;
  if (p.chi && o.gestione !== p.chi) return false;
  if (p.persona && o.gestita_da !== p.persona) return false;
  if (p.motivo && o.motivo !== p.motivo) return false;
  if (p.motivo_rit && (o.motivo_ritardo ?? MOTIVO_NON_SCRITTO) !== p.motivo_rit) return false;
  if (p.canale && nomeCanaleD(o.pratiche?.canale) !== p.canale) return false;
  if (p.giorno && giornoRoma(o.arrivata_il) !== p.giorno) return false;
  return true;
}
function passaPratica(x: RecPratica, p: ParDrill, chiuse: boolean) {
  if (p.gruppo && gruppoTipo(x.tipo) !== p.gruppo) return false;
  if (p.canale && x.canale !== p.canale) return false;
  if (p.giorno && giornoRoma(chiuse ? x.closed_at! : x.created_at) !== p.giorno) return false;
  return true;
}

/** Le righe contate dal numero `id` con i parametri `p`. */
export function righeDrill(def: DefDrill, d: DatiDrill, p: ParDrill = {}, ora = new Date()): (Offerta | RecPratica)[] {
  if (def.fonte === 'offerte' || def.fonte === 'offerte_aperte') return (d.off ?? []).filter(o => passaOfferta(o, p, ora) && def.num(o, ora));
  const l = def.fonte === 'chiuse' ? d.chiuse : d.pratiche;
  return l.filter(x => def.num(x, ora) && passaPratica(x, p, def.fonte === 'chiuse'));
}
export const contaDrill = (id: string, d: DatiDrill, p: ParDrill = {}, ora = new Date()) => { const def = defDrill(id); return def ? righeDrill(def, d, p, ora).length : 0; };

const nomeTipoD = (t: string) => (TIPI_RICHIESTA as Record<string, Testo>)[gruppoTipo(t)]?.it ?? t;
const ESITI_OFF = new Set(['accettata', 'non_accettata', 'annullata']);
/** Riga uniforme per la tabella e l'Excel. */
export function rigaDrill(r: Offerta | RecPratica, ora = new Date()): RigaDrill {
  if ('pratica_id' in r) {
    const o = r as Offerta;
    return { id: o.pratica_id, numero: o.pratiche?.numero ?? '', arrivo: o.arrivata_il, cliente: o.pratiche?.cliente_nome ?? '—', cosa: o.pratiche?.descrizione ?? '—',
      canale: nomeCanaleD(o.pratiche?.canale), tipo: nomeTipoD(o.pratiche?.tipo ?? 'offerta'), gestita: o.gestita_da, stato: STATI_OFFERTA[statoOfferta(o, ora)].it,
      inviata: o.inviata_il, esito: ESITI_OFF.has(o.esito) ? STATI_OFFERTA[o.esito].it : '—',
      motivo: [o.motivo && `${o.motivo}${o.motivo_nota ? ` – ${o.motivo_nota}` : ''}`, o.motivo_ritardo && `Ritardo: ${o.motivo_ritardo}`].filter(Boolean).join(' · ') || '—', dopo: false };
  }
  const x = r as RecPratica & { descrizione?: string | null; sottotipo?: string | null };
  return { id: x.id, numero: x.numero, arrivo: x.created_at, cliente: x.cliente_nome || '—', cosa: x.descrizione || x.sottotipo || '—', canale: nomeCanaleD(x.canale), tipo: nomeTipoD(x.tipo),
    gestita: x.assegnato_nome ?? '—', stato: (ESITI_NOMI as Record<string, Testo>)[x.esito]?.it ?? x.esito, inviata: null, esito: '—', motivo: '—', dopo: !!x.registrata_dopo };
}

export const PARAMETRI: (keyof ParDrill)[] = ['chi', 'persona', 'stato', 'motivo', 'motivo_rit', 'canale', 'gruppo', 'giorno'];
/** Link alla lista di un numero. */
export function linkDrill(base: string, id: string, da: string, a: string, p: ParDrill = {}) {
  const q = new URLSearchParams({ n: id });
  if (defDrill(id)?.fonte !== 'offerte_aperte') { q.set('da', da); q.set('a', a); }
  for (const k of PARAMETRI) if (p[k]) q.set(k, p[k]!);
  return `${base}/elenco?${q.toString()}`;
}
