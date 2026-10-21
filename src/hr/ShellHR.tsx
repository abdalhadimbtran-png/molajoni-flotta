import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { useT } from '../lib/i18n';
import { Caricamento } from '../ui';
import { Icona, Layout, type Gruppo } from '../admin/Barra';
import { InstallaApp } from '../Installa';
import type { CtxHR } from './comune';

type Stato = 'caricamento' | 'anonimo' | 'non_abilitato' | 'ok';

/** Sessione dell'area Ufficio personale: is_hr() (vero anche per l'amministratore). */
export function useSessioneHR() {
  const [sessione, setSessione] = useState<Session | null>(null);
  const [stato, setStato] = useState<Stato>('caricamento');
  const [admin, setAdmin] = useState(false);
  const [mio, setMio] = useState<{ dipendente: number | null; nome: string }>({ dipendente: null, nome: '' });
  useEffect(() => {
    let attivo = true;
    async function verifica(s: Session | null) {
      if (!attivo) return;
      setSessione(s);
      if (!s) { setStato('anonimo'); return; }
      const [h, a, r] = await Promise.all([
        supabase.rpc('is_hr'), supabase.rpc('is_admin'),
        supabase.from('responsabili').select('nome,dipendente_id').eq('user_id', s.user.id).maybeSingle(),
      ]);
      if (!attivo) return;
      setAdmin(!a.error && a.data === true);
      setMio({ dipendente: (r.data?.dipendente_id as number | null) ?? null, nome: (r.data?.nome as string | null) || s.user.email || '' });
      setStato(!h.error && h.data === true ? 'ok' : 'non_abilitato');
    }
    supabase.auth.getSession().then(({ data }) => verifica(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { verifica(s); });
    return () => { attivo = false; sub.subscription.unsubscribe(); };
  }, []);
  return { sessione, stato, admin, mio };
}

/** Numero di richieste in valutazione (aggiornato ogni 60 s, come la campanella). */
function useInAttesa(attivo: boolean) {
  const [n, setN] = useState(0);
  const carica = useCallback(async () => {
    if (!attivo) return;
    const { count } = await supabase.from('richieste_assenza').select('id', { count: 'exact', head: true }).eq('stato', 'in_attesa');
    setN(count ?? 0);
  }, [attivo]);
  useEffect(() => { carica(); const k = window.setInterval(carica, 60000); return () => window.clearInterval(k); }, [carica]);
  return { n, carica };
}

export default function ShellHR() {
  const { sessione, stato, admin, mio } = useSessioneHR();
  const { t } = useT();
  const loc = useLocation();
  const { n, carica } = useInAttesa(stato === 'ok');
  useEffect(() => {
    const base = 'Molajoni · Ufficio personale';
    document.title = n > 0 ? `(${n}) Da decidere · ${base}` : base;
    return () => { document.title = 'Molajoni'; };
  }, [n]);

  if (stato === 'caricamento') return <div className="wrap"><Caricamento /></div>;
  if (stato === 'anonimo') return <Navigate to="/accesso" replace state={{ da: loc.pathname + loc.search }} />;
  if (stato === 'non_abilitato') return (
    <div className="wrap narrow">
      <h1>{t('Account non abilitato')}</h1>
      <p className="subtitle">{t("L'account {email} non è abilitato per l'ufficio personale. Chiedi all'amministratore di abilitarlo.", { email: sessione?.user.email ?? '' })}</p>
      <button className="btn-ghost" onClick={() => supabase.auth.signOut()}>{t('Esci')}</button>
    </div>
  );

  const gruppi: Gruppo[] = [
    { titolo: 'Richieste', voci: [
      { to: '/hr', label: 'Da decidere', icona: 'hr-richieste', end: true, badge: n },
      { to: '/hr/calendario', label: 'Calendario assenze', icona: 'piano' }] },
    { titolo: 'Persone', voci: [
      { to: '/hr/dipendenti', label: 'Dipendenti', icona: 'tecnici' }, { to: '/hr/saldi', label: 'Saldi', icona: 'hr-saldi' }] },
    { titolo: 'Impostazioni', voci: [
      { to: '/hr/impostazioni', label: 'Festività e regole', icona: 'hr-festivita' }, { to: '/hr/report', label: 'Report', icona: 'report' }] },
  ];
  const ctx: CtxHR = { admin, mioDipendente: mio.dipendente, nomeAccount: mio.nome, aggiornaContatore: carica };
  return (
    <div className="hr-area">
      <Layout prodotto={t('Ufficio personale')} gruppi={gruppi} email={sessione?.user.email ?? ''}
        utilita={<><InstallaApp variante="admin" /><CampanellaHR /></>}
        menuUtente={<>
          {admin && <NavLink to="/cruscotto"><Icona n="cruscotto" />{t('Pannello flotta')}</NavLink>}
          {admin && <NavLink to="/admin"><Icona n="sicurezza" />{t('Amministrazione')}</NavLink>}
          <button onClick={() => supabase.auth.signOut()}><Icona n="ritorno" />{t('Esci')}</button>
        </>}>
        <Outlet context={ctx} />
      </Layout>
    </div>
  );
}

interface N { id: number; tipo: string; dati: { titolo?: string; testo?: string; richiesta_id?: number }; link: string | null; creato_il: string; letta_il: string | null }

/** Notifiche dell'ufficio personale (nuove richieste, annullamenti, promemoria). */
function CampanellaHR() {
  const { t } = useT();
  const nav = useNavigate();
  const [l, setL] = useState<N[]>([]);
  const [aperta, setAperta] = useState(false);
  const carica = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase.from('notifiche').select('id,tipo,dati,link,creato_il,letta_il').eq('user_id', u.user.id).order('creato_il', { ascending: false }).limit(20);
    setL((data ?? []) as N[]);
  }, []);
  useEffect(() => { carica(); const k = window.setInterval(carica, 60000); return () => window.clearInterval(k); }, [carica]);
  const nonLette = l.filter(n => !n.letta_il).length;
  async function apri(n: N) {
    if (!n.letta_il) await supabase.from('notifiche').update({ letta_il: new Date().toISOString() }).eq('id', n.id);
    setAperta(false); carica();
    const r = n.dati?.richiesta_id;
    if (n.link?.startsWith('/hr')) nav(r ? `/hr?r=${r}` : '/hr'); else if (n.link) nav(n.link);
  }
  return (
    <div className="bell-wrap">
      <button className="bell" aria-label={t('Notifiche')} onClick={() => setAperta(!aperta)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {nonLette > 0 && <span className="bell-n">{nonLette}</span>}
      </button>
      {aperta && (
        <div className="bell-panel">
          <div className="bell-head"><b>{t('Notifiche')}</b></div>
          {l.length === 0 && <p className="sub" style={{ padding: 14 }}>{t('Nessuna notifica')}</p>}
          {l.map(n => (
            <button key={n.id} className={`bell-item ${n.letta_il ? '' : 'nuova'}`} onClick={() => apri(n)}>
              <b>{n.dati?.titolo ?? t('Avviso')}</b>
              {n.dati?.testo && <div className="sub">{n.dati.testo}</div>}
              <div className="sub">{fmtOra(n.creato_il)}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
