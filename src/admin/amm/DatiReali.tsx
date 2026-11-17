import { useEffect, useState } from 'react';
import { supabase, testoErrore } from '../../lib/supabase';
import { Banner, Modal, toast } from '../../ui';
import { scarica } from '../report/esporta';
import { CHIAVE, COLONNE, NOME_FILE, validaTutto, type RigaImport, type Tipo } from '../../lib/anagrafiche';
import { creaModello } from '../../lib/modelliExcel';
import { CONFERMA_PF, TABELLE_PF, confermaPfValida, totalePf, type ContiPf } from '../../lib/azzeraPersonale';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function scaricaModello(tipo: Tipo) {
  const ExcelJS = (await import('exceljs')).default;
  scarica(new Blob([await creaModello(ExcelJS, tipo)], { type: XLSX_MIME }), NOME_FILE[tipo]);
}

/** Amministrazione › Dati reali: import Excel di dipendenti e veicoli, azzeramento dei dati di prova. */
export default function DatiReali() {
  return (
    <>
      <div className="section-title">Dati reali <span className="meta">importa dipendenti e veicoli da Excel</span></div>
      <Importa tipo="dipendenti" titolo="Dipendenti e tecnici" />
      <Importa tipo="veicoli" titolo="Veicoli" />
      <AzzeraPersonaleFlotta />
    </>
  );
}

type Anteprima = RigaImport & { esiste: boolean };

function Importa({ tipo, titolo }: { tipo: Tipo; titolo: string }) {
  const [file, setFile] = useState('');
  const [righe, setRighe] = useState<Anteprima[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);
  const chiave = CHIAVE[tipo];
  const valide = (righe ?? []).filter(r => !r.errori.length);
  const conErrori = (righe ?? []).length - valide.length;

  async function leggi(f: File) {
    setErr(null); setRighe(null); setFile(f.name);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
      const mat = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: true })
        .map(r => r.map(c => (c instanceof Date ? new Date(c.getTime() + 12 * 3600_000) : c)));
      const es = await supabase.from(tipo).select(tipo === 'dipendenti' ? 'codice,email' : 'targa');
      if (es.error) throw es.error;
      const esistenti = (es.data ?? []) as unknown as Record<string, string | null>[];
      const email: Record<string, string> = {};
      for (const d of esistenti) if (d.email) email[d.email.toLowerCase()] = String(d.codice);
      const v = validaTutto(tipo, mat, email);
      if (v.mancaChiave) { setErr(`Colonna «${COLONNE[tipo][0].titolo}» non trovata: usa il modello.`); return; }
      if (!v.righe.length) { setErr('Nessuna riga da importare.'); return; }
      const set = new Set(esistenti.map(d => String(d[chiave])));
      setRighe(v.righe.map(r => ({ ...r, esiste: set.has(String(r.valori[chiave])) })));
    } catch (e) { setErr(testoErrore(e)); }
  }

  async function importa() {
    if (!righe) return;
    setLavoro(true); setErr(null);
    try {
      const pulisci = (v: Record<string, unknown>) => { const o = { ...v }; delete o.sigla; return o; };
      const nuove = valide.filter(r => !r.esiste).map(r => pulisci(r.valori));
      for (let i = 0; i < nuove.length; i += 200) { const x = await supabase.from(tipo).insert(nuove.slice(i, i + 200)); if (x.error) throw x.error; }
      for (const r of valide.filter(r => r.esiste)) {
        const campi = Object.fromEntries(Object.entries(pulisci(r.valori)).filter(([k, v]) => v != null && k !== chiave));
        const x = await supabase.from(tipo).update(campi).eq(chiave, r.valori[chiave]); if (x.error) throw x.error;
      }
      if (tipo === 'dipendenti') {
        const conSigla = valide.filter(r => r.valori.sigla);
        if (conSigla.length) {
          const ids = await supabase.from('dipendenti').select('id,codice').in('codice', conSigla.map(r => String(r.valori.codice)));
          if (ids.error) throw ids.error;
          const per = new Map((ids.data ?? []).map((d: { id: number; codice: string }) => [d.codice, d.id]));
          const x = await supabase.from('tecnici_sigle').upsert(conSigla.map(r => ({ sigla: r.valori.sigla, dipendente_id: per.get(String(r.valori.codice)), attiva: true })), { onConflict: 'sigla' });
          if (x.error) throw x.error;
        }
      }
      toast(`${titolo}: ${nuove.length} nuovi, ${valide.length - nuove.length} aggiornati${conErrori ? `, ${conErrori} saltati` : ''}`);
      setRighe(null); setFile('');
    } catch (e) { setErr(testoErrore(e)); } finally { setLavoro(false); }
  }

  const vis = COLONNE[tipo].slice(0, tipo === 'dipendenti' ? 5 : 4);
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <h2 className="section-title">{titolo}</h2>
      <div className="row-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button className="btn-ghost btn-sm" onClick={() => scaricaModello(tipo).catch(e => setErr(testoErrore(e)))}>Scarica modello</button>
        <label className="btn btn-sm">Carica Excel<input type="file" accept=".xlsx,.xls,.csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) leggi(f); }} /></label>
        {file && <span className="hint">{file}</span>}
      </div>
      {err && <Banner s="ko">{err}</Banner>}
      {righe && (
        <>
          <p className="sub">{righe.length} righe · <b>{valide.filter(r => !r.esiste).length}</b> nuove · <b>{valide.filter(r => r.esiste).length}</b> da aggiornare{conErrori ? <> · <span style={{ color: 'var(--ko, #c0392b)' }}><b>{conErrori}</b> con errori (saltate)</span></> : null}</p>
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}><table>
            <thead><tr><th>Riga</th>{vis.map(c => <th key={c.k}>{c.titolo}</th>)}<th>Esito</th></tr></thead>
            <tbody>{righe.map(r => (
              <tr key={r.riga}><td>{r.riga}</td>{vis.map(c => <td key={c.k}>{String(r.valori[c.k] ?? '')}</td>)}
                <td>{r.errori.length ? <span style={{ color: 'var(--ko, #c0392b)' }}>{r.errori.join(' · ')}</span> : r.esiste ? 'Aggiorna' : 'Nuovo'}</td></tr>))}</tbody>
          </table></div>
          <div className="row-flex" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" disabled={!valide.length || lavoro} onClick={importa}>{lavoro ? 'Importazione…' : `Importa ${valide.length}`}</button>
            <button className="btn-ghost btn-sm" disabled={lavoro} onClick={() => { setRighe(null); setFile(''); }}>Annulla</button>
          </div>
        </>
      )}
    </div>
  );
}

