import { useNavigate } from 'react-router-dom';
import { Caricamento, Errore, useLoad } from '../ui';
import { ModaleAssegna } from './ModaleRegistra';
import { caricaTutto } from './comune';

/** Assegna un corso a più dipendenti (dopo una sessione di gruppo). */
export default function Registra() {
  const nav = useNavigate();
  const { data, errore, reload } = useLoad(caricaTutto);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  return (
    <>
      <div className="page-hero"><div><h1>Assegna un corso</h1><p className="sub">Scegli il corso, spunta chi l'ha fatto, metti la data e (se ce l'hai) la foto dell'attestato.</p></div></div>
      <ModaleAssegna corsi={data.corsi} dipendenti={data.dip} titolo="Assegna corso" onClose={() => nav('/formazione')} onFatto={() => nav('/formazione/dipendenti')} />
    </>
  );
}
