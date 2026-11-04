import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../../lib/supabase';
import { useT } from '../../lib/i18n';
import { Banner, Caricamento, Errore, Pill, toast, useLoad } from '../../ui';
import { leggiFile, type Lettura } from '../../lib/interventi/importa';
import { baricentri, suggerisci, type Suggerimento } from '../../lib/interventi/suggerimenti';
import { geocodificaPrimo } from '../../lib/percorsi/routing';
import MappaInterventi from './MappaInterventi';
import { CAMPI, QUALITA, STATI, coloreTecnico, daVerificare, type Intervento } from './tipi';

interface Sigla { sigla: string; dipendente_id: number | null; attiva: boolean }
interface Tec { id: number; nome: string; cognome: string; codice: string | null }
type Vista = 'mappa' | 'tabella' | 'senza' | 'verifica' | 'sigle' | 'importa';

const fineMese = (m: string) => { const [a, b] = m.split('-').map(Number); return new Date(Date.UTC(a, b, 0)).toISOString().slice(0, 10); };
const nomeMese = (m: string) => new Date(`${m}-15T12:00`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });

/** Riepilogo per la panoramica amministratore e il cruscotto. */
export function RiepilogoInterventi() {
  const { t } = useT();
  const { data, caricamento } = useLoad(async () => {
    const im = await supabase.from('importazioni').select('mese').not('mese', 'is', null).order('mese', { ascending: false }).limit(1);
    const mese = (im.data?.[0]?.mese as string | undefined)?.slice(0, 7);
    if (!mese) return null;
    const r = await supabase.from('interventi_importati').select('tecnico_sigla,geo_qualita,geo_dubbio,lat,fuori_lazio').eq('fuori_lazio', false)
      .gte('data_riferimento', `${mese}-01`).lte('data_riferimento', fineMese(mese)).range(0, 4999);
    const l = (r.data ?? []) as Pick<Intervento, 'tecnico_sigla' | 'geo_qualita' | 'geo_dubbio' | 'lat' | 'fuori_lazio'>[];
    return { mese, tot: l.length, senza: l.filter(x => !x.tecnico_sigla).length, verifica: l.filter(x => daVerificare(x as Intervento)).length };
  }, []);
  if (caricamento && data === null) return null;
  return (
    <Link to="/interventi" className={`kpi ${data?.senza ? 'ko' : data?.verifica ? 'warn' : 'info'}`}>
      <div className="lbl">{t('Interventi del mese')}</div>
      <div className="num">{data?.tot ?? '—'}</div>
      <div className="sub">{data ? t('{m} · senza tecnico {s} · da verificare {v}', { m: nomeMese(data.mese), s: data.senza, v: data.verifica }) : t('Nessun file importato')}</div>
    </Link>
  );
}

