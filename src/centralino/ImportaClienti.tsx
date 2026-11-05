import { useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Banner, toast, useLoad } from '../ui';
import { scarica } from '../admin/report/esporta';

/** Campi dell'anagrafica e nomi di colonna riconosciuti automaticamente (Taylor / Ad Hoc). */
const CAMPI: { k: string; l: string; obbl?: boolean; sinonimi: string[] }[] = [
  { k: 'cod_cliente', l: 'Cod. cliente', obbl: true, sinonimi: ['cod. cli.', 'cod cli', 'codice cliente', 'cod. cliente', 'codice', 'cod_cliente', 'cliente codice'] },
  { k: 'nome', l: 'Ragione sociale / nome', obbl: true, sinonimi: ['ragione sociale', 'cliente', 'nome', 'denominazione', 'descrizione'] },
  { k: 'indirizzo', l: 'Indirizzo', sinonimi: ['indirizzo', 'via', 'ubicazione'] },
  { k: 'cap', l: 'CAP', sinonimi: ['cap', 'c.a.p.'] },
  { k: 'comune', l: 'Comune', sinonimi: ['comune', 'città', 'citta', 'località', 'localita', 'loc.'] },
  { k: 'prov', l: 'Provincia', sinonimi: ['prov.', 'prov', 'provincia'] },
  { k: 'telefono', l: 'Telefono', sinonimi: ['telefono', 'tel.', 'tel', 'telefono 1'] },
  { k: 'cellulare', l: 'Cellulare', sinonimi: ['cellulare', 'cell.', 'cell', 'mobile'] },
  { k: 'email', l: 'Email', sinonimi: ['email', 'e-mail', 'mail', 'indirizzo email'] },
  { k: 'pec', l: 'PEC', sinonimi: ['pec', 'e-mail pec', 'posta certificata'] },
  { k: 'referente', l: 'Referente', sinonimi: ['referente', 'contatto', 'persona di riferimento', 'amministratore'] },
  { k: 'sedi', l: 'Sedi / impianti', sinonimi: ['sedi', 'impianti', 'imp. num/serie', 'impianto'] },
];
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
interface Esito { prova: boolean; nuovi: number; aggiornati: number; invariati: number; protetti: number; errori: number; dettaglio_errori: { riga: number; cod_cliente?: string; errore: string }[]; differenze: { riga: number; cod_cliente: string; nome: string; cambi: Record<string, { da: string | null; a: string }> }[] }
interface Log { id: number; file: string | null; autore_nome: string | null; at: string; nuovi: number; aggiornati: number; invariati: number; protetti: number; errori: number; dettaglio_errori: Esito['dettaglio_errori'] }

const erroriCsv = (l: Esito['dettaglio_errori']) => new Blob(['﻿Riga;Cod. cliente;Errore\n' + l.map(e => `${e.riga};${e.cod_cliente ?? ''};"${e.errore.replace(/"/g, '""')}"`).join('\n')], { type: 'text/csv;charset=utf-8' });

/**
 * «Anagrafica clienti – Importa da Taylor»: file Excel/CSV, colonne per nome (mappa ricordata), prova senza scrivere
 * (nuovi / aggiornati / invariati / protetti / errori + differenze), conferma, registro delle importazioni.
 */
