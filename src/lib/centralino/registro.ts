/**
 * Registro dei KPI del centralino: OGNI numero (tessera, barra, contatore) viene da qui,
 * e la pagina di dettaglio (/centralino/analisi?kpi=…) usa la stessa funzione → numero e lista coincidono sempre.
 */
export type Fonte = 'pratiche' | 'aperte' | 'chiuse' | 'trasferimenti' | 'contatti' | 'anagrafica';
export interface RecPratica {
  id: number; numero: string; tipo: string; sottotipo: string | null; canale: string; esito: string; esito_offerta: string | null; stato_corrente: string;
  cliente_nome: string; stato_cliente?: string | null; tipo_contatto?: string | null; importo_stimato: number | null; sla_rispettato: boolean | null; sla_scadenza: string | null;
  created_at: string; closed_at: string | null; assegnato_nome?: string | null; telefono?: string | null; urgenza?: string | null;
}
export interface RecTrasf {
  id: number; pratica_id: number | null; destinatario_nome: string; esito: string; modalita?: string; richiamo_scadenza: string | null; richiamato_at: string | null; at: string; solo_commerciale?: boolean;
  cliente_nome: string | null; telefono?: string | null; tipo_argomento?: string | null; stato_cliente?: string | null; tipo_contatto?: string | null;
  email_referente_inviata_at?: string | null; email_cliente_inviata_at?: string | null; email_riepilogo_at?: string | null; email_non_disponibile?: string | null;
}
export interface RecEvento { pratica_id: number; tipo: string; a_stato: string | null; dati: Record<string, unknown>; at: string; testo?: string | null }
export interface RecInfo { id: number; canale: string; nota: string | null; at: string; autore_nome?: string | null }
/** modifica di un contatto in rubrica (una riga per contatto e giorno) */
export interface RecAgg { contatto_id: number; at: string; campo: string; a: string | null; autore_nome: string | null }
export interface Dataset { pratiche: RecPratica[]; aperte: RecPratica[]; trasf: RecTrasf[]; eventi: RecEvento[]; info: RecInfo[]; /** chiuse nel periodo (data di chiusura) */ chiuse: RecPratica[]; agg?: RecAgg[] }
export type Filtri = Partial<Record<'canale' | 'tipo' | 'stato' | 'chi' | 'dest' | 'arg' | 'giorno' | 'ora' | 'dow' | 'passo', string>>;
type Rec = RecPratica | RecTrasf | RecInfo | RecAgg;
interface Ctx { ora: Date; slaEv: (id: number, stadio: string) => RecEvento | undefined; f: Filtri; email: Set<number>; motivo: Map<number, string> }

export interface Def {
  id: string; titolo: string; spiegazione: string; fonte: Fonte;
  /** contatori del registro: anche i contatti informativi senza pratica */
  conInfo?: boolean;
  num: (r: Rec, c: Ctx) => boolean;
  /** se c'è, il valore è una percentuale num/den (la lista mostra il numeratore) */
  den?: (r: Rec, c: Ctx) => boolean;
}

const P = (r: Rec) => r as RecPratica;
const T = (r: Rec) => r as RecTrasf;
const offerta = (t: string) => t === 'offerta_piccola' || t === 'offerta_grande';
/** offerta ≤ 1.000 € inviata dal centralino; offerta oltre 1.000 € passata al commerciale (email al cliente fatta) */
const inviata = (p: RecPratica) => ['offerta', 'email_cliente', 'riepilogo'].includes(p.stato_corrente) || (p.esito === 'chiusa_ok');
const conCliente = (t: RecTrasf) => !!(t.email_cliente_inviata_at || t.email_riepilogo_at);
const richiamoValutabile = (t: RecTrasf, ora: Date) => !!t.richiamo_scadenza && (!!t.richiamato_at || new Date(t.richiamo_scadenza) < ora);
const inTempo = (t: RecTrasf) => !!t.richiamato_at && !!t.richiamo_scadenza && new Date(t.richiamato_at) <= new Date(t.richiamo_scadenza);
const tutto = () => true;
/** giorno (Roma) di un istante */
const gR = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(iso));
const assistito = (p: RecPratica) => p.tipo === 'manutenzione' || p.tipo === 'sopralluogo';
const annullata = (p: RecPratica) => p.esito === 'annullata';

