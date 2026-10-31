import { useMemo, useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { fmtData, fmtEuro, normTarga } from '../lib/format';
import { useT } from '../lib/i18n';
import { Banner, Caricamento, Errore, Targa, toast, useLoad } from '../ui';

interface Rif { id: number; data: string; ora: string | null; carte_carburante: { ultime4: string } | null; dipendenti: { nome: string; cognome: string } | null; litri: number | null; importo: number; prodotto: string | null; fornitore: string | null; veicoli: { targa: string } | null }
type Campo = 'data' | 'ora' | 'targa' | 'carta' | 'litri' | 'importo' | 'km' | 'prodotto';
export interface Anomalia { rifornimento_id: number; data: string; ora: string | null; targa: string; dipendente: string | null; carta: string | null; litri: number | null; importo: number; tipo: string; dettaglio: string }
const CAMPI: [Campo, string, boolean][] = [['data', 'Data', true], ['ora', 'Ora', false], ['targa', 'Targa', false], ['carta', 'Numero carta', false], ['importo', 'Importo (€)', true], ['litri', 'Litri', false], ['km', 'Km', false], ['prodotto', 'Prodotto', false]];
const INDIZI: Record<Campo, RegExp> = { data: /^data|date/i, ora: /^ora|orario|time/i, carta: /carta|card|pan|tessera/i, targa: /targa|plate|veicolo/i, importo: /importo|totale|amount|euro|€/i, litri: /litri|quantit|qta|liters/i, km: /^km|chilometr|odometro/i, prodotto: /prodotto|carburante|product|descr/i };

/** CSV con ; o , — gestisce virgolette semplici. */
function leggiCsv(testo: string): string[][] {
  const righe = testo.replace(/\r/g, '').split('\n').filter(r => r.trim());
  const sep = (righe[0].match(/;/g)?.length ?? 0) >= (righe[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  return righe.map(r => { const out: string[] = []; let cur = ''; let q = false;
    for (const c of r) { if (c === '"') q = !q; else if (c === sep && !q) { out.push(cur.trim()); cur = ''; } else cur += c; }
    out.push(cur.trim()); return out; });
}
const numero = (s: string) => { if (!s) return null; const n = Number(s.replace(/[€\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
function data(s: string): string | null {
  const a = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/); if (a) { const y = a[3].length === 2 ? '20' + a[3] : a[3]; return `${y}-${a[2].padStart(2, '0')}-${a[1].padStart(2, '0')}`; }
  const b = s.match(/^(\d{4})-(\d{2})-(\d{2})/); return b ? `${b[1]}-${b[2]}-${b[3]}` : null;
}
function ora(s: string): string | null { const m = s.match(/(\d{1,2})[:.](\d{2})/); return m && Number(m[1]) < 24 ? `${m[1].padStart(2, '0')}:${m[2]}` : null; }
const ultime4 = (s: string) => { const c = s.replace(/\D/g, ''); return c.length >= 4 ? c.slice(-4) : null; };
async function hash(s: string) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

/** gestione = HR/admin (import); il responsabile flotta vede in sola lettura. */
export default function Carburante({ gestione = false }: { gestione?: boolean }) {
  const { t, tm } = useT();
  const { data: d, errore, reload } = useLoad(async () => {
    const [r, v, c, an] = await Promise.all([
      supabase.from('rifornimenti').select('id,data,ora,litri,importo,prodotto,fornitore,veicoli(targa),carte_carburante(ultime4),dipendenti(nome,cognome)').order('data', { ascending: false }).limit(200),
      supabase.from('veicoli').select('id,targa'),
      supabase.from('carte_carburante').select('id,ultime4,stato'),
      supabase.rpc('anomalie_carburante', { p_da: null, p_a: null }),
    ]);
    for (const x of [r, v, c, an]) if (x.error) throw x.error;
    return { rif: r.data as unknown as Rif[], veicoli: v.data as { id: number; targa: string }[], carte: c.data as { id: number; ultime4: string; stato: string }[], anomalie: an.data as Anomalia[] };
  });
  const [righe, setRighe] = useState<string[][] | null>(null);
  const [nomeFile, setNomeFile] = useState('');
  const [mappa, setMappa] = useState<Partial<Record<Campo, number>>>({});
  const [fornitore, setFornitore] = useState('');
  const [esito, setEsito] = useState<{ s: 'ok' | 'ko' | 'warn'; t: string } | null>(null);
  const [invio, setInvio] = useState(false);

  async function scegliFile(f: File) {
    setEsito(null);
    const r = leggiCsv(await f.text());
    if (r.length < 2) { setEsito({ s: 'ko', t: t('Il file non contiene righe.') }); return; }
    setNomeFile(f.name); setRighe(r);
    const m: Partial<Record<Campo, number>> = {};
    r[0].forEach((h, i) => { for (const [c] of CAMPI) if (m[c] === undefined && INDIZI[c].test(h)) { m[c] = i; break; } });
    setMappa(m);
  }

  const anteprima = useMemo(() => {
    if (!righe || !d) return [];
    const perTarga = new Map(d.veicoli.map(v => [normTarga(v.targa).replace(/\s/g, ''), v.id]));
    // stesse ultime 4 cifre su più carte: si preferisce quella attiva
    const perCarta = new Map<string, number>();
    [...d.carte].sort((a, b) => (a.stato === 'attiva' ? 1 : 0) - (b.stato === 'attiva' ? 1 : 0)).forEach(c => perCarta.set(c.ultime4, c.id));
    return righe.slice(1).map(r => {
      const get = (c: Campo) => (mappa[c] !== undefined ? r[mappa[c]!] ?? '' : '');
      const targa = normTarga(get('targa')).replace(/\s/g, '');
      const u4 = ultime4(get('carta'));
      return { raw: r.join('|'), data: data(get('data')), ora: ora(get('ora')) ?? ora(get('data').replace(/^\S+\s*/, '')), targa: get('targa'), veicolo_id: perTarga.get(targa) ?? null,
        u4, carta_id: u4 ? perCarta.get(u4) ?? null : null, importo: numero(get('importo')), litri: numero(get('litri')), km: numero(get('km')), prodotto: get('prodotto') || null };
    });
  }, [righe, mappa, d]);
  const valide = anteprima.filter(a => a.data && (a.veicolo_id || a.carta_id) && a.importo != null);
  const carteIgnote = [...new Set(anteprima.filter(a => a.u4 && !a.carta_id).map(a => a.u4))];
  const senzaVeicolo = [...new Set(anteprima.filter(a => !a.veicolo_id && !a.carta_id && a.targa).map(a => a.targa))];

  async function importa() {
    setInvio(true); setEsito(null);
    try {
      const rec = await Promise.all(valide.map(async a => ({ veicolo_id: a.veicolo_id, carta_id: a.carta_id, ora: a.ora, data: a.data!, importo: a.importo!, litri: a.litri, km: a.km ? Math.round(a.km) : null,
        prodotto: a.prodotto, fornitore: fornitore || null, importazione: nomeFile, riga_hash: await hash(a.raw) })));
      const { error, count } = await supabase.from('rifornimenti').upsert(rec, { onConflict: 'riga_hash', ignoreDuplicates: true, count: 'exact' });
      if (error) throw error;
      setEsito({ s: 'ok', t: t('{n} rifornimenti importati. Le righe già presenti non sono state duplicate.', { n: count ?? rec.length }) });
      setRighe(null); toast(t('Importazione completata')); reload();
    } catch (e) { setEsito({ s: 'ko', t: tm(testoErrore(e)) }); }
    finally { setInvio(false); }
  }

  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!d) return <Caricamento />;
  const totale = d.rif.reduce((s, r) => s + Number(r.importo), 0);
  return (
    <>
      <AnomalieCarburante righe={d.anomalie} />
      {gestione && <>
      <div className="section-title">{t('Importa il file della carta carburante')}</div>
      <div className="panel form">
        <p className="sub" style={{ margin: 0 }}>{t('Esporta il file CSV dal portale del fornitore della carta carburante e caricalo qui. Il tecnico non deve scrivere niente.')}</p>
        <div className="row-flex wrap-end">
          <div className="field"><label htmlFor="csv">{t('File CSV')}</label><input id="csv" type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && scegliFile(e.target.files[0])} /></div>
          <div className="field"><label htmlFor="forn">{t('Fornitore (facoltativo)')}</label><input id="forn" value={fornitore} onChange={e => setFornitore(e.target.value)} placeholder="Q8, Eni, IP…" /></div>
        </div>
        {righe && <>
          <div className="lbl-sm">{t('Collega le colonne del file')}</div>
          <div className="row-flex wrap-end">{CAMPI.map(([c, l, obbl]) => (
            <div className="field" key={c}><label htmlFor={`col-${c}`}>{t(l)}{obbl ? ' *' : ''}</label>
              <select id={`col-${c}`} value={mappa[c] ?? ''} onChange={e => setMappa({ ...mappa, [c]: e.target.value === '' ? undefined : Number(e.target.value) })}>
                <option value="">—</option>{righe[0].map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}</select></div>))}</div>
          <Banner s={valide.length ? 'ok' : 'warn'}>{t('{a} righe pronte su {b}.', { a: valide.length, b: anteprima.length })}{senzaVeicolo.length > 0 && ` ${t('Targhe non trovate nella flotta: {l}', { l: senzaVeicolo.slice(0, 8).join(', ') })}`}{carteIgnote.length > 0 && ` ${t('Carte non registrate: {l}', { l: carteIgnote.slice(0, 8).map(x => '•••• ' + x).join(', ') })}`}</Banner>
          <div className="table-wrap"><table>
            <thead><tr><th>{t('Data')}</th><th>{t('Ora')}</th><th>{t('Targa')}</th><th>{t('Carta')}</th><th>{t('Litri')}</th><th>{t('Importo')}</th><th>{t('Prodotto')}</th></tr></thead>
            <tbody>{anteprima.slice(0, 8).map((a, i) => <tr key={i} className={(a.veicolo_id || a.carta_id) && a.data && a.importo != null ? '' : 'muted'}>
              <td className="mono">{a.data ? fmtData(a.data) : '—'}</td><td className="mono">{a.ora ?? '—'}</td><td>{a.targa}</td><td className="mono">{a.u4 ? `•••• ${a.u4}` : '—'}</td><td className="mono">{a.litri ?? '—'}</td><td className="mono">{fmtEuro(a.importo)}</td><td>{a.prodotto ?? '—'}</td></tr>)}</tbody>
          </table></div>
          <div className="row-flex"><button className="btn" disabled={!valide.length || invio} onClick={importa}>{t('Importa {n} righe', { n: valide.length })}</button>
            <button className="btn-ghost" onClick={() => setRighe(null)}>{t('Annulla')}</button></div>
        </>}
        {esito && <Banner s={esito.s}>{esito.t}</Banner>}
      </div>
      </>}

      <div className="section-title">{t('Ultimi rifornimenti')} <span className="meta">{fmtEuro(totale)}</span></div>
      <div className="table-wrap"><table>
        <thead><tr><th>{t('Data')}</th><th>{t('Veicolo')}</th><th>{t('Carta')}</th><th>{t('Dipendente')}</th><th>{t('Litri')}</th><th>{t('Importo')}</th><th>{t('Prodotto')}</th><th>{t('Fornitore')}</th></tr></thead>
        <tbody>{d.rif.length ? d.rif.map(r => <tr key={r.id}><td className="mono">{fmtData(r.data)}{r.ora ? ` ${r.ora.slice(0, 5)}` : ''}</td><td><Targa t={r.veicoli?.targa} /></td><td className="mono">{r.carte_carburante ? `•••• ${r.carte_carburante.ultime4}` : '—'}</td><td>{r.dipendenti ? `${r.dipendenti.nome} ${r.dipendenti.cognome}` : '—'}</td><td className="mono">{r.litri ?? '—'}</td>
          <td className="mono">{fmtEuro(r.importo)}</td><td>{r.prodotto ?? '—'}</td><td>{r.fornitore ?? '—'}</td></tr>) : <tr><td colSpan={8} className="sub">{t('Nessun rifornimento importato')}</td></tr>}</tbody>
      </table></div>
    </>
  );
}

/** Anomalie carburante (ultimi 90 giorni). */
export function AnomalieCarburante({ righe }: { righe: Anomalia[] }) {
  const { t } = useT();
  return (
    <>
      <div className="section-title">{t('Anomalie carburante')} <span className="meta">{t('ultimi 90 giorni')} · {righe.length}</span></div>
      {righe.length ? <div className="table-wrap"><table>
        <thead><tr><th>{t('Data')}</th><th>{t('Veicolo')}</th><th>{t('Dipendente')}</th><th>{t('Carta')}</th><th>{t('Litri')}</th><th>{t('Importo')}</th><th>{t('Anomalia')}</th></tr></thead>
        <tbody>{righe.map((a, i) => <tr key={i}><td className="mono">{fmtData(a.data)}{a.ora ? ` ${a.ora.slice(0, 5)}` : ''}</td><td><Targa t={a.targa} /></td>
          <td>{a.dipendente ?? '—'}</td><td className="mono">{a.carta ?? '—'}</td><td className="mono">{a.litri ?? '—'}</td><td className="mono">{fmtEuro(a.importo)}</td><td>{a.dettaglio}</td></tr>)}</tbody>
      </table></div> : <Banner s="ok">{t('Nessuna anomalia nei rifornimenti.')}</Banner>}
    </>
  );
}
