import { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { fmtOra } from '../lib/format';
import { Errore, useLoad } from '../ui';
import { useCtx } from '../centralino/ShellCentralino';
import { datiPeriodo } from '../centralino/Direzione';
import { useAggiornamento, useConfig } from '../centralino/comune';
import { Scheletro } from '../centralino/Scheletro';
import { piuGiorni } from '../lib/direzione/analisi';
import { giornoRoma } from '../lib/centralino/sla';
import { BASE, Kpi, Sezione, oggiRoma } from './comuni';
import { Feed } from './Feed';

/** /direzione: la giornata a colpo d'occhio. Dati degli ultimi 30 giorni (per i richiami ancora aperti), numeri del giorno con filtro «giorno». */
export default function Panoramica() {
  const ctx = useCtx();
  const { config } = useConfig();
  const oggi = oggiRoma(), da = piuGiorni(oggi, -29);
  const { data, errore, reload } = useLoad(() => datiPeriodo(da, oggi), [da, oggi, ctx.versione]);
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r);
  const eventiOggi = useMemo(() => (data?.eventi ?? []).filter(e => giornoRoma(e.at) === oggi), [data, oggi]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !config) return <Scheletro tessere={6} righe={8} />;
  const f = { giorno: oggi };
  const ora = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="dz-pag">
      <div className="page-hero"><div><h1>Panoramica</h1><p className="sub">Oggi, {ora} · sola lettura · si aggiorna da solo</p></div>
        <Link className="btn" to={BASE}>Analisi del centralino</Link></div>

      <Sezione id="oggi" titolo="Centralino oggi" sub="Clic su un numero per l'elenco completo">
        <div className="kpis dz-kpis">
          <Kpi id="pratiche" titolo="Contatti oggi" d={data} da={da} a={oggi} f={f} />
          <Kpi id="aperte" titolo="Pratiche aperte" d={data} da={da} a={oggi} />
          <Kpi id="in_ritardo" titolo="Scadute" d={data} da={da} a={oggi} rossoSe />
          <Kpi id="comm_scaduti" d={data} da={da} a={oggi} rossoSe sub="ultimi 30 giorni" />
          <Kpi id="sla" titolo="SLA rispettati oggi" d={data} da={da} a={oggi} f={f} soglia={80} />
          <Kpi id="cliente1h" d={data} da={da} a={oggi} f={f} soglia={80} />
        </div>
      </Sezione>

      <Sezione id="feed" titolo="Ultimi movimenti" sub="In diretta: chi ha fatto cosa, e quando">
        <Feed eventi={eventiOggi.slice(0, 25)} config={config} />
        {eventiOggi.length > 25 && <Link to={`${BASE}#movimenti`} className="sub">Tutti i movimenti →</Link>}
      </Sezione>

      <div className="dz-prox">
        {['Flotta', 'Personale', 'Formazione', 'Interventi'].map(x => <div key={x} className="dz-prox-c"><b>{x}</b><span className="sub">Prossimamente</span></div>)}
      </div>
      <p className="sub dz-agg">Aggiornato alle {fmtOra(new Date().toISOString())}</p>
    </div>
  );
}
