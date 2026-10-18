import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AreaBilingue, SceltaLingua, useT } from '../../lib/i18n';
import { Caricamento, Logo } from '../../ui';
import { useSessione } from '../Shell';
import { URL_FUNZIONI } from '../../lib/push';

const TABS: [string, string][] = [
  ['/admin', 'Panoramica'], ['/admin/account', 'Account'], ['/admin/tecnici', 'Tecnici'],
  ['/admin/sicurezza', 'Sicurezza'], ['/admin/registro', 'Registro movimenti'],
];

/** Area dell'amministratore del sistema: unico livello con la scelta italiano/arabo. */
export default function AreaAdmin() {
  const { sessione, stato, admin } = useSessione();
  const loc = useLocation();
  if (stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname }} />;
  if (!admin) return <Navigate to="/cruscotto" replace />;
  return (
    <AreaBilingue>
      <Testata email={sessione?.user.email ?? ''} />
      <div className="wrap"><Outlet /></div>
    </AreaBilingue>
  );
}

function Testata({ email }: { email: string }) {
  const { t } = useT();
  return (
    <header className="app-top no-print">
      <div className="app-bar admin-bar">
        <div className="app-top-in">
          <Logo chiaro />
          <span className="prodotto">{t('Amministrazione')}</span>
          <span className="who">{email}</span>
          <NavLink className="btn-ghost btn-sm" to="/cruscotto">{t('Pannello responsabile')}</NavLink>
          <SceltaLingua chiaro />
          <button className="btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>{t('Esci')}</button>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(([to, l]) => <NavLink key={to} to={to} end={to === '/admin'} className={({ isActive }) => (isActive ? 'active' : '')}>{t(l)}</NavLink>)}
      </nav>
    </header>
  );
}

/** Chiamata alla funzione server per gli account (richiede la sessione dell'amministratore). */
export async function chiamaAccount<T>(corpo: Record<string, unknown>): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(`${URL_FUNZIONI}/account`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify(corpo),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.errore ?? 'Errore del server');
  return j as T;
}
