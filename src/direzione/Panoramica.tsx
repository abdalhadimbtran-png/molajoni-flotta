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
import { BASE, Sezione, oggiRoma } from './comuni';
import { Numero } from './Centralino';
import { caricaOfferte } from '../centralino/OfferteComuni';
import { kpiOfferte } from '../lib/centralino/offerte';
import { DIR, KPI_OFFERTE, PAN } from '../lib/centralino/testiDirezione';
import { Feed } from './Feed';

/** /direzione: la giornata a colpo d'occhio. Dati degli ultimi 30 giorni (per i richiami ancora aperti), numeri del giorno con filtro «giorno». */
export default function Panoramica() {
  const ctx = useCtx();
  const { config } = useConfig();
  const oggi = oggiRoma(), da = piuGiorni(oggi, -29);
  const { data: tutto, errore, reload } = useLoad(async () => { const [d, off] = await Promise.all([datiPeriodo(da, oggi), caricaOfferte({ aperte: true }).catch(() => null)]); return { d, off }; }, [da, oggi, ctx.versione]);
  const data = tutto?.d;
  const r = useCallback(() => { reload(); }, [reload]); useAggiornamento(r);
  const eventiOggi = useMemo(() => (data?.eventi ?? []).filter(e => giornoRoma(e.at) === oggi), [data, oggi]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !config) return <Scheletro tessere={6} righe={8} />;
  const ora = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <div className="dz-pag">
      <div className="page-hero"><div><h1>{PAN.titolo.it}</h1><p className="sub">{ora} · {PAN.sotto.it}</p></div>
        <Link className="btn" to={BASE}>{DIR.titolo.it}</Link></div>

      <Sezione id="oggi" titolo={PAN.oggi.it} sub={PAN.oggi.def}>
        <div className="dz2-kpis">
          <Numero t={DIR.richieste} n={data.pratiche.filter(x => giornoRoma(x.created_at) === oggi).length} extra={PAN.oggi.it} />
          <Numero t={KPI_OFFERTE.arrivate} n={data.pratiche.filter(x => x.tipo.startsWith('offerta') && giornoRoma(x.created_at) === oggi).length} extra={PAN.oggi.it} />
          {tutto?.off && (() => { const k = kpiOfferte(tutto.off, new Date()); return <>
            <Numero t={PAN.da_inviare} n={k.da_inviare} liv={k.da_inviare_scadute ? 'warn' : ''}
              extra={k.da_inviare_scadute ? `${DIR.di_cui.it} ${k.da_inviare_scadute} ${DIR.oltre_scadenza.it}` : undefined} />
            <Numero t={PAN.in_attesa} n={tutto.off.filter(o => o.esito === 'in_attesa').length} />
          </>; })()}
        </div>
      </Sezione>

      <Sezione id="feed" titolo={PAN.movimenti.it} sub={PAN.movimenti.def}>
        <Feed eventi={eventiOggi.slice(0, 25)} config={config} />
        {eventiOggi.length > 25 && <Link to={`${BASE}#movimenti`} className="sub">{PAN.tutti_mov.it}</Link>}
      </Sezione>

      <div className="dz-prox">
        {['Flotta', 'Personale', 'Formazione', 'Interventi'].map(x => <div key={x} className="dz-prox-c"><b>{x}</b><span className="sub">{PAN.prossimamente.it}</span></div>)}
      </div>
      <p className="sub dz-agg">{PAN.aggiornato.it} {fmtOra(new Date().toISOString())}</p>
    </div>
  );
}
