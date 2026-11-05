import { useMemo, useState } from 'react';
import { rpc, supabase, testoErrore } from '../lib/supabase';
import { Caricamento, Errore, toast, useLoad } from '../ui';
import { testoCella, type Col, type Report, type Riga } from '../admin/report/catalogo';
import { ESITI, ESITI_TRASF, NOME_TIPO, STATI_CLIENTE, nomeCanale } from '../lib/centralino/tipi';
import { calcolaKpi, calcolaTrasf, durata } from '../lib/centralino/kpi';
import { datiPeriodo, type DatiPeriodo } from './Direzione';
import { useConfig } from './comune';

type Id = 'registro' | 'pratiche' | 'sla' | 'funnel' | 'trasferimenti';
const c = (k: string, l: string, t: Col['t'], w: number, tot?: boolean): Col => ({ k, l, t, w, tot });
const base = (id: string, titolo: string, colonne: Col[], extra: Partial<Report> = {}): Report =>
  ({ id, titolo, descrizione: '', gruppo: 'Controllo e costi', periodo: 'intervallo', filtri: {}, colonne, ...extra });
interface Reg { telefonate: number; whatsapp: number; email: number; offerte_tablet: number; offerte_whatsapp: number; offerte_cliente: number; aggiornamenti_anagrafica: number; chiamate_info: number; pratiche: number; chiuse: number }
type Ctx = { d: DatiPeriodo; reg: Reg[]; nomeSt: (k: string | null) => string };

