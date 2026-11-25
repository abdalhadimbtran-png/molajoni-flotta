/** Ciclo di vita delle offerte (tabella pratiche_offerta, migrazione 0099): stato, scadenze, KPI, «da aggiornare oggi». Logica pura. */
import { giornoRoma } from './sla';

export type EsitoOfferta = 'da_inviare' | 'in_attesa' | 'accettata' | 'non_accettata' | 'annullata';
export type StatoOfferta = EsitoOfferta | 'in_ritardo' | 'scaduta';
export interface Offerta {
  pratica_id: number; gestione: 'jennifer' | 'collega'; gestita_da: string; arrivata_il: string; scadenza: string; inviata_il: string | null;
  esito: EsitoOfferta; esito_il: string | null; motivo: string | null; motivo_nota: string | null; motivo_ritardo: string | null;
  numero_offerta_adhoc: string | null; aggiornata_il: string; aggiornata_da: string | null;
  pratiche?: { numero: string; cliente_nome: string | null; descrizione: string | null; canale: string; importo_stimato: number | null; tipo: string } | null;
}

export const APERTI: EsitoOfferta[] = ['da_inviare', 'in_attesa'];
export const aperta = (o: Pick<Offerta, 'esito'>) => APERTI.includes(o.esito);

/** Stato da mostrare: non inviata e oltre la scadenza = «In ritardo» (Jennifer) o «Scaduta» (colleghi, solo informativo). */
export function statoOfferta(o: Pick<Offerta, 'esito' | 'inviata_il' | 'scadenza'> & { gestione?: Offerta['gestione'] }, ora = new Date()): StatoOfferta {
  if (o.esito === 'da_inviare' && !o.inviata_il && new Date(o.scadenza) < ora) return o.gestione === 'collega' ? 'scaduta' : 'in_ritardo';
  return o.esito;
}
export const COLORE_STATO: Record<StatoOfferta, string> = {
  da_inviare: 'grigio', in_ritardo: 'rosso', scaduta: 'ambra', in_attesa: 'blu', accettata: 'verde', non_accettata: 'arancio', annullata: 'scuro',
};

export const inTempo = (o: Pick<Offerta, 'inviata_il' | 'scadenza'>) => !!o.inviata_il && new Date(o.inviata_il) <= new Date(o.scadenza);
export const inRitardo = (o: Pick<Offerta, 'inviata_il' | 'scadenza'>) => !!o.inviata_il && new Date(o.inviata_il) > new Date(o.scadenza);

/** Impostazione `offerte_aggiornamento_obbligatorio` (default spento, decisione 25/11/2026): se accesa, ogni offerta aperta va aggiornata ogni giorno. */
export const aggiornamentoObbligatorio = (imp: Record<string, unknown> | undefined) => imp?.offerte_aggiornamento_obbligatorio === true || imp?.offerte_aggiornamento_obbligatorio === 'true';
/** Offerta aperta non aggiornata oggi (ora di Roma). Conta solo con l'impostazione accesa. */
export function daAggiornareOggi(o: Pick<Offerta, 'esito' | 'aggiornata_il'>, ora = new Date()) {
  return aperta(o) && giornoRoma(o.aggiornata_il) < giornoRoma(ora);
}

// ── scadenze (stesse regole di public.offerta_scadenza) ────────────────────────────────────────
const isoGiorno = (d: Date) => d.toISOString().slice(0, 10);
export function prossimoLavorativo(g: string, festivi: Set<string>) {
  const d = new Date(`${g}T12:00:00Z`);
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6 || festivi.has(isoGiorno(d)));
  return isoGiorno(d);
}
/** Giorno di scadenza (Roma) per un'offerta passata ai colleghi: 2 giorni lavorativi dopo l'arrivo, stessa ora. */
export function giornoScadenzaCollega(arrivata: string | Date, festivi: Set<string> = new Set()) {
  return prossimoLavorativo(prossimoLavorativo(giornoRoma(arrivata), festivi), festivi);
}

