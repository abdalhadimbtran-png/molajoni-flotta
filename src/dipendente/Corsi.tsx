import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { rpc } from '../lib/supabase';
import { URL_FUNZIONI } from '../lib/push';
import { comprimi } from '../formazione/comune';
import { leggiToken, useSessione } from './api';
import { Attesa } from './componenti';
import { dataLunga } from './periodo';

export interface MioCorso { corso: string; data_conseguimento: string | null; data_scadenza: string | null; stato: string; attestati: { id: number; nome: string }[] }
export interface RichiestaMia { id: number; corso: string; stato: 'richiesto' | 'da_verificare' | 'approvato' | 'rifiutato'; motivo: string | null }
const PILL: Record<string, [string, string]> = { valido: ['ok', 'Valido'], in_scadenza: ['warn', 'In scadenza'], scaduto: ['ko', 'Scaduto'], mancante: ['ko', 'Da fare'] };

const giorniA = (iso: string) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z')) / 86400000);
const entro6Mesi = (iso: string | null) => { if (!iso) return false; const g = giorniA(iso); return g >= 0 && g <= 183; };

export async function caricaCorsi(token: string) {
  const [corsi, richieste] = await Promise.all([rpc<MioCorso[]>('dipendente_corsi', { p_token: token }), rpc<RichiestaMia[]>('dipendente_attestati_richiesti', { p_token: token })]);
  return { corsi, richieste };
}
/** Cose da fare: attestati da caricare (richiesti o rifiutati) e corsi in scadenza entro 6 mesi. */
export function daFare(d: { corsi: MioCorso[]; richieste: RichiestaMia[] }) {
  return { caricare: d.richieste.filter(r => r.stato === 'richiesto' || r.stato === 'rifiutato').length,
    scadenza: d.corsi.filter(c => c.data_scadenza && (entro6Mesi(c.data_scadenza) || giorniA(c.data_scadenza) < 0)).length };
}

/** Contatore per la barra in basso e la home (si aggiorna cambiando pagina). */
export function useDaFareCorsi() {
  const loc = useLocation();
  const [n, setN] = useState<{ caricare: number; scadenza: number } | null>(null);
  useEffect(() => {
    const t = leggiToken(); if (!t) { setN(null); return; }
    caricaCorsi(t).then(d => setN(daFare(d))).catch(() => setN(null));
  }, [loc.pathname]);
  return n;
}