export const KPI: Def[] = [
  // pratiche del periodo
  { id: 'pratiche', titolo: 'Contatti (pratiche)', spiegazione: 'Pratiche aperte nel periodo, qualunque esito.', fonte: 'pratiche', num: tutto },
  { id: 'aperte_periodo', titolo: 'Ancora aperte', spiegazione: 'Pratiche del periodo non ancora chiuse né annullate.', fonte: 'pratiche', num: r => P(r).esito === 'aperta' },
  { id: 'chiuse', titolo: 'Chiuse', spiegazione: 'Pratiche del periodo chiuse (tutti i passi fatti), annullate escluse.', fonte: 'pratiche', num: r => P(r).esito === 'chiusa_ok' || P(r).esito === 'chiusa_ko' },
  { id: 'sla', titolo: 'SLA rispettati', spiegazione: 'Numeratore: pratiche con SLA rispettato. Denominatore: pratiche con SLA già valutato (chiuse o con una scadenza superata).', fonte: 'pratiche', num: r => P(r).sla_rispettato === true, den: r => P(r).sla_rispettato != null },
  { id: 'sla_mancati', titolo: 'SLA mancati', spiegazione: 'Pratiche del periodo con almeno una scadenza non rispettata.', fonte: 'pratiche', num: r => P(r).sla_rispettato === false },
  { id: 'offerte60', titolo: 'Offerte ≤ 1.000 € entro 60 min', spiegazione: 'Numeratore: offerte ≤ 1.000 € con il passo «Offerta inviata» fatto entro 60 minuti dalla richiesta. Denominatore: offerte ≤ 1.000 € già inviate.', fonte: 'pratiche',
    num: (r, c) => P(r).tipo === 'offerta_piccola' && c.slaEv(P(r).id, 'offerta')?.dati?.sla_rispettato === true, den: (r, c) => P(r).tipo === 'offerta_piccola' && !!c.slaEv(P(r).id, 'offerta') },
  { id: 'interventi1h', titolo: 'Interventi: cliente informato entro 1 ora', spiegazione: 'Numeratore: interventi con il passo «Cliente informato» fatto entro 60 minuti dalla chiamata. Denominatore: interventi con il cliente già informato.', fonte: 'pratiche',
    num: (r, c) => P(r).tipo === 'manutenzione' && c.slaEv(P(r).id, 'cliente')?.dati?.sla_rispettato === true, den: (r, c) => P(r).tipo === 'manutenzione' && !!c.slaEv(P(r).id, 'cliente') },
  { id: 'sopralluoghi1h', titolo: 'Sopralluoghi: cliente informato entro 1 ora', spiegazione: 'Numeratore: sopralluoghi con il cliente informato entro 60 minuti. Denominatore: sopralluoghi con il cliente già informato.', fonte: 'pratiche',
    num: (r, c) => P(r).tipo === 'sopralluogo' && c.slaEv(P(r).id, 'cliente')?.dati?.sla_rispettato === true, den: (r, c) => P(r).tipo === 'sopralluogo' && !!c.slaEv(P(r).id, 'cliente') },
  { id: 'urgenti', titolo: 'Richieste urgenti', spiegazione: 'Interventi e sopralluoghi valutati «urgente» (da fare oggi).', fonte: 'pratiche', num: r => (r as RecPratica & { urgenza?: string | null }).urgenza === 'urgente' },
  { id: 'off_richieste', titolo: 'Offerte richieste', spiegazione: 'Pratiche di offerta (≤ e > 1.000 €) del periodo.', fonte: 'pratiche', num: r => offerta(P(r).tipo) },
  { id: 'off_inviate', titolo: 'Offerte evase dal centralino', spiegazione: 'Offerte fino a 1.000 € inviate dal centralino e offerte oltre 1.000 € passate al Tecnico Commerciale (email al cliente fatta).', fonte: 'pratiche', num: r => offerta(P(r).tipo) && inviata(P(r)) },
  // direzione: servizio, offerte, qualità
  { id: 'cliente1h', titolo: 'Cliente informato entro 1 ora', spiegazione: 'Numeratore: interventi e sopralluoghi con il passo «Cliente informato» fatto entro 60 minuti dalla chiamata. Denominatore: interventi e sopralluoghi con il cliente già informato.', fonte: 'pratiche',
    num: (r, c) => assistito(P(r)) && c.slaEv(P(r).id, 'cliente')?.dati?.sla_rispettato === true, den: (r, c) => assistito(P(r)) && !!c.slaEv(P(r).id, 'cliente') },
  { id: 'sla_passo', titolo: 'SLA rispettati nel passo', spiegazione: 'Numeratore: pratiche con il passo indicato (filtro «passo») fatto entro la sua scadenza. Denominatore: pratiche con quel passo già fatto.', fonte: 'pratiche',
    num: (r, c) => !!c.f.passo && c.slaEv(P(r).id, c.f.passo)?.dati?.sla_rispettato === true, den: (r, c) => !!c.f.passo && !!c.slaEv(P(r).id, c.f.passo) },
  { id: 'urgenti_giornata', titolo: 'Urgenze gestite in giornata', spiegazione: 'Numeratore: richieste urgenti con il cliente informato (o la pratica chiusa) lo stesso giorno della chiamata. Denominatore: richieste urgenti del periodo, annullate escluse.', fonte: 'pratiche',
    num: (r, c) => { const p = P(r); if (p.urgenza !== 'urgente' || annullata(p)) return false; const e = c.slaEv(p.id, 'cliente'); const g = gR(p.created_at); return (!!e && gR(e.at) === g) || (!!p.closed_at && gR(p.closed_at) === g); },
    den: r => P(r).urgenza === 'urgente' && !annullata(P(r)) },
  { id: 'off_piccole', titolo: 'Offerte fino a 1.000 €', spiegazione: 'Richieste di offerta fino a 1.000 € (gestite dal centralino) nel periodo.', fonte: 'pratiche', num: r => P(r).tipo === 'offerta_piccola' },
  { id: 'off_piccole_inviate', titolo: 'Offerte fino a 1.000 € inviate', spiegazione: 'Offerte fino a 1.000 € con il passo «Offerta inviata» fatto o chiuse.', fonte: 'pratiche', num: r => P(r).tipo === 'offerta_piccola' && inviata(P(r)) },
  { id: 'off_grandi', titolo: 'Offerte oltre 1.000 €', spiegazione: 'Richieste di offerta oltre 1.000 € (per il Tecnico Commerciale) nel periodo.', fonte: 'pratiche', num: r => P(r).tipo === 'offerta_grande' },
  { id: 'off_grandi_passate', titolo: 'Passate ai commerciali', spiegazione: 'Numeratore: offerte oltre 1.000 € con l\'email al cliente fatta (passate al commerciale). Denominatore: offerte oltre 1.000 € non annullate.', fonte: 'pratiche',
    num: r => P(r).tipo === 'offerta_grande' && inviata(P(r)), den: r => P(r).tipo === 'offerta_grande' && !annullata(P(r)) },
  { id: 'qual_email', titolo: 'Pratiche con email al cliente', spiegazione: 'Numeratore: pratiche con almeno un\'email inviata dal centralino. Denominatore: pratiche del periodo, annullate escluse.', fonte: 'pratiche',
    num: (r, c) => !annullata(P(r)) && c.email.has(P(r).id), den: r => !annullata(P(r)) },
  { id: 'annullate', titolo: 'Annullate', spiegazione: 'Pratiche del periodo annullate.', fonte: 'pratiche', num: r => annullata(P(r)) },
  { id: 'annullate_motivo', titolo: 'Annullate con motivo', spiegazione: 'Numeratore: pratiche annullate con il motivo scritto. Denominatore: pratiche annullate.', fonte: 'pratiche',
    num: (r, c) => annullata(P(r)) && !!c.motivo.get(P(r).id)?.trim(), den: r => annullata(P(r)) },
  { id: 'senza_contatti', titolo: 'Contatti senza nome o telefono', spiegazione: 'Pratiche del periodo senza nome di chi chiama oppure senza numero di telefono.', fonte: 'pratiche',
    num: r => !P(r).cliente_nome?.trim() || !P(r).telefono?.trim() },
  // situazione attuale
  { id: 'in_ritardo', titolo: 'In ritardo adesso', spiegazione: 'Pratiche aperte (di qualunque giorno) con la scadenza del prossimo passo già superata.', fonte: 'aperte', num: (r, c) => !!P(r).sla_scadenza && new Date(P(r).sla_scadenza!) < c.ora },
  { id: 'in_scadenza', titolo: 'In scadenza (60 min)', spiegazione: 'Pratiche aperte con la scadenza del prossimo passo entro i prossimi 60 minuti.', fonte: 'aperte', num: (r, c) => !!P(r).sla_scadenza && new Date(P(r).sla_scadenza!) >= c.ora && new Date(P(r).sla_scadenza!).getTime() - c.ora.getTime() <= 3600e3 },
  { id: 'aperte', titolo: 'Pratiche aperte', spiegazione: 'Tutte le pratiche aperte in questo momento.', fonte: 'aperte', num: tutto },
  // registro del giorno (Jennifer pannel)
  { id: 'reg_telefonate', titolo: 'Telefonate ricevute', spiegazione: 'Pratiche con canale Telefono + chiamate solo informative.', fonte: 'contatti', conInfo: true, num: r => ('tipo' in r ? P(r).canale : (r as RecInfo).canale) === 'telefono' },
  { id: 'reg_whatsapp', titolo: 'WhatsApp', spiegazione: 'Pratiche con canale WhatsApp + messaggi solo informativi.', fonte: 'contatti', conInfo: true, num: r => ('tipo' in r ? P(r).canale : (r as RecInfo).canale) === 'whatsapp' },
  { id: 'reg_email', titolo: 'Email', spiegazione: 'Pratiche con canale Email + email solo informative.', fonte: 'contatti', conInfo: true, num: r => ('tipo' in r ? P(r).canale : (r as RecInfo).canale) === 'email' },
  { id: 'reg_tablet', titolo: 'Offerte da tablet', spiegazione: 'Offerte con canale Tablet TMQ.', fonte: 'pratiche', num: r => offerta(P(r).tipo) && P(r).canale === 'tablet_tmq' },
  { id: 'reg_wa_offerte', titolo: 'Offerte da WA', spiegazione: 'Offerte con canale WhatsApp.', fonte: 'pratiche', num: r => offerta(P(r).tipo) && P(r).canale === 'whatsapp' },
  { id: 'reg_cliente', titolo: 'Offerte da cliente', spiegazione: 'Offerte con canale Telefono, Email o Altro.', fonte: 'pratiche', num: r => offerta(P(r).tipo) && ['telefono', 'email', 'altro'].includes(P(r).canale) },
  { id: 'reg_anagrafica', titolo: 'Aggiornamento anagrafica', spiegazione: 'Pratiche «Modifica calendario / anagrafica / disdetta» + contatti dei clienti modificati (un contatto conta una volta al giorno).', fonte: 'anagrafica', num: r => 'contatto_id' in r || P(r).tipo === 'modifica' },
  { id: 'reg_info', titolo: 'Solo informazioni', spiegazione: 'Contatti informativi registrati con «+1», senza pratica.', fonte: 'contatti', conInfo: true, num: r => !('tipo' in r) },
  { id: 'reg_chiuse', titolo: 'Chiuse', spiegazione: 'Pratiche chiuse nel periodo (data di chiusura), annullate escluse.', fonte: 'chiuse', num: r => P(r).esito !== 'annullata' },
  // chiamate trasferite
  { id: 'trasferite', titolo: 'Chiamate trasferite', spiegazione: 'Chiamate passate a un responsabile (trasferite o «responsabile non disponibile»).', fonte: 'trasferimenti', num: tutto },
  { id: 'trasf_in_tempo', titolo: 'Richiamati entro la scadenza', spiegazione: 'Numeratore: richiami fatti entro la scadenza promessa. Denominatore: richiami già fatti o con scadenza superata.', fonte: 'trasferimenti',
    num: r => inTempo(T(r)), den: (r, c) => richiamoValutabile(T(r), c.ora) },
  { id: 'trasf_da_richiamare', titolo: 'Ancora da richiamare', spiegazione: 'Richiami promessi e non ancora fatti.', fonte: 'trasferimenti', num: r => !!T(r).richiamo_scadenza && !T(r).richiamato_at },
  { id: 'richiami_dovuti', titolo: 'Richiami dovuti', spiegazione: 'Richiami del centralino (tutti i giorni) con scadenza già superata o entro 60 minuti; esclusi quelli del Tecnico Commerciale (offerte oltre 1.000 €).', fonte: 'trasferimenti', num: (r, c) => !T(r).solo_commerciale && !!T(r).richiamo_scadenza && !T(r).richiamato_at && new Date(T(r).richiamo_scadenza!).getTime() - c.ora.getTime() <= 3600e3 },
  { id: 'trasf_scadute', titolo: 'Scadute non richiamate', spiegazione: 'Richiami non fatti con la scadenza già superata.', fonte: 'trasferimenti', num: (r, c) => !!T(r).richiamo_scadenza && !T(r).richiamato_at && new Date(T(r).richiamo_scadenza!) < c.ora },
  { id: 'trasf_email_ref', titolo: 'Con email al referente', spiegazione: 'Numeratore: trasferimenti con l\'email inviata al referente. Denominatore: tutti i trasferimenti.', fonte: 'trasferimenti', num: r => !!T(r).email_referente_inviata_at, den: tutto },
  { id: 'trasf_email_cli', titolo: 'Con email al cliente', spiegazione: 'Numeratore: trasferimenti con l\'email di riepilogo al cliente. Denominatore: tutti i trasferimenti.', fonte: 'trasferimenti', num: r => conCliente(T(r)), den: tutto },
  { id: 'comm_in_tempo', titolo: 'Richiami commerciali entro 2 ore', spiegazione: 'Numeratore: richiami dei Tecnici Commerciali (offerte oltre 1.000 €) fatti entro la scadenza. Denominatore: richiami dei commerciali già fatti o con scadenza superata.', fonte: 'trasferimenti',
    num: r => !!T(r).solo_commerciale && inTempo(T(r)), den: (r, c) => !!T(r).solo_commerciale && richiamoValutabile(T(r), c.ora) },
  { id: 'comm_scaduti', titolo: 'Richiami commerciali scaduti', spiegazione: 'Richiami dei Tecnici Commerciali non ancora fatti con la scadenza (2 ore) già superata.', fonte: 'trasferimenti',
    num: (r, c) => !!T(r).solo_commerciale && !!T(r).richiamo_scadenza && !T(r).richiamato_at && new Date(T(r).richiamo_scadenza!) < c.ora },
  { id: 'trasf_senza_email', titolo: 'Email mancanti', spiegazione: 'Trasferimenti senza email al referente, oppure senza email al cliente e senza motivo.', fonte: 'trasferimenti',
    num: r => !T(r).email_referente_inviata_at || (!conCliente(T(r)) && !T(r).email_non_disponibile) },
];
export const kpi = (id: string) => KPI.find(k => k.id === id);