// ── KPI ────────────────────────────────────────────────────────────────────────────────────────
export interface KpiOfferte { arrivate: number; in_tempo: number; in_ritardo: number; da_inviare: number; da_inviare_scadute: number; inviate: number; accettate: number; non_accettate: number; annullate: number }
export function kpiOfferte(l: Offerta[], ora = new Date()): KpiOfferte {
  const k: KpiOfferte = { arrivate: l.length, in_tempo: 0, in_ritardo: 0, da_inviare: 0, da_inviare_scadute: 0, inviate: 0, accettate: 0, non_accettate: 0, annullate: 0 };
  for (const o of l) {
    if (inTempo(o)) k.in_tempo++;
    if (inRitardo(o)) k.in_ritardo++;
    if (o.inviata_il) k.inviate++;
    if (!o.inviata_il && o.esito === 'da_inviare') { k.da_inviare++; if (new Date(o.scadenza) < ora) k.da_inviare_scadute++; }
    if (o.esito === 'accettata') k.accettate++;
    if (o.esito === 'non_accettata') k.non_accettate++;
    if (o.esito === 'annullata') k.annullate++;
  }
  return k;
}
export const pct = (n: number, d: number) => (d ? Math.round((100 * n) / d) : null);

/** Durata leggibile: «45 min», «3,5 ore», «1,5 giorni». */
export function durataTesto(ms: number | null) {
  if (ms == null || !isFinite(ms)) return '—';
  const s = ms / 1000;
  if (s < 3600) return `${Math.max(0, Math.round(s / 60))} min`;
  const f = (x: number) => x.toLocaleString('it-IT', { maximumFractionDigits: 1 });
  if (s < 86400) return `${f(s / 3600)} ore`;
  return `${f(s / 86400)} giorni`;
}
export function tempoInvio(o: Pick<Offerta, 'arrivata_il' | 'inviata_il'>) {
  return o.inviata_il ? new Date(o.inviata_il).getTime() - new Date(o.arrivata_il).getTime() : null;
}

export interface RigaPersona { persona: string; arrivate: number; in_tempo: number; inviate: number; accettate: number; medio: number | null }
export function perPersona(l: Offerta[]): RigaPersona[] {
  const m = new Map<string, RigaPersona & { somma: number }>();
  for (const o of l) {
    const r = m.get(o.gestita_da) ?? { persona: o.gestita_da, arrivate: 0, in_tempo: 0, inviate: 0, accettate: 0, medio: null, somma: 0 };
    r.arrivate++; if (inTempo(o)) r.in_tempo++; if (o.esito === 'accettata') r.accettate++;
    const t = tempoInvio(o); if (t != null) { r.inviate++; r.somma += t; }
    m.set(o.gestita_da, r);
  }
  return [...m.values()].map(({ somma, ...r }) => ({ ...r, medio: r.inviate ? somma / r.inviate : null })).sort((a, b) => b.arrivate - a.arrivate || a.persona.localeCompare(b.persona));
}

export function conta<T>(l: T[], f: (x: T) => string | null | undefined) {
  const m = new Map<string, number>();
  for (const x of l) { const k = f(x); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m.entries()].map(([l, n]) => ({ l, n })).sort((a, b) => b.n - a.n);
}

/** Valida un'azione rapida prima di chiamare offerta_aggiorna (stesse regole del database). */
export function erroreAzione(a: { esito?: EsitoOfferta; motivo?: string; motivo_nota?: string; inviata_il?: string; motivo_ritardo?: string }, o: Pick<Offerta, 'inviata_il' | 'scadenza' | 'arrivata_il' | 'motivo_ritardo'> & { gestione?: Offerta['gestione'] }, ora = new Date()): string | null {
  const mia = o.gestione !== 'collega'; // motivo del ritardo obbligatorio solo per le offerte di Jennifer
  if (a.inviata_il) {
    const t = new Date(a.inviata_il);
    if (isNaN(t.getTime())) return 'Data di invio non valida';
    if (t.getTime() > ora.getTime() + 120000) return 'La data di invio non può essere nel futuro';
    if (t < new Date(o.arrivata_il)) return 'L\'invio non può essere prima dell\'arrivo';
    if (mia && t > new Date(o.scadenza) && !(a.motivo_ritardo ?? o.motivo_ritardo ?? '').trim()) return 'Offerta in ritardo: scrivi il motivo del ritardo';
  }
  if (a.esito === 'accettata' && !o.inviata_il && !a.inviata_il) return 'Prima segna l\'offerta come inviata';
  if (a.esito === 'non_accettata' || a.esito === 'annullata') {
    if (!a.motivo) return 'Scegli il motivo';
    if (a.motivo === 'Altro' && !(a.motivo_nota ?? '').trim()) return 'Motivo «Altro»: scrivi una nota';
    if (mia && a.esito === 'annullata' && !o.inviata_il && ora > new Date(o.scadenza) && a.motivo !== 'Non più necessario'
      && !(a.motivo_ritardo ?? o.motivo_ritardo ?? '').trim()) return 'Offerta in ritardo: scrivi il motivo del ritardo';
  }
  return null;
}
