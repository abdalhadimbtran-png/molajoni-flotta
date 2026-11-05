import { useEffect, useRef, useState } from 'react';
import { leggiAppunti, salvaAppunti } from './comune';

/** Appunti personali durante la chiamata: li vede solo chi li scrive (RLS). Salvataggio automatico. */
export default function Appunti({ chiave, righe = 6, onTesto }: { chiave: string; righe?: number; onTesto?: (t: string) => void }) {
  const [t, setT] = useState('');
  const [stato, setStato] = useState<'' | 'salvo' | 'salvato'>('');
  const pronto = useRef(false);
  useEffect(() => { pronto.current = false; leggiAppunti(chiave).then(x => { setT(x); onTesto?.(x); pronto.current = true; }); }, [chiave]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!pronto.current) return;
    setStato('salvo'); onTesto?.(t);
    const k = window.setTimeout(() => { salvaAppunti(chiave, t).then(() => setStato('salvato')); }, 700);
    return () => window.clearTimeout(k);
  }, [t, chiave]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ct-appunti">
      <div className="ct-appunti-h"><b>Appunti</b><span className="sub">solo per te · non vanno nella storia né ai report</span><span className="sub ct-appunti-s">{stato === 'salvo' ? 'salvo…' : stato === 'salvato' ? 'salvati' : ''}</span></div>
      <textarea rows={righe} value={t} onChange={e => setT(e.target.value)} placeholder="Scrivi qui mentre parli con il cliente…" aria-label="Appunti personali" />
    </div>
  );
}
