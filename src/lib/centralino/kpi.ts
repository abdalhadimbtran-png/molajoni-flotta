/** KPI del centralino calcolati nel browser dalle pratiche e dagli eventi del periodo. */
export interface PraticaKpi {
  id: number; tipo: string; sottotipo: string | null; canale: string; esito: string; esito_offerta: string | null;
  importo_stimato: number | null; sla_rispettato: boolean | null; stato_corrente: string; created_at: string; closed_at: string | null;
  stato_cliente?: string | null;
}
export interface EventoKpi { pratica_id: number; tipo: string; a_stato: string | null; dati: Record<string, unknown>; at: string }

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
const conta = <T,>(l: T[], k: (x: T) => string) => l.reduce<Record<string, number>>((m, x) => { const c = k(x); m[c] = (m[c] ?? 0) + 1; return m; }, {});
const offerta = (t: string) => t === 'offerta_piccola' || t === 'offerta_grande';
const oltre = (stato: string, chiavi: string[]) => chiavi.includes(stato);

export function calcolaKpi(pr: PraticaKpi[], ev: EventoKpi[]) {
  const chiuse = pr.filter(p => p.esito !== 'aperta' && p.esito !== 'annullata');
  const conSla = pr.filter(p => p.sla_rispettato != null);
  const slaEv = (id: number, stadio: string) => ev.find(e => e.pratica_id === id && e.tipo === 'stato' && e.dati?.sla_stadio === stadio);

  // tempi medi per stadio: dalla creazione (o stadio precedente) all'ingresso nello stadio
  const perPratica = new Map<number, EventoKpi[]>();
  ev.filter(e => e.tipo === 'stato' || e.tipo === 'creata').forEach(e => perPratica.set(e.pratica_id, [...(perPratica.get(e.pratica_id) ?? []), e]));
  const tempi: Record<string, { tot: number; n: number }> = {};
  for (const l of perPratica.values()) {
    l.sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 1; i < l.length; i++) {
      const k = l[i].a_stato ?? '?';
      const m = (new Date(l[i].at).getTime() - new Date(l[i - 1].at).getTime()) / 60000;
      tempi[k] = { tot: (tempi[k]?.tot ?? 0) + m, n: (tempi[k]?.n ?? 0) + 1 };
    }
  }

  const off = pr.filter(p => offerta(p.tipo));
  const inviate = off.filter(p => oltre(p.stato_corrente, ['offerta', 'email_cliente', 'riepilogo']) || p.esito === 'chiusa_ok');
  const piccole = pr.filter(p => p.tipo === 'offerta_piccola').map(p => slaEv(p.id, 'offerta')).filter(Boolean);
  const int1 = pr.filter(p => p.tipo === 'manutenzione').map(p => slaEv(p.id, 'cliente')).filter(Boolean);
  const sop1 = pr.filter(p => p.tipo === 'sopralluogo').map(p => slaEv(p.id, 'cliente')).filter(Boolean);
  const valore = (l: PraticaKpi[]): number => l.reduce((s, p) => s + Number(p.importo_stimato ?? 0), 0);

  return {
    totale: pr.length,
    aperte: pr.filter(p => p.esito === 'aperta').length,
    chiuse: chiuse.length,
    perCanale: conta(pr, p => p.canale),
    perTipo: conta(pr, p => p.tipo),
    slaPct: pct(conSla.filter(p => p.sla_rispettato).length, conSla.length),
    tempiMedi: Object.fromEntries(Object.entries(tempi).map(([k, v]) => [k, Math.round(v.tot / v.n)])),
    offerte60Pct: pct(piccole.filter(e => e!.dati.sla_rispettato === true).length, piccole.length),
    interventi1hPct: pct(int1.filter(e => e!.dati.sla_rispettato === true).length, int1.length),
    sopralluoghi1hPct: pct(sop1.filter(e => e!.dati.sla_rispettato === true).length, sop1.length),
    perStatoCliente: conta(pr, p => p.stato_cliente ?? 'nuovo'),
    funnelPerStato: Object.fromEntries(['nuovo', 'ex_cliente', 'attivo'].map(k => {
      const o = off.filter(p => (p.stato_cliente ?? 'nuovo') === k);
      return [k, { richieste: o.length, inviate: o.filter(p => inviate.includes(p)).length, valore: valore(o) }];
    })),
    funnel: { richieste: off.length, inviate: inviate.length, valoreRichieste: valore(off), valoreInviate: valore(inviate) },
  };
}
export type Kpi = ReturnType<typeof calcolaKpi>;

