import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from '../admin/Barra';
import { useSessione } from '../admin/Shell';
import { Campanella } from '../formazione/ShellFormazione';
import type { CtxCentralino } from '../centralino/ShellCentralino';
import '../centralino/centralino.css';
import './direzione.css';

/**
 * Area Direzione (/direzione): monitoraggio in sola lettura per il titolare (responsabili.direzione) e l'amministratore.
 * Il contesto è compatibile con quello del centralino (scrive = false) → dettaglio KPI e scheda pratica riusano le stesse pagine.
 */
export default function ShellDirezione() {
  const s = useSessione();
  const loc = useLocation();
  const [versione, setVersione] = useState(0);
  useEffect(() => { document.title = 'Molajoni · Direzione'; return () => { document.title = 'Molajoni'; }; }, []);
  useEffect(() => { if (s.direzione) supabase.rpc('centralino_controlla_sla').then(() => undefined); }, [s.direzione]);
  // tempo reale: pratiche, storia, trasferimenti → le pagine si aggiornano da sole
  useEffect(() => {
    if (!s.sessione || !s.direzione) return;
    let k = 0;
    const agg = () => { window.clearTimeout(k); k = window.setTimeout(() => setVersione(v => v + 1), 400); };
    const ch = supabase.channel('direzione-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pratiche' }, agg)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pratiche_eventi' }, agg)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chiamate_trasferite' }, agg)
      .subscribe();
    return () => { window.clearTimeout(k); supabase.removeChannel(ch); };
  }, [s.sessione, s.direzione]);

  if (s.stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (s.stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname + loc.search }} />;
  if (!s.direzione) return (
    <div className="wrap narrow">
      <h1>Account non abilitato</h1>
      <p className="subtitle">L'account {s.sessione?.user.email ?? ''} non è abilitato per la direzione. Chiedi all'amministratore di abilitarlo.</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Esci</button>
    </div>
  );
  const P = 'Prossimamente';
  const gruppi: Gruppo[] = [
    { titolo: 'Direzione', voci: [
      { to: '/direzione', label: 'Panoramica', icona: 'panoramica', end: true },
      { to: '/direzione/centralino', label: 'Centralino', icona: 'telefono' }] },
    { titolo: 'In arrivo', voci: [
      { to: '/direzione/flotta', label: 'Flotta', icona: 'flotta', disabilitata: P },
      { to: '/direzione/personale', label: 'Personale', icona: 'tecnici', disabilitata: P },
      { to: '/direzione/formazione', label: 'Formazione', icona: 'report', disabilitata: P },
      { to: '/direzione/interventi', label: 'Interventi', icona: 'attivita', disabilitata: P }] },
  ];
  const ctx: CtxCentralino = { scrive: false, admin: s.admin, base: '/direzione/centralino', nuovo: () => undefined, versione, aggiorna: () => setVersione(v => v + 1) };
  return (
    <div className="hr-area ct-area dz-area">
      <Layout prodotto="Direzione" gruppi={gruppi} email={s.sessione?.user.email ?? ''}
        utilita={<><span className="dz-sola">Sola lettura</span><Campanella /></>}
        menuUtente={<>
          {s.centralino && <NavLink to="/centralino"><Icona n="telefono" />Apri il centralino</NavLink>}
          {s.admin && <NavLink to="/admin"><Icona n="sicurezza" />Amministrazione</NavLink>}
          <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />Esci</button>
        </>}>
        <Outlet context={ctx} />
      </Layout>
    </div>
  );
}