/** Zona pericolosa: cancella tutti i dipendenti, i veicoli e i dati collegati (solo admin). */
function AzzeraPersonaleFlotta() {
  const [attiva, setAttiva] = useState<boolean | null>(null);
  const [conti, setConti] = useState<ContiPf | null>(null);
  const [testo, setTesto] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [lavoro, setLavoro] = useState(false);

  useEffect(() => {
    supabase.rpc('admin_personale_flotta_conteggi', {}).then(r => setAttiva(!r.error || !/PGRST202|Could not find|does not exist/i.test(`${r.error.code} ${r.error.message}`)));
  }, []);

  async function apri() {
    setErr(null); setTesto('');
    const r = await supabase.rpc('admin_personale_flotta_conteggi', {});
    if (r.error) { setErr(testoErrore(r.error)); return; }
    setConti(r.data as ContiPf);
  }

  async function backup() {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    for (const t of ['dipendenti', 'veicoli', 'assegnazioni', 'movimenti', 'segnalazioni', 'richieste_assenza', 'corsi_dipendente', 'interventi']) {
      const x = await supabase.from(t).select('*'); if (x.error) throw x.error;
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((x.data ?? []).map(r => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'pin_hash' && k !== 'qr_token')))), t.slice(0, 31));
    }
    XLSX.writeFile(wb, `backup-personale-flotta-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  async function esegui() {
    if (!conti || !confermaPfValida(testo)) return;
    setLavoro(true); setErr(null);
    try {
      for (const [b, files] of Object.entries(conti.file ?? {})) for (let i = 0; i < files.length; i += 100) {
        const x = await supabase.storage.from(b).remove(files.slice(i, i + 100)); if (x.error) throw x.error;
      }
      const r = await supabase.rpc('admin_azzera_personale_flotta', {});
      if (r.error) throw r.error;
      toast(`Dati di prova cancellati (${totalePf(r.data as ContiPf)} righe)`); setConti(null);
    } catch (e) { setErr(testoErrore(e)); } finally { setLavoro(false); }
  }

  const nFile = Object.values(conti?.file ?? {}).reduce((s, l) => s + l.length, 0);
  return (
    <div className="card" style={{ borderColor: 'var(--ko, #c0392b)', borderWidth: 2, borderStyle: 'solid', marginTop: 24 }}>
      <h2 className="section-title" style={{ color: 'var(--ko, #c0392b)' }}>Zona pericolosa · Azzera dati di prova</h2>
      <p className="sub">Cancella tutti i dipendenti, i veicoli e i dati collegati. Restano account dell'ufficio, clienti, referenti, pratiche del centralino, modelli email, zone CAP e listino.</p>
      {err && <Banner s="ko">{err}</Banner>}
      {attiva === false
        ? <button className="btn btn-sm" disabled title="La funzione sul database non è ancora stata attivata">In attesa di attivazione</button>
        : <button className="btn btn-sm" style={{ background: 'var(--ko, #c0392b)' }} disabled={attiva === null} onClick={apri}>Azzera dati di prova…</button>}
      {conti && (
        <Modal titolo="Azzera dati di prova" onClose={() => !lavoro && setConti(null)}>
          <table className="tbl"><tbody>
            {TABELLE_PF.filter(t => Number(conti[t.k]) > 0 || t.sempre).map(t => <tr key={t.k}><td>{t.nome}</td><td style={{ textAlign: 'right' }}><b>{Number(conti[t.k]) || 0}</b></td></tr>)}
            <tr><td>File (attestati, foto, documenti)</td><td style={{ textAlign: 'right' }}><b>{nFile}</b></td></tr>
          </tbody></table>
          <p className="hint">Scollegati ma conservati: {Number(conti.scollega_pratiche) || 0} pratiche, {Number(conti.scollega_interventi_importati) || 0} interventi Taylor, {Number(conti.scollega_sigle) || 0} sigle zona, {Number(conti.scollega_carte) || 0} carte carburante.</p>
          <p>Totale: <b>{totalePf(conti)}</b> righe. Azione irreversibile, resta nel registro.</p>
          <label>Scrivi <b>{CONFERMA_PF}</b> per confermare <input value={testo} onChange={e => setTesto(e.target.value)} autoFocus aria-label="Conferma" /></label>
          <div className="row-flex" style={{ marginTop: 12 }}>
            <button className="btn btn-sm" style={{ background: 'var(--ko, #c0392b)' }} disabled={!confermaPfValida(testo) || lavoro} onClick={esegui}>{lavoro ? 'Cancellazione…' : 'Cancella tutto'}</button>
            <button type="button" className="btn-ghost btn-sm" disabled={lavoro} onClick={() => backup().catch(e => setErr(testoErrore(e)))}>Scarica copia (Excel)</button>
            <button className="btn-ghost btn-sm" disabled={lavoro} onClick={() => setConti(null)}>Annulla</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

