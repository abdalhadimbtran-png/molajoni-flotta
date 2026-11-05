import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtEuro, fmtOra } from '../lib/format';
import { Errore, useLoad } from '../ui';
import { useT } from '../lib/i18n';
import { NOME_TIPO, STATI_CLIENTE, nomeCanale, type Evento, type Pratica, type StatoCliente, type Trasferimento } from '../lib/centralino/tipi';
import { linkAnalisi } from '../lib/centralino/registro';
import { calcolaKpi, durata } from '../lib/centralino/kpi';
import { Scheletro } from './Scheletro';
import type { Dataset } from '../lib/centralino/registro';
import { Tessera } from './Tessera';
import KpiTrasferimenti from './KpiTrasferimenti';
import { semaforo, testoResiduo } from '../lib/centralino/sla';
import { CAMPI_PRATICA, useAdesso, useAggiornamento, useConfig } from './comune';
import { nomeStadio } from './componenti';
import { trasferimenti } from './Trasferimento';
import { useCtx } from './ShellCentralino';

export interface DatiPeriodo extends Dataset { pratiche: Pratica[]; eventi: (Evento & { pratiche?: { numero: string; cliente_nome: string } | null })[]; aperte: Pratica[]; trasf: Trasferimento[]; chiuse: Pratica[] }

