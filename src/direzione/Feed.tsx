import { Link } from 'react-router-dom';
import { fmtOra } from '../lib/format';
import type { DatiPeriodo } from '../centralino/Direzione';
import { BASE } from './comuni';

type Cfg = { flussi: { tipo: string; stadi: { key: string; nome: string }[] }[] };
const TIPO: Record<string, string> = { creata: 'ha aperto la pratica', nota: 'ha aggiunto una nota', email_inviata: 'ha inviato un\'email', chiamata: 'ha registrato una chiamata', assegnata: 'ha assegnato la pratica',
  appuntamento: 'ha fissato l\'appuntamento', allegato: 'ha allegato un file', sla_scaduto: 'scadenza superata', chiusa: 'ha chiuso / annullato', modifica: 'ha modificato i dati' };

/** Movimenti (storia delle pratiche): mai appunti privati — non sono nella storia. */
export function Feed({ eventi, config }: { eventi: DatiPeriodo['eventi']; config: Cfg }) {
  const nome = (k: string) => config.flussi.flatMap(f => f.stadi).find(s => s.key === k)?.nome ?? k;
  if (!eventi.length) return <p className="ct-vuoto">Nessun movimento nel periodo.</p>;
  return (
    <ul className="dz-feed">{eventi.map(e => (
      <li key={e.id} className={e.tipo === 'sla_scaduto' ? 'ko' : ''}>
        <time>{fmtOra(e.at)}</time>
        <span><b>{e.autore_nome ?? 'Sistema'}</b> {e.tipo === 'stato' ? <>→ {nome(e.a_stato ?? '')}</> : TIPO[e.tipo] ?? e.tipo}
          {e.pratiche && <> · <Link to={`${BASE}/pratica/${e.pratica_id}`}>{e.pratiche.cliente_nome} <span className="sub">{e.pratiche.numero}</span></Link></>}</span>
      </li>))}
    </ul>
  );
}
