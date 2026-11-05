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
  const inviate = off.filter(p => oltre(p.stato_corrente, ['offerta', 'followup', 'esito', 'contratto']) || p.esito_offerta != null);
  const accettate = off.filter(p => p.esito_offerta === 'accettata' || p.stato_corrente === 'contratto');
  const contratti = off.filter(p => p.stato_corrente === 'contratto');
  const piccole = pr.filter(p => p.tipo === 'offerta_piccola').map(p => slaEv(p.id, 'offerta')).filter(Boolean);
  const sop = pr.filter(p => p.tipo === 'sopralluogo').map(p => slaEv(p.id, 'eseguito')).filter(Boolean);
  const allarmi = pr.filter(p => p.tipo === 'manutenzione' && p.sottotipo === 'Allarme sonoro attivo' && p.esito !== 'annullata');
  const allarmiOk = allarmi.filter(p => p.sla_rispettato === true || slaEv(p.id, 'eseguito')?.dati?.sla_rispettato === true);
  const allarmiChiusi = allarmi.filter(p => p.sla_rispettato != null || slaEv(p.id, 'eseguito'));
  const valore = (l: PraticaKpi[]) => l.reduce((s, p) => s + Number(p.importo_stimato ?? 0), 0);

  return {
    totale: pr.length,
    aperte: pr.filter(p => p.esito === 'aperta').length,
    chiuse: chiuse.length,
    perCanale: conta(pr, p => p.canale),
    perTipo: conta(pr, p => p.tipo),
    slaPct: pct(conSla.filter(p => p.sla_rispettato).length, conSla.length),
    tempiMedi: Object.fromEntries(Object.entries(tempi).map(([k, v]) => [k, Math.round(v.tot / v.n)])),
    offerte60Pct: pct(piccole.filter(e => e!.dati.sla_rispettato === true).length, piccole.length),
    sopralluoghi2ggPct: pct(sop.filter(e => e!.dati.sla_rispettato === true).length, sop.length),
    allarmiPct: pct(allarmiOk.length, allarmiChiusi.length),
    perStatoCliente: conta(pr, p => p.stato_cliente ?? 'nuovo'),
    funnelPerStato: Object.fromEntries(['nuovo', 'ex_cliente', 'attivo'].map(k => {
      const o = off.filter(p => (p.stato_cliente ?? 'nuovo') === k);
      return [k, { richieste: o.length, inviate: o.filter(p => inviate.includes(p)).length, accettate: o.filter(p => accettate.includes(p)).length, valore: valore(o) }];
    })),
    funnel: {
      richieste: off.length, inviate: inviate.length, accettate: accettate.length, contratti: contratti.length,
      conversionePct: pct(accettate.length, inviate.length),
      valoreRichieste: valore(off), valoreAccettate: valore(accettate),
    },
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

export interface TrasfKpi { destinatario_nome: string; esito: string; modalita?: string; richiamo_scadenza: string | null; richiamato_at: string | null; email_riepilogo_at?: string | null; email_non_disponibile?: string | null }
/** Trasferimenti: per destinatario, % risposti, % richiamati entro la scadenza, % con email di riepilogo. */
export function calcolaTrasf(l: TrasfKpi[], ora = new Date()) {
  const trasferite = l.filter(t => (t.modalita ?? 'trasferita') === 'trasferita');
  const richiami = l.filter(t => t.richiamo_scadenza);
  const fatti = richiami.filter(t => t.richiamato_at);
  const inTempo = fatti.filter(t => new Date(t.richiamato_at!) <= new Date(t.richiamo_scadenza!));
  const dest: Record<string, { tot: number; risposti: number; richiami: number; inTempo: number; aperti: number }> = {};
  for (const t of l) {
    const d = dest[t.destinatario_nome] ??= { tot: 0, risposti: 0, richiami: 0, inTempo: 0, aperti: 0 };
    d.tot++; if (t.esito === 'risposto') d.risposti++;
    if (t.richiamo_scadenza) { d.richiami++; if (t.richiamato_at && new Date(t.richiamato_at) <= new Date(t.richiamo_scadenza)) d.inTempo++; if (!t.richiamato_at) d.aperti++; }
  }
  return {
    totale: l.length, rispostiPct: pct(trasferite.filter(t => t.esito === 'risposto').length, trasferite.length),
    richiamatiInTempoPct: pct(inTempo.length, richiami.filter(t => t.richiamato_at || new Date(t.richiamo_scadenza!) < ora).length),
    aperti: richiami.filter(t => !t.richiamato_at).length, scaduti: richiami.filter(t => !t.richiamato_at && new Date(t.richiamo_scadenza!) < ora).length,
    emailPct: pct(l.filter(t => t.email_riepilogo_at).length, l.length), senzaEmail: l.filter(t => !t.email_riepilogo_at && !t.email_non_disponibile).length,
    perDestinatario: dest,
  };
}