export default function Interventi() {
  const { t } = useT();
  const [sp, setSp] = useSearchParams();
  const vista = (sp.get('vista') as Vista) || 'mappa';
  const setVista = (v: Vista) => { const n = new URLSearchParams(sp); n.set('vista', v); setSp(n, { replace: true }); };
  const [meseScelto, setMese] = useState<string | null>(null);
  const [fuoriLazio, setFuoriLazio] = useState(false);
  const [f, setF] = useState({ tecnico: '', tipo: '', famiglia: '', stato: '', qualita: '', testo: '' });

  const base = useLoad(async () => {
    const [im, sg, tc, cz] = await Promise.all([
      supabase.from('importazioni').select('id,file_nome,mese,righe,nuovi,aggiornati,scartati,fuori_lazio,created_at').order('created_at', { ascending: false }).limit(50),
      supabase.from('tecnici_sigle').select('sigla,dipendente_id,attiva').order('sigla'),
      supabase.from('tecnici').select('id,nome,cognome,codice').eq('attivo', true).order('cognome'),
      supabase.from('cap_zone').select('cap,tecnico_sigla'),
    ]);
    for (const r of [im, sg, tc, cz]) if (r.error) throw r.error;
    const mesi = [...new Set((im.data ?? []).map(x => (x.mese as string | null)?.slice(0, 7)).filter(Boolean) as string[])].sort().reverse();
    return { importazioni: im.data!, sigle: sg.data as Sigla[], tecnici: tc.data as Tec[], capZone: new Map((cz.data ?? []).filter(x => x.tecnico_sigla).map(x => [x.cap as string, x.tecnico_sigla as string])), mesi };
  }, []);
  const mese = meseScelto ?? base.data?.mesi[0] ?? null;
  const dati = useLoad(async () => {
    if (!mese) return [] as Intervento[];
    const r = await supabase.from('interventi_importati').select(CAMPI).gte('data_riferimento', `${mese}-01`).lte('data_riferimento', fineMese(mese)).order('numero').range(0, 4999);
    if (r.error) throw r.error;
    return r.data as unknown as Intervento[];
  }, [mese]);
  const ricarica = () => { base.reload(); dati.reload(); };

  const tutti = dati.data ?? [];
  const visibili = useMemo(() => tutti.filter(i => fuoriLazio || !i.fuori_lazio), [tutti, fuoriLazio]);
  const filtrati = useMemo(() => {
    const q = f.testo.trim().toLowerCase();
    return visibili.filter(i => (!f.tecnico || (f.tecnico === '-' ? !i.tecnico_sigla : i.tecnico_sigla === f.tecnico))
      && (!f.tipo || i.tipo === f.tipo) && (!f.famiglia || i.famiglie.includes(f.famiglia)) && (!f.stato || i.stato === f.stato)
      && (!f.qualita || (f.qualita === 'verifica' ? daVerificare(i) : i.geo_qualita === f.qualita))
      && (!q || [i.numero, i.cliente, i.cod_cliente, i.impianto, i.via, i.comune, i.cap, i.note].some(x => String(x ?? '').toLowerCase().includes(q))));
  }, [visibili, f]);

  const attive = useMemo(() => new Set((base.data?.sigle ?? []).filter(s => s.attiva).map(s => s.sigla)), [base.data]);
  const lazio = tutti.filter(i => !i.fuori_lazio);
  const senza = lazio.filter(i => !i.tecnico_sigla && i.stato !== 'annullato');
  const verifica = lazio.filter(daVerificare);
  const bc = useMemo(() => baricentri(lazio, attive), [lazio, attive]); // eslint-disable-line react-hooks/exhaustive-deps
  const sugg = useMemo(() => new Map(senza.map(i => [i.id, suggerisci(i, base.data?.capZone ?? new Map(), bc, attive)])), [senza, bc, attive, base.data]); // eslint-disable-line react-hooks/exhaustive-deps
  const perTec = new Map<string, number>(); lazio.forEach(i => i.tecnico_sigla && perTec.set(i.tecnico_sigla, (perTec.get(i.tecnico_sigla) ?? 0) + 1));
  const opz = (k: (i: Intervento) => (string | null)[]) => [...new Set(visibili.flatMap(k).filter(Boolean) as string[])].sort();

  async function assegna(ids: number[], sigla: string) {
    for (let i = 0; i < ids.length; i += 200) {
      const r = await supabase.from('interventi_importati').update({ tecnico_sigla: sigla }).in('id', ids.slice(i, i + 200));
      if (r.error) { toast(testoErrore(r.error)); return; }
    }
    toast(t('{n} interventi assegnati', { n: ids.length })); dati.reload();
  }
  async function accettaTutti() {
    const gruppi = new Map<string, number[]>();
    for (const i of senza) { const s = sugg.get(i.id); if (s) gruppi.set(s.sigla, [...(gruppi.get(s.sigla) ?? []), i.id]); }
    for (const [s, ids] of gruppi) await assegna(ids, s);
  }
  async function sposta(id: number, lat: number, lon: number, indirizzo?: string) {
    const r = await supabase.from('interventi_importati').update({ lat, lon, geo_qualita: 'manuale', geo_dubbio: false, ...(indirizzo ? { geo_indirizzo: indirizzo } : {}) }).eq('id', id);
    if (r.error) toast(testoErrore(r.error)); else { toast(t('Posizione salvata')); dati.reload(); }
  }
  async function esporta() {
    const XLSX = await import('xlsx');
    const righe = filtrati.map(i => ({ 'Num. intervento': i.numero, Tecnico: i.tecnico_sigla ?? '', Impianto: i.impianto, 'Cod. cli.': i.cod_cliente, Cliente: i.cliente,
      Indirizzo: [i.via, i.civico].filter(Boolean).join(' '), CAP: i.cap, Comune: i.comune, Prov: i.prov, Note: i.note ?? '', Componenti: i.componenti,
      Tipo: i.tipo, Famiglie: i.famiglie.join(', '), Stato: STATI[i.stato], Posizione: QUALITA[i.geo_qualita ?? ''] ?? '', Lat: i.lat, Lon: i.lon }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(righe), 'Interventi');
    XLSX.writeFile(wb, `interventi_${mese ?? 'mese'}.xlsx`);
  }

  if (base.errore) return <Errore testo={base.errore} onRetry={base.reload} />;
  if (!base.data) return <Caricamento />;
  const nessuno = !base.data.mesi.length;
  const kpi = (lbl: string, n: number | string, cls: string, v?: Vista, sub?: string) => (
    <button className={`kpi ${cls}`} onClick={() => v && setVista(v)} style={{ textAlign: 'start', cursor: v ? 'pointer' : 'default' }}>
      <div className="lbl">{t(lbl)}</div><div className="num">{n}</div>{sub && <div className="sub">{sub}</div>}
    </button>
  );
  return (
    <div className="interventi">
      <div className="page-hero">
        <div><h1>{t('Interventi del mese')}</h1><p className="sub">{mese ? nomeMese(mese) : t('Nessun file importato')}</p></div>
        <div className="perc-bar">
          {base.data.mesi.length > 1 && <select value={mese ?? ''} onChange={e => setMese(e.target.value)} aria-label={t('Mese')}>{base.data.mesi.map(m => <option key={m} value={m}>{nomeMese(m)}</option>)}</select>}
          <label className="row-flex" style={{ gap: 6 }}><input type="checkbox" checked={fuoriLazio} onChange={e => setFuoriLazio(e.target.checked)} />{t('Mostra fuori Lazio')}</label>
          <button className="btn brand" onClick={() => setVista('importa')}>{t('Importa file Excel')}</button>
        </div>
      </div>

      {!nessuno && <div className="kpis">
        {kpi('Totale del mese', lazio.length, 'info', 'tabella', t('Lazio'))}
        {kpi('Per tecnico', perTec.size, 'info', 'mappa', [...perTec].sort().map(([s, n]) => `${s} ${n}`).join(' · '))}
        {kpi('Senza tecnico', senza.length, senza.length ? 'ko' : 'ok', 'senza', senza.length ? t('Da assegnare') : undefined)}
        {kpi('Da verificare posizione', verifica.length, verifica.length ? 'warn' : 'ok', 'verifica')}
        {kpi('Fuori Lazio', tutti.length - lazio.length, 'info', undefined, t('Esclusi dalla pianificazione'))}
        {kpi('Componenti totali', lazio.reduce((s, i) => s + (i.componenti ?? 0), 0), 'info')}
      </div>}

      <div className="segmented" role="tablist" style={{ marginBottom: 16, flexWrap: 'wrap' }}>
        {([['mappa', 'Mappa'], ['tabella', 'Tabella'], ['senza', `Senza tecnico (${senza.length})`], ['verifica', `Da verificare (${verifica.length})`], ['sigle', 'Sigle tecnici'], ['importa', 'Importa']] as [Vista, string][])
          .map(([v, l]) => <button key={v} className={vista === v ? 'on' : ''} onClick={() => setVista(v)}>{t(l)}</button>)}
      </div>

      {dati.errore && <Errore testo={dati.errore} onRetry={dati.reload} />}
      {vista === 'importa' && <Importa onFatto={ricarica} storico={base.data.importazioni} />}
      {vista === 'sigle' && <Sigle sigle={base.data.sigle} tecnici={base.data.tecnici} onSalvato={ricarica} />}
      {nessuno && vista !== 'importa' && vista !== 'sigle' && <Banner s="warn">{t('Nessun file importato. Usa «Importa file Excel» con il Listato interventi esportato da Taylor.')}</Banner>}
      {!nessuno && (vista === 'mappa' || vista === 'tabella') && <>
        <div className="int-filtri">
          <input type="search" placeholder={t('Cerca numero, cliente, via…')} value={f.testo} onChange={e => setF({ ...f, testo: e.target.value })} />
          <select value={f.tecnico} onChange={e => setF({ ...f, tecnico: e.target.value })}><option value="">{t('Tutti i tecnici')}</option><option value="-">{t('Senza tecnico')}</option>{opz(i => [i.tecnico_sigla]).map(s => <option key={s}>{s}</option>)}</select>
          <select value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })}><option value="">{t('Tutti i tipi')}</option>{opz(i => [i.tipo]).map(s => <option key={s}>{s}</option>)}</select>
          <select value={f.famiglia} onChange={e => setF({ ...f, famiglia: e.target.value })}><option value="">{t('Tutte le famiglie')}</option>{opz(i => i.famiglie).map(s => <option key={s}>{s}</option>)}</select>
          <select value={f.stato} onChange={e => setF({ ...f, stato: e.target.value })}><option value="">{t('Tutti gli stati')}</option>{Object.entries(STATI).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
          <select value={f.qualita} onChange={e => setF({ ...f, qualita: e.target.value })}><option value="">{t('Ogni posizione')}</option><option value="verifica">{t('Da verificare')}</option>{Object.entries(QUALITA).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</select>
          <span className="sub">{t('{n} interventi', { n: filtrati.length })}</span>
          {vista === 'tabella' && <button className="btn-ghost btn-sm" onClick={esporta}>{t('Esporta Excel')}</button>}
        </div>
        {vista === 'mappa' ? <>
          <MappaInterventi interventi={filtrati} alta />
          <Legenda sigle={[...perTec.keys()].sort()} />
        </> : <Tabella righe={filtrati} />}
      </>}
      {!nessuno && vista === 'senza' && <SenzaTecnico righe={senza} sugg={sugg} sigle={[...attive]} onAssegna={assegna} onAccettaTutti={accettaTutti} />}
      {!nessuno && vista === 'verifica' && <DaVerificare righe={verifica} tutti={lazio} onSposta={sposta} onRiprova={async ids => {
        const r = await supabase.functions.invoke('geocodifica', { body: { ids } }); if (r.error) toast(testoErrore(r.error)); else dati.reload();
      }} />}
    </div>
  );
}

