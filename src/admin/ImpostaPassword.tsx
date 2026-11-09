import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { controllaPassword } from '../lib/account';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Logo } from '../ui';
import { homeDi } from './Shell';

/**
 * Creazione / cambio della password personale.
 * - dal link d'invito o di recupero (?th=…&t=invite|recovery): verifica il link, poi la persona sceglie la password;
 * - dopo una password temporanea (?obbligo=1): cambio obbligatorio prima di entrare.
 */
export default function ImpostaPassword() {
  const { t, tm } = useT();
  const [q] = useSearchParams();
  const nav = useNavigate();
  const th = q.get('th'), tipo = q.get('t') === 'recovery' ? 'recovery' : 'invite', obbligo = q.get('obbligo') === '1';
  const [pronto, setPronto] = useState<'verifica' | 'ok' | 'ko'>('verifica');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState(''); const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [invio, setInvio] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      if (th) {
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: th, type: tipo });
        if (!vivo) return;
        if (error || !data.session) { setPronto('ko'); return; }
        setEmail(data.session.user.email ?? ''); setPronto('ok');
        // il link non resta nella barra degli indirizzi
        window.history.replaceState(null, '', '/imposta-password');
      } else {
        const { data } = await supabase.auth.getSession();
        if (!vivo) return;
        if (!data.session) { nav('/accesso', { replace: true }); return; }
        setEmail(data.session.user.email ?? ''); setPronto('ok');
      }
    })();
    return () => { vivo = false; };
  }, [th, tipo, nav]);

  async function salva(e: FormEvent) {
    e.preventDefault(); setMsg(null);
    const er = controllaPassword(pw, pw2);
    if (er) { setMsg(er); return; }
    setInvio(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw new Error(/different from the old|same/i.test(error.message) ? 'Scegli una password diversa da quella temporanea.' : /weak|short/i.test(error.message) ? 'Password troppo debole: allungala o aggiungi numeri e simboli.' : 'Salvataggio non riuscito. Riprova.');
      await supabase.rpc('segna_password_impostata');
      const [a, r, h, f, c, d] = await Promise.all(['is_admin', 'is_responsabile', 'is_hr', 'is_formazione', 'is_centralino', 'is_direzione'].map(n => supabase.rpc(n)));
      const home = homeDi({ admin: a.data === true, flotta: r.data === true, hr: h.data === true, formazione: f.data === true, centralino: c.data === true, direzione: d.data === true }) ?? '/cruscotto';
      window.location.replace(home);
    } catch (x) { setMsg(testoErrore(x)); setInvio(false); }
  }

  return (
    <div className="accesso">
      <aside className="accesso-brand">
        <Logo />
        <div className="accesso-claim"><h1>{tipo === 'invite' && !obbligo ? t('Benvenuta/o nel Portale Molajoni') : t('La tua password personale')}</h1>
          <ul><li>{t('Solo tu conosci la tua password')}</li><li>{t('Almeno 10 caratteri, con lettere e numeri')}</li><li>{t('Accedi poi con la tua email aziendale')}</li></ul></div>
        <span className="accesso-foot">Molajoni Antincendi · {t('dal 1930')}</span>
      </aside>
      <main className="accesso-form">
        <div className="accesso-logo"><Logo /></div>
        {pronto === 'verifica' ? <Caricamento /> : pronto === 'ko' ? (
          <div className="accesso-box form">
            <h2>{t('Link non più valido')}</h2>
            <Banner s="warn">{t("Il link è scaduto (vale 24 ore) o è già stato usato. Chiedi un nuovo invito all'amministratore oppure usa «Password dimenticata?» nella pagina di accesso.")}</Banner>
            <Link className="btn" to="/accesso">{t("Vai all'accesso")}</Link>
          </div>
        ) : (
          <form className="accesso-box form" onSubmit={salva}>
            <h2>{obbligo ? t('Cambia la password temporanea') : t('Imposta la tua password')}</h2>
            <p className="subtitle" dir="ltr">{email}</p>
            {obbligo && <Banner s="warn">{t("Hai effettuato l'accesso con una password temporanea: scegline una personale per continuare.")}</Banner>}
            <div className="field"><label htmlFor="pw1">{t('Nuova password')}</label><input id="pw1" type="password" dir="ltr" autoComplete="new-password" required value={pw} onChange={e => setPw(e.target.value)} /></div>
            <div className="field"><label htmlFor="pw2">{t('Ripeti la password')}</label><input id="pw2" type="password" dir="ltr" autoComplete="new-password" required value={pw2} onChange={e => setPw2(e.target.value)} /></div>
            {msg && <Banner s="ko">{tm(msg)}</Banner>}
            <button className="btn big" disabled={invio}>{invio ? t('Salvataggio…') : t('Salva e accedi')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
