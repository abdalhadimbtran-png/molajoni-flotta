import { useEffect, useMemo, useState } from 'react';
import { supabase, rpc } from '../lib/supabase';
import { oggiISO } from '../lib/format';
import { Banner, toast } from '../ui';
import { numerica, testoCella, type Report, type Riga } from '../admin/report/catalogo';
import { CATEGORIE, fmtQ, giornoLungo, nomeCategoria, type Unita } from './comune';
import { erroreHR } from './componenti';

/** Report del personale: stessi file premium (Excel e PDF con logo) del centro report flotta. */
type Id = 'riepilogo' | 'presenze' | 'registro';
const n = (v: unknown) => Number(v ?? 0) || 0;
const somma = (r: Riga[], k: string) => r.reduce((s, x) => s + n(x[k]), 0);
const fmtN = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: 1 });

const REPORT: (Report & { hrId: Id })[] = [
  {
    hrId: 'riepilogo', id: 'hr_riepilogo', gruppo: 'Tecnici', titolo: 'Riepilogo per le paghe', periodo: 'intervallo', filtri: {}, orizzontale: true,
    descrizione: 'Per ogni dipendente: giorni lavorativi, presenze, ferie, permessi, malattia e altre assenze approvate nel periodo, con i saldi.',
    colonne: [
      { k: 'dipendente', l: 'Dipendente', t: 'testo', w: 20 }, { k: 'codice', l: 'Codice', t: 'testo', w: 9 }, { k: 'cat', l: 'Categoria', t: 'testo', w: 10 },
      { k: 'giorni_lavorativi_periodo', l: 'Giorni lavorativi', t: 'num', tot: true, w: 9 }, { k: 'giorni_presenza', l: 'Presenze (gg)', t: 'dec1', tot: true, w: 9 },
      { k: 'ferie', l: 'Ferie (gg)', t: 'dec1', tot: true, w: 8 }, { k: 'rol', l: 'ROL (ore)', t: 'dec1', tot: true, w: 8 }, { k: 'exf', l: 'Ex fest. (ore)', t: 'dec1', tot: true, w: 8 },
      { k: 'pnr', l: 'Non retrib. (ore)', t: 'dec1', tot: true, w: 9 }, { k: 'mal', l: 'Malattia (gg)', t: 'dec1', tot: true, w: 9 }, { k: 'altro', l: 'Altre assenze (gg)', t: 'dec1', tot: true, w: 9 },
      { k: 'giorni_assenza_manuali', l: 'Assenze flotta (gg)', t: 'num', tot: true, w: 9 }, { k: 'richieste_in_attesa', l: 'In valutazione', t: 'num', tot: true, w: 8 },
      { k: 'saldo_ferie', l: 'Saldo ferie (gg)', t: 'dec1', w: 9 }, { k: 'saldo_rol', l: 'Saldo ROL (ore)', t: 'dec1', w: 9 }, { k: 'saldo_exf', l: 'Saldo ex fest. (ore)', t: 'dec1', w: 9 },
    ],
    riepilogo: r => [{ l: 'Dipendenti', v: String(r.length) }, { l: 'Giorni di ferie', v: fmtN(somma(r, 'ferie')) }, { l: 'Ore di permesso', v: fmtN(somma(r, 'rol') + somma(r, 'exf') + somma(r, 'pnr')) }, { l: 'Giorni di malattia', v: fmtN(somma(r, 'mal')) }],
  },
  {
    hrId: 'presenze', id: 'hr_presenze', gruppo: 'Tecnici', titolo: 'Presenze giorno per giorno', periodo: 'intervallo', filtri: {}, orizzontale: true,
    descrizione: 'Ogni giorno del periodo per ogni dipendente: presente, assente, parziale, riposo o festività.',
    colonne: [
      { k: 'data', l: 'Data', t: 'data', w: 10 }, { k: 'giorno', l: 'Giorno', t: 'testo', w: 6 }, { k: 'dipendente', l: 'Dipendente', t: 'testo', w: 20 }, { k: 'codice', l: 'Codice', t: 'testo', w: 9 },
      { k: 'cat', l: 'Categoria', t: 'testo', w: 10 }, { k: 'stato', l: 'Stato', t: 'testo', w: 12 }, { k: 'dettaglio', l: 'Dettaglio', t: 'testo', w: 26 }, { k: 'in_attesa', l: 'Richieste in valutazione', t: 'testo', w: 16 },
    ],
    raggruppa: { k: 'data', etichetta: r => giornoLungo(String(r.data)) },
    riepilogo: r => [{ l: 'Righe', v: String(r.length) }, { l: 'Presenti', v: String(r.filter(x => x.stato === 'Presente').length) }, { l: 'Assenti', v: String(r.filter(x => String(x.stato).startsWith('Assente')).length) }, { l: 'Parziali', v: String(r.filter(x => x.stato === 'Parziale').length) }],
  },
  {
    hrId: 'registro', id: 'hr_registro', gruppo: 'Tecnici', titolo: 'Registro delle richieste', periodo: 'intervallo', filtri: {}, orizzontale: true,
    descrizione: 'Tutte le richieste del periodo con stato, chi ha deciso, quando e perché.',
    colonne: [
      { k: 'numero', l: 'Numero', t: 'testo', w: 11 }, { k: 'creata_il', l: 'Inviata il', t: 'dataora', w: 12 }, { k: 'dipendente', l: 'Dipendente', t: 'testo', w: 17 },
      { k: 'descrizione', l: 'Tipo', t: 'testo', w: 14 }, { k: 'primo_giorno', l: 'Primo giorno', t: 'data', w: 9 }, { k: 'rientro', l: 'Rientro', t: 'data', w: 9 }, { k: 'orario', l: 'Orario', t: 'testo', w: 9 },
      { k: 'q', l: 'Quantità', t: 'testo', w: 11 }, { k: 'stato', l: 'Stato', t: 'testo', w: 10 }, { k: 'creata_da', l: 'Inserita da', t: 'testo', w: 10 },
      { k: 'deciso_da', l: 'Decisa da', t: 'testo', w: 11 }, { k: 'deciso_il', l: 'Decisa il', t: 'dataora', w: 12 }, { k: 'motivo', l: 'Motivo', t: 'testo', w: 20 }, { k: 'auto_decisione', l: 'Auto-decisione', t: 'testo', w: 8 },
    ],
    riepilogo: r => [{ l: 'Richieste', v: String(r.length) }, { l: 'Approvate', v: String(r.filter(x => x.stato === 'Approvata').length) }, { l: 'In attesa', v: String(r.filter(x => x.stato === 'In attesa').length) }, { l: 'Non approvate', v: String(r.filter(x => x.stato === 'Non approvata').length) }],
  },
];

