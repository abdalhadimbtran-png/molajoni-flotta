import { useMemo, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { Caricamento, Errore, toast, useLoad } from '../ui';
import { testoCella, type Col, type Report, type Riga } from '../admin/report/catalogo';
import { caricaTutto, piuMesi, type Tutto } from './comune';

type Id = 'tecnico' | 'scadenze' | 'matrice' | 'mancanti' | 'ore';
const ST: Record<string, string> = { valido: 'Valido', in_scadenza: 'In scadenza', scaduto: 'Scaduto', mancante: 'Mancante' };
const SIM: Record<string, string> = { valido: '✓', in_scadenza: 'In scad.', scaduto: 'Scaduto', mancante: 'Manca' };
const c = (k: string, l: string, t: Col['t'], w: number, tot?: boolean): Col => ({ k, l, t, w, tot });
const conta = (r: Riga[], k: string, v: string) => String(r.filter(x => x[k] === v).length);

interface Def { id: Id; titolo: string; descrizione: string; periodo?: boolean; costruisci: (t: Tutto, f: { tec: boolean; da: string; a: string }) => { rep: Report; righe: Riga[] } }
const base = (id: string, titolo: string, descrizione: string, colonne: Col[], extra: Partial<Report> = {}): Report =>
  ({ id, titolo, descrizione, gruppo: 'Tecnici', periodo: 'oggi', filtri: {}, colonne, ...extra });

const DEF: Def[] = [
  { id: 'tecnico', titolo: 'Situazione formazione per tecnico', descrizione: 'Per ogni persona: corsi attuali, scadenza, stato, attestato.',
    costruisci: (t, f) => {
      const righe = t.righe.filter(r => !f.tec || r.categoria === 'TEC').sort((a, b) => a.nome.localeCompare(b.nome) || a.corso.localeCompare(b.corso)).map(r => {
        const g = t.registrazioni.find(x => x.attuale && x.dipendente_id === r.dipendente_id && x.corso_id === r.corso_id);
        return { dipendente: r.nome, corso: r.corso, obbl: r.obbligatorio ? 'Sì' : '', fatto: r.data_conseguimento, scadenza: r.data_scadenza, stato: ST[r.stato], attestato: g ? (g.n_attestati ? 'Sì' : 'No') : '' };
      });
      return { righe, rep: base('form_tecnico', 'Situazione formazione per tecnico', '', [c('corso', 'Corso', 'testo', 34), c('obbl', 'Obbligatorio', 'testo', 11), c('fatto', 'Fatto il', 'data', 12), c('scadenza', 'Scadenza', 'data', 12), c('stato', 'Stato', 'testo', 12), c('attestato', 'Attestato', 'testo', 10)],
        { raggruppa: { k: 'dipendente', etichetta: r => String(r.dipendente) }, riepilogo: r => [{ l: 'Righe', v: String(r.length) }, { l: 'Scaduti', v: conta(r, 'stato', 'Scaduto') }, { l: 'Mancanti', v: conta(r, 'stato', 'Mancante') }] }) };
    } },
  { id: 'scadenze', titolo: 'Scadenze prossimi 6 mesi', descrizione: 'Corsi scaduti e in scadenza nei prossimi 6 mesi, in ordine di data.',
    costruisci: (t, f) => {
      const lim = piuMesi(t.oggi, 6);
      const righe = t.righe.filter(r => (!f.tec || r.categoria === 'TEC') && r.data_scadenza && r.data_scadenza <= lim).sort((a, b) => a.data_scadenza!.localeCompare(b.data_scadenza!))
        .map(r => ({ dipendente: r.nome, corso: r.corso, scadenza: r.data_scadenza, giorni: r.giorni, stato: ST[r.stato] }));
      return { righe, rep: base('form_scadenze', 'Scadenze prossimi 6 mesi', '', [c('dipendente', 'Dipendente', 'testo', 24), c('corso', 'Corso', 'testo', 34), c('scadenza', 'Scadenza', 'data', 12), c('giorni', 'Giorni', 'num', 8), c('stato', 'Stato', 'testo', 12)],
        { riepilogo: r => [{ l: 'Corsi', v: String(r.length) }, { l: 'Già scaduti', v: conta(r, 'stato', 'Scaduto') }] }) };
    } },
  { id: 'matrice', titolo: 'Matrice tecnici × corsi', descrizione: '✓ valido · In scad. · Scaduto · Manca (obbligatorio) · — non previsto. Pagina orizzontale.',
    costruisci: (t, f) => {
      const corsi = t.corsi.filter(x => x.attivo);
      const dip = t.dip.filter(d => !f.tec || d.categoria === 'TEC');
      const righe = dip.map(d => {
        const r: Riga = { dipendente: `${d.cognome} ${d.nome}` };
        for (const k of corsi) { const x = t.righe.find(y => y.dipendente_id === d.id && y.corso_id === k.id); r[`c${k.id}`] = x ? SIM[x.stato] : '—'; }
        return r;
      });
      return { righe, rep: base('form_matrice', 'Matrice tecnici × corsi', '', [c('dipendente', 'Dipendente', 'testo', 22), ...corsi.map(k => c(`c${k.id}`, k.nome, 'testo', 11))], { orizzontale: true }) };
    } },
  { id: 'mancanti', titolo: 'Attestati mancanti', descrizione: 'Corsi registrati senza attestato allegato.',
    costruisci: (t, f) => {
      const righe = t.registrazioni.filter(r => r.attuale && r.attivo && r.n_attestati === 0 && (!f.tec || r.categoria === 'TEC')).sort((a, b) => a.nome.localeCompare(b.nome))
        .map(r => { const q = t.richieste.find(x => x.corso_dipendente_id === r.id && x.stato !== 'approvato'); return { dipendente: r.nome, corso: r.corso, fatto: r.data_conseguimento, scadenza: r.data_scadenza, richiesta: q ? (q.stato === 'da_verificare' ? 'Da verificare' : 'Chiesto') : '' }; });
      return { righe, rep: base('form_mancanti', 'Attestati mancanti', '', [c('dipendente', 'Dipendente', 'testo', 24), c('corso', 'Corso', 'testo', 34), c('fatto', 'Fatto il', 'data', 12), c('scadenza', 'Scadenza', 'data', 12), c('richiesta', 'Al dipendente', 'testo', 14)],
        { riepilogo: r => [{ l: 'Senza attestato', v: String(r.length) }] }) };
    } },
  { id: 'ore', titolo: 'Ore di formazione per periodo', descrizione: 'Ore e corsi fatti da ogni persona nel periodo scelto.', periodo: true,
    costruisci: (t, f) => {
      const m = new Map<string, { dipendente: string; corsi: number; ore: number }>();
      for (const r of t.registrazioni) if (r.data_conseguimento >= f.da && r.data_conseguimento <= f.a && (!f.tec || r.categoria === 'TEC')) {
        const x = m.get(r.nome) ?? { dipendente: r.nome, corsi: 0, ore: 0 }; x.corsi++; x.ore += Number(r.ore ?? 0); m.set(r.nome, x);
      }
      const righe = [...m.values()].sort((a, b) => b.ore - a.ore);
      return { righe, rep: base('form_ore', 'Ore di formazione per periodo', '', [c('dipendente', 'Dipendente', 'testo', 30), c('corsi', 'Corsi fatti', 'num', 12, true), c('ore', 'Ore', 'dec1', 12, true)],
        { periodo: 'intervallo', riepilogo: r => [{ l: 'Persone', v: String(r.length) }, { l: 'Ore totali', v: String(r.reduce((s, x) => s + Number(x.ore), 0)) }] }) };
    } },
];

export default function ReportFormazione() {
  const { data, errore, reload } = useLoad(caricaTutto);
  const [sel, setSel] = useState<Def>(DEF[0]);
  const [tec, setTec] = useState(true);
  const anno = new Date().getFullYear();
  const [da, setDa] = useState(`${anno}-01-01`);
  const [a, setA] = useState(`${anno}-12-31`);
  const [esporto, setEsporto] = useState('');
  const out = useMemo(() => (data ? sel.costruisci(data, { tec, da, a }) : null), [data, sel, tec, da, a]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!data || !out) return <Caricamento />;
  const rep = { ...out.rep, descrizione: sel.descrizione };
  async function esporta(tipo: 'xlsx' | 'pdf') {
    setEsporto(tipo);
    try {
      const m = await import('../admin/report/esporta');
      const { data: u } = await supabase.auth.getUser();
      const ctx = { periodo: sel.periodo ? `${testoCella(da, 'data')} – ${testoCella(a, 'data')}` : `Situazione al ${testoCella(data!.oggi, 'data')}`,
        filtri: tec ? 'Solo tecnici' : 'Tutti i dipendenti', autore: u.user?.email ?? 'formazione', generato: new Date(), prodotto: 'Formazione' };
      await (tipo === 'xlsx' ? m.esportaExcel(rep, out!.righe, ctx) : m.esportaPdf(rep, out!.righe, ctx));
      toast(tipo === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(testoErrore(e)); } finally { setEsporto(''); }
  }
  const col = rep.raggruppa ? [c('dipendente', 'Dipendente', 'testo', 20), ...rep.colonne] : rep.colonne;
  return (
    <div className="rep">
      <div className="page-hero"><div><h1>Report formazione</h1><p className="sub">Scegli il report, guarda l'anteprima, scarica PDF o Excel.</p></div></div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', marginBottom: 16 }}>
        {DEF.map(d => <button key={d.id} className={sel.id === d.id ? 'btn' : 'btn-ghost'} style={{ textAlign: 'start', whiteSpace: 'normal', height: 'auto', padding: 12 }} onClick={() => setSel(d)}>{d.titolo}</button>)}
      </div>
      <p className="sub">{sel.descrizione}</p>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <button className={tec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTec(true)}>Solo tecnici</button>
        <button className={!tec ? 'btn btn-sm' : 'btn-ghost btn-sm'} onClick={() => setTec(false)}>Tutti</button>
        {sel.periodo && <><input type="date" aria-label="Dal" value={da} onChange={e => setDa(e.target.value)} /><input type="date" aria-label="Al" value={a} onChange={e => setA(e.target.value)} /></>}
        <button className="btn" onClick={() => esporta('pdf')} disabled={!out.righe.length || !!esporto}>{esporto === 'pdf' ? 'Preparo…' : 'Scarica PDF'}</button>
        <button className="btn-ghost" onClick={() => esporta('xlsx')} disabled={!out.righe.length || !!esporto}>{esporto === 'xlsx' ? 'Preparo…' : 'Scarica Excel'}</button>
      </div>
      {out.righe.length === 0 ? <p className="sub">Nessun dato.</p> : (
        <div className="table-wrap"><table>
          <thead><tr>{col.map(x => <th key={x.k}>{x.l}</th>)}</tr></thead>
          <tbody>{out.righe.slice(0, 300).map((r, i) => <tr key={i}>{col.map(x => <td key={x.k}>{testoCella(r[x.k], x.t)}</td>)}</tr>)}</tbody>
        </table></div>)}
    </div>
  );
}
