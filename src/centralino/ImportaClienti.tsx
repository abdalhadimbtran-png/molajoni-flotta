import { useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { fmtOra } from '../lib/format';
import { Banner, toast, useLoad } from '../ui';
import { scarica } from '../admin/report/esporta';
import { CAMPI, aBlocchi, normIntest, preparaRighe, riconosci, type Campo } from '../lib/centralino/importa';

interface Esito { nuovi: number; aggiornati: number; invariati: number; protetti: number; errori: number; dettaglio_errori: { riga: number; cod_cliente?: string; errore: string }[]; differenze: { riga: number; cod_cliente: string; nome: string; cambi: Record<string, { da: string | null; a: string }> }[] }
interface Log { id: number; file: string | null; autore_nome: string | null; at: string; nuovi: number; aggiornati: number; invariati: number; protetti: number; errori: number; dettaglio_errori: Esito['dettaglio_errori'] }
const vuoto = (): Esito => ({ nuovi: 0, aggiornati: 0, invariati: 0, protetti: 0, errori: 0, dettaglio_errori: [], differenze: [] });
const erroriCsv = (l: Esito['dettaglio_errori']) => new Blob(['﻿Riga;Codice;Errore\n' + l.map(e => `${e.riga};${e.cod_cliente ?? ''};"${e.errore.replace(/"/g, '""')}"`).join('\n')], { type: 'text/csv;charset=utf-8' });
const BLOCCO = 500;

/**
 * «Anagrafica clienti – Importa da Taylor»: Excel/CSV, intestazioni riconosciute (Codice, Ragione sociale, Località, Telefono, Email e sinonimi),
 * colonne sconosciute mostrate come «non importate», più numeri/email per cella, PEC, «00186 ROMA (RM)».
 * Prova senza scrivere → conferma; blocchi da 500 righe con avanzamento. Riutilizzabile per l'import mensile.
 */
export default function ImportaClienti({ scrive, mappaSalvata }: { scrive: boolean; mappaSalvata: Record<string, string> }) {
  const [file, setFile] = useState('');
  const [intest, setIntest] = useState<string[]>([]);
  const [grezze, setGrezze] = useState<Record<string, unknown>[]>([]);
  const [mappa, setMappa] = useState<Record<Campo, string>>({} as Record<Campo, string>);
  const [sovr, setSovr] = useState(false);
  const [es, setEs] = useState<(Esito & { prova: boolean }) | null>(null);
  const [avanz, setAvanz] = useState<{ fatto: number; tot: number; testo: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const log = useLoad(async () => {
    const { data, error } = await supabase.from('clienti_importazioni').select('*').order('at', { ascending: false }).limit(20);
    if (error) throw error; return (data ?? []) as Log[];
  });

  async function leggi(f: File) {
    setErr(null); setEs(null); setAvanz({ fatto: 0, tot: 1, testo: 'Leggo il file…' });
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', raw: false });
      const mat = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      // intestazione: la prima riga con almeno 2 nomi riconosciuti (di solito la riga 1)
      const iH = Math.max(0, mat.findIndex(r => (r as unknown[]).filter(c => CAMPI.some(k => k.sinonimi.includes(normIntest(c)))).length >= 2));
      const h = (mat[iH] as unknown[]).map(c => String(c ?? ''));
      const dati = mat.slice(iH + 1).filter(r => (r as unknown[]).some(c => String(c ?? '').trim())).map(r => Object.fromEntries(h.map((k, i) => [k, (r as unknown[])[i]])));
      setFile(f.name); setIntest(h); setGrezze(dati); setMappa(riconosci(h, mappaSalvata));
    } catch (e) { setErr(`File non leggibile: ${testoErrore(e)}`); } finally { setAvanz(null); }
  }
  const usate = new Set(Object.values(mappa).filter(Boolean));
  const ignorate = intest.filter(h => h.trim() && !usate.has(h));

  async function esegui(prova: boolean) {
    setErr(null);
    if (!mappa.cod_cliente || !mappa.nome) { setErr('Collega almeno «Codice» e «Ragione sociale».'); return; }
    const { righe, extra, doppi } = preparaRighe(grezze, mappa);
    const blocchi = aBlocchi(righe, BLOCCO);
    const tot = blocchi.length + (prova ? 0 : aBlocchi(extra, BLOCCO).length);
    const somma = vuoto(); let base = 0;
    try {
      for (let i = 0; i < blocchi.length; i++) {
        setAvanz({ fatto: i, tot, testo: `${prova ? 'Controllo' : 'Importo'} righe ${base + 1}–${base + blocchi[i].length} di ${righe.length}…` });
        const r = await rpc<Esito>('centralino_importa_clienti', { p_righe: blocchi[i], p_file: blocchi.length > 1 ? `${file} (parte ${i + 1}/${blocchi.length})` : file, p_prova: prova, p_sovrascrivi: sovr });
        for (const k of ['nuovi', 'aggiornati', 'invariati', 'protetti', 'errori'] as const) somma[k] += r[k];
        somma.dettaglio_errori.push(...r.dettaglio_errori.map(e => ({ ...e, riga: e.riga + base })));
        if (somma.differenze.length < 1000) somma.differenze.push(...r.differenze.map(d => ({ ...d, riga: d.riga + base })));
        base += blocchi[i].length;
      }
      if (!prova) {
        const be = aBlocchi(extra, BLOCCO);
        for (let i = 0; i < be.length; i++) { setAvanz({ fatto: blocchi.length + i, tot, testo: `Altri numeri ed email in rubrica (${i + 1}/${be.length})…` }); await rpc('centralino_importa_contatti', { p_righe: be[i] }); }
        await supabase.from('centralino_impostazioni').update({ valore: mappa }).eq('chiave', 'mappa_import_clienti');
        toast(`Importati: ${somma.nuovi} nuovi, ${somma.aggiornati} aggiornati`); log.reload();
      }
      setEs({ ...somma, prova });
      if (doppi) toast(`${doppi} righe con lo stesso Codice: tenuta l'ultima`);
    } catch (e) { setErr(`Interrotto al blocco ${Math.floor(base / BLOCCO) + 1}: ${testoErrore(e)}`); } finally { setAvanz(null); }
  }
  const anteprima = grezze.length ? preparaRighe(grezze.slice(0, 3), mappa).righe : [];

  return (
    <section className="ct-blocco ct-import" id="import">
      <h2>Anagrafica clienti – Importa da Taylor</h2>
      <p className="sub">Excel o CSV esportato da Taylor / Ad Hoc. Colonne riconosciute da sole (Codice, Ragione sociale, Località, Telefono, Email…), la scelta resta per la prossima volta. Prima la prova: nulla viene scritto finché non confermi.</p>
      {scrive && <label className="btn-ghost ct-file">Scegli il file…<input type="file" hidden accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; if (f) leggi(f); e.target.value = ''; }} /></label>}
      {avanz && <div className="ct-progress" role="progressbar" aria-valuemin={0} aria-valuemax={avanz.tot} aria-valuenow={avanz.fatto}><i style={{ width: `${Math.round((avanz.fatto / Math.max(1, avanz.tot)) * 100)}%` }} /><span>{avanz.testo}</span></div>}
      {intest.length > 0 && (<>
        <p><b>{file}</b> · {grezze.length.toLocaleString('it-IT')} righe</p>
        <div className="ct-mappa">
          {CAMPI.map(c => (
            <div key={c.k} className="field"><label>{c.l}{c.obbl ? ' *' : ''}</label>
              <select value={mappa[c.k] ?? ''} onChange={e => { setMappa({ ...mappa, [c.k]: e.target.value }); setEs(null); }}>
                <option value="">— non presente —</option>{intest.filter(h => h.trim()).map(h => <option key={h} value={h}>{h.trim()}</option>)}
              </select></div>))}
        </div>
        {ignorate.length > 0 && <p className="hint">Non importate: {ignorate.map(h => <span key={h} className="ct-mini">{h.trim()}</span>)}</p>}
        {anteprima.length > 0 && <div className="table-wrap"><table className="ct-tab"><thead><tr><th>Codice</th><th>Ragione sociale</th><th>CAP</th><th>Comune</th><th>Prov.</th><th>Telefono</th><th>Cellulare</th><th>Email</th><th>PEC</th></tr></thead>
          <tbody>{anteprima.map(r => <tr key={r.cod_cliente}><td>{r.cod_cliente}</td><td>{r.nome}</td><td>{r.cap}</td><td>{r.comune}</td><td>{r.prov}</td><td>{r.telefono}</td><td>{r.cellulare}</td><td>{r.email}</td><td>{r.pec}</td></tr>)}</tbody></table></div>}
        <label className="check"><input type="checkbox" checked={sovr} onChange={e => { setSovr(e.target.checked); setEs(null); }} /> Sovrascrivi anche i clienti modificati a mano nel portale</label>
        <div className="row-flex"><button className="btn-ghost" onClick={() => esegui(true)} disabled={!!avanz}>1 · Prova (non scrive)</button>
          <button className="btn" onClick={() => esegui(false)} disabled={!!avanz || !es?.prova}>2 · Conferma l'importazione</button></div>
      </>)}
      {err && <Banner s="ko">{err}</Banner>}
      {es && (<>
        <div className="kpis ct-riep">
          {([['Nuovi', es.nuovi, 'ok'], ['Aggiornati', es.aggiornati, 'info'], ['Invariati', es.invariati, ''], ['Protetti (modifiche manuali)', es.protetti, 'warn'], ['Errori', es.errori, es.errori ? 'ko' : '']] as const).map(([l, n, c]) => (
            <div key={l} className={`kpi ${c}`}><div className="num">{n.toLocaleString('it-IT')}</div><div className="lbl">{l}</div></div>))}
        </div>
        {es.prova && <p className="hint">Era una prova: controlla le differenze, poi «Conferma l'importazione».</p>}
        {es.differenze.length > 0 && <details open><summary>Differenze ({es.differenze.length}{es.differenze.length >= 1000 ? '+' : ''})</summary>
          <div className="table-wrap"><table className="ct-tab"><thead><tr><th>Riga</th><th>Cliente</th><th>Campo</th><th>Prima</th><th>Dopo</th></tr></thead>
            <tbody>{es.differenze.slice(0, 300).flatMap(d => Object.entries(d.cambi).map(([k, v]) => (
              <tr key={`${d.riga}-${k}`} className={['telefono', 'cellulare', 'email', 'pec'].includes(k) ? 'ct-diff-forte' : ''}><td>{d.riga}</td><td>{d.cod_cliente} · {d.nome}</td><td>{k}</td><td><s>{v.da ?? '—'}</s></td><td>{v.a}</td></tr>)))}</tbody></table></div></details>}
        {es.dettaglio_errori.length > 0 && <p><button className="btn-ghost btn-sm" onClick={() => scarica(erroriCsv(es.dettaglio_errori), `errori_import_${file}.csv`)}>Scarica il rapporto errori ({es.errori})</button></p>}
      </>)}
      {(log.data?.length ?? 0) > 0 && <details><summary>Importazioni precedenti</summary>
        <table className="ct-tab"><thead><tr><th>Quando</th><th>File</th><th>Chi</th><th>Nuovi</th><th>Agg.</th><th>Invar.</th><th>Protetti</th><th>Errori</th></tr></thead>
          <tbody>{log.data!.map(l => <tr key={l.id}><td>{fmtOra(l.at)}</td><td>{l.file}</td><td>{l.autore_nome}</td><td>{l.nuovi}</td><td>{l.aggiornati}</td><td>{l.invariati}</td><td>{l.protetti}</td>
            <td>{l.errori ? <button className="ct-link" onClick={() => scarica(erroriCsv(l.dettaglio_errori), `errori_import_${l.id}.csv`)}>{l.errori}</button> : 0}</td></tr>)}</tbody></table></details>}
    </section>
  );
}
