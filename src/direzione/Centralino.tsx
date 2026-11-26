import React, { useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Errore, useLoad } from '../ui';
import { useCtx } from '../centralino/ShellCentralino';
import { datiPeriodo } from '../centralino/Direzione';
import { useAdesso, useAggiornamento } from '../centralino/comune';
import { Scheletro } from '../centralino/Scheletro';
import { CANALI, nomeCanale } from '../lib/centralino/tipi';
import { fineGiornoRoma, inizioGiornoRoma } from '../lib/centralino/sla';
import { intervallo, piuGiorni, precedente, type Periodo } from '../lib/direzione/analisi';
import { conta, durataTesto, inRitardo, pct, perPersona, statoOfferta, tempoInvio, type Offerta, type StatoOfferta } from '../lib/centralino/offerte';
import { MOTIVO_NON_SCRITTO, contaDrill, linkDrill, nomeCanaleD, type DatiDrill, type ParDrill } from '../lib/centralino/drill';
import { DIR, KPI_OFFERTE, LEGENDA, SOTTOTIPI_OFFERTA, STATI_OFFERTA, TIPI_RICHIESTA } from '../lib/centralino/testiDirezione';
import { PillStato, caricaOfferte, dataOra } from '../centralino/OfferteComuni';
import { BASE, oggiRoma } from './comuni';
import { useRicordaScroll } from './scroll';
import ReportDirezione from './ReportDirezione';
import Digest from './Digest';

type Chi = 'tutte' | 'jennifer' | 'collega';

