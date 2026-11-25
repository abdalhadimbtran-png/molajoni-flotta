import { Link } from 'react-router-dom';
import { fmtOra } from '../lib/format';
import type { DatiPeriodo } from '../centralino/Direzione';
import { BASE } from './comuni';
import { MOVIMENTI } from '../lib/centralino/testiDirezione';

type Cfg = { flussi: { tipo: string; stadi: { key: string; nome: string }[] }[] };
const TIPO: Record<string, string> = Object.fromEntries(Object.entries(MOVIMENTI).map(([k, v]) => [k, v.it]));

/** Movimenti (storia delle pratiche): mai appunti privati — non sono nella storia. */
export function Feed({ eventi, config }: { eventi: DatiPeriodo['eventi']; config: Cfg }) {
  const nome = (k: string) => config.flussi.flatMap(f => f.stadi).find(s => s.key === k)?.nome ?? MOVIMENTI.altro.it;
  if (!eventi.length) return <p className="ct-vuoto">{MOVIMENTI.nessuno.it}</p>;
  return (
    <ul className="dz-feed">{eventi.map(e => (
      <li key={e.id} className={e.tipo === 'sla_scaduto' ? 'ko' : ''}>
        <time>{fmtOra(e.at)}</time>
        <span><b>{e.autore_nome ?? MOVIMENTI.sistema.it}</b> {e.tipo === 'stato' ? <>→ {nome(e.a_stato ?? '')}</> : TIPO[e.tipo] ?? MOVIMENTI.altro.it}
          {e.pratiche && <> · <Link to={`${BASE}/pratica/${e.pratica_id}`}>{e.pratiche.cliente_nome} <span className="sub">{e.pratiche.numero}</span></Link></>}</span>
      </li>))}
    </ul>
  );
}
