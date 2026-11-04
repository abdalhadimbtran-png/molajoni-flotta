import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../../lib/supabase';
import { useT } from '../../lib/i18n';
import { Banner, Caricamento, Errore, toast } from '../../ui';
import { ottimizza, type Matrice } from '../../lib/percorsi/ottimizza';
import { ErroreServizio, geocodifica, linkGoogleMaps, matrice, traccia, type Risultato as Geo } from '../../lib/percorsi/routing';
import { SceltaAttivita } from '../Settimana';
import { OPZIONI_DEFAULT, TIPI_ALLEGATO, allegatiAttivi, apriAllegato, caricaAllegato, avvisiStatici, calcola, leggiSede, nuovaTappa, oggi, percorso, salva, salvaSede, type Allegato, type Luogo, type Percorso, type Tappa } from '../../lib/percorsi/piano';

const Mappa = lazy(() => import('./Mappa'));
interface Tec { id: number; nome: string; cognome: string }
const CHIP = [15, 30, 45, 60, 90, 120];
const chiaveBozza = (d: string, t: number | null) => `molajoni_percorsi_bozza_${d}_${t ?? 'x'}`;
const chiavePunto = (id: string, l: Luogo) => `${id}@${l.lat},${l.lon}`;

/** Campo indirizzo con suggerimenti (Nominatim, attesa 1 s dopo l'ultima battuta, risultati in cache). */
function Indirizzo({ valore, onScelta, placeholder }: { valore: Luogo; onScelta: (l: Luogo) => void; placeholder: string }) {
  const { t } = useT();
  const [q, setQ] = useState(valore.indirizzo);
  const [lista, setLista] = useState<Geo[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [aperto, setAperto] = useState(false);
  const toccato = useRef(false);
  useEffect(() => { setQ(valore.indirizzo); }, [valore.indirizzo]);
  useEffect(() => {
    if (!toccato.current || q.trim().length < 4) { setLista([]); return; }
    let vivo = true;
    const h = window.setTimeout(async () => {
      try {
        const r = await geocodifica(q);
        if (!vivo) return;
        setLista(r); setAperto(true); setMsg(r.length ? null : t('Indirizzo non trovato. Prova ad aggiungere il comune o il CAP.'));
      } catch (e) { if (vivo) setMsg(e instanceof ErroreServizio ? t(e.message) : t('Ricerca non riuscita.')); }
    }, 1100);
    return () => { vivo = false; window.clearTimeout(h); };
  }, [q, t]);
  return (
    <div className="perc-ind">
      <input value={q} placeholder={placeholder} onChange={e => { toccato.current = true; setQ(e.target.value); if (valore.lat != null) onScelta({ ...valore, indirizzo: e.target.value, lat: null, lon: null }); }}
        onFocus={() => setAperto(lista.length > 0)} onBlur={() => window.setTimeout(() => setAperto(false), 200)} />
      {valore.lat != null ? <span className="perc-ok">✓ {t('posizione trovata')}</span> : q && <span className="perc-no">{t('scegli un suggerimento')}</span>}
      {msg && <div className="hint">{msg}</div>}
      {aperto && lista.length > 0 && <ul className="perc-sugg">{lista.map((r, i) =>
        <li key={i}><button type="button" onMouseDown={() => { toccato.current = false; setQ(r.etichetta); setAperto(false); setLista([]); onScelta({ ...valore, indirizzo: r.etichetta, lat: r.lat, lon: r.lon }); }}>{r.etichetta}</button></li>)}</ul>}
    </div>
  );
}

export default function Pianificatore() {
  const { t, tm, locale } = useT();
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const [tecnici, setTecnici] = useState<Tec[]>([]);
  const [p, setP] = useState<Percorso | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [mat, setMat] = useState<{ chiavi: string[]; m: Matrice } | null>(null);
  const [errCalc, setErrCalc] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const [linea, setLinea] = useState<[number, number][] | null>(null);
  const [sede, setSedeEdit] = useState(false);

  useEffect(() => {
    supabase.from('tecnici').select('id,nome,cognome').eq('attivo', true).order('cognome').then(({ data }) => setTecnici((data ?? []) as Tec[]));
  }, []);
  useEffect(() => {
    (async () => {
      try {
        if (id) { setP(await percorso(Number(id))); return; }
        const data = sp.get('data') || oggi(); const tec = sp.get('tecnico') ? Number(sp.get('tecnico')) : null;
        let bozza: Percorso | null = null;
        try { bozza = JSON.parse(localStorage.getItem(chiaveBozza(data, tec)) || 'null'); } catch { /* nulla */ }
        setP(bozza && !bozza.id ? bozza : { data, tecnico_id: tec, partenza: leggiSede(), stops: [nuovaTappa()], opzioni: { ...OPZIONI_DEFAULT, ora: sp.get('ora') || OPZIONI_DEFAULT.ora }, risultato: null, stato: 'bozza' });
      } catch (e) { setErrore(testoErrore(e)); }
    })();
  }, [id, sp]);
  // bozza locale automatica
  useEffect(() => { if (p) try { localStorage.setItem(chiaveBozza(p.data, p.tecnico_id), JSON.stringify(p)); } catch { /* nulla */ } }, [p]);

  // ricalcolo dal vivo: stesso insieme di punti della matrice → nuova timeline nell'ordine attuale
  const sottoMatrice = (pp: Percorso): Matrice | null => {
    if (!mat) return null;
    const chiavi = [chiavePunto('sede', pp.partenza), ...pp.stops.map(s => chiavePunto(s.id, s))];
    const idx = chiavi.map(k => mat.chiavi.indexOf(k));
    if (idx.some(i => i < 0)) return null;
    return { durate: idx.map(i => idx.map(j => mat.m.durate[i][j])), distanze: idx.map(i => idx.map(j => mat.m.distanze[i][j])) };
  };
  const conRisultato = (pp: Percorso): Percorso => {
    const m = sottoMatrice(pp);
    if (!m) return { ...pp, risultato: null };
    try { return { ...pp, risultato: calcola(m, pp.stops.map((_, i) => i + 1), pp.stops, pp.partenza, pp.opzioni) }; }
    catch { return { ...pp, risultato: null }; }
  };
  const aggiorna = (f: (x: Percorso) => Percorso) => setP(x => x ? conRisultato({ ...f(x), stato: x.stato === 'confermato' ? 'bozza' : x.stato }) : x);
  useEffect(() => { setP(x => x ? conRisultato(x) : x); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [mat]);

  const pronto = p && p.partenza.lat != null && p.stops.length > 0 && p.stops.every(s => s.lat != null);
  async function calcolaOrdine(soloOrdine = false) {
    if (!p || !pronto) return;
    setLavoro(true); setErrCalc(null);
    try {
      let m = sottoMatrice(p);
      const chiavi = [chiavePunto('sede', p.partenza), ...p.stops.map(s => chiavePunto(s.id, s))];
      if (!m || !soloOrdine) {
        const mm = await matrice([p.partenza as { lat: number; lon: number }, ...p.stops.map(s => s as { lat: number; lon: number })]);
        setMat({ chiavi, m: mm }); m = mm;
      }
      const prima = p.stops.findIndex(s => s.prima);
      const o = ottimizza(p.stops.map((_, i) => i + 1), prima >= 0 ? prima + 1 : null, m, paramDi(p));
      const stops = o.map(i => p.stops[i - 1]);
      const sub = { durate: [0, ...o].map(i => [0, ...o].map(j => m!.durate[i][j])), distanze: [0, ...o].map(i => [0, ...o].map(j => m!.distanze[i][j])) };
      setP({ ...p, stops, risultato: calcola(sub, stops.map((_, i) => i + 1), stops, p.partenza, p.opzioni), stato: 'bozza' });
    } catch (e) { setErrCalc(e instanceof ErroreServizio ? t(e.message) : t('Calcolo non riuscito. Controlla le tappe e riprova.')); }
    finally { setLavoro(false); }
  }
  const paramDi = (pp: Percorso) => {
    const o = pp.opzioni; const [h, mi] = o.ora.split(':').map(Number);
    return { partenza: h * 60 + mi, durate: [0, ...pp.stops.map(s => s.durata)], margine: o.margine, pausa: o.pausa, pausaDa: 810, pausaMin: 60, fasce: o.fasce, fattoreBase: o.fattoreBase };
  };

  // traccia sulla mappa (dopo 0,8 s di calma)
  const chiaveTraccia = p?.risultato && pronto ? [p.partenza, ...p.stops, p.partenza].map(x => `${x.lon},${x.lat}`).join(';') : '';
  useEffect(() => {
    if (!chiaveTraccia || !p) { setLinea(null); return; }
    let vivo = true;
    const h = window.setTimeout(() => {
      traccia([p.partenza, ...p.stops, p.partenza] as { lat: number; lon: number }[]).then(l => { if (vivo) setLinea(l); }).catch(() => { if (vivo) setLinea(null); });
    }, 800);
    return () => { vivo = false; window.clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chiaveTraccia]);

  const punti = useMemo(() => !p ? [] : [
    ...(p.partenza.lat != null ? [{ lat: p.partenza.lat, lon: p.partenza.lon!, etichetta: p.partenza.nome, sede: true }] : []),
    ...p.stops.filter(s => s.lat != null).map(s => ({ lat: s.lat!, lon: s.lon!, etichetta: s.nome || s.indirizzo })),
  ], [p]);

  async function registra(stato: 'bozza' | 'confermato') {
    if (!p) return;
    setLavoro(true);
    try {
      const nid = await salva({ ...p, stato });
      try { localStorage.removeItem(chiaveBozza(p.data, p.tecnico_id)); } catch { /* nulla */ }
      setP({ ...p, id: nid, stato });
      toast(stato === 'confermato' ? t('Percorso confermato.') : t('Bozza salvata.'));
      if (!id) nav(`/percorsi/${nid}`, { replace: true });
    } catch (e) {
      const s = testoErrore(e);
      toast(/duplicate|unique|percorsi_data_tecnico/i.test(s) ? t('Esiste già un percorso per questo tecnico in questa data. Aprilo dal cruscotto percorsi.') : s);
    } finally { setLavoro(false); }
  }

  if (errore) return <Errore testo={errore} />;
  if (!p) return <Caricamento />;
  const R = p.risultato;
  const tec = tecnici.find(x => x.id === p.tecnico_id);
  const statici = avvisiStatici(p).filter(a => a !== 'Percorso non calcolato');
  const muovi = (i: number, d: number) => aggiorna(x => {
    const s = [...x.stops]; const j = i + d; if (j < 0 || j >= s.length) return x;
    [s[i], s[j]] = [s[j], s[i]]; return { ...x, stops: s };
  });
  const setTappa = (i: number, v: Partial<Tappa>) => aggiorna(x => ({ ...x, stops: x.stops.map((s, k) => k === i ? { ...s, ...v } : (v.prima ? { ...s, prima: false } : s)) }));
  const fissaPrima = p.stops.findIndex(s => s.prima);

  return (
    <div className="percorsi">
      <div className="page-hero no-print">
        <div><Link to={`/percorsi?data=${p.data}`} className="sub">← {t('Percorsi')}</Link>
          <h1>{t('Percorso giornaliero')}</h1>
          <p className="sub">{p.id ? (p.stato === 'confermato' ? t('Confermato') : t('Bozza salvata')) : t('Nuovo percorso (bozza automatica su questo dispositivo)')}</p></div>
      </div>
      <h2 className="solo-stampa">{t('Percorso del {d}', { d: new Date(p.data + 'T12:00').toLocaleDateString(locale) })}{tec ? ` · ${tec.nome} ${tec.cognome}` : ''}</h2>

      <div className="card perc-box no-print">
        <div className="form grid2">
          <div className="field"><label>{t('Tecnico')}</label>
            <select value={p.tecnico_id ?? ''} onChange={e => aggiorna(x => ({ ...x, tecnico_id: e.target.value ? Number(e.target.value) : null }))}>
              <option value="">{t('— nessuno —')}</option>{tecnici.map(x => <option key={x.id} value={x.id}>{x.nome} {x.cognome}</option>)}</select></div>
          <div className="field"><label>{t('Data')}</label><input type="date" value={p.data} onChange={e => aggiorna(x => ({ ...x, data: e.target.value }))} /></div>
          <div className="field"><label>{t('Partenza')}</label>
            <div className="perc-sede"><strong>{p.partenza.nome}</strong> <span className="sub">{p.partenza.indirizzo || t('indirizzo non impostato')}</span>
              <button className="btn-ghost btn-sm" onClick={() => setSedeEdit(!sede)}>{t('Modifica sede')}</button></div>
            {sede && <div className="perc-sede-edit">
              <input value={p.partenza.nome} onChange={e => aggiorna(x => ({ ...x, partenza: { ...x.partenza, nome: e.target.value } }))} />
              <Indirizzo valore={p.partenza} placeholder={t('Indirizzo della sede')} onScelta={l => aggiorna(x => ({ ...x, partenza: l }))} />
              <button className="btn btn-sm" disabled={p.partenza.lat == null} onClick={() => { salvaSede(p.partenza); setSedeEdit(false); toast(t('Sede salvata come predefinita.')); }}>{t('Salva come sede predefinita')}</button>
            </div>}</div>
          <div className="field"><label>{t('Ora di partenza')}</label><input type="time" value={p.opzioni.ora} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, ora: e.target.value || '08:00' } }))} /></div>
        </div>
      </div>

      <div className="section-title no-print">{t('Tappe')} <span className="meta">{t('{n} tappe · rientro in sede sempre incluso', { n: p.stops.length })}</span></div>
      <div className="perc-tappe no-print">
        {p.stops.map((s, i) => (
          <div className="card perc-tappa" key={s.id}>
            <div className="perc-num">{i + 1}</div>
            <div className="perc-campi">
              <Indirizzo valore={s} placeholder={t('Indirizzo (via, civico, comune)')} onScelta={l => setTappa(i, l)} />
              <input value={s.nome} placeholder={t('Nome (facoltativo): cliente, condominio…')} onChange={e => setTappa(i, { nome: e.target.value })} />
              <SceltaAttivita valore={s.attivita ?? ''} onChange={(nome, durata) => setTappa(i, durata ? { attivita: nome, durata } : { attivita: nome })} />
              <textarea value={s.note ?? ''} placeholder={t('Note per il tecnico (accesso, referente, materiale…)')} onChange={e => setTappa(i, { note: e.target.value })} style={{ minHeight: 60 }} />
              <div className="perc-allegati">
                {allegatiAttivi(s).map(a => <span key={a.path} className="perc-all">
                  <button type="button" className="linklike" onClick={() => apriAllegato(a).catch(e => toast(testoErrore(e)))}>📎 {a.nome}</button>
                  <button type="button" className="linklike" aria-label={t('Rimuovi')} onClick={() => setTappa(i, { allegati: (s.allegati ?? []).map(x => x.path === a.path ? { ...x, rimosso: true } : x) })}>×</button></span>)}
                <label className="btn-ghost btn-sm">{t('+ Allegati')}<input type="file" multiple hidden accept={TIPI_ALLEGATO} onChange={async e => {
                  const files = [...(e.target.files ?? [])]; e.target.value = '';
                  const nuovi: Allegato[] = [];
                  for (const f of files) { try { nuovi.push(await caricaAllegato(p.data, s.id, f)); } catch (er) { toast(er instanceof Error && !('code' in er) ? t(er.message) : testoErrore(er)); } }
                  if (nuovi.length) setP(x => x && { ...x, stops: x.stops.map(y => y.id === s.id ? { ...y, allegati: [...(y.allegati ?? []), ...nuovi] } : y) });
                }} /></label>
                <span className="hint">{t('foto, PDF, Word, Excel · max 10 MB')}</span>
              </div>
              <div className="perc-durata"><span className="lbl-sm">{t('Durata intervento')}</span>
                {CHIP.map(c => <button key={c} type="button" className={`perc-chip ${s.durata === c ? 'on' : ''}`} onClick={() => setTappa(i, { durata: c })}>{c}′</button>)}
                <input type="number" min={5} max={600} step={5} value={s.durata} onChange={e => setTappa(i, { durata: Math.max(0, Number(e.target.value) || 0) })} style={{ width: 80 }} /> min</div>
              <label className="perc-check"><input type="checkbox" checked={s.prima} onChange={e => setTappa(i, { prima: e.target.checked })} /> {t('Prima tappa obbligatoria')}</label>
            </div>
            <div className="perc-azioni">
              <button className="btn-ghost btn-sm" aria-label={t('Su')} disabled={i === 0} onClick={() => muovi(i, -1)}>↑</button>
              <button className="btn-ghost btn-sm" aria-label={t('Giù')} disabled={i === p.stops.length - 1} onClick={() => muovi(i, 1)}>↓</button>
              <button className="btn-ghost btn-sm" onClick={() => aggiorna(x => ({ ...x, stops: x.stops.filter((_, k) => k !== i) }))}>{t('Elimina')}</button>
            </div>
          </div>))}
        <button className="btn-ghost" onClick={() => aggiorna(x => ({ ...x, stops: [...x.stops, nuovaTappa()] }))}>{t('+ Aggiungi tappa')}</button>
      </div>

      <div className="card perc-box no-print">
        <label className="perc-check"><input type="checkbox" checked={p.opzioni.pausa} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, pausa: e.target.checked } }))} /> {t('Pausa pranzo 13:30–14:30')}</label>
        <div className="perc-durata"><span className="lbl-sm">{t('Margine per ogni tratto')}</span>
          {[5, 7, 10].map(c => <button key={c} type="button" className={`perc-chip ${p.opzioni.margine === c ? 'on' : ''}`} onClick={() => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, margine: c } }))}>{c} min</button>)}</div>
        <details className="perc-imp"><summary>{t('Impostazioni stima')}</summary>
          <p className="hint">{t('OSRM non conosce il traffico reale: ogni tratto è moltiplicato per il fattore della fascia oraria in cui parte.')}</p>
          {p.opzioni.fasce.map((f, k) => <div key={k} className="perc-fascia">
            <input type="time" value={f.da} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, fasce: x.opzioni.fasce.map((y, j) => j === k ? { ...y, da: e.target.value } : y) } }))} />–
            <input type="time" value={f.a} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, fasce: x.opzioni.fasce.map((y, j) => j === k ? { ...y, a: e.target.value } : y) } }))} /> ×
            <input type="number" step={0.05} min={1} max={3} value={f.fattore} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, fasce: x.opzioni.fasce.map((y, j) => j === k ? { ...y, fattore: Number(e.target.value) || 1 } : y) } }))} style={{ width: 80 }} /></div>)}
          <div className="perc-fascia">{t('Altri orari')} × <input type="number" step={0.05} min={1} max={3} value={p.opzioni.fattoreBase} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, fattoreBase: Number(e.target.value) || 1 } }))} style={{ width: 80 }} /></div>
          <div className="perc-fascia">{t('Avviso se la giornata finisce dopo le')} <input type="time" value={p.opzioni.sogliaFine} onChange={e => aggiorna(x => ({ ...x, opzioni: { ...x.opzioni, sogliaFine: e.target.value || '18:00' } }))} /></div>
        </details>
      </div>

      <div className="perc-bar no-print">
        <button className="btn brand" disabled={!pronto || lavoro} onClick={() => calcolaOrdine(false)}>{lavoro ? t('Calcolo…') : t('Calcola percorso')}</button>
        {R && <button className="btn-ghost" disabled={lavoro} onClick={() => calcolaOrdine(true)}>{t('Ricalcola ordine migliore')}</button>}
        {!pronto && <span className="hint">{p.partenza.lat == null ? t('Imposta prima l\'indirizzo della sede (Modifica sede).') : t('Ogni tappa deve avere un indirizzo scelto dai suggerimenti.')}</span>}
      </div>
      {errCalc && <Banner s="ko">{errCalc}</Banner>}
      {statici.map(a => <Banner key={a} s="warn">{tm(a)}</Banner>)}

      {R && <>
        {R.avvisi.map(a => <Banner key={a} s="warn">{tm(a)}</Banner>)}
        <div className="kpis perc-kpi">
          <div className="kpi"><div className="lbl">{t('Km totali')}</div><div className="num">{R.totali.km.toLocaleString(locale)}</div></div>
          <div className="kpi"><div className="lbl">{t('Guida (con margini)')}</div><div className="num">{Math.floor(R.totali.guida / 60)}h {R.totali.guida % 60}′</div></div>
          <div className="kpi"><div className="lbl">{t('Lavoro')}</div><div className="num">{Math.floor(R.totali.lavoro / 60)}h {R.totali.lavoro % 60}′</div></div>
          <div className="kpi"><div className="lbl">{t('Fine giornata')}</div><div className="num">{R.totali.fine}</div><div className="sub">{t('partenza {o}', { o: R.totali.partenza })}</div></div>
        </div>
        <p className="hint">{t('Stima con correzione traffico: fattore ×{f} fuori fascia, ×1,15–1,35 nelle ore di punta (vedi Impostazioni stima). Margine {m} min per tratto.', { f: p.opzioni.fattoreBase, m: p.opzioni.margine })}</p>
        <div className="table-wrap"><table className="perc-tab">
          <thead><tr><th>#</th><th>{t('Luogo')}</th><th>{t('Arrivo')}</th><th>{t('Durata')}</th><th>{t('Partenza')}</th><th>{t('Tratto successivo')}</th></tr></thead>
          <tbody>
            <tr className="perc-sede-riga"><td>S</td><td>{p.partenza.nome}</td><td>—</td><td>—</td><td>{R.totali.partenza}</td><td /></tr>
            {(() => { let n = 0; return R.righe.map((r, k) => r.tipo === 'pausa'
              ? <tr key={k} className="perc-pausa"><td>☕</td><td>{tm(r.luogo)}</td><td>{r.arrivo}</td><td>{r.durata}′</td><td>{r.partenza}</td><td /></tr>
              : r.tipo === 'rientro'
                ? <tr key={k} className="perc-sede-riga"><td>S</td><td>{t('Rientro: {s}', { s: p.partenza.nome })}</td><td><strong>{r.arrivo}</strong></td><td /><td /><td /></tr>
                : <tr key={k}><td>{++n}</td><td>{(() => { const st = p.stops.find(s => s.id === r.id); const al = st ? allegatiAttivi(st) : []; return <>
                  <strong>{r.luogo}</strong>{st?.prima ? <span className="pill info" style={{ marginInlineStart: 6 }}>{t('prima')}</span> : null}
                  {st?.attivita && <div className="perc-att">{st.attivita}</div>}
                  {st?.note && <div className="perc-note">{st.note}</div>}
                  {al.length > 0 && <div className="perc-note">📎 {al.map(a => a.nome).join(', ')}</div>}</>; })()}</td><td>{r.arrivo}</td><td>{r.durata}′</td><td>{r.partenza}</td>
                  <td>{r.min != null ? `${r.min} min · ${r.km?.toLocaleString(locale)} km · ×${r.fattore}` : ''}</td></tr>); })()}
          </tbody></table></div>
        <div className="perc-bar no-print">
          <a className="btn-ghost" target="_blank" rel="noreferrer" href={linkGoogleMaps(p.partenza as { lat: number; lon: number }, p.stops as { lat: number; lon: number }[])}>{t('Apri in Google Maps')}</a>
          {p.stops.length > 9 && <span className="hint">{t('Google Maps accetta al massimo 9 tappe: le successive non sono incluse.')}</span>}
          <button className="btn-ghost" onClick={() => window.print()}>{t('Stampa / PDF')}</button>
        </div>
      </>}

      {punti.length > 0 && <Suspense fallback={<Caricamento />}><Mappa punti={punti} linea={linea} /></Suspense>}

      <div className="perc-bar no-print perc-salva">
        <button className="btn-ghost" disabled={lavoro} onClick={() => registra('bozza')}>{t('Salva bozza')}</button>
        <button className="btn" disabled={lavoro || !R} onClick={() => registra('confermato')}>{t('Conferma percorso')}</button>
        {fissaPrima >= 0 && <span className="hint">{t('La tappa {n} resta sempre la prima.', { n: fissaPrima + 1 })}</span>}
      </div>
    </div>
  );
}