/** /direzione/centralino: per il titolare. Prima le OFFERTE (dall'arrivo all'invio, poi la risposta del cliente), poi chiamate e richieste. Sola lettura. */
export default function CentralinoDirezione() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso();
  // filtri nell'URL: tornando indietro dall'elenco di un numero si ritrovano uguali
  const [qs, setQs] = useSearchParams();
  const imposta = (o: Record<string, string>) => { const n = new URLSearchParams(qs); for (const [k, v] of Object.entries(o)) { if (v) n.set(k, v); else n.delete(k); } setQs(n, { replace: true }); };
  const per = (qs.get('per') ?? 'mese') as Periodo;
  const cust = useMemo(() => ({ da: qs.get('dal') ?? piuGiorni(oggiRoma(), -6), a: qs.get('al') ?? oggiRoma() }), [qs]);
  const chi = (qs.get('chi') ?? 'tutte') as Chi;
  const persona = qs.get('persona') ?? '';
  const stato = (qs.get('stato') ?? '') as StatoOfferta | '';
  const setPer = (v: Periodo) => imposta({ per: v === 'mese' ? '' : v });
  const setCust = (c: { da: string; a: string }) => imposta({ dal: c.da, al: c.a });
  const setChi = (v: Chi) => imposta({ chi: v === 'tutte' ? '' : v });
  const setPersona = (v: string) => imposta({ persona: v });
  const setStato = (v: string) => imposta({ stato: v });
  const [da, a] = useMemo(() => intervallo(per, new Date(), cust), [per, cust]);
  const [pda, pa] = useMemo(() => precedente(da, a), [da, a]);
  const oggi = oggiRoma();
  const { data, errore, reload } = useLoad(async () => {
    const [d, p, off] = await Promise.all([datiPeriodo(da, a), datiPeriodo(pda, pa), caricaOfferte({ da: inizioGiornoRoma(da), a: fineGiornoRoma(a) })]);
    return { d, p, off };
  }, [da, a, pda, pa, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r, 60000);
  useRicordaScroll(!!data);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Scheletro tessere={6} righe={10} />;

  const tutte = data.off ?? [];
  const sel = tutte.filter(o => chi === 'tutte' || o.gestione === chi);
  // ogni numero = lunghezza dell'elenco che si apre col clic (stessa funzione: lib/centralino/drill.ts)
  const dd: DatiDrill = { off: data.off, pratiche: data.d.pratiche, chiuse: data.d.chiuse };
  const pc: ParDrill = chi === 'tutte' ? {} : { chi };
  const n = (id: string, p: ParDrill = {}) => contaDrill(id, dd, { ...pc, ...p }, ora);
  const L = (id: string, p: ParDrill = {}) => linkDrill(BASE, id, da, a, { ...pc, ...p });
  const kp = { arrivate: n('of_arrivate'), in_tempo: n('of_in_tempo'), in_ritardo: n('of_in_ritardo'), da_inviare: n('of_da_inviare'), inviate: n('of_inviate'),
    accettate: n('of_accettate'), non_accettate: n('of_non_accettate'), da_inviare_scadute: n('of_da_inviare_scadute') };
  const persone = perPersona(sel);
  const tab = sel.filter(o => (!persona || o.gestita_da === persona) && (!stato || statoOfferta(o, ora) === stato));
  const motiviNon = conta(sel.filter(o => o.esito === 'non_accettata'), o => o.motivo).map(x => ({ ...x, to: L('of_non_accettate', { motivo: x.l }) }));
  const motiviRit = conta(sel.filter(inRitardo), o => o.motivo_ritardo ?? MOTIVO_NON_SCRITTO).map(x => ({ ...x, to: L('of_in_ritardo', { motivo_rit: x.l }) }));
  const canali = conta(sel, o => nomeCanaleD(o.pratiche?.canale)).map(x => ({ ...x, to: L('of_arrivate', { canale: x.l }) }));
  const perc = (n: number, d: number) => { const v = pct(n, d); return v == null ? '—' : `${v}%`; };
  const Lp = (id: string, p: ParDrill = {}) => linkDrill(BASE, id, da, a, p); // richieste: il filtro Jennifer/Colleghi vale solo per le offerte
  const np = (id: string, p: ParDrill = {}) => contaDrill(id, dd, p, ora);
  const giorni: string[] = []; for (let g = da; g <= a && giorni.length < 62; g = piuGiorni(g, 1)) giorni.push(g);
  const perGiorno = giorni.map(g => ({ l: g.split('-').reverse().slice(0, 2).join('/'), n: np('pr_richieste', { giorno: g }), to: Lp('pr_richieste', { giorno: g }) }));

  return (
    <div className="dz-pag dz2">
      <div className="page-hero"><div><h1>{DIR.titolo.it}</h1><p className="sub">{DIR.sottotitolo.it}</p></div>
        <div className="dz-azioni"><ReportDirezione d={data.d} p={data.p} da={da} a={a} pda={pda} pa={pa} /><Digest /></div></div>

      <p className="dz2-def">{DIR.clic_numero.it}</p>
      <Legenda n={g => np('pr_richieste', { gruppo: g })} to={g => Lp('pr_richieste', { gruppo: g })} />

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
            <Numero t={KPI_OFFERTE.arrivate} n={kp.arrivate} to={L('of_arrivate')} extra={<><Link to={linkDrill(BASE, 'of_arrivate', da, a, { chi: 'jennifer' })}>{DIR.jennifer.it} {contaDrill('of_arrivate', dd, { chi: 'jennifer' })}</Link> · <Link to={linkDrill(BASE, 'of_arrivate', da, a, { chi: 'collega' })}>{DIR.colleghi.it} {contaDrill('of_arrivate', dd, { chi: 'collega' })}</Link></>} />
            <Numero t={KPI_OFFERTE.in_tempo} n={kp.in_tempo} to={L('of_in_tempo')} p={perc(kp.in_tempo, kp.arrivate)} liv="ok" />
            <Numero t={KPI_OFFERTE.in_ritardo} n={kp.in_ritardo} to={L('of_in_ritardo')} p={perc(kp.in_ritardo, kp.arrivate)} liv={kp.in_ritardo ? 'ko' : ''} />
            <Numero t={KPI_OFFERTE.da_inviare} n={kp.da_inviare} to={L('of_da_inviare')} p={perc(kp.da_inviare, kp.arrivate)} liv={kp.da_inviare_scadute ? 'warn' : ''}
              extra={kp.da_inviare_scadute ? <Link to={L('of_da_inviare_scadute')}>{DIR.di_cui.it} {kp.da_inviare_scadute} {DIR.oltre_scadenza.it}</Link> : undefined} />
            <Numero t={KPI_OFFERTE.accettate} n={kp.accettate} to={L('of_accettate')} p={perc(kp.accettate, kp.inviate)} liv="ok" />
            <Numero t={KPI_OFFERTE.non_accettate} n={kp.non_accettate} to={L('of_non_accettate')} p={perc(kp.non_accettate, kp.inviate)} />
          </div>

          <div className="dz2-g">
            <div className="dz-card dz2-card dz2-larga"><h3>{DIR.per_persona.it}</h3><p className="dz2-def">{DIR.per_persona.def}</p>
              {persone.length ? <table className="dz2-tab"><thead><tr><th>{DIR.col_persona.it}</th><th className="num">{DIR.col_arrivate.it}</th><th className="num">{DIR.col_in_tempo.it}</th><th className="num">{DIR.col_accettate.it}</th><th className="num">{DIR.col_tempo_medio.it}</th></tr></thead>
                <tbody>{persone.map(x => <tr key={x.persona}><td><b>{x.persona}</b></td><td className="num"><Link className="ct-cifra" to={L('of_arrivate', { persona: x.persona })}>{x.arrivate}</Link></td>
                  <td className="num"><Link className="ct-cifra" to={L('of_in_tempo', { persona: x.persona })}>{x.in_tempo}</Link> <span className="sub">({perc(x.in_tempo, x.arrivate)})</span></td><td className="num"><Link className="ct-cifra" to={L('of_accettate', { persona: x.persona })}>{x.accettate}</Link> <span className="sub">({perc(x.accettate, x.inviate)})</span></td>
                  <td className="num"><Link className="ct-cifra" to={L('of_inviate', { persona: x.persona })}>{durataTesto(x.medio)}</Link></td></tr>)}</tbody></table>
                : <p className="ct-vuoto">{DIR.nessuna.it}</p>}
              <p className="dz2-def">{DIR.col_tempo_medio.it}: {DIR.col_tempo_medio.def}</p></div>
            <Elenco t={DIR.motivi_non} v={motiviNon} />
            <Elenco t={DIR.motivi_rit} v={motiviRit} />
            <Elenco t={DIR.canale} v={canali} />
          </div>

          <div className="dz-card dz2-card">
            <div className="dz2-tab-h"><div><h3>{DIR.tabella.it} <Link className="sub ct-cifra" to={L('of_arrivate', { persona, stato })}>({tab.length})</Link></h3><p className="dz2-def">{DIR.tabella.def}</p></div>
              <div className="dz2-filtri">
                <select aria-label={DIR.col_gestita.it} value={persona} onChange={e => setPersona(e.target.value)}><option value="">{DIR.col_gestita.it}: tutte le persone</option>{persone.map(x => <option key={x.persona}>{x.persona}</option>)}</select>
                <select aria-label={DIR.col_stato.it} value={stato} onChange={e => setStato(e.target.value as StatoOfferta | '')}><option value="">{DIR.col_stato.it}: tutti gli stati</option>{(Object.keys(STATI_OFFERTA) as StatoOfferta[]).map(s => <option key={s} value={s}>{STATI_OFFERTA[s].it}</option>)}</select>
              </div></div>
            {tab.length ? <div className="dz2-scroll"><table className="dz2-tab dz2-tutte">
              <thead><tr><th>{DIR.col_cliente.it}</th><th>{DIR.col_richiesta.it}</th><th>{DIR.col_arrivata.it}</th><th>{DIR.col_gestita.it}</th><th>{DIR.col_inviata.it}</th><th>{DIR.col_stato.it}</th><th>{DIR.col_motivo.it}</th></tr></thead>
              <tbody>{tab.map((o: Offerta) => <tr key={o.pratica_id} className="ct-clic" tabIndex={0} onClick={() => nav(`${BASE}/scheda/${o.pratica_id}`)} onKeyDown={e => { if (e.key === 'Enter') nav(`${BASE}/scheda/${o.pratica_id}`); }}>
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
            <Numero t={DIR.richieste} n={np('pr_richieste')} to={Lp('pr_richieste')} />
            <Numero t={DIR.richieste_chiuse} n={np('pr_chiuse')} to={Lp('pr_chiuse')} />
          </div>
          <Elenco t={DIR.per_tipo} v={(Object.keys(TIPI_RICHIESTA) as (keyof typeof TIPI_RICHIESTA)[]).map(g => ({ l: TIPI_RICHIESTA[g].it, n: np('pr_richieste', { gruppo: g }), to: Lp('pr_richieste', { gruppo: g }) })).filter(x => x.n).sort((x, y) => y.n - x.n)} />
          <Elenco t={DIR.per_canale} v={CANALI.map(c => ({ l: nomeCanale(c.v), n: np('pr_richieste', { canale: c.v }), to: Lp('pr_richieste', { canale: c.v }) })).filter(x => x.n).sort((x, y) => y.n - x.n)} />
        </div>
        {giorni.length > 1 && <Colonne t={DIR.per_giorno} v={perGiorno} />}
      </section>
    </div>
  );
}

/** Legenda sempre visibile (si può chiudere): i tipi di richiesta con la definizione di una riga. */
function Legenda({ n, to }: { n: (g: string) => number; to: (g: string) => string }) {
  return (
    <details className="dz-card dz2-card dz2-legenda">
      <summary><b>{LEGENDA.titolo.it}</b></summary>
      <p className="dz2-def">{LEGENDA.sotto.it}</p>
      <dl>{(Object.keys(TIPI_RICHIESTA) as (keyof typeof TIPI_RICHIESTA)[]).map(g => <div key={g}><dt><Link to={to(g)}>{TIPI_RICHIESTA[g].it} <span className="ct-cifra">{n(g)}</span></Link></dt><dd>{TIPI_RICHIESTA[g].def}
        {g === 'offerta' && <ul>{Object.values(SOTTOTIPI_OFFERTA).map(x => <li key={x.it}><b>{x.it}</b>: {x.def}</li>)}</ul>}</dd></div>)}</dl>
    </details>
  );
}

/** Numero grande + etichetta + definizione sempre visibile (niente tooltip). */
export function Numero({ t, n, p, extra, liv = '', to }: { t: { it: string; def?: string }; n: number; p?: string; extra?: React.ReactNode; liv?: string; to?: string }) {
  return (
    <div className={`dz2-num ${liv}`}>
      <div className="dz2-num-l">{t.it}</div>
      <div className="dz2-num-v">{to ? <Link className="dz2-num-a" to={to} aria-label={`${t.it}: ${n}, apri l'elenco`}>{n}</Link> : n}{p && <span className="dz2-num-p">{p}</span>}</div>
      {extra && <div className="dz2-num-x">{extra}</div>}
      {t.def && <p className="dz2-def">{t.def}</p>}
    </div>
  );
}

/** Elenco con barre: etichetta, barra, numero. */
function Elenco({ t, v }: { t: { it: string; def?: string }; v: { l: string; n: number; to?: string }[] }) {
  const max = Math.max(1, ...v.map(x => x.n));
  return (
    <div className="dz-card dz2-card"><h3>{t.it}</h3>{t.def && <p className="dz2-def">{t.def}</p>}
      {v.length ? <ul className="dz2-barre">{v.map(x => { const c = <><span className="dz2-bl">{x.l}</span><span className="dz2-bt"><i style={{ width: `${(x.n / max) * 100}%` }} /></span><b>{x.n}</b></>; return <li key={x.l}>{x.to ? <Link className="dz2-bar-a" to={x.to}>{c}</Link> : c}</li>; })}</ul>
        : <p className="ct-vuoto">Nessun dato.</p>}
    </div>
  );
}

/** Colonne per giorno: clic su una colonna → elenco di quel giorno. */
function Colonne({ t, v }: { t: { it: string; def?: string }; v: { l: string; n: number; to: string }[] }) {
  const max = Math.max(1, ...v.map(x => x.n));
  return (
    <div className="dz-card dz2-card dz2-col"><h3>{t.it}</h3>{t.def && <p className="dz2-def">{t.def}</p>}
      <div className="dz2-colonne">{v.map(x => <Link key={x.l} to={x.to} className="dz2-c" title={`${x.l}: ${x.n}`}><b>{x.n || ''}</b><i style={{ height: `${(x.n / max) * 100}%` }} /><span>{x.l}</span></Link>)}</div>
    </div>
  );
}
