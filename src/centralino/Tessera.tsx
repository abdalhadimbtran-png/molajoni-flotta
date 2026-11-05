import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { kpi, linkAnalisi, valuta, type Dataset, type Filtri } from '../lib/centralino/registro';
import { useCtx } from './ShellCentralino';

/** Numero che «conta» fino al valore nuovo (animazione breve). */
export function Numero({ v }: { v: number | string }) {
  const [x, setX] = useState(v);
  const prec = useRef(v);
  useEffect(() => {
    if (typeof v !== 'number' || typeof prec.current !== 'number' || v === prec.current) { setX(v); prec.current = v; return; }
    const da = prec.current, t0 = performance.now(); let f = 0;
    const passo = (t: number) => { const k = Math.min(1, (t - t0) / 450); setX(Math.round(da + (v - da) * k)); if (k < 1) f = requestAnimationFrame(passo); };
    f = requestAnimationFrame(passo); prec.current = v;
    return () => cancelAnimationFrame(f);
  }, [v]);
  return <>{x}</>;
}

/** Tessera KPI dal registro: il numero e la lista del dettaglio vengono dalla stessa funzione. Clic → /analisi. */
export function Tessera({ id, d, da, a, f, sub, soglia, rossoSe, titolo }: { id: string; d: Dataset; da: string; a: string; f?: Filtri; sub?: ReactNode; soglia?: number; rossoSe?: boolean; titolo?: string }) {
  const ctx = useCtx();
  const def = kpi(id);
  if (!def) return null;
  const v = valuta(def, d, f);
  const val = def.den ? (v.pct == null ? '—' : `${v.pct}%`) : v.n;
  const liv = rossoSe ? (v.n ? 'ko' : 'ok') : soglia != null && v.pct != null ? (v.pct < soglia ? 'warn' : 'ok') : '';
  return (
    <Link to={linkAnalisi(ctx.base, id, da, a, f)} className={`kpi ct-tessera ${liv}`} title={`${def.spiegazione} Clic per vedere l'elenco.`}>
      <div className="num">{typeof val === 'number' ? <Numero v={val} /> : val}</div>
      <div className="lbl">{titolo ?? def.titolo}</div>
      <div className="sub">{sub ?? (def.den ? `${v.n} su ${v.den}` : 'apri l\'elenco')}</div>
    </Link>
  );
}

/** Numero cliccabile dentro una tabella. */
export function Cifra({ id, d, da, a, f, pct }: { id: string; d: Dataset; da: string; a: string; f?: Filtri; pct?: boolean }) {
  const ctx = useCtx();
  const def = kpi(id); if (!def) return null;
  const v = valuta(def, d, f);
  return <Link className="ct-cifra" to={linkAnalisi(ctx.base, id, da, a, f)}>{pct && def.den ? (v.pct == null ? '—' : `${v.pct}%`) : v.n}</Link>;
}
