import { useEffect } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from '../admin/Barra';
import { useSessione } from '../admin/Shell';

/** Area Formazione: is_formazione() (responsabile formazione o amministratore). */
export default function ShellFormazione() {
  const s = useSessione();
  const loc = useLocation();
  useEffect(() => { document.title = 'Molajoni · Formazione'; return () => { document.title = 'Molajoni'; }; }, []);
  if (s.stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (s.stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname + loc.search }} />;
  if (!s.formazione) return (
    <div className="wrap narrow">
      <h1>Account non abilitato</h1>
      <p className="subtitle">L'account {s.sessione?.user.email ?? ''} non è abilitato per la formazione. Chiedi all'amministratore di abilitarlo.</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Esci</button>
    </div>
  );
  const gruppi: Gruppo[] = [
    { titolo: 'Formazione', voci: [
      { to: '/formazione', label: 'Cruscotto', icona: 'cruscotto', end: true },
      { to: '/formazione/dipendenti', label: 'Dipendenti', icona: 'tecnici' },
      { to: '/formazione/registra', label: 'Corso di gruppo', icona: 'attivita' }] },
    { titolo: 'Impostazioni', voci: [
      { to: '/formazione/corsi', label: 'Corsi', icona: 'registro' },
      { to: '/formazione/report', label: 'Report', icona: 'report' }] },
  ];
  return (
    <div className="hr-area form-area">
      <Layout prodotto="Formazione" gruppi={gruppi} email={s.sessione?.user.email ?? ''}
        menuUtente={<>
          {s.admin && <NavLink to="/admin"><Icona n="sicurezza" />Amministrazione</NavLink>}
          <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />Esci</button>
        </>}>
        <Outlet />
      </Layout>
    </div>
  );
}