export default function ImportaClienti({ scrive, mappaSalvata }: { scrive: boolean; mappaSalvata: Record<string, string> }) {
  const [file, setFile] = useState<string>('');
  const [intest, setIntest] = useState<string[]>([]);
  const [righe, setRighe] = useState<Record<string, unknown>[]>([]);
  const [mappa, setMappa] = useState<Record<string, string>>({});
  const [sovr, setSovr] = useState(false);
  const [es, setEs] = useState<Esito | null>(null);
  const [lavoro, setLavoro] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const log = useLoad(async () => {
    const { data, error } = await supabase.from('clienti_importazioni').select('*').order('at', { ascending: false }).limit(20);
    if (error) throw error; return (data ?? []) as Log[];
  });

  async function leggi(f: File) {
    setErr(null); setEs(null); setLavoro('Leggo il file…');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', raw: false });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const mat = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
      // riga d'intestazione: la prima con almeno 2 nomi di colonna riconosciuti
      const iH = Math.max(0, mat.findIndex(r => (r as unknown[]).filter(c => CAMPI.some(k => k.sinonimi.includes(norm(c)))).length >= 2));
      const h = (mat[iH] as unknown[]).map(c => String(c ?? '').trim());
      const dati = mat.slice(iH + 1).filter(r => (r as unknown[]).some(c => String(c ?? '').trim())).map(r => Object.fromEntries(h.map((k, i) => [k, (r as unknown[])[i]])));
      const auto: Record<string, string> = {};
      for (const c of CAMPI) {
        const salv = mappaSalvata[c.k];
        auto[c.k] = salv && h.includes(salv) ? salv : h.find(x => c.sinonimi.includes(norm(x))) ?? '';
      }
      setFile(f.name); setIntest(h); setRighe(dati); setMappa(auto);
    } catch (e) { setErr(`File non leggibile: ${testoErrore(e)}`); } finally { setLavoro(''); }
  }
  const mappate = () => righe.map(r => {
    const o: Record<string, unknown> = {};
    for (const c of CAMPI) if (mappa[c.k]) o[c.k] = c.k === 'sedi' ? String(r[mappa[c.k]] ?? '').split(/[;,|]/).map(x => x.trim()).filter(Boolean) : String(r[mappa[c.k]] ?? '').trim();
    return o;
  });
  async function esegui(prova: boolean) {
    setErr(null);
    if (!mappa.cod_cliente || !mappa.nome) { setErr('Collega almeno «Cod. cliente» e «Ragione sociale».'); return; }
    setLavoro(prova ? 'Controllo senza scrivere…' : 'Importo…');
    try {
      const r = await rpc<Esito>('centralino_importa_clienti', { p_righe: mappate(), p_file: file, p_prova: prova, p_sovrascrivi: sovr });
      setEs(r);
      if (!prova) {
        await supabase.from('centralino_impostazioni').update({ valore: mappa }).eq('chiave', 'mappa_import_clienti');
        toast(`Importati: ${r.nuovi} nuovi, ${r.aggiornati} aggiornati`); log.reload();
      }
    } catch (e) { setErr(testoErrore(e)); } finally { setLavoro(''); }
  }

  return (
    <section className="ct-blocco ct-import">
      <h2>Anagrafica clienti – Importa da Taylor</h2>
      <p className="sub">File Excel o CSV esportato da Taylor / Ad Hoc (clienti nuovi o aggiornati). Le colonne si riconoscono dal nome; la scelta resta per la prossima volta. Prima si fa una prova: nulla viene scritto finché non confermi.</p>
      {scrive && <label className="btn-ghost ct-file">Scegli il file…<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) leggi(f); e.target.value = ''; }} /></label>}
      {lavoro && <p className="hint">{lavoro}</p>}
      {intest.length > 0 && (<>
        <p><b>{file}</b> · {righe.length} righe</p>
        <div className="ct-mappa">
          {CAMPI.map(c => (
            <div key={c.k} className="field"><label>{c.l}{c.obbl ? ' *' : ''}</label>
              <select value={mappa[c.k] ?? ''} onChange={e => { setMappa({ ...mappa, [c.k]: e.target.value }); setEs(null); }}>
                <option value="">— non presente —</option>{intest.filter(Boolean).map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              {mappa[c.k] && righe[0] && <span className="sub ct-es">es. {String(righe[0][mappa[c.k]] ?? '').slice(0, 40) || '—'}</span>}
            </div>))}
        </div>
        <label className="check"><input type="checkbox" checked={sovr} onChange={e => { setSovr(e.target.checked); setEs(null); }} /> Sovrascrivi anche i clienti modificati a mano nel portale</label>
        <div className="row-flex"><button className="btn-ghost" onClick={() => esegui(true)} disabled={!!lavoro}>1 · Prova (non scrive)</button>
          <button className="btn" onClick={() => esegui(false)} disabled={!!lavoro || !es?.prova}>2 · Conferma l'importazione</button></div>
      </>)}
      {err && <Banner s="ko">{err}</Banner>}
      {es && (<>
        <div className="kpis ct-riep">
          {([['Nuovi', es.nuovi, 'ok'], ['Aggiornati', es.aggiornati, 'info'], ['Invariati', es.invariati, ''], ['Protetti (modifiche manuali)', es.protetti, 'warn'], ['Errori', es.errori, es.errori ? 'ko' : '']] as const).map(([l, n, c]) => (
            <div key={l} className={`kpi ${c}`}><div className="num">{n}</div><div className="lbl">{l}</div></div>))}
        </div>
        {es.prova && <p className="hint">Questa era una prova: controlla le differenze e poi premi «Conferma l'importazione».</p>}
        {es.differenze.length > 0 && <details open><summary>Differenze ({es.differenze.length}{es.differenze.length >= 500 ? '+' : ''})</summary>
          <div className="table-wrap"><table className="ct-tab"><thead><tr><th>Riga</th><th>Cliente</th><th>Campo</th><th>Prima</th><th>Dopo</th></tr></thead>
            <tbody>{es.differenze.flatMap(d => Object.entries(d.cambi).map(([k, v]) => (
              <tr key={`${d.riga}-${k}`} className={k === 'telefono' || k === 'cellulare' || k === 'email' ? 'ct-diff-forte' : ''}><td>{d.riga}</td><td>{d.cod_cliente} · {d.nome}</td><td>{k}</td><td><s>{v.da ?? '—'}</s></td><td>{v.a}</td></tr>)))}</tbody></table></div></details>}
        {es.dettaglio_errori.length > 0 && <p><button className="btn-ghost btn-sm" onClick={() => scarica(erroriCsv(es.dettaglio_errori), `errori_import_${file}.csv`)}>Scarica il rapporto errori ({es.errori})</button></p>}
      </>)}
      {(log.data?.length ?? 0) > 0 && <details><summary>Importazioni precedenti</summary>
        <table className="ct-tab"><thead><tr><th>Quando</th><th>File</th><th>Chi</th><th>Nuovi</th><th>Agg.</th><th>Invar.</th><th>Protetti</th><th>Errori</th></tr></thead>
          <tbody>{log.data!.map(l => <tr key={l.id}><td>{fmtOra(l.at)}</td><td>{l.file}</td><td>{l.autore_nome}</td><td>{l.nuovi}</td><td>{l.aggiornati}</td><td>{l.invariati}</td><td>{l.protetti}</td>
            <td>{l.errori ? <button className="ct-link" onClick={() => scarica(erroriCsv(l.dettaglio_errori), `errori_import_${l.id}.csv`)}>{l.errori}</button> : 0}</td></tr>)}</tbody></table></details>}
    </section>
  );
}
