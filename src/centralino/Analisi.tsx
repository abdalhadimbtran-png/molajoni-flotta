import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase, testoErrore } from '../lib/supabase';
import { fmtEuro, fmtOra } from '../lib/format';
import { Errore, toast, useLoad } from '../ui';
import { testoCella, type Col, type Report, type Riga } from '../admin/report/catalogo';
import { CANALI, ESITI, NOME_TIPO, STATI_CLIENTE, eCliente, nomeCanale, nomeTipoContatto, type Esito } from '../lib/centralino/tipi';
import { KPI, kpi, valuta, type Filtri, type RecInfo, type RecPratica, type RecTrasf } from '../lib/centralino/registro';
import { giornoRoma, orologio } from '../lib/centralino/sla';
import { datiPeriodo } from './Direzione';
import { useAdesso, useConfig } from './comune';
import { Conto, nomeStadio } from './componenti';
import { Scheletro } from './Scheletro';
import { useCtx } from './ShellCentralino';
import { ANALISI, FILTRI_NOMI, KPI_TESTI } from '../lib/centralino/testiDirezione';
import { attiva as vistaAttiva } from '../lib/vediCome';
import { ModaleEliminaInfo, ROSSO_ELIMINA, useEliminaInfoAttiva } from './EliminaInfo';
import { cambiaTutte, puoEliminareInfo, statoTutte, type InfoDaEliminare } from './eliminaInfo';

const c = (k: string, l: string, t: Col['t'], w: number, tot?: boolean): Col => ({ k, l, t, w, tot });
const COL_PRATICHE: Col[] = [c('numero', 'Numero', 'testo', 15), c('quando', 'Data e ora', 'dataora', 15), c('canale', 'Canale', 'testo', 11), c('tipo', 'Tipo', 'testo', 20), c('cliente', 'Nome', 'testo', 24),
  c('stato_cliente', 'Cliente è', 'testo', 11), c('referente', 'Assegnata a', 'testo', 15), c('stadio', 'Passo', 'testo', 18), c('scadenza', 'Scadenza', 'dataora', 15), c('ritardo', 'Ritardo', 'testo', 10), c('esito', 'Stato', 'testo', 12), c('importo', 'Importo', 'euro', 11, true)];
const COL_TRASF: Col[] = [c('quando', 'Data e ora', 'dataora', 15), c('cliente', 'Nome', 'testo', 22), c('stato_cliente', 'Cliente è', 'testo', 11), c('referente', 'Referente', 'testo', 16), c('argomento', 'Argomento', 'testo', 18),
  c('esito', 'Modalità', 'testo', 16), c('scadenza', 'Richiamo entro', 'dataora', 15), c('richiamato', 'Richiamato', 'dataora', 15), c('ritardo', 'Ritardo', 'testo', 10), c('email_ref', 'Email referente', 'testo', 10), c('email_cli', 'Email cliente', 'testo', 10)];
const COL_INFO: Col[] = [c('quando', 'Data e ora', 'dataora', 15), c('canale', 'Canale', 'testo', 12), c('cliente', 'Cliente / nota', 'testo', 40), c('tipo', 'Tipo', 'testo', 20)];
const iso = (d: Date) => giornoRoma(d);
/** Persona reale se nota (tecnico, commerciale), altrimenti il ruolo assegnato. */
const chiDi = (p: RecPratica) => { const x = p as RecPratica & { tecnico_nome?: string | null; commerciale_nome?: string | null }; return x.tecnico_nome || x.commerciale_nome || p.assegnato_nome || ''; };

/**
 * /centralino/analisi?kpi=…&da=…&a=…&dest=…&arg=…&stato=…&tipo=…&canale=…&giorno=…
 * Dettaglio di qualunque numero del centralino: spiegazione, filtri, riepilogo, elenco, esportazione.
 * Usa la stessa funzione del numero (registro.valuta) → conteggi identici.
 */