function Legenda({ sigle }: { sigle: string[] }) {
  const { t } = useT();
  return (
    <div className="int-legenda">
      {[...sigle, null].map(s => <span key={s ?? '-'}><i className="int-dot" style={{ background: coloreTecnico(s) }} />{s ?? t('Senza tecnico')}</span>)}
      <span className="sep" />
      <span><i className="int-pin q-esatto"><span style={{ ['--c' as string]: '#555' }} /></i>{t('Civico esatto')}</span>
      <span><i className="int-pin q-via"><span style={{ ['--c' as string]: '#555' }} /></i>{t('Punto medio via')}</span>
      <span><i className="int-pin q-centro_cap"><span style={{ ['--c' as string]: '#555' }}>?</span></i>{t('Centro CAP/comune')}</span>
      <span><i className="int-pin q-manuale"><span style={{ ['--c' as string]: '#555' }} /></i>{t('Manuale')}</span>
    </div>
  );
}

function Tabella({ righe }: { righe: Intervento[] }) {
  const { t } = useT();
  const [n, setN] = useState(200);
  return (<>
    <div className="table-wrap"><table>
      <thead><tr><th>{t('N.')}</th><th>{t('Tecnico')}</th><th>{t('Cliente')}</th><th>{t('Impianto')}</th><th>{t('Indirizzo')}</th><th>{t('Comp.')}</th><th>{t('Famiglie')}</th><th>{t('Tipo')}</th><th>{t('Stato')}</th><th>{t('Posizione')}</th><th>{t('Durata')}</th></tr></thead>
      <tbody>{righe.slice(0, n).map(i => (
        <tr key={i.id}>
          <td className="mono">{i.numero}</td>
          <td>{i.tecnico_sigla ? <span><i className="int-dot" style={{ background: coloreTecnico(i.tecnico_sigla) }} />{i.tecnico_sigla}</span> : <Pill s="ko">{t('Senza')}</Pill>}</td>
          <td>{i.cliente}<div className="sub mono">{i.cod_cliente}</div></td>
          <td className="mono">{i.impianto}</td>
          <td>{[i.via, i.civico].filter(Boolean).join(' ')}<div className="sub">{i.cap} {i.comune}{i.prov ? ` (${i.prov})` : ''}</div>{i.note && <div className="sub">{i.note}</div>}</td>
          <td className="mono">{i.componenti ?? '—'}</td>
          <td style={{ fontSize: 12.5 }}>{i.famiglie.join(', ')}</td>
          <td style={{ fontSize: 12.5 }}>{i.tipo}</td>
          <td>{t(STATI[i.stato])}</td>
          <td>{i.geo_qualita ? <Pill s={daVerificare(i) ? 'warn' : 'ok'}>{t(QUALITA[i.geo_qualita])}</Pill> : <Pill s="na">{i.fuori_lazio ? t('Fuori Lazio') : t('In attesa')}</Pill>}</td>
          <td className="sub">{i.durata_minuti ? `${i.durata_minuti}′` : t('Durata: da definire')}</td>
        </tr>))}
        {!righe.length && <tr><td colSpan={11} className="sub">{t('Nessun intervento con questi filtri')}</td></tr>}</tbody>
    </table></div>
    {righe.length > n && <button className="btn-ghost" onClick={() => setN(n + 300)}>{t('Mostra altri ({n})', { n: righe.length - n })}</button>}
  </>);
}

