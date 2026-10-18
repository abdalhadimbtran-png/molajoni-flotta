import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { useT } from '../lib/i18n';
import { supabase } from '../lib/supabase';

interface Dati { tecnico: { nome: string; cognome: string; codice: string; email: string | null }; pin: string }

/** Scheda A4 per installare l'app tecnici (solo italiano). Se arriva da "Scheda app + PIN" è già compilata. */
export default function Volantino() {
  const { t } = useT();
  const loc = useLocation();
  const nav = useNavigate();
  const base = loc.pathname.startsWith('/admin') ? '/admin' : '';
  const url = `${window.location.origin}/t`;
  const [qr, setQr] = useState('');
  // Il PIN resta solo in memoria: tolto subito dalla cronologia del browser
  const [dati] = useState<Dati | null>(() => (loc.state as Dati | null)?.pin ? loc.state as Dati : null);
  const [email, setEmail] = useState(dati?.tecnico.email ?? '');
  const [mittente, setMittente] = useState('');
  useEffect(() => { if (loc.state) nav(loc.pathname, { replace: true, state: null }); }, [loc.state, loc.pathname, nav]);
  useEffect(() => { QRCode.toDataURL(url, { width: 520, margin: 1 }).then(setQr); }, [url]);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const r = await supabase.from('responsabili').select('nome').eq('user_id', data.user.id).maybeSingle();
      setMittente(r.data?.nome ?? '');
    });
  }, []);

  const emailValida = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const mailto = dati ? `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('Molajoni · App Flotta: il tuo accesso')}&body=${encodeURIComponent(
`Ciao ${dati.tecnico.nome},

da oggi per prendere e riconsegnare i veicoli, registrare i km e segnalare problemi usi l'app Flotta di Molajoni.

1. Apri questo link dal telefono: ${url}
2. Android: tocca "Installa l'app".
   iPhone: apri il link con Safari, tocca Condividi e poi "Aggiungi alla schermata Home".
3. Apri l'app dall'icona Flotta e accedi con:
   Codice: ${dati.tecnico.codice}
   PIN: ${dati.pin}
4. Tocca "Attiva le notifiche": così ricevi il piano del giorno dopo e gli avvisi urgenti.

Il PIN è personale: non darlo a nessuno. Se lo dimentichi, chiedi un PIN nuovo al responsabile flotta.

Buon lavoro,
${mittente || 'Il responsabile flotta'}
Molajoni Antincendi`)}` : '';

  return (
    <>
      <div className="row-flex no-print" style={{ marginBottom: 18 }}>
        <Link className="btn-ghost btn-sm" to={`${base}/tecnici`}>← {t('Tecnici')}</Link>
        <button className="btn btn-sm" onClick={() => window.print()}>{t('Stampa')}</button>
        {!dati && <span className="sub">{t('Scheda vuota: per una scheda con codice e PIN usa "Scheda app + PIN" accanto al tecnico.')}</span>}
      </div>
      {dati && (
        <div className="panel form no-print scheda-invio">
          <div className="lbl-sm">{t('Invia la scheda per email')}</div>
          <div className="row-flex wrap-end">
            <div className="field" style={{ flex: 1, minWidth: 240 }}><label htmlFor="v-mail">{t('Email di {n}', { n: `${dati.tecnico.nome} ${dati.tecnico.cognome}` })}</label>
              <input id="v-mail" type="email" dir="ltr" value={email} onChange={e => setEmail(e.target.value)} placeholder="nome@esempio.it" /></div>
            <a className={`btn ${emailValida ? '' : 'disabled'}`} aria-disabled={!emailValida} href={emailValida ? mailto : undefined}>✉️ {t('Apri email pronta')}</a>
          </div>
          <p className="hint">{t("Si apre il tuo programma di posta con il messaggio già scritto: controlla e premi Invia. Il PIN è visibile solo adesso: se chiudi la pagina, per rivederlo devi generarne uno nuovo.")}</p>
        </div>
      )}
      <div className="volantino" lang="it" dir="ltr">
        <div className="vol-head"><img src="/logo-molajoni.png" alt="Molajoni Antincendi" /><span>FLOTTA</span></div>
        {dati && <div className="vol-per">Scheda personale di <b>{dati.tecnico.nome} {dati.tecnico.cognome}</b></div>}
        <div className="vol-qr">{qr && <img src={qr} alt="QR per aprire l'app" />}<div className="mono">{url}</div></div>
        <div className="vol-col">
          <div>
            <h3>Android</h3>
            <ol><li>Inquadra il QR con la fotocamera.</li><li>Tocca <b>Installa l'app</b> nella pagina.</li><li>Conferma <b>Installa</b>.</li></ol>
          </div>
          <div>
            <h3>iPhone / iPad</h3>
            <ol><li>Inquadra il QR e apri con <b>Safari</b>.</li><li>Tocca <b>Condividi</b> ⬆︎</li><li><b>Aggiungi alla schermata Home</b> → <b>Aggiungi</b>.</li></ol>
          </div>
          <div>
            <h3>Primo accesso</h3>
            <ol><li>Apri l'app dall'icona <b>Flotta</b>.</li><li>Scrivi <b>codice</b> e <b>PIN</b>.</li><li>Tocca <b>Attiva le notifiche</b>.</li></ol>
          </div>
        </div>
        <div className="vol-pin">
          <span>Codice: {dati ? <b className="mono">{dati.tecnico.codice}</b> : '________________'}</span>
          <span>PIN: {dati ? <b className="mono">{dati.pin}</b> : '______________'}</span>
        </div>
        <p className="vol-foot">Il PIN è personale: non darlo a nessuno. Se lo dimentichi, chiedi un PIN nuovo al responsabile flotta.</p>
      </div>
    </>
  );
}
