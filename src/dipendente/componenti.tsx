import { ReactNode, useEffect, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Pill } from '../ui';
import { oggiISO } from '../lib/format';
import type { Livello } from '../lib/format';
import { nomeTipo, type Richiesta, type Saldo, type SaldoAnteprima, type StatoRichiesta } from './api';
import { dataDaTs, dataLunga, diffGiorni, fineMese, fmtPeriodo, fmtQuantita, fmtSaldo, giornoLungo, intervallo, nomeMese, num, type Unita } from './periodo';

/* ---------- Icone (tratto 2, come quelle dell'app tecnico) ---------- */
const Ico = ({ d }: { d: ReactNode }) => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
export const IcoCasa = () => <Ico d={<><path d="M3 11 12 4l9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>} />;
export const IcoFerie = () => <Ico d={<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /><path d="m9 15 2 2 4-4" /></>} />;
export const IcoProfilo = () => <Ico d={<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>} />;
export const IcoPiu = () => <Ico d={<path d="M12 5v14M5 12h14" />} />;
export const IcoSpunta = () => <Ico d={<><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>} />;
export const IcoFreccia = () => <Ico d={<path d="m9 6 6 6-6 6" />} />;

/* ---------- Stato della richiesta ---------- */
export const STATI_RICHIESTA: Record<StatoRichiesta, [Livello, string]> = {
  in_attesa: ['warn', 'In valutazione'], approvata: ['ok', 'Approvata'], rifiutata: ['ko', 'Rifiutata'], annullata: ['na', 'Annullata'],
};
export function PillStato({ stato, grande = false }: { stato: StatoRichiesta; grande?: boolean }) {
  const [l, testo] = STATI_RICHIESTA[stato] ?? ['na', stato];
  return <span className={grande ? 'pill-lg-wrap' : undefined}><Pill s={l}>{testo}</Pill></span>;
}

/** «Caricamento…» solo dopo 300 ms, per evitare lo sfarfallio. */
export function Attesa() {
  const [vedi, setVedi] = useState(false);
  useEffect(() => { const k = window.setTimeout(() => setVedi(true), 300); return () => window.clearTimeout(k); }, []);
  return vedi ? <p className="sub" role="status">Caricamento…</p> : null;
}

/* ---------- Saldo ---------- */
export interface SintesiSaldo { ferie: Saldo | null; oreTot: number | null; oreTipi: Saldo[] }
export function sintesiSaldi(saldi: Saldo[] | undefined): SintesiSaldo {
  const l = saldi ?? [];
  const ferie = l.find(s => s.tipo === 'FERIE') ?? null;
  const oreTipi = l.filter(s => s.unita === 'ore');
  return { ferie, oreTipi, oreTot: oreTipi.length ? Math.round(oreTipi.reduce((a, s) => a + Number(s.saldo), 0) * 100) / 100 : null };
}
const Neg = ({ n, children }: { n: number; children: ReactNode }) => <b className={n < 0 ? 'neg' : undefined}>{children}</b>;

export function RiquadroSaldo({ saldi, variante, inAttesa = 0 }: { saldi: Saldo[] | undefined; variante: 'grande' | 'compatto'; inAttesa?: number }) {
  const { ferie, oreTot } = sintesiSaldi(saldi);
  if (!ferie && oreTot == null) {
    return <section className={`tec-card saldo ${variante}`}><p>Il tuo saldo non è ancora pronto. Puoi già fare una richiesta.</p></section>;
  }
  const oggi = oggiISO();
  const prossima = ferie && ferie.mesi_maturati < 12 && Number(ferie.quota_mensile) > 0 ? fineMese(oggi) : null;
  if (variante === 'compatto') return (
    <p className="saldo-riga">
      Ti restano {ferie && <><Neg n={ferie.saldo}>{fmtSaldo(Number(ferie.saldo), 'giorni')}</Neg> di ferie</>}
      {ferie && oreTot != null && ' e '}
      {oreTot != null && <><Neg n={oreTot}>{fmtSaldo(oreTot, 'ore')}</Neg> di permesso</>}
    </p>
  );
  return (
    <section className="tec-card saldo grande" aria-label="Il tuo saldo">
      <span className="lbl-sm">Ti restano</span>
      {ferie && <div className={`saldo-num${ferie.saldo < 0 ? ' neg' : ''}`}>{fmtSaldo(Number(ferie.saldo), 'giorni')} <span>di ferie</span></div>}
      {oreTot != null && <div className="saldo-ore">{ferie ? 'e ' : ''}<b className={oreTot < 0 ? 'neg' : undefined}>{fmtSaldo(oreTot, 'ore')}</b> di permesso</div>}
      {inAttesa > 0 && <div className="sub">{inAttesa === 1 ? '1 richiesta in valutazione non è ancora tolta dal saldo.' : `${inAttesa} richieste in valutazione non sono ancora tolte dal saldo.`}</div>}
      {prossima && ferie && <div className="sub">A fine {nomeMese(prossima)} maturi altri {fmtSaldo(Number(ferie.quota_mensile), 'giorni')} di ferie.</div>}
    </section>
  );
}

/* ---------- Passi ---------- */
export function PassiRichiesta({ passo }: { passo: 1 | 2 | 3 }) {
  const testo = `Passo ${passo} di 3`;
  return (
    <div className="passi-wrap" aria-label={testo}>
      <div className="passi" aria-hidden="true">{[1, 2, 3].map(n => <span key={n} className={n <= passo ? 'on' : ''} />)}</div>
      <span className="sub">{testo}</span>
    </div>
  );
}

/* ---------- Card della richiesta ---------- */
const META_RE = /^Mezza giornata: (mattina|pomeriggio)(?: · )?/;
/** La metà della giornata (mattina/pomeriggio) è scritta in testa alla nota: l'API non ha un campo apposito. */
export const metaDaNota = (note: string | null) => (note?.match(META_RE)?.[1] as 'mattina' | 'pomeriggio' | undefined) ?? null;
export const notaPulita = (note: string | null) => (note ?? '').replace(META_RE, '').trim() || null;
export const periodoDi = (r: Richiesta, breve = false) => fmtPeriodo({ ...r, meta: metaDaNota(r.note) }, breve);

export function CardRichiesta({ r, compatta = false }: { r: Richiesta; compatta?: boolean }) {
  const attesaDa = r.stato === 'in_attesa' ? diffGiorni(dataDaTs(r.creato_il), oggiISO()) : 0;
  return (
    <Link className="tec-card card-richiesta" to={`/t/ferie/${r.id}`}>
      <div className="cr-testa"><b>{nomeTipo(r.tipo, r.tipo_descrizione)}</b><PillStato stato={r.stato} /></div>
      <div>{periodoDi(r, true)}</div>
      {!compatta && <div className="sub">{fmtQuantita(Number(r.quantita), r.unita)} · inviata il {dataLunga(dataDaTs(r.creato_il))}</div>}
      {r.stato === 'rifiutata' && r.motivo_decisione && <div className="msg ko">Motivo: {r.motivo_decisione}</div>}
      {attesaDa > 3 && <div className="sub">In valutazione da {attesaDa} giorni</div>}
      <span className="cr-freccia"><IcoFreccia /></span>
    </Link>
  );
}

/* ---------- Riepilogo ---------- */
export interface DatiRiepilogo {
  tipo: string; tipoDescrizione?: string; unita: Unita; primo: string; ultimo: string; rientro: string;
  oraInizio?: string | null; oraFine?: string | null; mezza: boolean; meta?: 'mattina' | 'pomeriggio' | null;
  quantita: number; festivitaEscluse?: { data: string; nome: string }[]; note?: string | null;
}

export function RiepilogoRichiesta({ d, saldi, conSaldo, modificabile }: {
  d: DatiRiepilogo; saldi?: SaldoAnteprima[]; conSaldo?: boolean; modificabile?: (passo: 1 | 2) => void;
}) {
  const cambia = (p: 1 | 2) => modificabile && <button type="button" className="link" onClick={() => modificabile(p)}>Cambia</button>;
  const assente = d.oraInizio ? `${giornoLungo(d.primo)}, dalle ${d.oraInizio} alle ${d.oraFine}`
    : d.mezza ? `${giornoLungo(d.primo)}, ${d.meta ? `la ${d.meta}` : 'mezza giornata'}`
    : intervallo(d.primo, d.ultimo);
  const nomeT = nomeTipo(d.tipo, d.tipoDescrizione);
  return (
    <div className="tec-card">
      <div className="cr-testa"><span className="tec-h2">{nomeT}</span>{cambia(1)}</div>
      <dl className="riepilogo">
        <dt>Assente</dt><dd>{assente}</dd><dd className="az">{cambia(2)}</dd>
        {!d.oraInizio && !d.mezza && <><dt>Torni</dt><dd>{giornoLungo(d.rientro)}</dd><dd className="az" /></>}
        <dt>Conteggio</dt>
        <dd><b>{fmtQuantita(d.quantita, d.unita)}</b>{d.unita === 'giorni' && d.quantita !== 0.5 ? ` di ${nomeT.toLowerCase()}` : ''}
          {(d.festivitaEscluse ?? []).map(f => <div key={f.data} className="sub">Non conta {giornoLungo(f.data)} ({f.nome})</div>)}</dd><dd className="az" />
        {d.note && <><dt>Nota</dt><dd>{d.note}</dd><dd className="az">{cambia(2)}</dd></>}
      </dl>
      {conSaldo === false && <p className="sub">Questa assenza non tocca le tue ferie.</p>}
      {conSaldo !== false && saldi && saldi.length > 0 && saldi.map(s => {
        const prima = Number(s.saldo) - Number(s.in_attesa);
        return (
          <div key={s.anno} className="saldo-dopo">
            <div className="lbl-sm">{d.unita === 'ore' ? 'Ore di permesso' : 'Ferie'} che ti restano a fine {nomeMese(s.alla_data)}{s.alla_data.slice(0, 4) !== oggiISO().slice(0, 4) ? ` ${s.anno}` : ''}</div>
            <div className="mini-stat">
              <span>senza questa<b className={prima < 0 ? 'neg' : undefined}>{num(prima)}</b></span>
              <span>dopo questa<b className={s.saldo_dopo < 0 ? 'neg' : undefined}>{num(Number(s.saldo_dopo))}</b></span>
            </div>
            {Number(s.in_attesa) > 0 && <span className="sub">Sono già tolte le altre richieste in valutazione ({fmtSaldo(Number(s.in_attesa), d.unita)}).</span>}
            {s.insufficiente && <div className="ph-msg warn">Dopo questa richiesta ti mancano {fmtSaldo(-Number(s.saldo_dopo), d.unita)} di {d.unita === 'ore' ? 'permesso' : 'ferie'}. Puoi inviarla lo stesso: decide l'ufficio personale.</div>}
            {s.spettanza_mancante && <span className="sub">L'ufficio personale non ha ancora impostato le ferie di quest'anno: il numero può cambiare.</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- Navigazione ---------- */
const VOCI = [
  { to: '/t', label: 'Home', ico: <IcoCasa />, end: true },
  { to: '/t/ferie', label: 'Ferie', ico: <IcoFerie />, end: false },
  { to: '/t/profilo', label: 'Profilo', ico: <IcoProfilo />, end: false },
];
/** Barra in basso (telefono). Su computer le stesse voci stanno nella barra in alto. */
export function BarraDipendente() {
  return (
    <nav className="tec-nav" aria-label="Menu">
      {VOCI.map(v => <NavLink key={v.to} to={v.to} end={v.end} className={({ isActive }) => (isActive ? 'on' : '')}>{v.ico}<span>{v.label}</span></NavLink>)}
    </nav>
  );
}
export function VociAlto({ onEsci }: { onEsci: () => void }) {
  return (
    <nav className="tec-voci" aria-label="Menu">
      {VOCI.map(v => <NavLink key={v.to} to={v.to} end={v.end} className={({ isActive }) => (isActive ? 'on' : '')}>{v.label}</NavLink>)}
      <button className="esci" onClick={onEsci}>Esci</button>
    </nav>
  );
}

/* ---------- Conferma (Modal con il focus su «No») ---------- */
export function Conferma({ titolo, testo, si, no, onSi, onNo, invio }: { titolo: string; testo: string; si: string; no: string; onSi: () => void; onNo: () => void; invio?: boolean }) {
  const noRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    noRef.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onNo(); };
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [onNo]);
  return (
    <div className="modal" onClick={e => { if (e.target === e.currentTarget) onNo(); }}>
      <div className="modal-card conferma" role="alertdialog" aria-modal="true" aria-labelledby="conf-t" aria-describedby="conf-d">
        <h2 id="conf-t">{titolo}</h2>
        <p id="conf-d">{testo}</p>
        <div className="conferma-az">
          <button className="btn brand big" onClick={onSi} disabled={invio}>{invio ? 'Invio…' : si}</button>
          <button ref={noRef} className="btn-ghost big-ghost" onClick={onNo}>{no}</button>
        </div>
      </div>
    </div>
  );
}
