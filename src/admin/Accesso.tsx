import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { useSessione } from './Shell';
import { Banner, Logo } from '../ui';

/** Accesso del responsabile flotta. Gli account si creano solo dall'amministratore (nessuna registrazione pubblica). */
export default function Accesso() {
  const { stato, admin } = useSessione();
  const { t, tm } = useT();
  const loc = useLocation() as { state?: { da?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ s: 'ok' | 'ko'; t: string } | null>(null);
  const [invio, setInvio] = useState(false);

  if (stato === 'ok' || stato === 'non_abilitato') return <Navigate to={loc.state?.da ?? (admin ? '/admin' : '/cruscotto')} replace />;

  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null); setInvio(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message.includes('Invalid login') ? 'Email o password non corretti.' : error.message.includes('not confirmed') ? "Conferma prima l'email dal link che hai ricevuto." : /banned/i.test(error.message) ? "Account disattivato: contatta l'amministratore." : 'Accesso non riuscito. Riprova tra poco.');
    } catch (err) { setMsg({ s: 'ko', t: testoErrore(err) }); }
    finally { setInvio(false); }
  }

  return (
    <div className="accesso">
      <aside className="accesso-brand">
        <Logo />
        <div className="accesso-claim">
          <h1>{t('Ogni veicolo, ogni tecnico, ogni giorno: sotto controllo.')}</h1>
          <ul>
            <li>{t('Piano giornaliero di veicoli e interventi')}</li>
            <li>{t('Km, riconsegne e guasti registrati con il QR')}</li>
            <li>{t('Scadenze, patenti e multe senza sorprese')}</li>
          </ul>
        </div>
        <span className="accesso-foot">Molajoni Antincendi · {t('Uso interno')}</span>
      </aside>
      <main className="accesso-form">
        <form className="accesso-box form" onSubmit={invia}>
          <h2>{t('Accedi')}</h2>
          <p className="subtitle">{t('Accesso riservato al responsabile flotta. I tecnici usano il QR sul veicolo.')}</p>
          <div className="field"><label htmlFor="email">{t('Email aziendale')}</label><input id="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw">{t('Password')}</label><input id="pw" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          {msg && <Banner s={msg.s}>{tm(msg.t)}</Banner>}
          <button className="btn big" disabled={invio}>{invio ? t('Accesso…') : t('Accedi')}</button>
          <p className="hint">{t("Non hai un account? Chiedilo all'amministratore del sistema.")}</p>
        </form>
        <a className="accesso-tec" href="/t">{t('Sei un tecnico? Vai alla tua giornata')}</a>
      </main>
    </div>
  );
}
