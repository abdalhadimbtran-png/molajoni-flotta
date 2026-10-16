import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { SceltaLingua, useT } from '../lib/i18n';
import { Caricamento, Logo } from '../ui';

type Stato = 'caricamento' | 'anonimo' | 'non_abilitato' | 'ok';

export function useSessione() {
  const [sessione, setSessione] = useState<Session | null>(null);
  const [stato, setStato] = useState<Stato>('caricamento');
  useEffect(() => {
    let attivo = true;
    async function verifica(s: Session | null) {
      if (!attivo) return;
      setSessione(s);
      if (!s) { setStato('anonimo'); return; }
      const { data, error } = await supabase.rpc('is_responsabile');
      if (!attivo) return;
      setStato(!error && data === true ? 'ok' : 'non_abilitato');
    }
    supabase.auth.getSession().then(({ data }) => verifica(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { verifica(s); });
    return () => { attivo = false; sub.subscription.unsubscribe(); };
  }, []);
  return { sessione, stato };
}

const TABS: [string, string][] = [
  ['/cruscotto', 'Cruscotto'], ['/piano', 'Pianificazione'], ['/flotta', 'Flotta'],
  ['/tecnici', 'Tecnici'], ['/segnalazioni', 'Segnalazioni'], ['/registro', 'Registro movimenti'],
];

export default function Shell() {
  const { sessione, stato } = useSessione();
  const { t } = useT();
  const loc = useLocation();
  if (stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname }} />;
  if (stato === 'non_abilitato') return (
    <div className="wrap narrow">
      <h1>{t('Account non abilitato')}</h1>
      <p className="subtitle">{t("L'account {email} esiste ma non è ancora abilitato come responsabile flotta. Chiedi all'amministratore di abilitarlo.", { email: sessione?.user.email ?? '' })}</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>{t('Esci')}</button>
    </div>
  );
  return (
    <>
      <header className="app-top no-print">
        <div className="app-top-in">
          <Logo />
          <span className="prodotto">{t('Gestione flotta')}</span>
          <span className="who">{sessione?.user.email}</span>
          <SceltaLingua />
          <button className="btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>{t('Esci')}</button>
        </div>
        <nav className="tabs">
          {TABS.map(([to, l]) => <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>{t(l)}</NavLink>)}
        </nav>
      </header>
      <div className="wrap"><Outlet /></div>
    </>
  );
}