function SenzaTecnico({ righe, sugg, sigle, onAssegna, onAccettaTutti }: { righe: Intervento[]; sugg: Map<number, Suggerimento | null>; sigle: string[]; onAssegna: (ids: number[], s: string) => Promise<void>; onAccettaTutti: () => Promise<void> }) {
  const { t } = useT();
  const [occ, setOcc] = useState(false);
  const [scelta, setScelta] = useState<Record<number, string>>({});
  const conSugg = righe.filter(i => sugg.get(i.id)).length;
  if (!righe.length) return <Banner s="ok">{t('Tutti gli interventi del Lazio hanno un tecnico.')}</Banner>;
  return (<>
    <div className="section-title">{t('Senza tecnico')} <span className="meta">{t('{n} da assegnare', { n: righe.length })}</span><span className="spacer" />
      <button className="btn btn-sm" disabled={occ || !conSugg} onClick={async () => { setOcc(true); await onAccettaTutti(); setOcc(false); }}>{t('Accetta tutti i suggerimenti ({n})', { n: conSugg })}</button></div>
    <div className="table-wrap"><table>
      <thead><tr><th>{t('N.')}</th><th>{t('Cliente')}</th><th>{t('Indirizzo')}</th><th>{t('Suggerito')}</th><th /></tr></thead>
      <tbody>{righe.map(i => { const s = sugg.get(i.id); return (
        <tr key={i.id}>
          <td className="mono">{i.numero}</td><td>{i.cliente}</td>
          <td>{[i.via, i.civico].filter(Boolean).join(' ')}<div className="sub">{i.cap} {i.comune}</div></td>
          <td>{s ? <><strong style={{ color: coloreTecnico(s.sigla) }}>{s.sigla}</strong><div className="sub">{s.motivo}</div></> : <span className="sub">{t('Nessun suggerimento (posizione mancante)')}</span>}</td>
          <td className="row-flex" style={{ gap: 6, flexWrap: 'nowrap' }}>
            {s && <button className="btn btn-sm" onClick={() => onAssegna([i.id], s.sigla)}>{t('Accetta')}</button>}
            <select value={scelta[i.id] ?? ''} onChange={e => { setScelta({ ...scelta, [i.id]: e.target.value }); if (e.target.value) onAssegna([i.id], e.target.value); }} aria-label={t('Scegli altro')}>
              <option value="">{t('Scegli altro…')}</option>{sigle.sort().map(x => <option key={x}>{x}</option>)}</select>
          </td>
        </tr>); })}</tbody>
    </table></div>
  </>);
}