/** Pratiche create nel periodo + chiuse nel periodo + eventi + tutte le aperte + trasferimenti + contatti informativi: base di KPI, dettagli e report. */
export async function datiPeriodo(da: string, a: string): Promise<DatiPeriodo> {
  const fine = `${a}T23:59:59`, ini = `${da}T00:00:00`;
  const [p, e, ap, t, inf, ch, ag] = await Promise.all([
    supabase.from('pratiche').select(CAMPI_PRATICA).gte('created_at', ini).lte('created_at', fine).limit(5000),
    supabase.from('pratiche_eventi').select('*, pratiche(numero,cliente_nome)').gte('at', ini).lte('at', fine).order('at', { ascending: false }).limit(5000),
    supabase.from('pratiche').select(CAMPI_PRATICA).eq('esito', 'aperta').limit(2000),
    supabase.from('chiamate_trasferite').select('*').gte('at', ini).lte('at', fine).order('at', { ascending: false }).limit(5000),
    supabase.from('centralino_chiamate_info').select('*').gte('at', ini).lte('at', fine).limit(5000),
    supabase.from('pratiche').select(CAMPI_PRATICA).gte('closed_at', ini).lte('closed_at', fine).limit(5000),
    supabase.from('clienti_contatti_storia').select('contatto_id,at,campo,a,autore_nome').gte('at', ini).lte('at', fine).neq('campo', 'nuovo').limit(5000),
  ]);
  const err = p.error || e.error || ap.error || t.error || inf.error || ch.error || ag.error; if (err) throw err;
  return { pratiche: (p.data ?? []) as Pratica[], eventi: (e.data ?? []) as DatiPeriodo['eventi'], aperte: (ap.data ?? []) as Pratica[], trasf: (t.data ?? []) as Trasferimento[],
    info: (inf.data ?? []) as Dataset['info'], chiuse: (ch.data ?? []) as Pratica[], agg: (ag.data ?? []) as Dataset['agg'] };
}
const pc = (n: number | null) => (n == null ? '—' : `${n}%`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** /direzione/centralino: monitoraggio in sola lettura. */
export default function Direzione() {
  const ctx = useCtx();
  const ora = useAdesso();
  const { config } = useConfig();
  const [per, setPer] = useState<'oggi' | '7' | '30' | 'mese'>('oggi');
  const [da, a] = useMemo(() => {
    const o = new Date();
    if (per === 'oggi') return [iso(o), iso(o)];
    if (per === 'mese') return [iso(new Date(o.getFullYear(), o.getMonth(), 1)), iso(o)];
    return [iso(new Date(Date.now() - (Number(per) - 1) * 864e5)), iso(o)];
  }, [per]);
  const { data, errore, reload } = useLoad(async () => ({ ...(await datiPeriodo(da, a)), trend: await trasferimenti(new Date(Date.now() - 30 * 864e5).toISOString()) }), [da, a, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r);
  const k = useMemo(() => (data ? calcolaKpi(data.pratiche, data.eventi) : null), [data]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !k || !config) return <Scheletro tessere={6} righe={8} />;
  const fl = (t: string) => config.flussi.find(f => f.tipo === t);
  const scadute = data.aperte.filter(p => semaforo(p.created_at, p.sla_scadenza, ora) === 'rosso').sort((x, y) => (x.sla_scadenza ?? '').localeCompare(y.sla_scadenza ?? ''));
  const stadi = [...new Set(config.flussi.flatMap(f => f.stadi.slice(1).map(s => s.key)))];
  const nomeSt = (key: string) => config.flussi.flatMap(f => f.stadi).find(s => s.key === key)?.nome ?? key;
  const F = k.funnel;
  const maxF = Math.max(1, F.richieste);
  return (
    <div className="ct-dir">
      <div className="page-hero"><div><h1>Monitoraggio centralino</h1><p className="sub">Sola lettura · si aggiorna da solo</p></div>
        <div className="segmented" role="group" aria-label="Periodo">
          {([['oggi', 'Oggi'], ['7', '7 giorni'], ['30', '30 giorni'], ['mese', 'Mese']] as const).map(([v, l]) => <button key={v} className={per === v ? 'on' : ''} onClick={() => setPer(v)}>{l}</button>)}
        </div></div>

      <div className="kpis">
        <Tessera id="pratiche" d={data} da={da} a={a} sub={<>{k.aperte} aperte · {k.chiuse} chiuse</>} />
        <Tessera id="sla" d={data} da={da} a={a} soglia={80} />
        <Tessera id="offerte60" d={data} da={da} a={a} />
        <Tessera id="sopralluoghi2" d={data} da={da} a={a} />
        <Tessera id="allarmi" d={data} da={da} a={a} />
        <Tessera id="in_ritardo" d={data} da={da} a={a} rossoSe />
      </div>
      <KpiTrasferimenti d={data} da={da} a={a} base={ctx.base} trend={data.trend} />

      <div className="ct-dir-g">
        <section className="ct-blocco"><h2>Per canale</h2><Barre v={Object.entries(k.perCanale).map(([x, n]) => [nomeCanale(x), n, linkAnalisi(ctx.base, 'pratiche', da, a, { canale: x })])} /></section>
        <section className="ct-blocco"><h2>Per tipo</h2><Barre v={Object.entries(k.perTipo).map(([x, n]) => [NOME_TIPO[x as 'manutenzione'] ?? x, n, linkAnalisi(ctx.base, 'pratiche', da, a, { tipo: x })])} /></section>
        <section className="ct-blocco"><h2>Per stato del cliente</h2><Barre v={(Object.keys(STATI_CLIENTE) as StatoCliente[]).map(x => [STATI_CLIENTE[x][1], k.perStatoCliente[x] ?? 0, linkAnalisi(ctx.base, 'pratiche', da, a, { stato: x })])} /></section>
        <section className="ct-blocco"><h2>Tempi medi per passo</h2>
          <table className="ct-tab"><tbody>{stadi.filter(s => k.tempiMedi[s] != null).map(s => <tr key={s}><td>{nomeSt(s)}</td><td className="num">{durata(k.tempiMedi[s])}</td></tr>)}</tbody></table>
          {!stadi.some(s => k.tempiMedi[s] != null) && <p className="ct-vuoto">Nessun dato nel periodo.</p>}</section>
      </div>

      <section className="ct-blocco"><h2>Funnel offerte</h2>
        <div className="ct-funnel">
          {([['Richieste', F.richieste, 'off_richieste'], ['Inviate', F.inviate, 'off_inviate'], ['Accettate', F.accettate, 'off_accettate'], ['Contratti', F.contratti, 'off_contratti']] as const).map(([l, n, id]) => (
            <Link key={l} to={linkAnalisi(ctx.base, id, da, a)} className="ct-funnel-r ct-clic"><span>{l}</span><span className="ct-funnel-b"><i style={{ width: `${(n / maxF) * 100}%` }} /></span><b>{n}</b></Link>))}
        </div>
        <p className="sub">Conversione (accettate / inviate): <b>{pc(F.conversionePct)}</b> · Valore richiesto {fmtEuro(F.valoreRichieste)} · accettato {fmtEuro(F.valoreAccettate)}</p>
        <table className="ct-tab"><thead><tr><th>Cliente</th><th>Richieste</th><th>Inviate</th><th>Accettate</th><th>Valore</th></tr></thead>
          <tbody>{(Object.keys(STATI_CLIENTE) as StatoCliente[]).map(s => { const x = k.funnelPerStato[s]; const L = (id: string, n: number) => <Link to={linkAnalisi(ctx.base, id, da, a, { stato: s })}>{n}</Link>; return <tr key={s}><td>{STATI_CLIENTE[s][1]}</td><td>{L('off_richieste', x.richieste)}</td><td>{L('off_inviate', x.inviate)}</td><td>{L('off_accettate', x.accettate)}</td><td>{fmtEuro(x.valore)}</td></tr>; })}</tbody></table>
      </section>

      <div className="ct-dir-g">
        <section className="ct-blocco"><h2>In ritardo adesso <span className="ct-n ko">{scadute.length}</span></h2>
          {scadute.length ? <table className="ct-tab"><thead><tr><th>Pratica</th><th>Passo atteso</th><th>Scaduta</th><th>Chi</th></tr></thead><tbody>
            {scadute.map(p => <tr key={p.id}><td><Link to={`${ctx.base}/pratica/${p.id}`}><b>{p.cliente_nome}</b></Link><div className="sub">{p.numero} · {NOME_TIPO[p.tipo]}</div></td>
              <td>{nomeStadio(fl(p.tipo), p.sla_stadio)}<div className="sub">ora: {nomeStadio(fl(p.tipo), p.stato_corrente)}</div></td><td className="ko-t">{testoResiduo(p.sla_scadenza, ora)}</td><td>{p.assegnato_nome ?? '—'}</td></tr>)}
          </tbody></table> : <p className="ct-vuoto">Nessuna pratica in ritardo.</p>}</section>
      </div>

      <section className="ct-blocco"><h2>Ultimi movimenti</h2>
        <ul className="ct-feed">{data.eventi.slice(0, 40).map(e => (
          <li key={e.id}><span className="sub">{fmtOra(e.at)}</span> <b>{e.autore_nome ?? 'Sistema'}</b> · {e.tipo === 'stato' ? `→ ${nomeSt(e.a_stato ?? '')}` : e.testo ?? e.tipo}
            {e.pratiche && <> · <Link to={`${ctx.base}/pratica/${e.pratica_id}`}>{e.pratiche.cliente_nome} ({e.pratiche.numero})</Link></>}</li>))}</ul>
        {!data.eventi.length && <p className="ct-vuoto">Nessun movimento nel periodo.</p>}
      </section>
    </div>
  );
}

export function Barre({ v }: { v: [string, number, string?][] }) {
  const max = Math.max(1, ...v.map(x => x[1]));
  if (!v.length) return <p className="ct-vuoto">Nessun dato.</p>;
  return <div className="ct-barre">{[...v].sort((a, b) => b[1] - a[1]).map(([l, n, to]) => {
    const r = <><span>{l}</span><span className="ct-funnel-b"><i style={{ width: `${(n / max) * 100}%` }} /></span><b>{n}</b></>;
    return to ? <Link key={l} to={to} className="ct-barra ct-clic">{r}</Link> : <div key={l} className="ct-barra">{r}</div>;
  })}</div>;
}

/** Scheda nella panoramica dell'amministratore. */
export function RiepilogoCentralino() {
  const { t } = useT();
  const { data } = useLoad(async () => {
    const [reg, ap] = await Promise.all([supabase.rpc('centralino_registro_giorno', { p_data: null }), supabase.from('pratiche').select('id,sla_scadenza').eq('esito', 'aperta').limit(2000)]);
    if (reg.error || ap.error) return null;
    const l = (ap.data ?? []) as { sla_scadenza: string | null }[];
    return { oggi: Number((reg.data as { pratiche: number }).pratiche), aperte: l.length, scadute: l.filter(x => x.sla_scadenza && new Date(x.sla_scadenza) < new Date()).length };
  });
  if (!data) return null;
  return (
    <Link to="/direzione/centralino" className={`kpi ${data.scadute ? 'ko' : 'ok'}`}>
      <div className="lbl">{t('Centralino oggi')}</div><div className="num">{data.oggi}</div>
      <div className="sub">{t('contatti oggi · {a} aperte · {s} in ritardo', { a: data.aperte, s: data.scadute })}</div>
    </Link>
  );
}
