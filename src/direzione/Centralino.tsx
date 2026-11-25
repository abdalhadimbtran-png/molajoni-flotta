import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Errore, useLoad } from '../ui';
import { useCtx } from '../centralino/ShellCentralino';
import { datiPeriodo } from '../centralino/Direzione';
import { useAdesso, useAggiornamento } from '../centralino/comune';
import { Scheletro } from '../centralino/Scheletro';
import { calcolaKpi } from '../lib/centralino/kpi';
import { CANALI, nomeCanale } from '../lib/centralino/tipi';
import { fineGiornoRoma, inizioGiornoRoma } from '../lib/centralino/sla';
import { intervallo, piuGiorni, precedente, type Periodo } from '../lib/direzione/analisi';
import { conta, durataTesto, inRitardo, kpiOfferte, pct, perPersona, statoOfferta, tempoInvio, type Offerta, type StatoOfferta } from '../lib/centralino/offerte';
import { DIR, KPI_OFFERTE, LEGENDA, SOTTOTIPI_OFFERTA, STATI_OFFERTA, TIPI_RICHIESTA, gruppoTipo } from '../lib/centralino/testiDirezione';
import { PillStato, caricaOfferte, dataOra } from '../centralino/OfferteComuni';
import { oggiRoma } from './comuni';
import ReportDirezione from './ReportDirezione';
import Digest from './Digest';

type Chi = 'tutte' | 'jennifer' | 'collega';

