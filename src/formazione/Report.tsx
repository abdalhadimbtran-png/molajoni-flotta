import { useEffect, useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { Banner, Caricamento, toast } from '../ui';
import { testoCella, type Report, type Riga } from '../admin/report/catalogo';

type Id = 'per_dipendente' | 'scadenze';
const COL_BASE = [
  { k: 'dipendente', l: 'Dipendente', t: 'testo', w: 22 }, { k: 'corso', l: 'Corso', t: 'testo', w: 30 },
  { k: 'data_conseguimento', l: 'Conseguito il', t: 'data', w: 12 }, { k: 'data_scadenza', l: 'Scadenza', t: 'data', w: 12 },
  { k: 'stato', l: 'Stato', t: 'testo', w: 11 }, { k: 'ente', l: 'Ente', t: 'testo', w: 18 }, { k: 'ore', l: 'Ore', t: 'dec1', w: 7 },
] as Report['colonne'];
const conta = (r: Riga[], s: string) => String(r.filter(x => x.stato === s).length);
const REPORT: (Report & { fid: Id })[] = [
  { fid: 'per_dipendente', id: 'formazione_dipendente', gruppo: 'Tecnici', periodo: 'oggi', filtri: {}, titolo: 'Formazione per dipendente',
    descrizione: 'Ogni dipendente con i suoi corsi attuali, la scadenza e lo stato. Include gli obbligatori mancanti dei tecnici.',
    colonne: COL_BASE.filter(c => c.k !== 'dipendente'), raggruppa: { k: 'dipendente', etichetta: r => String(r.dipendente) }, nuovaPaginaPerGruppo: false,
    riepilogo: r => [{ l: 'Righe', v: String(r.length) }, { l: 'Scaduti', v: conta(r, 'Scaduto') }, { l: 'Mancanti', v: conta(r, 'Mancante') }] },
  { fid: 'scadenze', id: 'formazione_scadenze', gruppo: 'Tecnici', periodo: 'oggi', filtri: {}, titolo: 'Scadenze corsi',
    descrizione: 'Corsi già scaduti e in scadenza entro i giorni scelti, in ordine di data.',
    colonne: [...COL_BASE, { k: 'giorni', l: 'Giorni', t: 'num', w: 8 }] as Report['colonne'],
    riepilogo: r => [{ l: 'Corsi', v: String(r.length) }, { l: 'Scaduti', v: conta(r, 'Scaduto') }, { l: 'In scadenza', v: conta(r, 'In scadenza') }] },
];

export default function ReportFormazione() {
  const [sel, setSel] = useState(REPORT[0]);
  const [cat, setCat] = useState('TEC');
  const [giorni, setGiorni] = useState(60);
  const [righe, setRighe] = useState<Riga[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [esporto, setEsporto] = useState('');
  useEffect(() => {
    let vivo = true; setRighe(null); setErr(null);
    rpc<{ righe: Riga[] }>('formazione_report', { p_tipo: sel.fid, p_categoria: cat || null, p_dipendente: null, p_giorni: giorni })
      .then(r => { if (vivo) setRighe(r.righe); }).catch(e => { if (vivo) setErr(testoErrore(e)); });
    return () => { vivo = false; };
  }, [sel, cat, giorni]);
  async function esporta(tipo: 'xlsx' | 'pdf') {
    if (!righe) return; setEsporto(tipo);
    try {
      const m = await import('../admin/report/esporta');
      const { data: u } = await supabase.auth.getUser();
      const ctx = { periodo: `Situazione al ${testoCella(new Date().toISOString().slice(0, 10), 'data')}`,
        filtri: [cat ? (cat === 'TEC' ? 'Solo tecnici' : cat) : 'Tutti i dipendenti', sel.fid === 'scadenze' ? `entro ${giorni} giorni` : ''].filter(Boolean).join(' · '),
        autore: u.user?.email ?? 'formazione', generato: new Date(), prodotto: 'Formazione' };
      await (tipo === 'xlsx' ? m.esportaExcel(sel, righe, ctx) : m.esportaPdf(sel, righe, ctx));
      toast(tipo === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(testoErrore(e)); } finally { setEsporto(''); }
  }
  const col = sel.colonne;
  return (
    <div className="rep">
      <div className="page-hero"><div><h1>Report formazione</h1><p className="sub">Scegli il report, guarda l'anteprima e scaricalo in PDF o Excel.</p></div></div>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        {REPORT.map(r => <button key={r.id} className={sel.id === r.id ? 'btn' : 'btn-ghost'} onClick={() => setSel(r)}>{r.titolo}</button>)}
      </div>
      <p className="sub">{sel.descrizione}</p>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <div className="field"><label htmlFor="f-cat">Dipendenti</label>
          <select id="f-cat" value={cat} onChange={e => setCat(e.target.value)}>
            <option value="TEC">Solo tecnici</option><option value="">Tutti</option><option value="UFFICIO">Ufficio</option><option value="MAGAZZINO">Magazzino</option><option value="ALTRO">Altro</option>
          </select></div>
        {sel.fid === 'scadenze' && <div className="field"><label htmlFor="f-gg">Scadenza entro</label>
          <select id="f-gg" value={giorni} onChange={e => setGiorni(Number(e.target.value))}>
            {[30, 60, 90, 180, 365].map(g => <option key={g} value={g}>{g} giorni</option>)}
          </select></div>}
        <button className="btn" onClick={() => esporta('pdf')} disabled={!righe?.length || !!esporto}>{esporto === 'pdf' ? 'Preparo…' : 'Scarica PDF'}</button>
        <button className="btn-ghost" onClick={() => esporta('xlsx')} disabled={!righe?.length || !!esporto}>{esporto === 'xlsx' ? 'Preparo…' : 'Scarica Excel'}</button>
      </div>
      {err && <Banner s="ko">{err}</Banner>}
      {!righe && !err && <Caricamento />}
      {righe && righe.length === 0 && <p className="sub">Nessun dato.</p>}
      {righe && righe.length > 0 && (
        <div className="table-wrap"><table>
          <thead><tr>{sel.raggruppa && <th>Dipendente</th>}{col.map(c => <th key={c.k}>{c.l}</th>)}</tr></thead>
          <tbody>{righe.slice(0, 300).map((r, i) => <tr key={i}>{sel.raggruppa && <td>{String(r.dipendente)}</td>}{col.map(c => <td key={c.k}>{testoCella(r[c.k], c.t)}</td>)}</tr>)}</tbody>
        </table></div>)}
    </div>
  );
}
