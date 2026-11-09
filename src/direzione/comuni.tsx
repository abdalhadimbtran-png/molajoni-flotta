import { ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { kpi, linkAnalisi, valuta, type Dataset, type Def, type Filtri } from '../lib/centralino/registro';
import { variazione } from '../lib/direzione/analisi';
import { giornoRoma } from '../lib/centralino/sla';
import { Numero } from '../centralino/Tessera';

export const BASE = '/direzione/centralino';
export const oggiRoma = () => giornoRoma(new Date());

export const FONTE: Record<Def['fonte'], string> = {
  pratiche: 'pratiche create nel periodo (tabella pratiche, con la loro storia)',
  aperte: 'pratiche aperte in questo momento, di qualunque giorno',
  chiuse: 'pratiche chiuse nel periodo (data di chiusura)',
  trasferimenti: 'chiamate trasferite / richiami del periodo (chiamate_trasferite)',
  contatti: 'pratiche del periodo + contatti solo informativi («+1»)',
  anagrafica: 'pratiche «modifica» + storia della rubrica clienti',
};

/** «i» con la definizione: numeratore, denominatore, fonte. Hover/focus o tocco. */
export function Info({ def }: { def: Def }) {
  const [aperto, setAperto] = useState(false);
  return (
    <span className="dz-info" onMouseEnter={() => setAperto(true)} onMouseLeave={() => setAperto(false)}>
      <button type="button" aria-label={`Come si calcola: ${def.titolo}`} onClick={e => { e.preventDefault(); e.stopPropagation(); setAperto(!aperto); }} onFocus={() => setAperto(true)} onBlur={() => setAperto(false)}>i</button>
      {aperto && <span className="dz-pop" role="tooltip"><b>{def.titolo}</b>{def.spiegazione}<span className="dz-fonte">Fonte: {FONTE[def.fonte]}{def.den ? ' · valore = numeratore / denominatore' : ' · valore = conteggio'}</span></span>}
    </span>
  );
}

/** ▲▼ rispetto al periodo precedente. `buono` = verso desiderato (su = meglio, giu = meglio, neutro). */
export function Delta({ att, prec, punti, buono = 'su' }: { att: number | null; prec: number | null; punti?: boolean; buono?: 'su' | 'giu' | 'neutro' }) {
  const v = variazione(att, prec, punti);
  if (!v) return <span className="dz-delta na" title="Nessun confronto possibile">—</span>;
  if (v.v === 0) return <span className="dz-delta na" title="Uguale al periodo precedente">= 0{punti ? ' pt' : '%'}</span>;
  const meglio = buono === 'neutro' ? null : (buono === 'su') === v.su;
  return <span className={`dz-delta ${meglio == null ? 'na' : meglio ? 'ok' : 'ko'}`} title={`Periodo precedente: ${prec}${punti ? '%' : ''}`}>{v.su ? '▲' : '▼'} {Math.abs(v.v)}{punti ? ' pt' : '%'}</span>;
}

/** Tessera KPI della Direzione: valore dal registro, confronto col precedente, definizione, clic → elenco. */
export function Kpi({ id, d, prev, da, a, f, soglia, rossoSe, buono, titolo, sub }: {
  id: string; d: Dataset; prev?: Dataset | null; da: string; a: string; f?: Filtri; soglia?: number; rossoSe?: boolean; buono?: 'su' | 'giu' | 'neutro'; titolo?: string; sub?: ReactNode;
}) {
  const def = kpi(id); if (!def) return null;
  const v = valuta(def, d, f);
  const p = prev ? valuta(def, prev, f) : null;
  const pctMode = !!def.den;
  const val = pctMode ? v.pct : v.n;
  const liv = rossoSe ? (v.n ? 'ko' : 'ok') : soglia != null && v.pct != null ? (v.pct < soglia ? 'warn' : 'ok') : '';
  return (
    <Link to={linkAnalisi(BASE, id, da, a, f)} className={`kpi dz-kpi ${liv}`}>
      <div className="dz-kpi-top"><span className="lbl">{titolo ?? def.titolo}</span><Info def={def} /></div>
      <div className="num">{val == null ? '—' : <><Numero v={val} />{pctMode ? '%' : ''}</>}</div>
      <div className="sub">{sub ?? (pctMode ? `${v.n} su ${v.den}` : 'apri l\'elenco')}{p && <> · <Delta att={val} prec={pctMode ? p.pct : p.n} punti={pctMode} buono={buono ?? (rossoSe ? 'giu' : pctMode ? 'su' : 'neutro')} /></>}</div>
    </Link>
  );
}

/** Numero cliccabile in tabella (dal registro). */
export function Cella({ id, d, da, a, f, pct }: { id: string; d: Dataset; da: string; a: string; f?: Filtri; pct?: boolean }) {
  const def = kpi(id); if (!def) return null;
  const v = valuta(def, d, f);
  return <Link className="ct-cifra" to={linkAnalisi(BASE, id, da, a, f)}>{pct && def.den ? (v.pct == null ? '—' : `${v.pct}%`) : v.n}</Link>;
}

/** Barre orizzontali semplici (una tinta), ordinate, con confronto facoltativo. */
export function Barre({ v }: { v: { l: string; n: number; to?: string; prec?: number }[] }) {
  const max = Math.max(1, ...v.map(x => x.n));
  if (!v.length || v.every(x => !x.n && !x.prec)) return <p className="ct-vuoto">Nessun dato nel periodo.</p>;
  return <div className="dz-barre">{[...v].sort((a, b) => b.n - a.n).map(x => {
    const r = <><span className="dz-bl">{x.l}</span><span className="dz-bt"><i style={{ width: `${(x.n / max) * 100}%` }} /></span><b>{x.n}</b>{x.prec != null && <Delta att={x.n} prec={x.prec} buono="neutro" />}</>;
    return x.to ? <Link key={x.l} to={x.to} className="dz-barra ct-clic">{r}</Link> : <div key={x.l} className="dz-barra">{r}</div>;
  })}</div>;
}

export function Sezione({ id, titolo, sub, azioni, children }: { id: string; titolo: string; sub?: string; azioni?: ReactNode; children: ReactNode }) {
  return <section id={id} className="dz-sez"><header><div><h2>{titolo}</h2>{sub && <p className="sub">{sub}</p>}</div>{azioni}</header>{children}</section>;
}
