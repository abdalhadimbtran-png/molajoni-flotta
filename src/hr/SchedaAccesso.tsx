import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useHR } from './comune';

interface Dati { dipendente: { nome: string; cognome: string; codice: string; email: string | null; categoria: string }; pin: string }

/** Scheda di accesso all'app per qualsiasi dipendente (stampa o email). Il PIN resta solo in memoria. */
export default function SchedaAccesso() {
  const loc = useLocation();
  const nav = useNavigate();
  const { nomeAccount } = useHR();
  const url = `${window.location.origin}/t`;
  const [qr, setQr] = useState('');
  const [dati] = useState<Dati | null>(() => ((loc.state as Dati | null)?.pin ? loc.state as Dati : null));
  const [email, setEmail] = useState(dati?.dipendente.email ?? '');
  useEffect(() => { if (loc.state) nav(loc.pathname, { replace: true, state: null }); }, [loc.state, loc.pathname, nav]);
  useEffect(() => { QRCode.toDataURL(url, { width: 520, margin: 1 }).then(setQr); }, [url]);
  const tec = dati?.dipendente.categoria === 'TEC';
  const valida = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const mailto = dati ? `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('Molajoni · Il tuo accesso al portale')}&body=${encodeURIComponent(
`Ciao ${dati.dipendente.nome},

con l'app Molajoni chiedi ferie e permessi e vedi le risposte dell'ufficio personale${tec ? ' (e, come oggi, prendi e riconsegni i veicoli)' : ''}.

1. Apri questo link dal telefono: ${url}
2. Android: tocca "Installa l'app". iPhone: apri il link con Safari, tocca Condividi e poi "Aggiungi alla schermata Home".
3. Apri l'app dall'icona Molajoni e accedi con:
   Codice: ${dati.dipendente.codice}
   PIN: ${dati.pin}

Il PIN è personale: non darlo a nessuno. Se lo dimentichi, chiedi un PIN nuovo all'ufficio personale.

${nomeAccount || "L'ufficio personale"}
Molajoni Antincendi`)}` : '';
  return (
    <>
      <div className="row-flex no-print" style={{ marginBottom: 18 }}>
        <Link className="btn-ghost btn-sm" to="/hr/dipendenti">← Dipendenti</Link>
        <button className="btn btn-sm" onClick={() => window.print()}>Stampa</button>
        {!dati && <span className="sub">Scheda vuota: per una scheda con codice e PIN usa «Scheda accesso + PIN» accanto al dipendente.</span>}
      </div>
      {dati && <div className="panel form no-print scheda-invio">
        <div className="lbl-sm">Invia la scheda per email</div>
        <div className="row-flex wrap-end">
          <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="s-mail">Email di {dati.dipendente.nome} {dati.dipendente.cognome}</label>
            <input id="s-mail" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@esempio.it" /></div>
          <a className={`btn ${valida ? '' : 'disabled'}`} aria-disabled={!valida} href={valida ? mailto : undefined}>Apri email pronta</a>
        </div>
        <p className="hint">Il PIN è visibile solo adesso: se chiudi la pagina, per rivederlo devi generarne uno nuovo.</p>
      </div>}
      <div className="volantino" lang="it" dir="ltr">
        <div className="vol-head"><img src="/logo-molajoni.png" alt="Molajoni Antincendi" /><span>PORTALE</span></div>
        {dati && <div className="vol-per">Scheda personale di <b>{dati.dipendente.nome} {dati.dipendente.cognome}</b></div>}
        <div className="vol-qr">{qr && <img src={qr} alt="QR per aprire l'app" />}<div className="mono">{url}</div></div>
        <div className="vol-col">
          <div><h3>Android</h3><ol><li>Inquadra il QR con la fotocamera.</li><li>Tocca <b>Installa l'app</b>.</li><li>Conferma <b>Installa</b>.</li></ol></div>
          <div><h3>iPhone / iPad</h3><ol><li>Inquadra il QR e apri con <b>Safari</b>.</li><li>Tocca <b>Condividi</b> ⬆︎</li><li><b>Aggiungi alla schermata Home</b>.</li></ol></div>
          <div><h3>Primo accesso</h3><ol><li>Apri l'app dall'icona <b>Molajoni</b>.</li><li>Scrivi <b>codice</b> e <b>PIN</b>.</li><li>Chiedi ferie e permessi da <b>Ferie</b>.</li></ol></div>
        </div>
        <div className="vol-pin">
          <span>Codice: {dati ? <b className="mono">{dati.dipendente.codice}</b> : '________________'}</span>
          <span>PIN: {dati ? <b className="mono">{dati.pin}</b> : '______________'}</span>
        </div>
        <p className="vol-foot">Il PIN è personale: non darlo a nessuno. Se lo dimentichi, chiedi un PIN nuovo all'ufficio personale.</p>
      </div>
    </>
  );
}
