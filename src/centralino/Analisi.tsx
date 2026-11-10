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
    if ('contatto_id' in r) return { quando: r.at, canale: '—', cliente: `Contatto modificato: ${r.campo} → ${r.a ?? '—'}${r.autore_nome ? ` (${r.autore_nome})` : ''}`, tipo: 'Aggiornamento anagrafica' };
    if (!('cliente_nome' in r)) { const x = r as RecInfo; return { quando: x.at, canale: nomeCanale(x.canale), cliente: x.nota ?? '—', tipo: 'Solo informazione' }; }
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
        riepilogo: () => [{ l: 'Elementi', v: String(v?.n ?? 0) }, ...(v?.den != null ? [{ l: 'Su', v: String(v.den) }, { l: 'Percentuale', v: v.pct == null ? '—' : `${v.pct}%` }] : [])] };
      const filtri = Object.entries(f).map(([k, x]) => `${k}: ${x}`).join(' · ');
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
      <Link to={ctx.base === '/centralino' ? '/centralino' : ctx.base} className="ct-indietro">← Indietro</Link>
      <div className="page-hero"><div>
        <h1>{def.titolo}</h1>
        <p className="sub ct-spieg">{def.spiegazione}</p>
      </div>
        <select aria-label="Indicatore" value={def.id} onChange={e => imposta('kpi', e.target.value)}>{KPI.map(k => <option key={k.id} value={k.id}>{k.titolo}</option>)}</select>
      </div>
      <div className="row-flex ct-filtri">
        <input type="date" aria-label="Dal" value={da} onChange={e => imposta('da', e.target.value)} /><input type="date" aria-label="Al" value={a} onChange={e => imposta('a', e.target.value)} />
        {def.fonte !== 'trasferimenti' && <>
          <select aria-label="Canale" value={f.canale ?? ''} onChange={e => imposta('canale', e.target.value)}><option value="">Tutti i canali</option>{CANALI.map(x => <option key={x.v} value={x.v}>{x.l}</option>)}</select>
          {!def.conInfo && <select aria-label="Tipo" value={f.tipo ?? ''} onChange={e => imposta('tipo', e.target.value)}><option value="">Tutti i tipi</option>{Object.entries(NOME_TIPO).map(([k, x]) => <option key={k} value={k}>{x}</option>)}</select>}
        </>}
        {def.fonte === 'trasferimenti' && <>
          <select aria-label="Destinatario" value={f.dest ?? ''} onChange={e => imposta('dest', e.target.value)}><option value="">Tutti i destinatari</option>{dest.map(x => <option key={x}>{x}</option>)}</select>
          <select aria-label="Argomento" value={f.arg ?? ''} onChange={e => imposta('arg', e.target.value)}><option value="">Tutti gli argomenti</option>{arg.map(x => <option key={x}>{x}</option>)}</select>
        </>}
        {!def.conInfo && <select aria-label="Stato cliente" value={f.stato ?? ''} onChange={e => imposta('stato', e.target.value)}><option value="">Tutti i clienti</option>{Object.entries(STATI_CLIENTE).map(([k, x]) => <option key={k} value={k}>{x[1]}</option>)}</select>}
        <button className="btn btn-sm" onClick={() => esporta('pdf')} disabled={!righe.length || !!esporto}>{esporto === 'pdf' ? 'Preparo…' : 'PDF'}</button>
        <button className="btn-ghost btn-sm" onClick={() => esporta('xlsx')} disabled={!righe.length || !!esporto}>{esporto === 'xlsx' ? 'Preparo…' : 'Excel'}</button>
      </div>
      {!v ? <Scheletro righe={6} /> : <>
        <div className="kpis ct-riep">
          <div className="kpi"><div className="num">{def.den ? (v.pct == null ? '—' : `${v.pct}%`) : v.n}</div><div className="lbl">{def.den ? `${v.n} su ${v.den}` : 'Elementi'}</div></div>
          {def.den && <div className="kpi"><div className="num">{v.n}</div><div className="lbl">Numeratore (elenco qui sotto)</div></div>}
          {def.den && <div className="kpi"><div className="num">{v.den}</div><div className="lbl">Denominatore</div></div>}
          {medio && <div className="kpi"><div className="num num-sm">{medio}</div><div className="lbl">Tempo medio di richiamo</div></div>}
          {valore > 0 && <div className="kpi"><div className="num num-sm">{fmtEuro(valore)}</div><div className="lbl">Valore stimato</div></div>}
        </div>
        {righe.length === 0 ? <p className="ct-vuoto">Nessun elemento con questi filtri. Prova ad allargare il periodo.</p> : (
          <div className="table-wrap ct-tw-analisi"><table className="ct-tab-analisi">
            <thead><tr>{colonne.map(x => <th key={x.k} className={`c-${x.k}`}>{x.l}</th>)}</tr></thead>
            <tbody>{righe.slice(0, 1000).map((r, i) => (
              <tr key={i} className={r._p ? 'ct-clic' : ''} onClick={() => r._p && nav(`${ctx.base}/pratica/${r._p}`)}>
                {colonne.map(x => <td key={x.k} title={typeof r[x.k] === 'string' ? String(r[x.k]) : undefined} className={`c-${x.k}`}>{x.k === 'scadenza' && r.scadenza && !r.richiamato && (r._r ? (r._r as RecPratica).esito === 'aperta' : true)
                  ? <Conto inizio={String(r.quando)} scadenza={String(r.scadenza)} /> : x.k === 'ritardo' && r.ritardo ? <span className="ko-t">{String(r.ritardo)}</span> : x.t === 'dataora' && r[x.k] ? fmtOra(String(r[x.k])) : testoCella(r[x.k], x.t)}</td>)}
              </tr>))}</tbody>
          </table></div>)}
        {righe.length > 1000 && <p className="hint">Mostrate le prime 1000 righe; l'esportazione le contiene tutte.</p>}
        <p className="hint">Aggiornato {fmtOra(new Date().toISOString())}. Il numero sulla tessera e questo elenco usano lo stesso calcolo.</p>
      </>}
    </div>
  );
}
