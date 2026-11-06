import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate, useOutletContext } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from '../admin/Barra';
import { useSessione } from '../admin/Shell';
import { Campanella } from '../formazione/ShellFormazione';
import { NOME_TIPO, type Pratica } from '../lib/centralino/tipi';
import { cerca } from './comune';
import { Ic } from './componenti';
import { toast } from '../ui';

const SUONO = 'ct_suono_avvisi';
export const suonoAttivo = () => { try { return localStorage.getItem(SUONO) === '1'; } catch { return false; } };
/** Suono discreto (due note brevi), solo se attivato dall'utente. */
export function bip() {
  try {
    const C = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext); const a = new C();
    [660, 880].forEach((f, i) => { const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0.0001, a.currentTime + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.08, a.currentTime + i * 0.16 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + i * 0.16 + 0.14);
      o.connect(g).connect(a.destination); o.start(a.currentTime + i * 0.16); o.stop(a.currentTime + i * 0.16 + 0.15); });
  } catch { /* nessun audio */ }
}
import NuovoContatto from './NuovoContatto';
import './centralino.css';
import '../design/tokens.css';

/** Direzione grafica (ramo design-premium): ?tema=apple|graphite|heritage, ricordata nel browser. */
const TEMI = ['apple', 'graphite', 'heritage'] as const;
function temaIniziale(): string {
  try {
    const q = new URLSearchParams(location.search).get('tema');
    if (q && (TEMI as readonly string[]).includes(q)) { localStorage.setItem('ct_tema', q); return q; }
    const v = localStorage.getItem('ct_tema'); if (v && (TEMI as readonly string[]).includes(v)) return v;
  } catch { /* nessuna memoria */ }
  return 'apple';
}

export interface ClientePreset { codice: string | null; nome: string; fonte?: 'taylor' | 'pratiche' }
export interface CtxCentralino { scrive: boolean; base: string; nuovo: (cliente?: ClientePreset) => void; versione: number; aggiorna: () => void }
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
  const [preset, setPreset] = useState<ClientePreset | undefined>(undefined);
  const [versione, setVersione] = useState(0);
  const direzione = loc.pathname.startsWith('/direzione');
  useEffect(() => { const r = document.documentElement; r.dataset.theme = temaIniziale(); return () => { delete r.dataset.theme; }; }, []);
  useEffect(() => { document.title = direzione ? 'Molajoni · Direzione' : 'Molajoni · Centralino'; return () => { document.title = 'Molajoni'; }; }, [direzione]);
  // controllo SLA all'apertura (c'è anche il controllo automatico ogni 5 minuti)
  useEffect(() => { if (s.centralino || s.direzione) supabase.rpc('centralino_controlla_sla').then(() => undefined); }, [s.centralino, s.direzione]);
  const scrive = s.centralino && !direzione;
  const [suono, setSuono] = useState(suonoAttivo);
  // tempo reale: pratiche, storia, trasferimenti → le pagine si aggiornano da sole; campanella → avviso (e suono se attivo)
  useEffect(() => {
    if (!s.sessione || !(s.centralino || s.direzione)) return;
    let k = 0;
    const agg = () => { window.clearTimeout(k); k = window.setTimeout(() => setVersione(v => v + 1), 400); };
    const uid = s.sessione.user.id;
    const ch = supabase.channel('centralino-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pratiche' }, agg)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pratiche_eventi' }, agg)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chiamate_trasferite' }, agg)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifiche', filter: `user_id=eq.${uid}` }, msg => {
        const d = (msg.new as { dati?: { titolo?: string; categoria?: string } }).dati;
        if (d?.categoria === 'centralino') { toast(d.titolo ?? 'Nuovo avviso'); if (suonoAttivo()) bip(); }
      })
      .subscribe();
    return () => { window.clearTimeout(k); supabase.removeChannel(ch); };
  }, [s.sessione, s.centralino, s.direzione]);
  // N = nuovo contatto (fuori dai campi di testo)
  useEffect(() => {
    if (!scrive) return;
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey || t.closest('input,textarea,select,[contenteditable],.modal')) return;
      e.preventDefault(); setPreset(undefined); setAperto(true);
    };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [scrive]);

  useEffect(() => { if (loc.pathname === '/centralino/nuovo' && s.centralino) { setPreset(undefined); setAperto(true); nav('/centralino', { replace: true }); } }, [loc.pathname, s.centralino]); // eslint-disable-line react-hooks/exhaustive-deps
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
    { titolo: 'Lavoro', voci: [
      { to: '/centralino', label: 'Oggi', icona: 'cruscotto', end: true },
      { to: '/centralino/nuovo', label: 'Nuovo contatto', icona: 'attivita' },
      { to: '/centralino/pratiche', label: 'Pratiche', icona: 'pratiche' },
      { to: '/centralino/trasferimenti', label: 'Trasferimenti e richiami', icona: 'telefono' },
      { to: '/centralino/clienti', label: 'Clienti', icona: 'tecnici' }] },
    { titolo: 'Dati', voci: [
      { to: '/centralino/monitoraggio', label: 'Analisi', icona: 'panoramica' },
      { to: '/centralino/report', label: 'Report', icona: 'report' }] },
    { titolo: 'Configurazione', voci: [
      { to: '/centralino/modelli', label: 'Modelli email', icona: 'email' },
      { to: '/centralino/referenti', label: 'Referenti', icona: 'account' },
      { to: '/centralino/impostazioni', label: 'Impostazioni', icona: 'impostazioni' }] },
  ];
  const ctx: CtxCentralino = { scrive, base, nuovo: c => { setPreset(c); setAperto(true); }, versione, aggiorna: () => setVersione(v => v + 1) };
  return (
    <div className="hr-area ct-area">
      <Layout prodotto={direzione ? 'Direzione' : 'Centralino'} gruppi={gruppi} email={s.sessione?.user.email ?? ''}
        utilita={<>
          {!soloTrasf && <StatoLive base={base} versione={versione} />}
          {!soloTrasf && <Ricerca base={base} />}
          {scrive && <button className="btn ct-nuovo-btn" onClick={() => { setPreset(undefined); setAperto(true); }} title="Nuovo contatto (tasto N)"><Ic n="piu" size={18} /><span>Nuovo contatto</span><kbd>N</kbd></button>}
          <Campanella />
        </>}
        menuUtente={<>
          <button onClick={() => { const n = !suono; setSuono(n); try { localStorage.setItem(SUONO, n ? '1' : '0'); } catch { /* */ } if (n) bip(); }}><Icona n="avvisi" />Suono degli avvisi: {suono ? 'sì' : 'no'}</button>
          {s.admin && <NavLink to="/admin"><Icona n="sicurezza" />Amministrazione</NavLink>}
          <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />Esci</button>
        </>}>
        <Outlet context={ctx} />
      </Layout>
      {aperto && <NuovoContatto cliente={preset} onClose={() => setAperto(false)} onCreata={(id, dopo) => { setAperto(false); setVersione(v => v + 1); nav(`/centralino/pratica/${id}?nuova=1${dopo ? `&${dopo}` : ''}`); }} />}
    </div>
  );
}

