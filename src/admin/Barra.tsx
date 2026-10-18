import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useT } from '../lib/i18n';

/** Icone di navigazione: tratto 1.75, stessa griglia 24×24. */
const P: Record<string, ReactNode> = {
  cruscotto: <><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5" rx="1.5" /><rect x="13.5" y="11" width="7.5" height="10" rx="1.5" /><rect x="3" y="15" width="7.5" height="6" rx="1.5" /></>,
  piano: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h3M13.5 13.5h3M7.5 17h3" /></>,
  avvisi: <><path d="M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1Z" /><path d="M16 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /></>,
  flotta: <><path d="M2.5 16.5V7a1 1 0 0 1 1-1h10v10.5M13.5 9.5h4l3.5 3.5v3.5h-2" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" /><path d="M9 17h6" /></>,
  tecnici: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.5 3.5 0 0 1 0 6.4M18.5 14.5a6.5 6.5 0 0 1 3 5.5" /></>,
  segnalazioni: <><path d="M12 3.5 2.5 20h19L12 3.5Z" /><path d="M12 10v4.5M12 17.2v.3" /></>,
  multe: <><path d="M6 2.5h12v19l-3-2-3 2-3-2-3 2v-19Z" /><path d="M9 7.5h6M9 11h6M9 14.5h3.5" /></>,
  carburante: <><path d="M4 21V4.5A1.5 1.5 0 0 1 5.5 3h7A1.5 1.5 0 0 1 14 4.5V21M2.5 21h13M4 10h10" /><path d="M14 8h2.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 0 3 0V8l-3-3" /></>,
  report: <><path d="M3.5 3.5v17h17" /><path d="M7.5 15.5v-4M11.5 15.5v-8M15.5 15.5v-6M19.5 15.5v-10" /></>,
  registro: <><path d="M8 6h12.5M8 12h12.5M8 18h12.5" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  panoramica: <><path d="M3 20.5h18" /><path d="M4 16l5-5 4 3 7-7.5" /><path d="M15 6.5h5v5" /></>,
  account: <><circle cx="10" cy="8" r="4" /><path d="M3 20.5a7 7 0 0 1 11.5-5.4" /><circle cx="18" cy="17" r="2.5" /><path d="M18 12.5v2M18 19.5v2M13.5 17h2M20.5 17h2" /></>,
  sicurezza: <><path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6l-8-3Z" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
  ritorno: <><path d="M10 6 4 12l6 6" /><path d="M4.5 12H15a5 5 0 0 1 5 5v1" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  chiudi: <path d="M6 6l12 12M18 6 6 18" />,
};
export const Icona = ({ n }: { n: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{P[n]}</svg>
);

export interface Voce { to: string; label: string; icona: string; end?: boolean }
export interface Gruppo { titolo: string; voci: Voce[] }

/** Struttura delle aree di gestione: barra laterale chiara + barra superiore con utilità e menu utente. */
export function Layout({ prodotto, gruppi, utilita, email, menuUtente, children }:
  { prodotto: string; gruppi: Gruppo[]; utilita?: ReactNode; email: string; menuUtente: ReactNode; children: ReactNode }) {
  const { t } = useT();
  const [aperto, setAperto] = useState(false);
  const loc = useLocation();
  useEffect(() => { setAperto(false); }, [loc.pathname]);
  const corrente = gruppi.flatMap(g => g.voci).filter(v => v.end ? loc.pathname === v.to : loc.pathname === v.to || loc.pathname.startsWith(v.to + '/')).sort((a, b) => b.to.length - a.to.length)[0];
  const iniziali = (email.split('@')[0].split(/[._-]/).filter(Boolean).slice(0, 2).map(x => x[0]).join('') || '?').toUpperCase();
  return (
    <div className={`gest ${aperto ? 'menu-aperto' : ''}`}>
      <aside className="side no-print">
        <div className="side-brand">
          <img className="logo" src="/logo-molajoni.png" alt="Molajoni Antincendi" />
          <span className="side-prodotto">{prodotto}</span>
        </div>
        <nav className="side-nav">
          {gruppi.map(g => (
            <div key={g.titolo} className="side-gruppo">
              <div className="side-gtit">{t(g.titolo)}</div>
              {g.voci.map(v => (
                <NavLink key={v.to} to={v.to} end={v.end} className={({ isActive }) => `side-voce ${isActive ? 'attiva' : ''}`}>
                  <Icona n={v.icona} /><span>{t(v.label)}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <div className="gest-velo no-print" onClick={() => setAperto(false)} />
      <div className="gest-col">
        <header className="gest-top no-print">
          <button className="gest-menu" onClick={() => setAperto(!aperto)} aria-expanded={aperto} aria-label={t('Menu')}><Icona n={aperto ? 'chiudi' : 'menu'} /></button>
          <img className="logo gest-top-logo" src="/logo-molajoni.png" alt="Molajoni Antincendi" />
          <div className="gest-crumb">{prodotto}{corrente && <><span aria-hidden="true">/</span><b>{t(corrente.label)}</b></>}</div>
          <span className="gest-top-sp" />
          {utilita}
          <details className="utente">
            <summary aria-label={t('Account')}><span className="avatar">{iniziali}</span></summary>
            <div className="utente-pop" onClick={e => { if ((e.target as HTMLElement).closest('a,button')) (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
              <div className="utente-mail">{email}</div>
              {menuUtente}
            </div>
          </details>
        </header>
        <main className="gest-main"><div className="wrap">{children}</div></main>
      </div>
    </div>
  );
}