export default function Analisi() {
  const ctx = useCtx();
  const nav = useNavigate();
  const ora = useAdesso(30000);
  const { config } = useConfig();
  const [qs, setQs] = useSearchParams();
  const id = qs.get('kpi') ?? 'pratiche';
  const def = kpi(id) ?? KPI[0];
  const oggi = iso(new Date());
  const da = qs.get('da') ?? oggi, a = qs.get('a') ?? oggi;
  const f: Filtri = Object.fromEntries((['canale', 'tipo', 'stato', 'chi', 'dest', 'arg', 'giorno'] as const).map(k => [k, qs.get(k) ?? '']).filter(([, v]) => v));
  const { data, errore, reload } = useLoad(() => datiPeriodo(da, a), [da, a, ctx.versione]);
  const [esporto, setEsporto] = useState('');
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [daEliminare, setDaEliminare] = useState<InfoDaEliminare[] | null>(null);
  const puoElim = puoEliminareInfo(ctx.admin, vistaAttiva()) && !!def.conInfo;
  const elimAttiva = useEliminaInfoAttiva(puoElim);
  const v = useMemo(() => (data ? valuta(def, data, f, ora) : null), [data, def, qs.toString(), ora]); // eslint-disable-line react-hooks/exhaustive-deps
  const fl = (t: string) => config?.flussi.find(x => x.tipo === t);
  const imposta = (k: string, val: string) => { const n = new URLSearchParams(qs); if (val) n.set(k, val); else n.delete(k); setQs(n, { replace: true }); };

  const righe: Riga[] = useMemo(() => (v?.righe ?? []).map(r => {
    if ('destinatario_nome' in r) {
      const t = r as RecTrasf;
      const rit = t.richiamo_scadenza && new Date(t.richiamato_at ?? ora) > new Date(t.richiamo_scadenza) ? orologio(((t.richiamato_at ? new Date(t.richiamato_at) : ora).getTime() - new Date(t.richiamo_scadenza).getTime()) / 1000) : '';
      return { _p: t.pratica_id, _t: t, quando: t.at, chi: nomeTipoContatto(t.tipo_contatto), cliente: t.cliente_nome ?? t.telefono ?? '', stato_cliente: eCliente(t) && t.stato_cliente ? STATI_CLIENTE[t.stato_cliente as 'nuovo'][1] : '', referente: t.destinatario_nome,
        argomento: t.tipo_argomento ?? '', esito: t.modalita === 'richiamo' ? 'Non disponibile' : 'Trasferita', scadenza: t.richiamo_scadenza, richiamato: t.richiamato_at, ritardo: rit,
        email_ref: t.email_referente_inviata_at ? 'Sì' : 'No', email_cli: t.email_cliente_inviata_at || t.email_riepilogo_at ? 'Sì' : t.email_non_disponibile ? 'Non disp.' : 'No' };
    }
    if ('contatto_id' in r) return { quando: r.at, canale: '—', cliente: `Contatto modificato: ${r.campo} → ${r.a ?? '—'}${r.autore_nome ? ` (${r.autore_nome})` : ''}`, tipo: KPI_TESTI.reg_anagrafica.it };
    if (!('cliente_nome' in r)) { const x = r as RecInfo; return { _i: x, quando: x.at, canale: nomeCanale(x.canale), cliente: x.nota ?? '—', tipo: KPI_TESTI.reg_info.it }; }
    const p = r as RecPratica;
    const rit = p.esito === 'aperta' && p.sla_scadenza && new Date(p.sla_scadenza) < ora ? orologio((ora.getTime() - new Date(p.sla_scadenza).getTime()) / 1000) : '';
    return { _p: p.id, _r: p, numero: p.numero, quando: p.created_at, canale: nomeCanale(p.canale), tipo: NOME_TIPO[p.tipo as 'manutenzione'] + (p.sottotipo ? ` · ${p.sottotipo}` : ''), chi: nomeTipoContatto(p.tipo_contatto), cliente: p.cliente_nome,
      stato_cliente: eCliente(p) && p.stato_cliente ? STATI_CLIENTE[p.stato_cliente as 'nuovo'][1] : '', referente: chiDi(p), stadio: nomeStadio(fl(p.tipo), p.stato_corrente),
      scadenza: p.esito === 'aperta' ? p.sla_scadenza : null, ritardo: rit, esito: ESITI[p.esito as Esito][1], importo: p.importo_stimato };
  }), [v, ora, config]); // eslint-disable-line react-hooks/exhaustive-deps
  const colonne = def.fonte === 'trasferimenti' ? COL_TRASF : def.conInfo ? COL_INFO : COL_PRATICHE;

  async function esporta(t: 'xlsx' | 'pdf') {
    setEsporto(t);
    try {
      const m = await import('../admin/report/esporta');
      const { data: u } = await supabase.auth.getUser();
      const rep: Report = { id: `ct_${def.id}`, titolo: def.titolo, descrizione: def.spiegazione, gruppo: 'Controllo e costi', periodo: 'intervallo', filtri: {}, colonne, orizzontale: true,
        riepilogo: () => [{ l: ANALISI.elementi.it, v: String(v?.n ?? 0) }, ...(v?.den != null ? [{ l: ANALISI.su.it, v: String(v.den) }, { l: 'Percentuale', v: v.pct == null ? '—' : `${v.pct}%` }] : [])] };
      const filtri = Object.entries(f).map(([k, x]) => `${FILTRI_NOMI[k] ?? k}: ${k === 'tipo' ? NOME_TIPO[x as 'manutenzione'] ?? x : k === 'canale' ? nomeCanale(x) : k === 'stato' ? STATI_CLIENTE[x as 'nuovo']?.[1] ?? x : x}`).join(' · ');
      const c2 = { periodo: `${testoCella(da, 'data')} – ${testoCella(a, 'data')}`, filtri, autore: u.user?.email ?? 'centralino', generato: new Date(), prodotto: 'Centralino' };
      await (t === 'xlsx' ? m.esportaExcel(rep, righe, c2) : m.esportaPdf(rep, righe, c2));
      toast(t === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(testoErrore(e)); } finally { setEsporto(''); }
  }
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  const dest = [...new Set((data?.trasf ?? []).map(t => t.destinatario_nome))];
  const arg = [...new Set((data?.trasf ?? []).map(t => t.tipo_argomento || 'Non indicato'))];
  const medio = def.fonte === 'trasferimenti' ? (() => { const l = (v?.righe ?? []) as RecTrasf[]; const x = l.filter(t => t.richiamato_at); return x.length ? orologio(x.reduce((s, t) => s + (new Date(t.richiamato_at!).getTime() - new Date(t.at).getTime()) / 1000, 0) / x.length) : null; })() : null;
  const valore = def.fonte !== 'trasferimenti' && !def.conInfo ? ((v?.righe ?? []) as RecPratica[]).reduce((s, p) => s + Number(p.importo_stimato ?? 0), 0) : 0;

  return (
    <div className="ct-analisi">
      <Link to={ctx.base === '/centralino' ? '/centralino' : ctx.base} className="ct-indietro">{ANALISI.indietro.it}</Link>
      <div className="page-hero"><div>
        <h1>{def.titolo}</h1>
        <p className="sub ct-spieg">{def.spiegazione}</p>
      </div>
        <select aria-label="Indicatore" value={def.id} onChange={e => imposta('kpi', e.target.value)}>{KPI.map(k => <option key={k.id} value={k.id}>{k.titolo}</option>)}</select>
      </div>
      <div className="row-flex ct-filtri">
        <input type="date" aria-label="Dal" value={da} onChange={e => imposta('da', e.target.value)} /><input type="date" aria-label="Al" value={a} onChange={e => imposta('a', e.target.value)} />
        {def.fonte !== 'trasferimenti' && <>
          <select aria-label="Canale" value={f.canale ?? ''} onChange={e => imposta('canale', e.target.value)}><option value="">{ANALISI.tutti_canali.it}</option>{CANALI.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
          {!def.conInfo && <select aria-label="Tipo" value={f.tipo ?? ''} onChange={e => imposta('tipo', e.target.value)}><option value="">{ANALISI.tutti_tipi.it}</option>{Object.entries(NOME_TIPO).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>}
        </>}
        {def.fonte === 'trasferimenti' && <>
          <select aria-label="Destinatario" value={f.dest ?? ''} onChange={e => imposta('dest', e.target.value)}><option value="">{ANALISI.tutti_dest.it}</option>{dest.map(x => <option key={x}>{x}</option>)}</select>
          <select aria-label="Argomento" value={f.arg ?? ''} onChange={e => imposta('arg', e.target.value)}><option value="">{ANALISI.tutti_arg.it}</option>{arg.map(x => <option key={x}>{x}</option>)}</select>
        </>}
        {!def.conInfo && <select aria-label="Stato cliente" value={f.stato ?? ''} onChange={e => imposta('stato', e.target.value)}><option value="">{ANALISI.tutti_clienti.it}</option>{Object.entries(STATI_CLIENTE).map(([k, x]) => <option key={k} value={k}>{x[1]}</option>)}</select>}
        <button className="btn btn-sm" onClick={() => esporta('pdf')} disabled={!righe.length || !!esporto}>{esporto === 'pdf' ? 'Preparo…' : 'PDF'}</button>
        <button className="btn-ghost btn-sm" onClick={() => esporta('xlsx')} disabled={!righe.length || !!esporto}>{esporto === 'xlsx' ? 'Preparo…' : 'Excel'}</button>
      </div>
      {!v ? <Scheletro righe={6} /> : <>
        <div className="kpis ct-riep">
          <div className="kpi"><div className="num">{def.den ? (v.pct == null ? '—' : `${v.pct}%`) : v.n}</div><div className="lbl">{def.den ? `${v.n} su ${v.den}` : ANALISI.elementi.it}</div></div>
          {def.den && <div className="kpi"><div className="num">{v.n}</div><div className="lbl">{ANALISI.conteggio.it}</div></div>}
          {def.den && <div className="kpi"><div className="num">{v.den}</div><div className="lbl">{ANALISI.su.it}</div></div>}
          {medio && <div className="kpi"><div className="num num-sm">{medio}</div><div className="lbl">{ANALISI.tempo_richiamo.it}</div></div>}
          {valore > 0 && <div className="kpi"><div className="num num-sm">{fmtEuro(valore)}</div><div className="lbl">{ANALISI.valore.it}</div></div>}
        </div>
        {puoElim && righe.length > 0 && (() => {
          const ids = righe.slice(0, 1000).flatMap(r => r._i ? [(r._i as InfoDaEliminare).id] : []);
          const st = statoTutte(ids, sel);
          const scelte = righe.flatMap(r => r._i && sel.has((r._i as InfoDaEliminare).id) ? [r._i as InfoDaEliminare] : []);
          return <div className="row-flex" style={{ gap: 8, margin: '8px 0' }}>
            <label><input type="checkbox" aria-label="Seleziona tutte" checked={st === 'tutte'} ref={el => { if (el) el.indeterminate = st === 'alcune'; }} onChange={() => setSel(cambiaTutte(ids, sel))} /> Tutte</label>
            {elimAttiva === false
              ? <button type="button" className="btn-ghost btn-sm" disabled title="Migrazione 0103 da applicare">Eliminazione non ancora attiva</button>
              : <button type="button" className="btn-ghost btn-sm" style={{ color: ROSSO_ELIMINA, borderColor: ROSSO_ELIMINA }} disabled={elimAttiva === null || !scelte.length} onClick={() => setDaEliminare(scelte)}>Elimina selezionate ({scelte.length})</button>}
          </div>;
        })()}
        {righe.length === 0 ? <p className="ct-vuoto">{ANALISI.vuoto.it}</p> : (
          <div className="table-wrap ct-tw-analisi"><table className="ct-tab-analisi">
            <thead><tr>{puoElim && <th className="c-sel" />}{colonne.map(x => <th key={x.k} className={`c-${x.k}`}>{x.l}</th>)}</tr></thead>
            <tbody>{righe.slice(0, 1000).map((r, i) => (
              <tr key={i} className={r._p ? 'ct-clic' : ''} onClick={() => r._p && nav(`${ctx.base}/pratica/${r._p}`)}>
                {puoElim && <td className="c-sel of-nowrap">{r._i ? (() => { const x = r._i as InfoDaEliminare; return <>
                  <input type="checkbox" aria-label="Seleziona" checked={sel.has(x.id)} onChange={() => setSel(p => { const n = new Set(p); if (n.has(x.id)) n.delete(x.id); else n.add(x.id); return n; })} />
                  <button type="button" className="btn-ghost btn-sm" aria-label="Elimina" title={elimAttiva === false ? 'Eliminazione non ancora attiva' : 'Elimina'} disabled={!elimAttiva} style={{ color: ROSSO_ELIMINA, marginLeft: 4, padding: '0 6px' }} onClick={() => setDaEliminare([x])}>🗑</button>
                </>; })() : null}</td>}
                {colonne.map(x => <td key={x.k} title={typeof r[x.k] === 'string' ? String(r[x.k]) : undefined} className={`c-${x.k}`}>{x.k === 'scadenza' && r.scadenza && !r.richiamato && (r._r ? (r._r as RecPratica).esito === 'aperta' : true)
                  ? <Conto inizio={String(r.quando)} scadenza={String(r.scadenza)} /> : x.k === 'ritardo' && r.ritardo ? <span className="ko-t">{String(r.ritardo)}</span> : x.t === 'dataora' && r[x.k] ? fmtOra(String(r[x.k])) : testoCella(r[x.k], x.t)}</td>)}
              </tr>))}</tbody>
          </table></div>)}
        {righe.length > 1000 && <p className="hint">{ANALISI.piu_1000.it}</p>}
        <p className="hint">Aggiornato {fmtOra(new Date().toISOString())}</p>
      </>}
      {daEliminare && <ModaleEliminaInfo righe={daEliminare} onClose={() => setDaEliminare(null)} onFatto={() => { setDaEliminare(null); setSel(new Set()); reload(); ctx.aggiorna(); }} />}
    </div>
  );
}