/** /direzione/centralino: per il titolare. Prima le OFFERTE (dall'arrivo all'invio, poi la risposta del cliente), poi chiamate e richieste. Sola lettura. */
export default function CentralinoDirezione() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso();
  const [per, setPer] = useState<Periodo>('mese');
  const [cust, setCust] = useState({ da: piuGiorni(oggiRoma(), -6), a: oggiRoma() });
  const [chi, setChi] = useState<Chi>('tutte');
  const [persona, setPersona] = useState('');
  const [stato, setStato] = useState<StatoOfferta | ''>('');
  const [da, a] = useMemo(() => intervallo(per, new Date(), cust), [per, cust]);
  const [pda, pa] = useMemo(() => precedente(da, a), [da, a]);
  const oggi = oggiRoma();
  const { data, errore, reload } = useLoad(async () => {
    const [d, p, off] = await Promise.all([datiPeriodo(da, a), datiPeriodo(pda, pa), caricaOfferte({ da: inizioGiornoRoma(da), a: fineGiornoRoma(a) })]);
    return { d, p, off };
  }, [da, a, pda, pa, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r, 60000);
  const k = useMemo(() => (data ? calcolaKpi(data.d.pratiche, data.d.eventi) : null), [data]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !k) return <Scheletro tessere={6} righe={10} />;

  const tutte = data.off ?? [];
  const sel = tutte.filter(o => chi === 'tutte' || o.gestione === chi);
  const kp = kpiOfferte(sel, ora);
  const persone = perPersona(sel);
  const tab = sel.filter(o => (!persona || o.gestita_da === persona) && (!stato || statoOfferta(o, ora) === stato));
  const motiviNon = conta(sel.filter(o => o.esito === 'non_accettata'), o => o.motivo);
  const motiviRit = conta(sel.filter(inRitardo), o => o.motivo_ritardo ?? 'Motivo non scritto');
  const canali = conta(sel, o => nomeCanale(o.pratiche?.canale ?? 'altro'));
  const perc = (n: number, d: number) => { const v = pct(n, d); return v == null ? '—' : `${v}%`; };
  const registrate = data.d.pratiche.filter(x => x.registrata_dopo).length;

  return (
    <div className="dz-pag dz2">
      <div className="page-hero"><div><h1>{DIR.titolo.it}</h1><p className="sub">{DIR.sottotitolo.it}</p></div>
        <div className="dz-azioni"><ReportDirezione d={data.d} p={data.p} da={da} a={a} pda={pda} pa={pa} /><Digest /></div></div>

      <Legenda />

      <div className="dz-barra-per">
        <span className="dz2-lbl">{DIR.periodo.it}</span>
        <div className="segmented" role="group" aria-label={DIR.periodo.it}>
          {([['oggi', 'Oggi'], ['settimana', 'Settimana'], ['mese', 'Mese'], ['personalizzato', 'Dal… al…']] as const).map(([v, l]) => <button key={v} className={per === v ? 'on' : ''} onClick={() => setPer(v)}>{l}</button>)}
        </div>
        {per === 'personalizzato' && <span className="dz-date"><input type="date" aria-label="Dal" value={cust.da} max={oggi} onChange={e => setCust({ ...cust, da: e.target.value })} />–<input type="date" aria-label="Al" value={cust.a} max={oggi} onChange={e => setCust({ ...cust, a: e.target.value })} /></span>}
        <span className="sub">{da.split('-').reverse().join('/')}{da !== a ? ` – ${a.split('-').reverse().join('/')}` : ''}</span>
      </div>

      <section id="offerte" className="dz2-sez">
        <header><div><h2>{DIR.sez_offerte.it}</h2><p className="dz2-def">{DIR.sez_offerte.def}</p></div>
          <div className="segmented" role="group" aria-label="Chi gestisce">
            {([['tutte', DIR.tutte.it], ['jennifer', DIR.jennifer.it], ['collega', DIR.colleghi.it]] as const).map(([v, l]) => <button key={v} className={chi === v ? 'on' : ''} onClick={() => setChi(v)}>{l}</button>)}
          </div></header>
        {data.off === null ? <Banner s="warn">{DIR.db_mancante.it}</Banner> : <>
          <div className="dz2-kpis">
            <Numero t={KPI_OFFERTE.arrivate} n={kp.arrivate} extra={`${DIR.jennifer.it} ${tutte.filter(o => o.gestione === 'jennifer').length} · ${DIR.colleghi.it} ${tutte.filter(o => o.gestione === 'collega').length}`} />
            <Numero t={KPI_OFFERTE.in_tempo} n={kp.in_tempo} p={perc(kp.in_tempo, kp.arrivate)} liv="ok" />
            <Numero t={KPI_OFFERTE.in_ritardo} n={kp.in_ritardo} p={perc(kp.in_ritardo, kp.arrivate)} liv={kp.in_ritardo ? 'ko' : ''} />
            <Numero t={KPI_OFFERTE.da_inviare} n={kp.da_inviare} p={perc(kp.da_inviare, kp.arrivate)} liv={kp.da_inviare_scadute ? 'warn' : ''}
              extra={kp.da_inviare_scadute ? `${DIR.di_cui.it} ${kp.da_inviare_scadute} ${DIR.oltre_scadenza.it}` : undefined} />
            <Numero t={KPI_OFFERTE.accettate} n={kp.accettate} p={perc(kp.accettate, kp.inviate)} liv="ok" />
            <Numero t={KPI_OFFERTE.non_accettate} n={kp.non_accettate} p={perc(kp.non_accettate, kp.inviate)} />
          </div>

          <div className="dz2-g">
            <div className="dz-card dz2-card dz2-larga"><h3>{DIR.per_persona.it}</h3><p className="dz2-def">{DIR.per_persona.def}</p>
              {persone.length ? <table className="dz2-tab"><thead><tr><th>{DIR.col_persona.it}</th><th className="num">{DIR.col_arrivate.it}</th><th className="num">{DIR.col_in_tempo.it}</th><th className="num">{DIR.col_accettate.it}</th><th className="num">{DIR.col_tempo_medio.it}</th></tr></thead>
                <tbody>{persone.map(x => <tr key={x.persona} className="ct-clic" onClick={() => setPersona(x.persona)}><td><b>{x.persona}</b></td><td className="num">{x.arrivate}</td>
                  <td className="num">{x.in_tempo} <span className="sub">({perc(x.in_tempo, x.arrivate)})</span></td><td className="num">{x.accettate} <span className="sub">({perc(x.accettate, x.inviate)})</span></td><td className="num">{durataTesto(x.medio)}</td></tr>)}</tbody></table>
                : <p className="ct-vuoto">{DIR.nessuna.it}</p>}
              <p className="dz2-def">{DIR.col_tempo_medio.it}: {DIR.col_tempo_medio.def}</p></div>
            <Elenco t={DIR.motivi_non} v={motiviNon} />
            <Elenco t={DIR.motivi_rit} v={motiviRit} />
            <Elenco t={DIR.canale} v={canali} />
          </div>

          <div className="dz-card dz2-card">
            <div className="dz2-tab-h"><div><h3>{DIR.tabella.it} <span className="sub">({tab.length})</span></h3><p className="dz2-def">{DIR.tabella.def}</p></div>
              <div className="dz2-filtri">
                <select aria-label={DIR.col_gestita.it} value={persona} onChange={e => setPersona(e.target.value)}><option value="">{DIR.col_gestita.it}: tutte le persone</option>{persone.map(x => <option key={x.persona}>{x.persona}</option>)}</select>
                <select aria-label={DIR.col_stato.it} value={stato} onChange={e => setStato(e.target.value as StatoOfferta | '')}><option value="">{DIR.col_stato.it}: tutti gli stati</option>{(Object.keys(STATI_OFFERTA) as StatoOfferta[]).map(s => <option key={s} value={s}>{STATI_OFFERTA[s].it}</option>)}</select>
              </div></div>
            {tab.length ? <div className="dz2-scroll"><table className="dz2-tab dz2-tutte">
              <thead><tr><th>{DIR.col_cliente.it}</th><th>{DIR.col_richiesta.it}</th><th>{DIR.col_arrivata.it}</th><th>{DIR.col_gestita.it}</th><th>{DIR.col_inviata.it}</th><th>{DIR.col_stato.it}</th><th>{DIR.col_motivo.it}</th></tr></thead>
              <tbody>{tab.map((o: Offerta) => <tr key={o.pratica_id} className="ct-clic" tabIndex={0} onClick={() => nav(`${ctx.base}/pratica/${o.pratica_id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`${ctx.base}/pratica/${o.pratica_id}`); }}>
                <td><b>{o.pratiche?.cliente_nome ?? '—'}</b></td><td className="dz2-desc">{o.pratiche?.descrizione ?? '—'}</td>
                <td className="of-nowrap">{dataOra(o.arrivata_il)}</td><td>{o.gestita_da}</td>
                <td className="of-nowrap">{o.inviata_il ? <>{dataOra(o.inviata_il)} <span className="sub">· dopo {durataTesto(tempoInvio(o))}</span></> : '—'}</td>
                <td><PillStato o={o} ora={ora} /></td>
                <td>{[o.motivo && `${o.motivo}${o.motivo_nota ? ` – ${o.motivo_nota}` : ''}`, o.motivo_ritardo && `Ritardo: ${o.motivo_ritardo}`].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody>
            </table></div> : <p className="ct-vuoto">{DIR.nessuna.it}</p>}
          </div>
        </>}
      </section>

      <section id="chiamate" className="dz2-sez">
        <header><div><h2>{DIR.sez_chiamate.it}</h2><p className="dz2-def">{DIR.sez_chiamate.def}</p></div></header>
        <div className="dz2-g">
          <div className="dz2-kpis dz2-k2">
            <Numero t={DIR.richieste} n={data.d.pratiche.length} />
            <Numero t={DIR.registrate_dopo} n={registrate} />
          </div>
          <Elenco t={DIR.per_tipo} v={(Object.keys(TIPI_RICHIESTA) as (keyof typeof TIPI_RICHIESTA)[]).map(g => ({ l: TIPI_RICHIESTA[g].it, n: Object.entries(k.perTipo).filter(([t]) => gruppoTipo(t) === g).reduce((s, [, n]) => s + (n ?? 0), 0) })).filter(x => x.n).sort((x, y) => y.n - x.n)} />
          <Elenco t={DIR.per_canale} v={CANALI.map(c => ({ l: nomeCanale(c.v), n: k.perCanale[c.v] ?? 0 })).filter(x => x.n).sort((x, y) => y.n - x.n)} />
        </div>
      </section>
    </div>
  );
}

/** Legenda sempre visibile (si può chiudere): i tipi di richiesta con la definizione di una riga. */
function Legenda() {
  return (
    <details className="dz-card dz2-card dz2-legenda" open>
      <summary><b>{LEGENDA.titolo.it}</b></summary>
      <p className="dz2-def">{LEGENDA.sotto.it}</p>
      <dl>{(Object.keys(TIPI_RICHIESTA) as (keyof typeof TIPI_RICHIESTA)[]).map(g => <div key={g}><dt>{TIPI_RICHIESTA[g].it}</dt><dd>{TIPI_RICHIESTA[g].def}
        {g === 'offerta' && <ul>{Object.values(SOTTOTIPI_OFFERTA).map(x => <li key={x.it}><b>{x.it}</b>: {x.def}</li>)}</ul>}</dd></div>)}</dl>
    </details>
  );
}

/** Numero grande + etichetta + definizione sempre visibile (niente tooltip). */
export function Numero({ t, n, p, extra, liv = '' }: { t: { it: string; def?: string }; n: number; p?: string; extra?: string; liv?: string }) {
  return (
    <div className={`dz2-num ${liv}`}>
      <div className="dz2-num-l">{t.it}</div>
      <div className="dz2-num-v">{n}{p && <span className="dz2-num-p">{p}</span>}</div>
      {extra && <div className="dz2-num-x">{extra}</div>}
      {t.def && <p className="dz2-def">{t.def}</p>}
    </div>
  );
}

/** Elenco con barre: etichetta, barra, numero. */
function Elenco({ t, v }: { t: { it: string; def?: string }; v: { l: string; n: number }[] }) {
  const max = Math.max(1, ...v.map(x => x.n));
  return (
    <div className="dz-card dz2-card"><h3>{t.it}</h3>{t.def && <p className="dz2-def">{t.def}</p>}
      {v.length ? <ul className="dz2-barre">{v.map(x => <li key={x.l}><span className="dz2-bl">{x.l}</span><span className="dz2-bt"><i style={{ width: `${(x.n / max) * 100}%` }} /></span><b>{x.n}</b></li>)}</ul>
        : <p className="ct-vuoto">Nessun dato.</p>}
    </div>
  );
}
