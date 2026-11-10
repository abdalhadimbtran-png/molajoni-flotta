import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtEuro } from '../lib/format';
import { Errore, useLoad } from '../ui';
import { useCtx } from '../centralino/ShellCentralino';
import { datiPeriodo } from '../centralino/Direzione';
import { useAdesso, useAggiornamento, useConfig } from '../centralino/comune';
import { Scheletro } from '../centralino/Scheletro';
import { nomeStadio } from '../centralino/componenti';
import KpiTrasferimenti from '../centralino/KpiTrasferimenti';
import { calcolaKpi, durata } from '../lib/centralino/kpi';
import { kpi, linkAnalisi, valuta, type RecPratica } from '../lib/centralino/registro';
import { CANALI, NOME_TIPO, STATI_CLIENTE, nomeCanale, type StatoCliente } from '../lib/centralino/tipi';
import { inizioGiornoRoma, testoResiduo } from '../lib/centralino/sla';
import { giorniTra, heatmap, intervallo, perCommerciale, piuGiorni, precedente, primaRisposta, slaPerPasso, trend, valore, type Periodo } from '../lib/direzione/analisi';
import { BASE, Barre, Cella, Delta, Info, Kpi, Sezione, oggiRoma } from './comuni';
import { Feed } from './Feed';
import ReportDirezione from './ReportDirezione';
import Digest from './Digest';

const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const PASSI = [['coordinatore', 'Inviato al coordinatore'], ['tecnico', 'Tecnico individuato'], ['cliente', 'Cliente informato'], ['avviso', 'Tecnico avvisato']] as const;
const SEZ = [['volumi', 'Volumi'], ['servizio', 'Servizio'], ['offerte', 'Offerte'], ['trasferimenti', 'Trasferimenti'], ['qualita', 'Qualità'], ['registro', 'Registro di Jennifer'], ['movimenti', 'Movimenti']] as const;

async function carica90(da: string) {
  const { data, error } = await supabase.from('pratiche').select('created_at').gte('created_at', inizioGiornoRoma(da)).limit(10000);
  if (error) throw error; return (data ?? []) as { created_at: string }[];
}

