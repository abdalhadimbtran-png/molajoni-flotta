import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { fmtData } from '../lib/format';
import { Caricamento, Errore, Pill, useLoad } from '../ui';
import { STATO_CORSO, type RigaStato, type StatoCorso } from './comune';

interface Dati { validi: number; in_scadenza: number; scaduti: number; mancanti: number; lista: RigaStato[] }

function quando(r: RigaStato) {
  if (r.stato === 'mancante') return 'Mai fatto (obbligatorio)';
  if (r.giorni == null) return '—';
  if (r.giorni < 0) return `Scaduto da ${-r.giorni} ${r.giorni === -1 ? 'giorno' : 'giorni'}`;
  if (r.giorni === 0) return 'Scade oggi';
  return `Scade tra ${r.giorni} ${r.giorni === 1 ? 'giorno' : 'giorni'}`;
}

/** Cruscotto: quattro numeri grandi e l'elenco delle cose da fare. */
export default function Cruscotto() {
  const nav = useNavigate();
  const [filtro, setFiltro] = useState<StatoCorso | ''>('');
  const { data, errore, reload } = useLoad(() => rpc<Dati>('formazione_cruscotto', {}));
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data) return <Caricamento />;
  const lista = data.lista.filter(r => !filtro || r.stato === filtro);
  const tile = (s: StatoCorso | '', n: number, l: string, cls: string) => (
    <button className={`kpi ${cls}`} style={{ textAlign: 'start', cursor: 'pointer', font: 'inherit', outline: filtro === s && s ? '2px solid var(--ink)' : undefined }}
      onClick={() => setFiltro(filtro === s ? '' : s)} aria-pressed={filtro === s}>
      <div className="num">{n}</div><div className="lbl">{l}</div>
    </button>
  );
  return (
    <>
      <div className="page-hero"><div><h1>Formazione</h1><p className="sub">Corsi validi, in scadenza nei prossimi 60 giorni, scaduti e obbligatori mai fatti. Tocca un numero per filtrare.</p></div></div>
      <div className="kpis">
        {tile('valido', data.validi, 'Corsi validi', 'ok')}
        {tile('in_scadenza', data.in_scadenza, 'In scadenza (60 giorni)', 'warn')}
        {tile('scaduto', data.scaduti, 'Scaduti', 'ko')}
        {tile('mancante', data.mancanti, 'Obbligatori mancanti (tecnici)', 'ko')}
      </div>
      <h2>Da sistemare {filtro && <button className="btn-ghost btn-sm" onClick={() => setFiltro('')}>Mostra tutto</button>}</h2>
      {filtro === 'valido' ? <p className="sub">I corsi validi si vedono nella pagina Dipendenti.</p>
        : lista.length === 0 ? <p className="sub">Niente da sistemare. Tutti i corsi sono in regola.</p> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Dipendente</th><th>Corso</th><th>Stato</th><th>Scadenza</th><th></th></tr></thead>
          <tbody>{lista.map((r, i) => (
            <tr key={i}>
              <td><b>{r.nome}</b></td><td>{r.corso}</td>
              <td><Pill s={STATO_CORSO[r.stato][0]}>{STATO_CORSO[r.stato][1]}</Pill><div className="sub">{quando(r)}</div></td>
              <td>{fmtData(r.data_scadenza)}</td>
              <td><button className="btn btn-sm" onClick={() => nav(`/formazione/dipendenti?d=${r.dipendente_id}&c=${r.corso_id}`)}>{r.stato === 'mancante' ? 'Registra' : 'Rinnova'}</button></td>
            </tr>))}</tbody>
        </table></div>
      )}
    </>
  );
}
