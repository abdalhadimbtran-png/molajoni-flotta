import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AreaBilingue, SceltaLingua, useT } from '../../lib/i18n';
import { Caricamento } from '../../ui';
import { Icona, Layout, type Gruppo } from '../Barra';
import { useSessione } from '../Shell';
import { URL_FUNZIONI } from '../../lib/push';

const GRUPPI: Gruppo[] = [
  { titolo: 'Amministrazione', voci: [
    { to: '/admin', label: 'Panoramica', icona: 'panoramica', end: true }, { to: '/admin/account', label: 'Account', icona: 'account' },
    { to: '/admin/tecnici', label: 'Tecnici', icona: 'tecnici' }, { to: '/admin/sicurezza', label: 'Sicurezza', icona: 'sicurezza' },
    { to: '/admin/report', label: 'Report', icona: 'report' }, { to: '/admin/registro', label: 'Registro movimenti', icona: 'registro' }] },
];

/** Area dell'amministratore del sistema: unico livello con la scelta italiano/arabo. */
export default function AreaAdmin() {
  const { sessione, stato, admin } = useSessione();
  const loc = useLocation();
  if (stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname }} />;
  if (!admin) return <Navigate to="/cruscotto" replace />;
  return <AreaBilingue><Contenuto email={sessione?.user.email ?? ''} /></AreaBilingue>;
}

function Contenuto({ email }: { email: string }) {
  const { t } = useT();
  return (
    <Layout prodotto={t('Amministrazione')} gruppi={GRUPPI} email={email}
      utilita={<SceltaLingua />}
      menuUtente={<>
        <NavLink to="/cruscotto"><Icona n="cruscotto" />{t('Pannello responsabile')}</NavLink>
        <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />{t('Esci')}</button>
      </>}>
      <Outlet />
    </Layout>
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
