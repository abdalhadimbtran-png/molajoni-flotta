import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { homeDi, puoAprire, useSessione } from './Shell';
import { Banner, Logo } from '../ui';
import { URL_FUNZIONI } from '../lib/push';

/**
 * Accesso dell'ufficio: responsabile flotta, ufficio personale, amministratore.
 * Gli account si creano solo dall'amministratore (nessuna registrazione pubblica).
 * Dopo l'accesso: la pagina di partenza solo se il ruolo può aprirla, altrimenti la home del ruolo.
 */
export default function Accesso() {
  const s = useSessione();
  const { t, tm } = useT();
  const loc = useLocation() as { state?: { da?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ s: 'ok' | 'ko'; t: string } | null>(null);
  const [invio, setInvio] = useState(false);
  const [recupero, setRecupero] = useState(false);

  if (s.stato === 'ok' || s.stato === 'non_abilitato') {
    const da = loc.state?.da;
    const dest = da && da !== '/' && puoAprire(da, s) ? da : homeDi(s) ?? '/cruscotto';
    return <Navigate to={dest} replace />;
  }

  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null); setInvio(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(error.message.includes('Invalid login') ? 'Email o password non corretti.' : error.message.includes('not confirmed') ? "Conferma prima l'email dal link che hai ricevuto." : /banned/i.test(error.message) ? "Account disattivato: contatta l'amministratore." : 'Accesso non riuscito. Riprova tra poco.');
    } catch (err) { setMsg({ s: 'ko', t: testoErrore(err) }); }
    finally { setInvio(false); }
  }

  async function chiediLink(e: FormEvent) {
    e.preventDefault(); setMsg(null); setInvio(true);
    try {
      const r = await fetch(`${URL_FUNZIONI}/recupero`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.errore ?? 'Richiesta non riuscita. Riprova tra poco.'); }
      setMsg({ s: 'ok', t: "Se l'email appartiene a un account del portale, riceverai a breve un messaggio con il link per creare una nuova password (valido 24 ore). Non arriva? Controlla la posta indesiderata o chiedi all'amministratore il link diretto." });
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
        <div className="accesso-logo"><Logo /></div>
        {recupero ? (
        <form className="accesso-box form" onSubmit={chiediLink}>
          <h2>{t('Password dimenticata?')}</h2>
          <p className="subtitle">{t('Scrivi la tua email aziendale: ti mandiamo un link sicuro per crearne una nuova.')}</p>
          <div className="field"><label htmlFor="email-r">{t('Email aziendale')}</label><input id="email-r" type="email" dir="ltr" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          {msg && <Banner s={msg.s}>{tm(msg.t)}</Banner>}
          <button className="btn big" disabled={invio}>{invio ? t('Invio…') : t('Inviami il link')}</button>
          <button type="button" className="btn-ghost" onClick={() => { setRecupero(false); setMsg(null); }}>{t("Torna all'accesso")}</button>
        </form>
        ) : (
        <form className="accesso-box form" onSubmit={invia}>
          <h2>{t("Accedi all'area ufficio")}</h2>
          <p className="subtitle">{t('Per responsabile flotta, ufficio personale e amministratore.')}</p>
          <div className="field"><label htmlFor="email">{t('Email aziendale')}</label><input id="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
          <div className="field"><label htmlFor="pw">{t('Password')}</label><input id="pw" type="password" dir="ltr" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} /></div>
          {msg && <Banner s={msg.s}>{tm(msg.t)}</Banner>}
          <button className="btn big" disabled={invio}>{invio ? t('Accesso…') : t('Accedi')}</button>
          <button type="button" className="btn-ghost btn-sm" onClick={() => { setRecupero(true); setMsg(null); }}>{t('Password dimenticata?')}</button>
          <p className="hint">{t("Non hai un account? Chiedilo all'amministratore del sistema.")}</p>
        </form>
        )}
        <a className="accesso-tec" href="/t">{t('Sei un dipendente? Entra con codice e PIN')}</a>
      </main>
    </div>
  );
}
