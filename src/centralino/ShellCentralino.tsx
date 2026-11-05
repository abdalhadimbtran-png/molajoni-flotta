import { useEffect, useRef, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from '../admin/Barra';
import { useSessione } from '../admin/Shell';
import { Campanella } from '../formazione/ShellFormazione';
import { NOME_TIPO, type Pratica } from '../lib/centralino/tipi';
import { cerca } from './comune';
import { Ic } from './componenti';
import NuovoContatto from './NuovoContatto';
import './centralino.css';

export interface CtxCentralino { scrive: boolean; base: string; nuovo: () => void; versione: number; aggiorna: () => void }
export const useCtx = () => useOutletContext<CtxCentralino>();

/**
 * Area Centralino (is_centralino: admin o responsabile con centralino) e pagina Direzione (is_direzione, sola lettura).
 * /centralino/* → chi scrive; un account solo-direzione viene portato su /direzione/centralino (stesse pagine, sola lettura).
 */
export default function ShellCentralino() {
  const s = useSessione();
  const loc = useLocation();
  const nav = useNavigate();
  const [aperto, setAperto] = useState(false);
  const [versione, setVersione] = useState(0);
  const direzione = loc.pathname.startsWith('/direzione');
  useEffect(() => { document.title = direzione ? 'Molajoni · Direzione' : 'Molajoni · Centralino'; return () => { document.title = 'Molajoni'; }; }, [direzione]);
  // controllo SLA all'apertura (c'è anche il controllo automatico ogni 5 minuti)
  useEffect(() => { if (s.centralino || s.direzione) supabase.rpc('centralino_controlla_sla').then(() => undefined); }, [s.centralino, s.direzione]);
  const scrive = s.centralino && !direzione;
  // N = nuovo contatto (fuori dai campi di testo)
  useEffect(() => {
    if (!scrive) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input,textarea,select,[contenteditable],.modal')) return;
      e.preventDefault(); setAperto(true);
    };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [scrive]);

  if (s.stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (s.stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname + loc.search }} />;
  const soloTrasf = loc.pathname === '/centralino/trasferimenti' && !s.centralino && !s.direzione;
  if (!direzione && !s.centralino && s.direzione) return <Navigate to={loc.pathname.replace(/^\/centralino/, '/direzione/centralino').replace('/direzione/centralino/pratiche', '/direzione/centralino')} replace />;
  if (!soloTrasf && ((direzione && !s.direzione) || (!direzione && !s.centralino))) return (
    <div className="wrap narrow">
      <h1>Account non abilitato</h1>
      <p className="subtitle">L'account {s.sessione?.user.email ?? ''} non è abilitato per {direzione ? 'la direzione' : 'il centralino'}. Chiedi all'amministratore di abilitarlo.</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>Esci</button>
    </div>
  );
  const base = direzione ? '/direzione/centralino' : '/centralino';
  const gruppi: Gruppo[] = soloTrasf ? [{ titolo: 'Centralino', voci: [{ to: '/centralino/trasferimenti', label: 'Chiamate da richiamare', icona: 'telefono' }] }] : direzione ? [
    { titolo: 'Direzione', voci: [{ to: '/direzione/centralino', label: 'Monitoraggio centralino', icona: 'panoramica', end: true }] },
    ...(s.centralino ? [{ titolo: 'Centralino', voci: [{ to: '/centralino', label: 'Apri il centralino', icona: 'telefono', end: true }] }] : []),
  ] : [
    { titolo: 'Centralino', voci: [
      { to: '/centralino', label: 'Da fare', icona: 'cruscotto', end: true },
      { to: '/centralino/pratiche', label: 'Tutte le pratiche', icona: 'pratiche' },
      { to: '/centralino/trasferimenti', label: 'Chiamate trasferite', icona: 'telefono' }] },
    { titolo: 'Strumenti', voci: [
      { to: '/centralino/modelli', label: 'Modelli email', icona: 'email' },
      { to: '/centralino/report', label: 'Report', icona: 'report' },
      { to: '/centralino/impostazioni', label: 'Flussi e impostazioni', icona: 'impostazioni' }] },
    ...(s.direzione ? [{ titolo: 'Direzione', voci: [{ to: '/direzione/centralino', label: 'Monitoraggio', icona: 'panoramica', end: true }] }] : []),
  ];
  const ctx: CtxCentralino = { scrive, base, nuovo: () => setAperto(true), versione, aggiorna: () => setVersione(v => v + 1) };
  return (
    <div className="hr-area ct-area">
      <Layout prodotto={direzione ? 'Direzione' : 'Centralino'} gruppi={gruppi} email={s.sessione?.user.email ?? ''}
        utilita={<>
          {!soloTrasf && <Ricerca base={base} />}
          {scrive && <button className="btn ct-nuovo-btn" onClick={() => setAperto(true)} title="Nuovo contatto (tasto N)"><Ic n="piu" size={18} /><span>Nuovo contatto</span><kbd>N</kbd></button>}
          <Campanella />
        </>}
        menuUtente={<>
          {s.admin && <NavLink to="/admin"><Icona n="sicurezza" />Amministrazione</NavLink>}
          <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />Esci</button>
        </>}>
        <Outlet context={ctx} />
      </Layout>
      {aperto && <NuovoContatto onClose={() => setAperto(false)} onCreata={(id, tr) => { setAperto(false); setVersione(v => v + 1); nav(`/centralino/pratica/${id}?nuova=1${tr ? '&trasferisci=1' : ''}`); }} />}
    </div>
  );
}

/** Ricerca globale: cliente, telefono, numero pratica. */
function Ricerca({ base }: { base: string }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [r, setR] = useState<Pratica[] | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) { setR(null); return; }
    const k = window.setTimeout(() => { cerca(q).then(x => { setR(x); setSel(0); }, () => setR([])); }, 220);
    return () => window.clearTimeout(k);
  }, [q]);
  useEffect(() => {
    const f = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setR(null); };
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f);
  }, []);
  const apri = (p: Pratica) => { setQ(''); setR(null); nav(`${base}/pratica/${p.id}`); };
  return (
    <div className="ct-cerca" ref={box}>
      <Ic n="cerca" size={17} />
      <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cliente, telefono, CT-…" aria-label="Cerca pratiche"
        onKeyDown={e => {
          if (!r?.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setSel(Math.min(sel + 1, r.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setSel(Math.max(sel - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); apri(r[sel]); }
          if (e.key === 'Escape') setR(null);
        }} />
      {r && (
        <div className="ct-cerca-pop" role="listbox">
          {r.length === 0 && <div className="sub" style={{ padding: 12 }}>Nessuna pratica trovata</div>}
          {r.map((p, i) => (
            <button key={p.id} role="option" aria-selected={i === sel} className={i === sel ? 'sel' : ''} onMouseEnter={() => setSel(i)} onClick={() => apri(p)}>
              <b>{p.cliente_nome}</b><span className="sub">{p.numero} · {NOME_TIPO[p.tipo]}{p.telefono ? ` · ${p.telefono}` : ''}{p.esito !== 'aperta' ? ' · chiusa' : ''}</span>
            </button>))}
        </div>)}
    </div>
  );
}