const meseDi = (iso: string, d: number) => { const [y, m] = iso.split('-').map(Number); const a = new Date(Date.UTC(y, m - 1 + d, 1)); const b = new Date(Date.UTC(y, m + d, 0)); return [a.toISOString().slice(0, 10), b.toISOString().slice(0, 10)]; };
type Preset = 'mese_scorso' | 'mese' | 'anno' | 'personalizzato';
const PRESET: [Preset, string][] = [['mese_scorso', 'Mese scorso'], ['mese', 'Questo mese'], ['anno', "Quest'anno"], ['personalizzato', 'Personalizzato']];
function intervallo(p: Preset): [string, string] {
  const o = oggiISO();
  if (p === 'mese_scorso') return meseDi(o, -1) as [string, string];
  if (p === 'anno') return [`${o.slice(0, 4)}-01-01`, `${o.slice(0, 4)}-12-31`];
  return meseDi(o, 0) as [string, string];
}
const STATO_TESTO: Record<string, string> = { 'In attesa': 'In valutazione', 'Non approvata': 'Rifiutata' };
function normalizza(id: Id, r: Riga): Riga {
  const x = { ...r, cat: nomeCategoria(String(r.categoria)) };
  if (id === 'registro') return { ...x, q: fmtQ(n(r.quantita), r.unita as Unita), motivo: r.motivo_decisione ?? r.motivo_annullamento ?? '', stato: STATO_TESTO[String(r.stato)] ?? r.stato };
  return x;
}

