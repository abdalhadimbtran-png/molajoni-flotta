import { ReactNode, useCallback, useEffect, useState } from 'react';
import type { Livello, Messaggio } from './lib/format';
import { testoErrore } from './lib/supabase';

export const Pill = ({ s, children }: { s: Livello; children: ReactNode }) => <span className={`pill ${s}`}>{children}</span>;

export const Msgs = ({ items }: { items: Messaggio[] }) => (
  <div className="msgs">{items.map((x, i) => <div key={i} className={`msg ${x.l}`}>{x.m}</div>)}</div>
);

export const Banner = ({ s, children }: { s: 'ok' | 'ko' | 'warn'; children: ReactNode }) => <div className={`banner ${s}`}>{children}</div>;

export function Modal({ titolo, onClose, children }: { titolo: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={titolo}>
        <div className="modal-head"><h2>{titolo}</h2><button className="btn-ghost btn-sm" onClick={onClose}>Chiudi</button></div>
        {children}
      </div>
    </div>
  );
}

/** Carica dati con stato di caricamento/errore e funzione di ricarica. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    setCaricamento(true);
    try { setData(await run()); setErrore(null); }
    catch (e) { setErrore(testoErrore(e)); }
    finally { setCaricamento(false); }
  }, [run]);
  useEffect(() => { reload(); }, [reload]);
  return { data, errore, caricamento, reload };
}

let toastTimer: number | undefined;
export function toast(msg: string) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg; el.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { if (el) el.hidden = true; }, 3500);
}

export const Caricamento = () => <p className="sub" style={{ padding: '24px 0' }}>Caricamento…</p>;
export const Errore = ({ testo, onRetry }: { testo: string; onRetry?: () => void }) => (
  <Banner s="ko">{testo} {onRetry && <button className="btn-ghost btn-sm" onClick={onRetry}>Riprova</button>}</Banner>
);
