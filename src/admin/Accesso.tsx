import { FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { SceltaLingua, useT } from '../lib/i18n';
import { useSessione } from './Shell';
import { Banner, Logo } from '../ui';

export default function Accesso() {
  const { stato } = useSessione();
  const { t, tm } = useT();
  const loc = useLocation() as { state?: { da?: string } };
  const [modo, setModo] = useState<'accedi' | 'registra'>('accedi');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<{ s: 'ok' | 'ko'; t: string } | null>(null);
  const [invio, setInvio] = useState(false);

  if (stato === 'ok' || stato === 'non_abilitato') return <Navigate to={loc.state?.da ?? '/cruscotto'} replace />;

  async function invia(e: FormEvent) {
    e.preventDefault(); setMsg(null); setInvio(true);
    try {
      if (modo === 'accedi') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(error.message.includes('Invalid login') ? 'Email o password non corretti.' : error.message.includes('not confirmed') ? "Conferma prima l'email dal link che hai ricevuto." : error.message);
      } else {
        if (password.length < 10) throw new Error('La password deve avere almeno 10 caratteri.');
        const { error } = await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: window.location.origin + '/accesso' } });
        if (error) throw error;
        setMsg({ s: 'ok', t: "Account creato. Se richiesto, conferma l'email dal link ricevuto. Poi l'account va abilitato come responsabile flotta prima di poter accedere ai dati." });
      }
    } catch (err) { setMsg({ s: 'ko', t: testoErrore(err) }); }
    finally { setInvio(false); }
  }

  return (
    <div className="wrap narrow">
      <div className="row-flex" style={{ marginBottom: 28 }}><Logo /><span className="spacer" /><SceltaLingua /></div>
      <h1>{t('Gestione flotta')}</h1>
      <p className="subtitle">{t('Accesso riservato al responsabile flotta. I tecnici usano il QR sul veicolo.')}</p>
      <form className="panel form" onSubmit={invia}>
        <div className="field"><label htmlFor="email">{t('Email aziendale')}</label><input id="email" type="email" dir="ltr" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} /></div>
        <div className="field"><label htmlFor="pw">{t('Password')}</label><input id="pw" type="password" dir="ltr" autoComplete={modo === 'accedi' ? 'current-password' : 'new-password'} required value={password} onChange={e => setPassword(e.target.value)} /></div>
        {msg && <Banner s={msg.s}>{tm(msg.t)}</Banner>}
        <button className="btn" disabled={invio}>{modo === 'accedi' ? t('Accedi') : t('Crea account')}</button>
        <button type="button" className="link" onClick={() => { setModo(modo === 'accedi' ? 'registra' : 'accedi'); setMsg(null); }}>
          {modo === 'accedi' ? t("Primo accesso: crea l'account") : t('Ho già un account: accedi')}
        </button>
      </form>
      <p className="hint"><a href="/t">{t('Sei un tecnico? Vai alla tua giornata')}</a></p>
    </div>
  );
}