function DaVerificare({ righe, tutti, onSposta, onRiprova }: { righe: Intervento[]; tutti: Intervento[]; onSposta: (id: number, lat: number, lon: number, ind?: string) => Promise<void>; onRiprova: (ids: number[]) => Promise<void> }) {
  const { t } = useT();
  const [sel, setSel] = useState<number | null>(righe[0]?.id ?? null);
  const [testo, setTesto] = useState('');
  const [occ, setOcc] = useState(false);
  const i = tutti.find(x => x.id === sel);
  async function cerca() {
    if (!i || !testo.trim()) return;
    setOcc(true);
    try {
      const r = await geocodificaPrimo(`${testo}, ${i.cap ?? ''} ${i.comune ?? ''}`);
      if (r) await onSposta(i.id, r.lat, r.lon, testo); else toast(t('Indirizzo non trovato'));
    } catch (e) { toast(testoErrore(e)); } finally { setOcc(false); }
  }
  if (!righe.length) return <Banner s="ok">{t('Tutte le posizioni sono verificate.')}</Banner>;
  return (
    <div className="int-verifica">
      <div className="int-lista">
        <div className="section-title">{t('Da verificare')} <span className="meta">{righe.length}</span><span className="spacer" />
          <button className="btn-ghost btn-sm" disabled={occ} onClick={async () => { setOcc(true); await onRiprova(righe.filter(x => x.lat == null).map(x => x.id).slice(0, 30)); setOcc(false); }}>{t('Riprova geocodifica')}</button></div>
        {righe.map(x => (
          <button key={x.id} className={`int-voce${x.id === sel ? ' on' : ''}`} onClick={() => { setSel(x.id); setTesto([x.via, x.civico].filter(Boolean).join(' ')); }}>
            <strong>N. {x.numero}</strong> · {[x.via, x.civico].filter(Boolean).join(' ') || x.indirizzo_originale}
            <div className="sub">{x.cap} {x.comune} · {x.geo_qualita ? t(QUALITA[x.geo_qualita]) : t('Non trovato')}{x.geo_dubbio ? ` · ${t('dubbio')}` : ''}</div>
          </button>))}
      </div>
      <div>
        {i && <div className="card" style={{ marginBottom: 12 }}>
          <div><strong>N. {i.numero}</strong> · {i.cliente}</div>
          <div className="sub">{t('Originale')}: {i.indirizzo_originale} · {i.cap} {i.comune}</div>
          {i.note && <div className="sub">{i.note}</div>}
          <div className="row-flex" style={{ marginTop: 8 }}>
            <input value={testo} onChange={e => setTesto(e.target.value)} placeholder={t('Indirizzo corretto, es. Via Roma 10')} onKeyDown={e => e.key === 'Enter' && cerca()} style={{ flex: 1 }} />
            <button className="btn btn-sm" disabled={occ} onClick={cerca}>{t('Cerca e salva')}</button>
          </div>
          <p className="hint">{i.lat == null ? t('Nessuna posizione: scrivi un indirizzo migliore.') : t('Oppure trascina il segnaposto sulla mappa nel punto giusto.')}</p>
        </div>}
        <MappaInterventi interventi={righe} trascinabile={sel} onScegli={setSel} onSposta={(id, la, lo) => onSposta(id, la, lo)} />
      </div>
    </div>
  );
}