const DEF: { id: Id; titolo: string; descrizione: string; f: (x: Ctx) => { rep: Report; righe: Riga[] } }[] = [
  { id: 'registro', titolo: 'Registro giornaliero centralino', descrizione: 'Per ogni giorno: telefonate, WhatsApp, email, offerte per canale, aggiornamenti anagrafica (dalle pratiche).',
    f: ({ reg }) => ({ righe: reg as unknown as Riga[], rep: base('ct_registro', 'Registro giornaliero centralino', [c('data', 'Giorno', 'data', 12), c('telefonate', 'Telefonate', 'num', 10, true), c('whatsapp', 'WhatsApp', 'num', 10, true), c('email', 'Email', 'num', 9, true),
      c('offerte_tablet', 'Offerte tablet', 'num', 10, true), c('offerte_whatsapp', 'Offerte WA', 'num', 10, true), c('offerte_cliente', 'Offerte cliente', 'num', 10, true), c('aggiornamenti_anagrafica', 'Aggiorn. anagrafica', 'num', 11, true), c('chiamate_info', 'Solo info', 'num', 9, true), c('pratiche', 'Pratiche', 'num', 9, true), c('chiuse', 'Chiuse', 'num', 9, true)], { orizzontale: true }) }) },
  { id: 'pratiche', titolo: 'Pratiche per periodo', descrizione: 'Tutte le pratiche aperte nel periodo con stato, esito e SLA.',
    f: ({ d, nomeSt }) => ({ righe: d.pratiche.sort((a, b) => a.created_at.localeCompare(b.created_at)).map(p => ({ numero: p.numero, aperta: p.created_at, cliente: p.cliente_nome, stato_cliente: p.stato_cliente ? STATI_CLIENTE[p.stato_cliente][1] : '', tipo: NOME_TIPO[p.tipo] + (p.sottotipo ? ` · ${p.sottotipo}` : ''), canale: nomeCanale(p.canale), stadio: nomeSt(p.stato_corrente), esito: ESITI[p.esito][1], sla: p.sla_rispettato == null ? '' : p.sla_rispettato ? 'Sì' : 'No', importo: p.importo_stimato })),
      rep: base('ct_pratiche', 'Pratiche per periodo', [c('numero', 'Numero', 'testo', 15), c('aperta', 'Aperta', 'dataora', 15), c('cliente', 'Cliente', 'testo', 26), c('stato_cliente', 'Cliente è', 'testo', 11), c('tipo', 'Tipo', 'testo', 22), c('canale', 'Canale', 'testo', 11), c('stadio', 'Stadio', 'testo', 18), c('esito', 'Esito', 'testo', 12), c('sla', 'SLA ok', 'testo', 7), c('importo', 'Importo', 'euro', 11, true)], { orizzontale: true }) }) },
  { id: 'sla', titolo: 'SLA', descrizione: 'Ogni passo con scadenza: quando doveva essere fatto, quando è stato fatto, in tempo o no.',
    f: ({ d, nomeSt }) => ({ righe: d.eventi.filter(e => e.tipo === 'stato' && e.dati?.sla_stadio).sort((a, b) => a.at.localeCompare(b.at)).map(e => ({ pratica: e.pratiche?.numero ?? '', cliente: e.pratiche?.cliente_nome ?? '', passo: nomeSt(String(e.dati.sla_stadio)), scadenza: e.dati.sla_scadenza, fatto: e.at, esito: e.dati.sla_rispettato ? 'In tempo' : 'In ritardo', chi: e.autore_nome })),
      rep: base('ct_sla', 'SLA', [c('pratica', 'Pratica', 'testo', 15), c('cliente', 'Cliente', 'testo', 24), c('passo', 'Passo', 'testo', 22), c('scadenza', 'Scadenza', 'dataora', 15), c('fatto', 'Fatto', 'dataora', 15), c('esito', 'Esito', 'testo', 11), c('chi', 'Chi', 'testo', 14)],
        { orizzontale: true, riepilogo: r => [{ l: 'Passi', v: String(r.length) }, { l: 'In tempo', v: `${r.length ? Math.round(r.filter(x => x.esito === 'In tempo').length / r.length * 100) : 0}%` }] }) }) },
  { id: 'funnel', titolo: 'Funnel offerte', descrizione: 'Richieste → inviate → accettate → contratti, per tipo di cliente, con valore.',
    f: ({ d }) => { const k = calcolaKpi(d.pratiche, d.eventi); const righe = (Object.keys(STATI_CLIENTE) as (keyof typeof STATI_CLIENTE)[]).map(s => ({ cliente: STATI_CLIENTE[s][1], ...k.funnelPerStato[s] }));
      return { righe, rep: base('ct_funnel', 'Funnel offerte', [c('cliente', 'Cliente', 'testo', 18), c('richieste', 'Richieste', 'num', 11, true), c('inviate', 'Inviate', 'num', 11, true), c('accettate', 'Accettate', 'num', 11, true), c('valore', 'Valore richiesto', 'euro', 15, true)],
        { riepilogo: () => [{ l: 'Conversione', v: k.funnel.conversionePct == null ? '—' : `${k.funnel.conversionePct}%` }, { l: 'Contratti', v: String(k.funnel.contratti) }, { l: 'Offerte ≤1.000 € in 60 min', v: k.offerte60Pct == null ? '—' : `${k.offerte60Pct}%` }, { l: 'Tempo medio offerta', v: durata(k.tempiMedi.offerta) }] }) }; } },
  { id: 'trasferimenti', titolo: 'Chiamate trasferite', descrizione: 'Chiamate per i responsabili: esito, richiamo, email di riepilogo.',
    f: ({ d }) => { const k = calcolaTrasf(d.trasf); return { righe: d.trasf.map(t => ({ quando: t.at, cliente: t.cliente_nome ?? t.telefono ?? '', a: t.destinatario_nome, argomento: [t.tipo_argomento, t.argomento].filter(Boolean).join(' · '), esito: t.modalita === 'richiamo' ? `Non disponibile, ${t.entro_testo ?? ''}` : ESITI_TRASF[t.esito], richiamo: t.richiamo_scadenza, richiamato: t.richiamato_at, stato: t.stato_cliente ? STATI_CLIENTE[t.stato_cliente][1] : '', email_ref: t.email_referente_inviata_at ? 'Sì' : 'NO', email: t.email_cliente_inviata_at || t.email_riepilogo_at ? 'Sì' : t.email_non_disponibile ? `No: ${t.email_non_disponibile}` : 'NO' })),
      rep: base('ct_trasf', 'Chiamate trasferite', [c('quando', 'Quando', 'dataora', 15), c('cliente', 'Cliente', 'testo', 22), c('a', 'A', 'testo', 16), c('argomento', 'Argomento', 'testo', 24), c('esito', 'Esito', 'testo', 18), c('richiamo', 'Richiamo entro', 'dataora', 15), c('richiamato', 'Richiamato', 'dataora', 15), c('stato', 'Cliente è', 'testo', 11), c('email_ref', 'Email referente', 'testo', 10), c('email', 'Email cliente', 'testo', 12)],
        { orizzontale: true, riepilogo: () => [{ l: 'Risposti', v: k.rispostiPct == null ? '—' : `${k.rispostiPct}%` }, { l: 'Richiamati in tempo', v: k.richiamatiInTempoPct == null ? '—' : `${k.richiamatiInTempoPct}%` }, { l: 'Email referente', v: k.referentePct == null ? '—' : `${k.referentePct}%` }, { l: 'Email cliente', v: k.clientePct == null ? '—' : `${k.clientePct}%` }] }) }; } },
];