/** Stato in diretta nella barra: in scadenza (60 min), scadute, richiami dovuti. Clic → elenco. */
function StatoLive({ base, versione }: { base: string; versione: number }) {
  const [d, setD] = useState<{ ap: Pratica[]; tr: { richiamo_scadenza: string | null; richiamato_at: string | null }[] } | null>(null);
  const ora = useAdessoShell();
  useEffect(() => {
    let ok = true;
    const carica = () => Promise.all([
      supabase.from('pratiche').select('id,sla_scadenza').eq('esito', 'aperta').not('sla_scadenza', 'is', null).limit(2000),
      supabase.from('chiamate_trasferite').select('richiamo_scadenza,richiamato_at').is('richiamato_at', null).not('richiamo_scadenza', 'is', null).limit(2000),
    ]).then(([a, t]) => ok && setD({ ap: (a.data ?? []) as Pratica[], tr: (t.data ?? []) as { richiamo_scadenza: string | null; richiamato_at: string | null }[] }));
    carica(); const k = window.setInterval(carica, 60000);
    return () => { ok = false; window.clearInterval(k); };
  }, [versione]);
  if (!d) return null;
  const t = ora.getTime();
  const scadute = d.ap.filter(p => new Date(p.sla_scadenza!).getTime() < t).length;
  const inScad = d.ap.filter(p => { const x = new Date(p.sla_scadenza!).getTime(); return x >= t && x - t <= 3600e3; }).length;
  const richiami = d.tr.filter(x => new Date(x.richiamo_scadenza!).getTime() - t <= 3600e3).length;
  const oggi = new Date().toISOString().slice(0, 10), da30 = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  return (
    <div className="ct-live" aria-label="Situazione in diretta">
      <Link to={`${base}/analisi?kpi=in_scadenza&da=${oggi}&a=${oggi}`} className={`ct-live-c ${inScad ? 'arancio' : ''}`}><b>{inScad}</b> in scadenza</Link>
      <Link to={`${base}/analisi?kpi=in_ritardo&da=${oggi}&a=${oggi}`} className={`ct-live-c ${scadute ? 'rosso' : ''}`}><b>{scadute}</b> scadute</Link>
      <Link to={`${base}/analisi?kpi=richiami_dovuti&da=${da30}&a=${oggi}`} className={`ct-live-c ${richiami ? 'rosso' : ''}`}><b>{richiami}</b> richiami</Link>
    </div>
  );
}
function useAdessoShell() { const [t, setT] = useState(() => new Date()); useEffect(() => { const k = window.setInterval(() => setT(new Date()), 30000); return () => window.clearInterval(k); }, []); return t; }

/** Ricerca globale: cliente, telefono, numero pratica. */
function Ricerca({ base }: { base: string }) {
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [r, setR] = useState<Pratica[] | null>(null);
  const [sel, setSel] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const inp = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (e.key === '/' && !t.closest('input,textarea,select,[contenteditable]')) { e.preventDefault(); inp.current?.focus(); } };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, []);
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
      <input ref={inp} type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Cerca  /  cliente, telefono, CT-…" aria-label="Cerca pratiche"
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