function Sigle({ sigle, tecnici, onSalvato }: { sigle: Sigla[]; tecnici: Tec[]; onSalvato: () => void }) {
  const { t } = useT();
  async function salva(s: string, campi: Partial<Sigla>) {
    const r = await supabase.from('tecnici_sigle').update(campi).eq('sigla', s);
    if (r.error) toast(testoErrore(r.error)); else { toast(t('Salvato')); onSalvato(); }
  }
  return (<>
    <div className="section-title">{t('Sigle tecnici')} <span className="meta">{t('Collega le sigle di Taylor ai dipendenti')}</span></div>
    <div className="table-wrap"><table>
      <thead><tr><th>{t('Sigla')}</th><th>{t('Dipendente')}</th><th>{t('Attiva')}</th></tr></thead>
      <tbody>{sigle.map(s => (
        <tr key={s.sigla}>
          <td><i className="int-dot" style={{ background: coloreTecnico(s.sigla) }} /><strong className="mono">{s.sigla}</strong></td>
          <td><select value={s.dipendente_id ?? ''} onChange={e => salva(s.sigla, { dipendente_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t('— da collegare —')}</option>{tecnici.map(x => <option key={x.id} value={x.id}>{x.cognome} {x.nome}{x.codice ? ` (${x.codice})` : ''}</option>)}</select></td>
          <td><input type="checkbox" checked={s.attiva} onChange={e => salva(s.sigla, { attiva: e.target.checked })} aria-label={t('Attiva')} /></td>
        </tr>))}</tbody>
    </table></div>
    <p className="hint">{t('Solo le sigle attive ricevono suggerimenti. Le zone CAP di Roma (tabella cap_zone) indicano il tecnico di riferimento per ogni CAP.')}</p>
  </>);
}

interface Anteprima { file: File; l: Lettura; nuovi: number; aggiornati: number; fuori: number; senzaTec: number; verifica: number }

function Importa({ onFatto, storico }: { onFatto: () => void; storico: { id: number; file_nome: string; mese: string | null; righe: number; nuovi: number; aggiornati: number; scartati: number; fuori_lazio: number; created_at: string }[] }) {
  const { t } = useT();
  const [ant, setAnt] = useState<Anteprima | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [fase, setFase] = useState<'' | 'lettura' | 'salvataggio' | 'geo'>('');
  const [prog, setProg] = useState<{ fatti: number; tot: number } | null>(null);
  const [esito, setEsito] = useState<string | null>(null);
  const [sopra, setSopra] = useState(false);

  async function scegli(file: File | undefined) {
    if (!file) return;
    setErrore(null); setEsito(null); setAnt(null);
    if (!/\.xlsx$/i.test(file.name)) { setErrore(t('Serve un file .xlsx (Listato interventi di Taylor).')); return; }
    setFase('lettura');
    try {
      const l = await leggiFile(file);
      if (l.mancanti.length) { setErrore(t('Colonne mancanti: {c}', { c: l.mancanti.join(', ') })); return; }
      const ids = l.righe.map(r => r.id_intervento); const esistenti = new Set<string>();
      for (let i = 0; i < ids.length; i += 150) {
        const r = await supabase.from('interventi_importati').select('id_intervento').in('id_intervento', ids.slice(i, i + 150));
        if (r.error) throw r.error; r.data.forEach(x => esistenti.add(x.id_intervento as string));
      }
      const laz = l.righe.filter(r => !r.fuori_lazio);
      setAnt({ file, l, nuovi: ids.filter(x => !esistenti.has(x)).length, aggiornati: esistenti.size, fuori: l.righe.length - laz.length,
        senzaTec: laz.filter(r => !r.tecnico_sigla).length, verifica: laz.filter(r => !r.via || !r.civico).length });
    } catch (e) { setErrore(testoErrore(e)); } finally { setFase(''); }
  }

  async function conferma() {
    if (!ant) return;
    setFase('salvataggio');
    try {
      const { data, error } = await supabase.rpc('importa_interventi', { p_file: ant.file.name, p_mese: ant.l.mese ? `${ant.l.mese}-01` : null, p_scartati: ant.l.scartate.length, p_righe: ant.l.righe });
      if (error) throw error;
      const d = data as { nuovi: number; aggiornati: number; scartati: number; fuori_lazio: number };
      setEsito(t('Salvati: {n} nuovi, {a} aggiornati, {s} scartati, {f} fuori Lazio.', { n: d.nuovi, a: d.aggiornati, s: d.scartati, f: d.fuori_lazio }));
      setAnt(null); onFatto();
      await geocodificaTutto();
    } catch (e) { setErrore(testoErrore(e)); } finally { setFase(''); }
  }

  async function geocodificaTutto() {
    setFase('geo');
    let tot = 0, fatti = 0;
    try {
      for (let giro = 0; giro < 200; giro++) {
        const { data, error } = await supabase.functions.invoke('geocodifica', { body: {} });
        if (error) throw error;
        const d = data as { fatti: number; rimanenti: number };
        fatti += d.fatti; if (!tot) tot = d.fatti + d.rimanenti;
        setProg({ fatti, tot });
        if (!d.rimanenti || !d.fatti) break;
      }
      toast(t('Geocodifica completata'));
    } catch (e) { setErrore(t('Geocodifica interrotta: {e}. Puoi riprendere con «Continua geocodifica».', { e: testoErrore(e) })); }
    finally { setFase(''); onFatto(); }
  }

  return (<>
    <div className="section-title">{t('Importa file Excel')} <span className="meta">{t('Listato interventi mensile esportato da Taylor')}</span><span className="spacer" />
      <button className="btn-ghost btn-sm" disabled={!!fase} onClick={geocodificaTutto}>{t('Continua geocodifica')}</button></div>
    <label className={`int-drop${sopra ? ' sopra' : ''}`} onDragOver={e => { e.preventDefault(); setSopra(true); }} onDragLeave={() => setSopra(false)}
      onDrop={e => { e.preventDefault(); setSopra(false); scegli(e.dataTransfer.files[0]); }}>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e => { scegli(e.target.files?.[0]); e.target.value = ''; }} />
      <strong>{fase === 'lettura' ? t('Lettura del file…') : t('Trascina qui il file .xlsx oppure fai clic per sceglierlo')}</strong>
      <span className="sub">{t('Le colonne si riconoscono dal nome nella riga d\'intestazione. Reimportare lo stesso file aggiorna senza duplicare.')}</span>
    </label>
    {errore && <Banner s="ko">{errore}</Banner>}
    {esito && <Banner s="ok">{esito}</Banner>}
    {ant && <div className="card" style={{ margin: '16px 0' }}>
      <strong>{ant.file.name}</strong> · {ant.l.mese ? nomeMese(ant.l.mese) : t('mese non riconosciuto')}
      <div className="kpis" style={{ marginTop: 12 }}>
        <div className="kpi info"><div className="lbl">{t('Righe valide')}</div><div className="num">{ant.l.righe.length}</div></div>
        <div className="kpi ok"><div className="lbl">{t('Nuovi')}</div><div className="num">{ant.nuovi}</div></div>
        <div className="kpi info"><div className="lbl">{t('Aggiornati')}</div><div className="num">{ant.aggiornati}</div></div>
        <div className="kpi info"><div className="lbl">{t('Fuori Lazio')}</div><div className="num">{ant.fuori}</div></div>
        <div className={`kpi ${ant.senzaTec ? 'ko' : 'ok'}`}><div className="lbl">{t('Senza tecnico')}</div><div className="num">{ant.senzaTec}</div></div>
        <div className={`kpi ${ant.verifica ? 'warn' : 'ok'}`}><div className="lbl">{t('Indirizzo incompleto')}</div><div className="num">{ant.verifica}</div></div>
        <div className={`kpi ${ant.l.scartate.length ? 'warn' : 'ok'}`}><div className="lbl">{t('Scartate')}</div><div className="num">{ant.l.scartate.length}</div></div>
      </div>
      {ant.l.scartate.length > 0 && <p className="hint">{ant.l.scartate.slice(0, 8).map(s => `${t('riga')} ${s.riga}: ${s.motivo}`).join(' · ')}</p>}
      <div className="row-flex"><button className="btn brand" disabled={!!fase} onClick={conferma}>{fase === 'salvataggio' ? t('Salvataggio…') : t('Conferma e salva')}</button>
        <button className="btn-ghost" onClick={() => setAnt(null)}>{t('Annulla')}</button></div>
    </div>}
    {prog && <div className="card" style={{ margin: '16px 0' }}>
      <div>{fase === 'geo' ? t('Geocodifica in corso (1 indirizzo al secondo)…') : t('Geocodifica')} {prog.fatti}/{prog.tot}</div>
      <progress max={prog.tot || 1} value={prog.fatti} style={{ width: '100%' }} />
    </div>}
    {storico.length > 0 && <>
      <div className="section-title" style={{ marginTop: 24 }}>{t('Importazioni precedenti')}</div>
      <div className="table-wrap"><table><thead><tr><th>{t('Data')}</th><th>{t('File')}</th><th>{t('Mese')}</th><th>{t('Righe')}</th><th>{t('Nuovi')}</th><th>{t('Aggiornati')}</th><th>{t('Scartati')}</th><th>{t('Fuori Lazio')}</th></tr></thead>
        <tbody>{storico.map(s => <tr key={s.id}><td className="mono">{new Date(s.created_at).toLocaleString('it-IT')}</td><td>{s.file_nome}</td><td>{s.mese ? nomeMese(s.mese.slice(0, 7)) : '—'}</td><td>{s.righe}</td><td>{s.nuovi}</td><td>{s.aggiornati}</td><td>{s.scartati}</td><td>{s.fuori_lazio}</td></tr>)}</tbody></table></div>
    </>}
  </>);
}