const giorni = (da: string, a: string) => { const l: string[] = []; for (let d = new Date(da + 'T12:00:00Z'); d <= new Date(a + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) l.push(d.toISOString().slice(0, 10)); return l.slice(0, 62); };

export default function ReportCentralino() {
  const { config } = useConfig();
  const o = new Date();
  const [da, setDa] = useState(new Date(o.getFullYear(), o.getMonth(), 1).toISOString().slice(0, 10));
  const [a, setA] = useState(o.toISOString().slice(0, 10));
  const [sel, setSel] = useState(DEF[0]);
  const [esporto, setEsporto] = useState('');
  const { data, errore, reload } = useLoad(async () => {
    const [d, reg] = await Promise.all([datiPeriodo(da, a), Promise.all(giorni(da, a).map(g => rpc<Reg>('centralino_registro_giorno', { p_data: g })))]);
    return { d, reg };
  }, [da, a]);
  const out = useMemo(() => {
    if (!data || !config) return null;
    const st = config.flussi.flatMap(f => f.stadi);
    return sel.f({ ...data, nomeSt: k => st.find(s => s.key === k)?.nome ?? k ?? '' });
  }, [data, config, sel]);
  if (errore) return <Errore testo={errore} onRetry={reload} />;
  if (!out) return <Caricamento />;
  const rep = { ...out.rep, descrizione: sel.descrizione };
  async function esporta(t: 'xlsx' | 'pdf') {
    setEsporto(t);
    try {
      const m = await import('../admin/report/esporta');
      const { data: u } = await supabase.auth.getUser();
      const ctx = { periodo: `${testoCella(da, 'data')} – ${testoCella(a, 'data')}`, filtri: '', autore: u.user?.email ?? 'centralino', generato: new Date(), prodotto: 'Centralino' };
      await (t === 'xlsx' ? m.esportaExcel(rep, out!.righe, ctx) : m.esportaPdf(rep, out!.righe, ctx));
      toast(t === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(testoErrore(e)); } finally { setEsporto(''); }
  }
  return (
    <div className="rep">
      <div className="page-hero"><div><h1>Report centralino</h1><p className="sub">Scegli il report e il periodo, poi scarica PDF o Excel.</p></div></div>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', marginBottom: 16 }}>
        {DEF.map(d => <button key={d.id} className={sel.id === d.id ? 'btn' : 'btn-ghost'} style={{ textAlign: 'start', whiteSpace: 'normal', height: 'auto', padding: 12 }} onClick={() => setSel(d)}>{d.titolo}</button>)}
      </div>
      <p className="sub">{sel.descrizione}</p>
      <div className="row-flex" style={{ marginBottom: 14 }}>
        <input type="date" aria-label="Dal" value={da} onChange={e => setDa(e.target.value)} /><input type="date" aria-label="Al" value={a} onChange={e => setA(e.target.value)} />
        <button className="btn" onClick={() => esporta('pdf')} disabled={!out.righe.length || !!esporto}>{esporto === 'pdf' ? 'Preparo…' : 'Scarica PDF'}</button>
        <button className="btn-ghost" onClick={() => esporta('xlsx')} disabled={!out.righe.length || !!esporto}>{esporto === 'xlsx' ? 'Preparo…' : 'Scarica Excel'}</button>
      </div>
      {out.righe.length === 0 ? <p className="sub">Nessun dato nel periodo.</p> : (
        <div className="table-wrap"><table>
          <thead><tr>{rep.colonne.map(x => <th key={x.k}>{x.l}</th>)}</tr></thead>
          <tbody>{out.righe.slice(0, 300).map((r, i) => <tr key={i}>{rep.colonne.map(x => <td key={x.k}>{testoCella(r[x.k], x.t)}</td>)}</tr>)}</tbody>
        </table></div>)}
    </div>
  );
}
