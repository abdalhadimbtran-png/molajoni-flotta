import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, rpc } from '../lib/supabase';
import { CATEGORIE, fmtOra } from '../lib/format';
import { useT } from '../lib/i18n';
import { attivaPush, registraSW, statoPush, type StatoPush } from '../lib/push';
import { Targa } from '../ui';

interface N { id: number; tipo: string; dati: Record<string, unknown>; link: string | null; creato_il: string; letta_il: string | null }

/** Notifiche del responsabile: veicoli fermi, incidenti, riepilogo scadenze. */
export default function Campanella() {
  const { t, tm, locale, lingua } = useT();
  const nav = useNavigate();
  const [l, setL] = useState<N[]>([]);
  const [aperta, setAperta] = useState(false);
  const [push, setPush] = useState<StatoPush | null>(null);
  const carica = useCallback(async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return;
    const { data } = await supabase.from('notifiche').select('id,tipo,dati,link,creato_il,letta_il').eq('user_id', u.user.id).order('creato_il', { ascending: false }).limit(20);
    setL((data ?? []) as N[]);
  }, []);
  useEffect(() => { registraSW(); carica(); statoPush().then(setPush); const k = window.setInterval(carica, 60000); return () => window.clearInterval(k); }, [carica]);
  const nonLette = l.filter(n => !n.letta_il).length;

  async function apri(n: N) {
    if (!n.letta_il) await supabase.from('notifiche').update({ letta_il: new Date().toISOString() }).eq('id', n.id);
    setAperta(false); carica(); if (n.link) nav(n.link);
  }
  async function attiva() {
    try { setPush(await attivaPush((e, p, a) => rpc('responsabile_salva_push', { p_endpoint: e, p_p256dh: p, p_auth: a, p_lingua: lingua }))); }
    catch { setPush('da_attivare'); }
  }

  return (
    <div className="bell-wrap">
      <button className="bell" aria-label={t('Notifiche')} onClick={() => setAperta(!aperta)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>
        {nonLette > 0 && <span className="bell-n">{nonLette}</span>}
      </button>
      {aperta && (
        <div className="bell-panel">
          <div className="bell-head"><b>{t('Notifiche')}</b>
            {push === 'da_attivare' && <button className="btn btn-sm" onClick={attiva}>{t('Attiva su questo dispositivo')}</button>}
            {push === 'attive' && <span className="sub">✓ {t('Attive su questo dispositivo')}</span>}
          </div>
          {l.length === 0 && <p className="sub" style={{ padding: 14 }}>{t('Nessuna notifica')}</p>}
          {l.map(n => {
            const d = n.dati as { targa?: string; categoria?: string; descrizione?: string; tecnico?: string; superate?: number; in_scadenza?: number; elenco?: string[] };
            return (
              <button key={n.id} className={`bell-item ${n.letta_il ? '' : 'nuova'}`} onClick={() => apri(n)}>
                {n.tipo === 'segnalazione_fermo' ? <>
                  <div className="row-flex"><b>{t('Veicolo fermo')}</b><Targa t={d.targa} /></div>
                  <div className="sub">{t(CATEGORIE[d.categoria ?? 'altro'])} · {d.tecnico}: {d.descrizione}</div>
                </> : <>
                  <b>{t('Scadenze flotta')}</b>
                  <div className="sub">{t('{a} superate, {b} in scadenza', { a: d.superate ?? 0, b: d.in_scadenza ?? 0 })}</div>
                  {(d.elenco ?? []).slice(0, 3).map((e, i) => <div key={i} className="sub">· {tm(e.split(' · ')[1] ?? e)} ({e.split(' · ')[0]})</div>)}
                </>}
                <div className="sub">{fmtOra(n.creato_il, locale)}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