/** «45 min», «3 h 20», «2 g». */
export const durata = (min: number | null | undefined) => {
  if (min == null) return '—';
  if (min < 60) return `${min} min`;
  if (min < 1440) return `${Math.floor(min / 60)} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`;
  return `${Math.round(min / 144) / 10} g`;
};

export interface TrasfKpi {
  destinatario_nome: string; esito: string; modalita?: string; richiamo_scadenza: string | null; richiamato_at: string | null; at?: string;
  email_riepilogo_at?: string | null; email_non_disponibile?: string | null; email_referente_inviata_at?: string | null; email_cliente_inviata_at?: string | null;
  tipo_argomento?: string | null; stato_cliente?: string | null;
}
export interface Gruppo { tot: number; risposti: number; trasferite: number; richiami: number; inTempo: number; fatti: number; minuti: number; aperti: number }
const nuovoG = (): Gruppo => ({ tot: 0, risposti: 0, trasferite: 0, richiami: 0, inTempo: 0, fatti: 0, minuti: 0, aperti: 0 });
/** Trasferimenti: per destinatario / argomento / stato cliente, % risposte, % richiamati in tempo, tempo medio di richiamo, email. */
export function calcolaTrasf(l: TrasfKpi[], ora = new Date()) {
  const richiami = l.filter(t => t.richiamo_scadenza);
  const fatti = richiami.filter(t => t.richiamato_at);
  const inTempo = fatti.filter(t => new Date(t.richiamato_at!) <= new Date(t.richiamo_scadenza!));
  const aggiungi = (m: Record<string, Gruppo>, k: string, t: TrasfKpi) => {
    const d = m[k] ??= nuovoG();
    d.tot++;
    if ((t.modalita ?? 'trasferita') === 'trasferita') { d.trasferite++; }
    if (t.richiamo_scadenza) {
      d.richiami++;
      if (t.richiamato_at) { d.fatti++; d.minuti += Math.max(0, (new Date(t.richiamato_at).getTime() - new Date(t.at ?? t.richiamato_at).getTime()) / 60000); if (new Date(t.richiamato_at) <= new Date(t.richiamo_scadenza)) d.inTempo++; }
      else d.aperti++;
    }
  };
  const dest: Record<string, Gruppo> = {}, arg: Record<string, Gruppo> = {}, stato: Record<string, Gruppo> = {};
  for (const t of l) { aggiungi(dest, t.destinatario_nome, t); aggiungi(arg, t.tipo_argomento || 'Non indicato', t); aggiungi(stato, t.stato_cliente || 'non indicato', t); }
  const conCliente = (t: TrasfKpi) => !!(t.email_cliente_inviata_at || t.email_riepilogo_at);
  return {
    totale: l.length,
    richiamatiInTempoPct: pct(inTempo.length, richiami.filter(t => t.richiamato_at || new Date(t.richiamo_scadenza!) < ora).length),
    aperti: richiami.filter(t => !t.richiamato_at).length, scaduti: richiami.filter(t => !t.richiamato_at && new Date(t.richiamo_scadenza!) < ora).length,
    emailPct: pct(l.filter(conCliente).length, l.length), senzaEmail: l.filter(t => !conCliente(t) && !t.email_non_disponibile).length,
    referentePct: pct(l.filter(t => t.email_referente_inviata_at).length, l.length), clientePct: pct(l.filter(conCliente).length, l.length),
    tempoMedioRichiamo: fatti.length ? Math.round(fatti.reduce((s, t) => s + (new Date(t.richiamato_at!).getTime() - new Date(t.at ?? t.richiamato_at!).getTime()) / 60000, 0) / fatti.length) : null,
    perDestinatario: dest, perArgomento: arg, perStatoCliente: stato,
  };
}
export const pctG = (a: number, b: number) => pct(a, b);
