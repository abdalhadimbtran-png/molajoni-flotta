import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtEuro } from '../lib/format';
import { Errore, useLoad } from '../ui';
import { useCtx } from '../centralino/ShellCentralino';
import { datiPeriodo } from '../centralino/Direzione';
import { tutteLeRighe, useAdesso, useAggiornamento, useConfig } from '../centralino/comune';
import { Scheletro } from '../centralino/Scheletro';
import { calcolaKpi } from '../lib/centralino/kpi';
import { kpi, linkAnalisi, valuta, type RecPratica } from '../lib/centralino/registro';
import { CANALI, NOME_TIPO, STATI_CLIENTE, nomeCanale, type StatoCliente } from '../lib/centralino/tipi';
import { inizioGiornoRoma } from '../lib/centralino/sla';
import { giorniTra, heatmap, intervallo, piuGiorni, precedente, trend, valore, type Periodo } from '../lib/direzione/analisi';
import { BASE, Barre, Cella, Info, Kpi, Sezione, oggiRoma } from './comuni';
import { Feed } from './Feed';
import ReportDirezione from './ReportDirezione';
import Digest from './Digest';

const GIORNI = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const SEZ = [['volumi', 'Volumi'], ['offerte', 'Offerte'], ['qualita', 'Qualità'], ['registro', 'Registro di Jennifer'], ['movimenti', 'Movimenti']] as const;

async function carica90(da: string) {
  // a blocchi: l'API restituisce al massimo 1000 righe per richiesta; fatture/fornitori non sono pratiche
  return tutteLeRighe<{ created_at: string }>((x, y) => supabase.from('pratiche').select('id,created_at').not('tipo', 'in', '(amministrazione,fornitori)')
    .gte('created_at', inizioGiornoRoma(da)).order('id').range(x, y), 20000);
}

/** /direzione/centralino: tutto quello che succede al centralino, con periodo e confronto. Sola lettura. */
export default function CentralinoDirezione() {
  const ctx = useCtx();
  useAdesso(); // aggiorna la pagina ogni minuto
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
        <Kpi id="off_piccole" titolo="Offerte Jennifer" d={d} prev={p} da={da} a={a} />
        <Kpi id="offerte60" titolo="Offerte entro 60 min" d={d} prev={p} da={da} a={a} soglia={80} />
        <Kpi id="off_grandi" titolo="Offerte al Commerciale" d={d} prev={p} da={da} a={a} />
        <Kpi id="da_seguire" d={d} da={da} a={a} />
        <Kpi id="in_ritardo" titolo="Offerte in ritardo" d={d} da={da} a={a} rossoSe />
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
            </div>
</div>
        </div>
      </Sezione>

      <Sezione id="qualita" titolo="Qualità dei dati" sub="Tracciabilità e completezza delle pratiche">
        <div className="kpis dz-kpis">
          <Kpi id="qual_email" d={d} prev={p} da={da} a={a} soglia={80} />
          <Kpi id="annullate_motivo" d={d} prev={p} da={da} a={a} soglia={100} sub={<>{cnt(d.pratiche, x => x.esito === 'annullata')} annullate</>} />
          <Kpi id="senza_contatti" d={d} prev={p} da={da} a={a} buono="giu" />
          <Kpi id="reg_anagrafica" titolo="Anagrafiche aggiornate" d={d} prev={p} da={da} a={a} buono="neutro" />
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
