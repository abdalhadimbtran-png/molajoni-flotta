import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from '../admin/Barra';
import { useSessione } from '../admin/Shell';

/** Area Formazione: is_formazione() (responsabile formazione o amministratore). */
export default function ShellFormazione() {
  const s = useSessione();
  const loc = useLocation();
  useEffect(() => { document.title = 'Molajoni · Formazione'; return () => { document.title = 'Molajoni'; }; }, []);
  // controllo scadenze all'apertura (idempotente; c'è anche il controllo giornaliero automatico)
  useEffect(() => { if (s.formazione) supabase.rpc('formazione_controlla').then(() => undefined); }, [s.formazione]);
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
      { to: '/formazione/registra', label: 'Assegna corso', icona: 'attivita' },
      { to: '/formazione/archivio', label: 'Archivio attestati', icona: 'registro' }] },
    { titolo: 'Impostazioni', voci: [
      { to: '/formazione/corsi', label: 'Corsi', icona: 'registro' },
      { to: '/formazione/report', label: 'Report', icona: 'report' }] },
  ];
  return (
    <div className="hr-area form-area">
      <Layout prodotto="Formazione" gruppi={gruppi} email={s.sessione?.user.email ?? ''} utilita={<Campanella />}
        menuUtente={<>
          {s.admin && <NavLink to="/admin"><Icona n="sicurezza" />Amministrazione</NavLink>}
          <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />Esci</button>
        </>}>
        <Outlet />
      </Layout>
    </div>
  );
}

interface N { id: number; dati: { titolo?: string; testo?: string }; link: string | null; creato_il: string; letta_il: string | null }
function Campanella() {
  const nav = useNavigate();
  const [l, setL] = useState<N[]>([]);
  const [aperta, setAperta] = useState(false);
  const carica = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser(); if (!u.user) return;
    const { data } = await supabase.from('notifiche').select('id,dati,link,creato_il,letta_il').eq('user_id', u.user.id).order('creato_il', { ascending: false }).limit(30);
    setL((data ?? []) as N[]);
  }, []);
  useEffect(() => { carica(); const k = window.setInterval(carica, 60000); return () => window.clearInterval(k); }, [carica]);
  const nonLette = l.filter(n => !n.letta_il).length;
  async function apri(n: N) {
    if (!n.letta_il) await supabase.from('notifiche').update({ letta_il: new Date().toISOString() }).eq('id', n.id);
    setAperta(false); carica(); if (n.link) nav(n.link);
  }
  return (
    <div className="bell-wrap">
      <button className="bell" aria-label="Notifiche" onClick={() => setAperta(!aperta)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {nonLette > 0 && <span className="bell-n">{nonLette}</span>}
      </button>
      {aperta && (
        <div className="bell-panel">
          <div className="bell-head"><b>Notifiche</b></div>
          {l.length === 0 && <p className="sub" style={{ padding: 14 }}>Nessuna notifica</p>}
          {l.map(n => (
            <button key={n.id} className={`bell-item ${n.letta_il ? '' : 'nuova'}`} onClick={() => apri(n)}>
              <b>{n.dati?.titolo ?? 'Avviso'}</b>{n.dati?.testo && <div className="sub">{n.dati.testo}</div>}<div className="sub">{fmtOra(n.creato_il)}</div>
            </button>))}
        </div>)}
    </div>
  );
}