const giorno = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(iso));

/** Righe della fonte, con i filtri comuni (canale, tipo, stato cliente, destinatario, argomento, giorno). */
export function base(def: Def, d: Dataset, f: Filtri): Rec[] {
  const l: Rec[] = def.fonte === 'trasferimenti' ? d.trasf : def.fonte === 'aperte' ? d.aperte : def.fonte === 'chiuse' ? d.chiuse
    : def.fonte === 'anagrafica' ? [...d.pratiche, ...unaAlGiorno(d.agg ?? [])] : def.conInfo ? [...d.pratiche, ...d.info] : d.pratiche;
  return l.filter(r => {
    if ('contatto_id' in r) return !f.ora && !f.dow && !f.canale && !f.tipo && !f.stato && !f.chi && !f.dest && !f.arg && (!f.giorno || giorno(r.at) === f.giorno);
    const isT = 'destinatario_nome' in r, isI = !('cliente_nome' in r);
    if (f.giorno && giorno(isT ? T(r).at : isI ? (r as RecInfo).at : def.fonte === 'chiuse' ? P(r).closed_at! : P(r).created_at) !== f.giorno) return false;
    if ((f.ora || f.dow) && (isT || isI)) return false;
    if (f.ora && oraR(P(r).created_at) !== Number(f.ora)) return false;
    if (f.dow && dowR(P(r).created_at) !== Number(f.dow)) return false;
    if (f.canale && (isT || (isI ? (r as RecInfo).canale : P(r).canale) !== f.canale)) return false;
    if (f.tipo && (isT || isI || P(r).tipo !== f.tipo)) return false;
    const chi = isI ? null : ((isT ? T(r).tipo_contatto : P(r).tipo_contatto) ?? 'cliente');
    if (f.chi && chi !== f.chi) return false;
    // lo stato cliente vale solo per i clienti
    if (f.stato && (isI || chi !== 'cliente' || ((isT ? T(r).stato_cliente : P(r).stato_cliente) ?? 'nuovo') !== f.stato)) return false;
    if (f.dest && (!isT || T(r).destinatario_nome !== f.dest)) return false;
    if (f.arg && (!isT || (T(r).tipo_argomento || 'Non indicato') !== f.arg)) return false;
    return true;
  });
}