export function CardCorsiHome() {
  const n = useDaFareCorsi();
  if (!n || (!n.caricare && !n.scadenza)) return null;
  const parti = [n.caricare && `${n.caricare} ${n.caricare === 1 ? 'attestato da caricare' : 'attestati da caricare'}`, n.scadenza && `${n.scadenza} da rinnovare`].filter(Boolean);
  return <Link to="/t/corsi" className={`ph-msg ${n.caricare ? 'ko' : 'warn'}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}><b>Corsi:</b> {parti.join(' / ')} →</Link>;
}

async function apriMioAttestato(token: string, id: number) {
  const w = window.open('', '_blank');
  const r = await fetch(`${URL_FUNZIONI}/attestato`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, id }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) { w?.close(); alert(j.errore === 'SESSIONE_NON_VALIDA' ? 'Accedi di nuovo.' : 'Attestato non disponibile.'); return; }
  if (w) w.location.href = j.url; else window.location.href = j.url;
}

export default function Corsi() {
  const { token } = useSessione();
  const [d, setD] = useState<{ corsi: MioCorso[]; richieste: RichiestaMia[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [invio, setInvio] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const carica = useCallback(() => caricaCorsi(token).then(setD).catch(() => setErr('Non riesco a caricare i corsi. Riprova.')), [token]);
  useEffect(() => { carica(); }, [carica]);
  async function invia(id: number, f: File | undefined) {
    if (!f) return;
    setInvio(id); setMsg(null);
    try {
      const g = await comprimi(f);
      if (g.size > 10 * 1024 * 1024) throw new Error('Il file è troppo grande (massimo 10 MB).');
      const fd = new FormData(); fd.append('token', token); fd.append('richiesta_id', String(id)); fd.append('file', g, g.name);
      const r = await fetch(`${URL_FUNZIONI}/carica-attestato`, { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.errore === 'SESSIONE_NON_VALIDA' ? 'Accedi di nuovo.' : j.errore || 'Caricamento non riuscito.');
      setMsg('Attestato inviato. Il responsabile lo controllerà.'); carica();
    } catch (e) { setMsg((e as Error).message); } finally { setInvio(null); }
  }
  if (err) return <div className="ph-msg ko">{err}</div>;
  if (!d) return <Attesa />;
  const aperte = d.richieste.filter(r => r.stato !== 'approvato');
  const scad = d.corsi.filter(c => entro6Mesi(c.data_scadenza)).sort((a, b) => a.data_scadenza!.localeCompare(b.data_scadenza!));
  const fatti = d.corsi.filter(c => c.data_conseguimento);
  return (
    <>
      <h1 className="tec-h1">I miei corsi</h1>
      {msg && <div className="ph-msg info">{msg}</div>}
      {aperte.length > 0 && (
        <section className="tec-card" style={{ borderColor: 'var(--ko-line)', background: 'var(--ko-bg)' }}>
          <div className="lbl-sm" style={{ color: 'var(--ko)' }}>Da caricare</div>
          {aperte.map(r => (
            <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <b style={{ fontSize: 17 }}>{r.corso}</b>
              {r.stato === 'da_verificare' && <span><span className="pill warn">In verifica</span></span>}
              {r.stato === 'rifiutato' && <span style={{ color: 'var(--ko)' }}><span className="pill ko">Rifiutato</span> {r.motivo}</span>}
              {(r.stato === 'richiesto' || r.stato === 'rifiutato') && (
                <label className="big-btn primary" style={{ justifyContent: 'center', cursor: 'pointer' }}>
                  {invio === r.id ? 'Invio…' : r.stato === 'rifiutato' ? 'Ricarica foto/PDF' : 'Carica foto/PDF'}
                  <input type="file" accept="image/*,application/pdf" hidden disabled={invio != null} onChange={e => { invia(r.id, e.target.files?.[0]); e.target.value = ''; }} />
                </label>)}
            </div>))}
        </section>)}
      {scad.length > 0 && (
        <section className="tec-card">
          <div className="lbl-sm">In scadenza</div>
          {scad.map((c, i) => {
            const g = giorniA(c.data_scadenza!);
            return <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <span style={{ minWidth: 0 }}><b>{c.corso}</b><span className="sub" style={{ display: 'block' }}>Scade il {dataLunga(c.data_scadenza!)}</span></span>
              <b style={{ color: g <= 30 ? 'var(--ko)' : 'var(--warn)', whiteSpace: 'nowrap' }}>{g === 0 ? 'oggi' : `${g} gg`}</b></div>;
          })}
        </section>)}
      <section className="tec-card">
        <div className="lbl-sm">I miei corsi</div>
        {fatti.length === 0 && <p className="sub">Nessun corso registrato.</p>}
        {fatti.map((c, i) => {
          const [l, t] = PILL[c.stato] ?? ['na', c.stato];
          return (
            <div key={i} style={{ paddingBottom: 10, borderBottom: '1px solid var(--line)', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}><b style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{c.corso}</b><span className={`pill ${l}`}>{t}</span></div>
              <span className="sub">Conseguito il {dataLunga(c.data_conseguimento!)}</span>
              <span className="sub">{c.data_scadenza ? `${c.stato === 'scaduto' ? 'Scaduto il' : 'Scade il'} ${dataLunga(c.data_scadenza)}` : 'Nessuna scadenza'}</span>
              {c.attestati?.map((a, j) => <button key={a.id} className="btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => apriMioAttestato(token, a.id)}>Vedi attestato{c.attestati.length > 1 ? ` ${j + 1}` : ''}</button>)}
            </div>);
        })}
        {d.corsi.some(c => c.stato === 'mancante') && <p className="sub">Corsi obbligatori da fare: {d.corsi.filter(c => c.stato === 'mancante').map(c => c.corso).join(', ')}.</p>}
        <span className="sub">Un corso manca o è sbagliato? Avvisa il responsabile della formazione.</span>
      </section>
    </>
  );
}