export default function ReportHR() {
  const [sel, setSel] = useState(REPORT[0]);
  const [preset, setPreset] = useState<Preset>('mese_scorso');
  const [da, setDa] = useState(() => intervallo('mese_scorso')[0]);
  const [a, setA] = useState(() => intervallo('mese_scorso')[1]);
  const [cat, setCat] = useState('');
  const [dip, setDip] = useState('');
  const [dips, setDips] = useState<{ id: number; nome: string; cognome: string; categoria: string }[]>([]);
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [esporto, setEsporto] = useState<'' | 'xlsx' | 'pdf'>('');
  const [autore, setAutore] = useState('');
  useEffect(() => {
    supabase.from('dipendenti').select('id,nome,cognome,categoria').order('cognome').then(r => setDips(r.data ?? []));
    supabase.auth.getUser().then(async u => {
      if (!u.data.user) return;
      const r = await supabase.from('responsabili').select('nome').eq('user_id', u.data.user.id).maybeSingle();
      setAutore(r.data?.nome || u.data.user.email || '');
    });
  }, []);
  useEffect(() => {
    let vivo = true; setRighe(null); setErr(null);
    rpc<{ righe: Riga[] }>('hr_report', { p_tipo: sel.hrId, p_da: da, p_a: a, p_categoria: cat || null, p_dipendente: dip ? Number(dip) : null })
      .then(r => { if (vivo) setRighe(r.righe.map(x => normalizza(sel.hrId, x))); }).catch(e => { if (vivo) setErr(erroreHR(e)); });
    return () => { vivo = false; };
  }, [sel.hrId, da, a, cat, dip]);

  const it = (d: string) => testoCella(d, 'data');
  const testoPeriodo = `${it(da)} – ${it(a)}`;
  const testoFiltri = [cat && `Categoria ${nomeCategoria(cat)}`, dip && (o => o ? `${o.nome} ${o.cognome}` : '')(dips.find(x => String(x.id) === dip))].filter(Boolean).join(' · ');
  const riepilogo = useMemo(() => (righe?.length && sel.riepilogo ? sel.riepilogo(righe) : []), [righe, sel]);
  function scegli(p: Preset) { setPreset(p); if (p !== 'personalizzato') { const [x, y] = intervallo(p); setDa(x); setA(y); } }
  async function esporta(tipo: 'xlsx' | 'pdf') {
    if (!righe) return; setEsporto(tipo);
    try {
      const m = await import('../admin/report/esporta');
      const ctx = { periodo: testoPeriodo, filtri: testoFiltri, autore: autore || 'ufficio personale', generato: new Date(), prodotto: 'Ufficio personale' };
      await (tipo === 'xlsx' ? m.esportaExcel(sel, righe, ctx) : m.esportaPdf(sel, righe, ctx));
      toast(tipo === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(erroreHR(e)); } finally { setEsporto(''); }
  }
  const MAX = 300;
  return (
    <div className="rep">
      <div className="page-hero"><div><h1>Report del personale</h1><p className="sub">Scegli un report e il periodo. Guarda l'anteprima e scaricalo in PDF o Excel per il consulente del lavoro.</p></div></div>
      <div className="rep-layout">
        <nav className="rep-catalogo" aria-label="Tipi di report">
          <div className="rep-gruppo"><div className="rep-gtit">Personale</div>
            {REPORT.map(r => <button key={r.id} className={`rep-voce ${sel.id === r.id ? 'on' : ''}`} aria-pressed={sel.id === r.id} onClick={() => setSel(r)}><b>{r.titolo}</b><span>{r.descrizione}</span></button>)}</div>
        </nav>
        <section className="rep-main">
          <div className="panel rep-filtri">
            <div className="rep-titolo"><h2>{sel.titolo}</h2><span className="sub">{sel.descrizione}</span></div>
            <div className="segmented rep-preset" role="group" aria-label="Periodo">{PRESET.map(([k, l]) => <button key={k} className={preset === k ? 'on' : ''} onClick={() => scegli(k)}>{l}</button>)}</div>
            <div className="row-flex wrap-end">
              <div className="field"><label htmlFor="hr-da">Dal</label><input id="hr-da" type="date" value={da} max={a} onChange={e => { if (e.target.value) { setDa(e.target.value); setPreset('personalizzato'); } }} /></div>
              <div className="field"><label htmlFor="hr-a">Al</label><input id="hr-a" type="date" value={a} min={da} onChange={e => { if (e.target.value) { setA(e.target.value); setPreset('personalizzato'); } }} /></div>
              <div className="field"><label htmlFor="hr-cat">Categoria</label><select id="hr-cat" value={cat} onChange={e => setCat(e.target.value)}><option value="">Tutte</option>{CATEGORIE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
              <div className="field"><label htmlFor="hr-dip">Dipendente</label><select id="hr-dip" value={dip} onChange={e => setDip(e.target.value)}><option value="">Tutti</option>
                {dips.filter(x => !cat || x.categoria === cat).map(x => <option key={x.id} value={x.id}>{x.cognome} {x.nome}</option>)}</select></div>
              <span className="spacer" />
              <button className="btn" onClick={() => esporta('pdf')} disabled={!righe || !!esporto}>{esporto === 'pdf' ? 'Preparo…' : 'Scarica PDF'}</button>
              <button className="btn-ghost" onClick={() => esporta('xlsx')} disabled={!righe || !!esporto}>{esporto === 'xlsx' ? 'Preparo…' : 'Scarica Excel'}</button>
            </div>
          </div>
          {err && <Banner s="ko">{err}</Banner>}
          {!righe && !err && <p className="sub" style={{ padding: '20px 4px' }}>Caricamento…</p>}
          {righe && <>
            <div className="rep-meta"><span>{testoPeriodo}{testoFiltri ? ` · ${testoFiltri}` : ''}</span><span>{righe.length} righe</span></div>
            {riepilogo.length > 0 && <div className="rep-riepilogo">{riepilogo.map(x => <div key={x.l}><span>{x.l}</span><b>{x.v}</b></div>)}</div>}
            <div className="table-wrap"><table className="rep-tab">
              <thead><tr>{sel.colonne.map(c => <th key={c.k} className={numerica(c.t) ? 'num-c' : ''}>{c.l}</th>)}</tr></thead>
              <tbody>{righe.length ? righe.slice(0, MAX).map((r, i) => {
                const g = sel.raggruppa && (i === 0 || righe[i - 1][sel.raggruppa.k] !== r[sel.raggruppa.k]);
                return [g ? <tr key={`g${i}`} className="rep-gr"><td colSpan={sel.colonne.length}>{sel.raggruppa!.etichetta(r)}</td></tr> : null,
                  <tr key={i}>{sel.colonne.map(c => <td key={c.k} className={`${numerica(c.t) ? 'num-c mono' : ''} ${c.t === 'testo' && (c.w ?? 0) > 18 ? 'wrap-cell' : ''}`}>{testoCella(r[c.k], c.t)}</td>)}</tr>];
              }) : <tr><td colSpan={sel.colonne.length} className="sub">Nessun dato nel periodo selezionato.</td></tr>}</tbody>
            </table></div>
            {righe.length > MAX && <p className="hint">Anteprima delle prime {MAX} righe: i file PDF ed Excel contengono tutte le {righe.length} righe.</p>}
            <p className="hint">Malattia: solo il numero di giorni, mai la diagnosi. «Assenze flotta» sono quelle inserite a mano dal responsabile flotta prima del modulo ferie.</p>
          </>}
        </section>
      </div>
    </div>
  );
}
