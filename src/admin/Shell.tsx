import { useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { useT } from '../lib/i18n';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from './Barra';
import Campanella from './Campanella';
import { InstallaApp } from '../Installa';

type Stato = 'caricamento' | 'anonimo' | 'non_abilitato' | 'ok';

export function useSessione() {
  const [sessione, setSessione] = useState<Session | null>(null);
  const [stato, setStato] = useState<Stato>('caricamento');
  const [admin, setAdmin] = useState(false);
  const [hr, setHr] = useState(false);
  useEffect(() => {
    let attivo = true;
    async function verifica(s: Session | null) {
      if (!attivo) return;
      setSessione(s);
      if (!s) { setStato('anonimo'); return; }
      const [r, a, h] = await Promise.all([supabase.rpc('is_responsabile'), supabase.rpc('is_admin'), supabase.rpc('is_hr')]);
      if (!attivo) return;
      setAdmin(!a.error && a.data === true);
      setHr(!h.error && h.data === true);
      setStato(!r.error && r.data === true ? 'ok' : 'non_abilitato');
    }
    supabase.auth.getSession().then(({ data }) => verifica(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { verifica(s); });
    return () => { attivo = false; sub.subscription.unsubscribe(); };
  }, []);
  return { sessione, stato, admin, hr };
}

const GRUPPI: Gruppo[] = [
  { titolo: 'Operatività', voci: [
    { to: '/cruscotto', label: 'Cruscotto', icona: 'cruscotto' }, { to: '/piano', label: 'Pianificazione', icona: 'piano' }, { to: '/avvisi', label: 'Avvisi', icona: 'avvisi' }] },
  { titolo: 'Risorse', voci: [
    { to: '/flotta', label: 'Flotta', icona: 'flotta' }, { to: '/tecnici', label: 'Tecnici', icona: 'tecnici' }] },
  { titolo: 'Controllo', voci: [
    { to: '/segnalazioni', label: 'Segnalazioni', icona: 'segnalazioni' }, { to: '/multe', label: 'Multe', icona: 'multe' }, { to: '/carburante', label: 'Carburante', icona: 'carburante' }] },
  { titolo: 'Dati', voci: [
    { to: '/report', label: 'Report', icona: 'report' }, { to: '/registro', label: 'Registro movimenti', icona: 'registro' }] },
];

export default function Shell() {
  const { sessione, stato, admin, hr } = useSessione();
  const { t } = useT();
  const loc = useLocation();
  if (stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname }} />;
  // account dell'ufficio personale: il pannello flotta non è suo, va nella sua area senza errore
  if (stato === 'non_abilitato' && hr) return <Navigate to="/hr" replace />;
  if (stato === 'non_abilitato') return (
    <div className="wrap narrow">
      <h1>{t('Account non abilitato')}</h1>
      <p className="subtitle">{t("L'account {email} non è abilitato come responsabile flotta. Chiedi all'amministratore di abilitarlo.", { email: sessione?.user.email ?? '' })}</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>{t('Esci')}</button>
    </div>
  );
  return (
    <Layout prodotto={t('Gestione flotta')} gruppi={admin ? [...GRUPPI, { titolo: 'Sistema', voci: [{ to: '/admin', label: 'Amministrazione', icona: 'sicurezza' }] }] : GRUPPI} email={sessione?.user.email ?? ''}
      utilita={<><InstallaApp variante="admin" /><Campanella /></>}
      menuUtente={<>
        {admin && <NavLink to="/hr"><Icona n="tecnici" />{t('Ufficio personale')}</NavLink>}
        {admin && <NavLink to="/admin"><Icona n="sicurezza" />{t('Amministrazione')}</NavLink>}
        <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />{t('Esci')}</button>
      </>}>
      <Outlet />
    </Layout>
  );
}