/** /direzione/centralino: tutto quello che succede al centralino, con periodo e confronto. Sola lettura. */
export default function CentralinoDirezione() {
  const ctx = useCtx();
  const ora = useAdesso();
  const { config } = useConfig();
  const [per, setPer] = useState<Periodo>('settimana');
  const [cust, setCust] = useState({ da: piuGiorni(oggiRoma(), -6), a: oggiRoma() });
  const [giorniTrend, setGiorniTrend] = useState<30 | 90>(30);
  const [da, a] = useMemo(() => intervallo(per, new Date(), cust), [per, cust]);
  const [pda, pa] = useMemo(() => precedente(da, a), [da, a]);
  const oggi = oggiRoma(), da90 = piuGiorni(oggi, -89);
  const { data, errore, reload } = useLoad(async () => {
    const [d, p, t] = await Promise.all([datiPeriodo(da, a), datiPeriodo(pda, pa), carica90(da90)]);
    return { d, p, t };
  }, [da, a, pda, pa, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r, 60000);
  const d = data?.d, p = data?.p;
  const k = useMemo(() => (d ? calcolaKpi(d.pratiche, d.eventi) : null), [d]);
  const kp = useMemo(() => (p ? calcolaKpi(p.pratiche, p.eventi) : null), [p]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!d || !p || !k || !kp || !config || !data) return <Scheletro tessere={8} righe={10} />;

  const L = (id: string, f = {}) => linkAnalisi(BASE, id, da, a, f);
  const cnt = (rec: RecPratica[], fn: (x: RecPratica) => boolean) => rec.filter(fn).length;
  const hm = heatmap(d.pratiche);
  const tr = trend(data.t, piuGiorni(oggi, -(giorniTrend - 1)), oggi);
  const trMax = Math.max(1, ...tr.map(x => x.n));
  const pr = primaRisposta(d.pratiche, d.eventi), prp = primaRisposta(p.pratiche, p.eventi);
  const spp = slaPerPasso(d.eventi), sppP = slaPerPasso(p.eventi);
  const comm = perCommerciale(d.trasf, ora);
  const fl = (t: string) => config.flussi.find(f => f.tipo === t);
  const scadute = (valuta(kpi('in_ritardo')!, d, {}, ora).righe as RecPratica[]).sort((x, y) => (x.sla_scadenza ?? '').localeCompare(y.sla_scadenza ?? ''));
  const piccole = d.pratiche.filter(x => x.tipo === 'offerta_piccola'), grandi = d.pratiche.filter(x => x.tipo === 'offerta_grande');
  const giorni = [...Array(Math.min(62, giorniTra(da, a))).keys()].map(i => piuGiorni(a, -i));
  const tipi = Object.keys(NOME_TIPO);

  return (
    <div className="dz-pag">
      <div className="page-hero"><div><h1>Centralino</h1><p className="sub">Tutto quello che succede, in sola lettura · confronto con {pda === pa ? pda.split('-').reverse().join('/') : `${pda.split('-').reverse().join('/')} – ${pa.split('-').reverse().join('/')}`}</p></div>
        <div className="dz-azioni"><ReportDirezione d={d} p={p} da={da} a={a} pda={pda} pa={pa} /><Digest /></div></div>

      <div className="dz-barra-per">
        <div className="segmented" role="group" aria-label="Periodo">
          {([['oggi', 'Oggi'], ['settimana', 'Settimana'], ['mese', 'Mese'], ['personalizzato', 'Personalizzato']] as const).map(([v, l]) => <button key={v} className={per === v ? 'on' : ''} onClick={() => setPer(v)}>{l}</button>)}
        </div>
        {per === 'personalizzato' && <span className="dz-date"><input type="date" aria-label="Dal" value={cust.da} max={oggi} onChange={e => setCust({ ...cust, da: e.target.value })} />–<input type="date" aria-label="Al" value={cust.a} max={oggi} onChange={e => setCust({ ...cust, a: e.target.value })} /></span>}
        <nav className="dz-ancore" aria-label="Sezioni">{SEZ.map(([id, l]) => <a key={id} href={`#${id}`}>{l}</a>)}</nav>
      </div>

      <div className="kpis dz-kpis">
        <Kpi id="pratiche" titolo="Contatti" d={d} prev={p} da={da} a={a} />
        <Kpi id="aperte" d={d} da={da} a={a} />
        <Kpi id="in_ritardo" titolo="Scadute adesso" d={d} da={da} a={a} rossoSe />
        <Kpi id="sla" d={d} prev={p} da={da} a={a} soglia={80} />
        <Kpi id="cliente1h" d={d} prev={p} da={da} a={a} soglia={80} />
        <Kpi id="offerte60" d={d} prev={p} da={da} a={a} soglia={80} />
        <Kpi id="trasf_in_tempo" d={d} prev={p} da={da} a={a} soglia={80} />
        <Kpi id="comm_scaduti" d={d} da={da} a={a} rossoSe />
      </div>

      <Sezione id="volumi" titolo="Volumi" sub="Quanti contatti, da dove e per cosa">
        <div className="dz-g4">
          <div className="dz-card"><h3>Per canale</h3><Barre v={CANALI.map(c => ({ l: nomeCanale(c.v), n: k.perCanale[c.v] ?? 0, prec: kp.perCanale[c.v] ?? 0, to: L('pratiche', { canale: c.v }) }))} /></div>
          <div className="dz-card"><h3>Per tipo di richiesta</h3><Barre v={tipi.map(t => ({ l: NOME_TIPO[t as 'manutenzione'], n: k.perTipo[t] ?? 0, prec: kp.perTipo[t] ?? 0, to: L('pratiche', { tipo: t }) }))} /></div>
          <div className="dz-card"><h3>Stato del cliente <span className="sub">solo clienti</span></h3><Barre v={(Object.keys(STATI_CLIENTE) as StatoCliente[]).map(s => ({ l: STATI_CLIENTE[s][1], n: k.perStatoCliente[s] ?? 0, prec: kp.perStatoCliente[s] ?? 0, to: L('pratiche', { stato: s }) }))} /></div>
        </div>
        <div className="dz-g2">
          <div className="dz-card"><h3>Quando arrivano i contatti <span className="sub">giorno × ora, ora di Roma</span></h3>
            <div className="dz-heat" style={{ gridTemplateColumns: `36px repeat(${hm.ore.length}, minmax(0, 1fr))` }}>
              <span />{hm.ore.map(h => <span key={h} className="dz-hh">{h}</span>)}
              {GIORNI.map((g, i) => [<span key={g} className="dz-hd">{g}</span>, ...hm.ore.map(h => {
                const n = hm.m[i][h];
                return n ? <Link key={`${g}${h}`} to={L('pratiche', { dow: String(i + 1), ora: String(h) })} className="dz-hc" style={{ ['--a' as string]: String(0.12 + 0.88 * (n / Math.max(1, hm.max))) }} title={`${g} ${h}:00–${h}:59 · ${n} contatti`}><span>{n}</span></Link>
                  : <span key={`${g}${h}`} className="dz-hc vuota" title={`${g} ${h}:00 · nessun contatto`} />;
              })])}
            </div></div>
          <div className="dz-card"><h3>Andamento <span className="sub">contatti al giorno</span>
            <span className="segmented dz-mini">{([30, 90] as const).map(n => <button key={n} className={giorniTrend === n ? 'on' : ''} onClick={() => setGiorniTrend(n)}>{n} giorni</button>)}</span></h3>
            <div className="dz-trend" role="img" aria-label={`Contatti al giorno negli ultimi ${giorniTrend} giorni`}>
              {tr.map(x => <Link key={x.g} to={linkAnalisi(BASE, 'pratiche', x.g, x.g)} className={`dz-col ${x.g >= da && x.g <= a ? 'sel' : ''}`} title={`${x.g.split('-').reverse().join('/')}: ${x.n}`}><i style={{ height: `${(x.n / trMax) * 100}%` }} /></Link>)}
            </div>
            <div className="dz-trend-ax"><span>{tr[0]?.g.split('-').reverse().slice(0, 2).join('/')}</span><span>max {trMax}</span><span>oggi</span></div></div>
        </div>
      </Sezione>

      <Sezione id="servizio" titolo="Servizio" sub="Promesse al cliente mantenute e tempi di lavoro">
        <div className="kpis dz-kpis">
          <Kpi id="sla" d={d} prev={p} da={da} a={a} soglia={80} />
          <Kpi id="urgenti_giornata" d={d} prev={p} da={da} a={a} soglia={90} />
          <Kpi id="sla_mancati" d={d} prev={p} da={da} a={a} buono="giu" />
          <div className="kpi dz-kpi"><div className="dz-kpi-top"><span className="lbl">Prima risposta (media)</span>
            <Info def={{ id: 'pr', titolo: 'Prima risposta', spiegazione: 'Media dei minuti tra la chiamata e il primo passo fatto, sulle pratiche del periodo che hanno almeno un passo.', fonte: 'pratiche', num: () => true }} /></div>
            <div className="num">{durata(pr.media)}</div><div className="sub">su {pr.n} pratiche · <Delta att={pr.media} prec={prp.media} buono="giu" /></div></div>
        </div>
        <div className="dz-g2">
          <div className="dz-card"><h3>SLA rispettati per tipo</h3>
            <table className="ct-tab dz-tab"><thead><tr><th>Tipo</th><th className="num">Pratiche</th><th className="num">SLA ok</th><th className="num">vs prec.</th></tr></thead><tbody>
              {tipi.filter(t => k.perTipo[t]).map(t => { const x = valuta(kpi('sla')!, d, { tipo: t }), y = valuta(kpi('sla')!, p, { tipo: t }); return (
                <tr key={t}><td>{NOME_TIPO[t as 'manutenzione']}</td><td className="num"><Cella id="pratiche" d={d} da={da} a={a} f={{ tipo: t }} /></td><td className="num"><Cella id="sla" d={d} da={da} a={a} f={{ tipo: t }} pct /></td><td className="num"><Delta att={x.pct} prec={y.pct} punti /></td></tr>); })}
            </tbody></table>{!k.totale && <p className="ct-vuoto">Nessun dato nel periodo.</p>}</div>
          <div className="dz-card"><h3>Per passo <span className="sub">interventi e sopralluoghi</span></h3>
            <table className="ct-tab dz-tab"><thead><tr><th>Passo</th><th className="num">Fatti</th><th className="num">Entro SLA</th><th className="num">Tempo medio</th><th className="num">vs prec.</th></tr></thead><tbody>
              {PASSI.map(([s, l]) => <tr key={s}><td>{l}</td><td className="num">{spp[s]?.n ?? 0}</td><td className="num">{spp[s] ? <Cella id="sla_passo" d={d} da={da} a={a} f={{ passo: s }} pct /> : '—'}</td>
                <td className="num">{durata(k.tempiMedi[s])}</td><td className="num"><Delta att={spp[s]?.pct ?? null} prec={sppP[s]?.pct ?? null} punti /></td></tr>)}
            </tbody></table><p className="sub">Tempo medio: dal passo precedente all'ingresso nel passo.</p></div>
        </div>
        <div className="dz-card"><h3>Pratiche scadute aperte <span className={`ct-n ${scadute.length ? 'ko' : ''}`}>{scadute.length}</span></h3>
          {scadute.length ? <table className="ct-tab dz-tab"><thead><tr><th>Cliente</th><th>Tipo</th><th>Passo atteso</th><th>Chi</th><th className="num">Ritardo</th></tr></thead><tbody>
            {scadute.slice(0, 15).map(x => <tr key={x.id}><td><Link to={`${BASE}/pratica/${x.id}`}><b>{x.cliente_nome || '—'}</b></Link><div className="sub">{x.numero}</div></td><td>{NOME_TIPO[x.tipo as 'manutenzione']}</td>
              <td>{nomeStadio(fl(x.tipo), (x as RecPratica & { sla_stadio?: string }).sla_stadio ?? x.stato_corrente)}</td><td>{x.assegnato_nome ?? '—'}</td><td className="num ko-t">{testoResiduo(x.sla_scadenza, ora)}</td></tr>)}
          </tbody></table> : <p className="ct-vuoto">Nessuna pratica in ritardo.</p>}
          {scadute.length > 15 && <Link className="sub" to={L('in_ritardo')}>Tutte le {scadute.length} →</Link>}</div>
      </Sezione>

      <Sezione id="offerte" titolo="Offerte" sub="Jennifer le gestisce o le passa a un Tecnico Commerciale">
        <div className="dz-g2">
          <div className="dz-card"><h3>Gestite da Jennifer</h3>
            <div className="kpis dz-kpis dz-k2">
              <Kpi id="off_piccole" titolo="Richieste" d={d} prev={p} da={da} a={a} sub={<>valore {fmtEuro(valore(piccole))}</>} />
              <Kpi id="offerte60" titolo="Inviate entro 60 min" d={d} prev={p} da={da} a={a} soglia={80} />
              <Kpi id="off_piccole_inviate" titolo="Inviate" d={d} prev={p} da={da} a={a} sub={<>valore {fmtEuro(valore(piccole.filter(x => valuta(kpi('off_piccole_inviate')!, d).righe.includes(x))))}</>} />
            </div></div>
          <div className="dz-card"><h3>Passate al Tecnico Commerciale</h3>
            <div className="kpis dz-kpis dz-k2">
              <Kpi id="off_grandi" titolo="Richieste" d={d} prev={p} da={da} a={a} sub={<>valore {fmtEuro(valore(grandi))}</>} />
              <Kpi id="off_grandi_passate" d={d} prev={p} da={da} a={a} soglia={90} />
              <Kpi id="comm_in_tempo" d={d} prev={p} da={da} a={a} soglia={80} />
              <Kpi id="comm_scaduti" d={d} da={da} a={a} rossoSe />
            </div>
            <table className="ct-tab dz-tab"><thead><tr><th>Commerciale</th><th className="num">Richiami</th><th className="num">Entro 2 ore</th><th className="num">Scaduti</th></tr></thead><tbody>
              {Object.entries(comm).sort((x, y) => y[1].tot - x[1].tot).map(([n, x]) => <tr key={n}><td>{n}</td><td className="num">{x.tot}</td>
                <td className="num"><Cella id="comm_in_tempo" d={d} da={da} a={a} f={{ dest: n }} pct /></td><td className={`num ${x.scaduti ? 'ko-t' : ''}`}><Cella id="comm_scaduti" d={d} da={da} a={a} f={{ dest: n }} /></td></tr>)}
            </tbody></table>{!Object.keys(comm).length && <p className="ct-vuoto">Nessun richiamo dei commerciali nel periodo.</p>}</div>
        </div>
      </Sezione>

      <Sezione id="trasferimenti" titolo="Trasferimenti" sub="Chiamate per un responsabile: richiami ed email di riepilogo">
        <KpiTrasferimenti d={d} da={da} a={a} base={BASE} />
      </Sezione>

      <Sezione id="qualita" titolo="Qualità dei dati" sub="Tracciabilità e completezza delle pratiche">
        <div className="kpis dz-kpis">
          <Kpi id="qual_email" d={d} prev={p} da={da} a={a} soglia={80} />
          <Kpi id="annullate_motivo" d={d} prev={p} da={da} a={a} soglia={100} sub={<>{cnt(d.pratiche, x => x.esito === 'annullata')} annullate</>} />
          <Kpi id="senza_contatti" d={d} prev={p} da={da} a={a} buono="giu" />
          <Kpi id="reg_anagrafica" titolo="Anagrafiche aggiornate" d={d} prev={p} da={da} a={a} buono="neutro" />
          <Kpi id="trasf_email_cli" d={d} prev={p} da={da} a={a} soglia={90} />
        </div>
      </Sezione>

      <Sezione id="registro" titolo="Registro di Jennifer" sub="Per giorno, calcolato dalle pratiche (nessun doppio inserimento)">
        <div className="dz-card dz-scroll">
          <table className="ct-tab dz-tab"><thead><tr><th>Giorno</th>{['reg_telefonate', 'reg_whatsapp', 'reg_email', 'reg_tablet', 'reg_wa_offerte', 'reg_cliente', 'reg_anagrafica', 'reg_info', 'reg_chiuse'].map(id => <th key={id} className="num">{kpi(id)!.titolo} <Info def={kpi(id)!} /></th>)}</tr></thead>
            <tbody>{giorni.map(g => <tr key={g}><td>{new Date(`${g}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: '2-digit' })}</td>
              {['reg_telefonate', 'reg_whatsapp', 'reg_email', 'reg_tablet', 'reg_wa_offerte', 'reg_cliente', 'reg_anagrafica', 'reg_info', 'reg_chiuse'].map(id => <td key={id} className="num"><Cella id={id} d={d} da={da} a={a} f={{ giorno: g }} /></td>)}</tr>)}</tbody>
            <tfoot><tr><th>Totale</th>{['reg_telefonate', 'reg_whatsapp', 'reg_email', 'reg_tablet', 'reg_wa_offerte', 'reg_cliente', 'reg_anagrafica', 'reg_info', 'reg_chiuse'].map(id => <th key={id} className="num"><Cella id={id} d={d} da={da} a={a} /></th>)}</tr></tfoot>
          </table></div>
      </Sezione>

      <Sezione id="movimenti" titolo="Movimenti" sub="Chi ha fatto cosa, e quando · in diretta · clic per la pratica (sola lettura, senza appunti privati)">
        <Feed eventi={d.eventi.slice(0, 60)} config={config} />
      </Sezione>
    </div>
  );
}
