import { useNavigate, useParams } from 'react-router-dom';
import DettaglioPratica from '../centralino/Pratica';
import { ANALISI } from '../lib/centralino/testiDirezione';
import { BASE } from './comuni';
import { indietro } from './scroll';

/** /direzione/centralino/scheda/:id — pratica completa (storia, email, note, offerta) in sola lettura, con «Indietro» all'elenco. */
export default function SchedaDirezione() {
  const { id } = useParams();
  const nav = useNavigate();
  return (
    <div className="dz-pag dz-scheda">
      <button type="button" className="ct-indietro btn-link" onClick={() => indietro(nav as (to: string | number) => void, BASE)}>{ANALISI.indietro.it}</button>
      <DettaglioPratica key={id} />
    </div>
  );
}
