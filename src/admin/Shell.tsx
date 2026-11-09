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
/** Area dell'account: null per l'amministratore (entra ovunque) o per un account non abilitato. */
export type Area = 'flotta' | 'hr' | 'formazione' | 'centralino' | 'direzione' | null;
export interface Ruoli { admin: boolean; flotta: boolean; hr: boolean; formazione: boolean; centralino: boolean; direzione: boolean }
const NESSUNO: Ruoli = { admin: false, flotta: false, hr: false, formazione: false, centralino: false, direzione: false };

/**
 * Sessione dell'ufficio. `stato` resta come prima (ok = può aprire il pannello flotta).
 * In più: `flotta` (is_responsabile), `hr` (is_hr) e `area` per lo smistamento.
 * L'amministratore ha admin, flotta e hr veri.
 */
export function useSessione() {
  const [sessione, setSessione] = useState<Session | null>(null);
  const [stato, setStato] = useState<Stato>('caricamento');
  const [ruoli, setRuoli] = useState<Ruoli>(NESSUNO);
  useEffect(() => {
    let attivo = true;
    async function verifica(s: Session | null) {
      if (!attivo) return;
      setSessione(s);
      if (!s) { setRuoli(NESSUNO); setStato('anonimo'); return; }
      const [r, a, h, f, c, d] = await Promise.all([supabase.rpc('is_responsabile'), supabase.rpc('is_admin'), supabase.rpc('is_hr'), supabase.rpc('is_formazione'), supabase.rpc('is_centralino'), supabase.rpc('is_direzione')]);
      if (!attivo) return;
      const nuovi = { admin: !a.error && a.data === true, flotta: !r.error && r.data === true, hr: !h.error && h.data === true, formazione: !f.error && f.data === true,
        centralino: !c.error && c.data === true, direzione: !d.error && d.data === true };
      setRuoli(nuovi);
      setStato(nuovi.flotta ? 'ok' : 'non_abilitato');
    }
    supabase.auth.getSession().then(({ data }) => verifica(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { verifica(s); });
    return () => { attivo = false; sub.subscription.unsubscribe(); };
  }, []);
  const area: Area = ruoli.admin ? null : ruoli.flotta ? 'flotta' : ruoli.hr ? 'hr' : ruoli.formazione ? 'formazione' : ruoli.centralino ? 'centralino' : ruoli.direzione ? 'direzione' : null;
  return { sessione, stato, ...ruoli, area };
}

/** Pagina iniziale per ruolo: amministratore → /admin, responsabile flotta → /cruscotto, ufficio personale → /hr. */
export function homeDi(r: Ruoli): string | null {
  if (r.admin) return '/admin';
  if (r.flotta) return '/cruscotto';
  if (r.hr) return '/hr';
  if (r.formazione) return '/formazione';
  if (r.centralino) return '/centralino';
  if (r.direzione) return '/direzione';
  return null;
}

/** Il ruolo può aprire questa pagina? Serve per tornare a `state.da` dopo l'accesso. */
export function puoAprire(percorso: string, r: Ruoli): boolean {
  if (r.admin) return true;
  if (percorso === '/t' || percorso.startsWith('/t/')) return true;
  if (percorso.startsWith('/admin')) return false;
  if (percorso.startsWith('/hr')) return r.hr;
  if (percorso.startsWith('/formazione')) return r.formazione;
  if (percorso.startsWith('/centralino')) return r.centralino || r.direzione;
  if (percorso.startsWith('/direzione')) return r.direzione;
  return r.flotta;
}

const haTokenDipendente = () => {
  try { return Boolean(localStorage.getItem('molajoni_flotta_token') || sessionStorage.getItem('molajoni_flotta_token')); } catch { return false; }
};

/** Smistamento di `/` e delle pagine sconosciute: dipendente → /t, account dell'ufficio → pagina del suo ruolo. */
export function Smistamento() {
  const s = useSessione();
  const loc = useLocation();
  const { t } = useT();
  if (haTokenDipendente()) return <Navigate to="/t" replace />;
  if (s.stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (s.stato === 'anonimo') return <Navigate to="/t" replace />;
  const home = homeDi(s) ?? '/cruscotto';
  // la pagina del ruolo non esiste in questa versione: niente giri a vuoto
  if (home === loc.pathname) return (
    <div className="wrap narrow">
      <h1>{t('Pagina non disponibile')}</h1>
      <p className="subtitle">{t('Questa parte del portale non è ancora attiva. Riprova più tardi.')}</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>{t('Esci')}</button>
    </div>
  );
  return <Navigate to={home} replace />;
}

const GRUPPI: Gruppo[] = [
  { titolo: 'Operatività', voci: [
    { to: '/cruscotto', label: 'Cruscotto', icona: 'cruscotto' }, { to: '/piano', label: 'Pianificazione', icona: 'piano' }, { to: '/interventi', label: 'Interventi del mese', icona: 'attivita' }, { to: '/percorsi', label: 'Percorsi', icona: 'percorsi' }, { to: '/giornata', label: 'Variazioni giornata', icona: 'avvisi' }, { to: '/avvisi', label: 'Avvisi', icona: 'avvisi' }] },
  { titolo: 'Risorse', voci: [
    { to: '/flotta', label: 'Flotta', icona: 'flotta' }, { to: '/tecnici', label: 'Tecnici', icona: 'tecnici' }, { to: '/attivita', label: 'Elenco attività', icona: 'attivita' }] },
  { titolo: 'Controllo', voci: [
    { to: '/segnalazioni', label: 'Segnalazioni', icona: 'segnalazioni' }, { to: '/multe', label: 'Multe', icona: 'multe' }, { to: '/carburante', label: 'Carburante', icona: 'carburante' }, { to: '/carte', label: 'Carte carburante', icona: 'carburante' }] },
  { titolo: 'Dati', voci: [
    { to: '/report', label: 'Report', icona: 'report' }, { to: '/registro', label: 'Registro movimenti', icona: 'registro' }] },
];

export default function Shell() {
  const { sessione, stato, admin, hr, formazione, centralino, direzione } = useSessione();
  const { t } = useT();
  const loc = useLocation();
  if (stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname + loc.search }} />;
  // account dell'ufficio personale che apre il pannello flotta: va alla sua area, senza errore
  if (stato === 'non_abilitato' && hr) return <Navigate to="/hr" replace />;
  if (stato === 'non_abilitato' && formazione) return <Navigate to="/formazione" replace />;
  if (stato === 'non_abilitato' && centralino) return <Navigate to="/centralino" replace />;
  if (stato === 'non_abilitato' && direzione) return <Navigate to="/direzione" replace />;
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
        {admin && <NavLink to="/centralino"><Icona n="telefono" />{t('Centralino')}</NavLink>}
        {admin && <NavLink to="/admin"><Icona n="sicurezza" />{t('Amministrazione')}</NavLink>}
        <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />{t('Esci')}</button>
      </>}>
      <Outlet />
    </Layout>
  );
}