const _oraF = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hourCycle: 'h23', weekday: 'short' });
const DOW: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
/** ora (0–23) e giorno della settimana (1 = lunedì) a Roma */
export const oraR = (iso: string) => Number(_oraF.formatToParts(new Date(iso)).find(x => x.type === 'hour')!.value);
export const dowR = (iso: string) => DOW[_oraF.formatToParts(new Date(iso)).find(x => x.type === 'weekday')!.value];

const unaAlGiorno = (l: RecAgg[]) => { const m = new Map<string, RecAgg>(); for (const x of l) if (x.campo !== 'nuovo') m.set(`${x.contatto_id}|${giorno(x.at)}`, x); return [...m.values()]; };

export function contesto(d: Dataset, ora = new Date(), f: Filtri = {}): Ctx {
  const m = new Map<string, RecEvento>(); const email = new Set<number>(); const motivo = new Map<number, string>();
  for (const e of d.eventi) {
    if (e.tipo === 'stato' && e.dati?.sla_stadio) m.set(`${e.pratica_id}|${e.dati.sla_stadio}`, e);
    else if (e.tipo === 'email_inviata') email.add(e.pratica_id);
    else if (e.tipo === 'chiusa' && e.testo) motivo.set(e.pratica_id, e.testo);
  }
  return { ora, f, email, motivo, slaEv: (id, s) => m.get(`${id}|${s}`) };
}

/** Valore di un KPI: conteggio (o percentuale) e righe del numeratore. La pagina di dettaglio mostra esattamente queste righe. */
export function valuta(def: Def, d: Dataset, f: Filtri = {}, ora = new Date()) {
  const c = contesto(d, ora, f);
  const b = base(def, d, f);
  const righe = b.filter(r => def.num(r, c));
  const den = def.den ? b.filter(r => def.den!(r, c)).length : null;
  return { n: righe.length, den, pct: den == null ? null : den ? Math.round((righe.length / den) * 100) : null, righe };
}


/** Link alla pagina di dettaglio con i filtri nell'URL. */
export function linkAnalisi(baseUrl: string, id: string, da: string, a: string, f: Filtri = {}) {
  const q = new URLSearchParams({ kpi: id, da, a, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string> });
  return `${baseUrl}/analisi?${q.toString()}`;
}
