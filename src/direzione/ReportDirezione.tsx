import { useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { toast } from '../ui';
import { testoCella, type Col, type Report, type Riga } from '../admin/report/catalogo';
import { datiPeriodo } from '../centralino/Direzione';
import { kpi, valuta, type Dataset } from '../lib/centralino/registro';
import { intervallo, perCommerciale, precedente, primaRisposta, valore, variazione } from '../lib/direzione/analisi';
import { durata } from '../lib/centralino/kpi';
import { fmtEuro } from '../lib/format';
import { FONTE } from './comuni';

const VOCI: [string, string[]][] = [
  ['Volumi', ['pratiche', 'reg_telefonate', 'reg_whatsapp', 'reg_email', 'urgenti', 'reg_info']],
  ['Servizio', ['sla', 'cliente1h', 'interventi1h', 'sopralluoghi1h', 'urgenti_giornata', 'sla_mancati', 'in_ritardo']],
  ['Offerte', ['off_piccole', 'offerte60', 'off_piccole_inviate', 'off_grandi', 'off_grandi_passate', 'comm_in_tempo', 'comm_scaduti']],
  ['Trasferimenti', ['trasferite', 'trasf_in_tempo', 'trasf_da_richiamare', 'trasf_scadute', 'trasf_email_ref', 'trasf_email_cli']],
  ['Qualità', ['qual_email', 'annullate', 'annullate_motivo', 'senza_contatti', 'reg_anagrafica']],
];
const COL: Col[] = [
  { k: 'sezione', l: 'Sezione', t: 'testo', w: 14 }, { k: 'voce', l: 'Indicatore', t: 'testo', w: 30 }, { k: 'valore', l: 'Valore', t: 'testo', w: 12 },
  { k: 'dettaglio', l: 'Numeratore / denominatore', t: 'testo', w: 16 }, { k: 'prec', l: 'Periodo precedente', t: 'testo', w: 14 }, { k: 'var', l: 'Variazione', t: 'testo', w: 11 },
  { k: 'def', l: 'Definizione', t: 'testo', w: 60 },
];

/** Righe del report: stessi KPI del registro della pagina (valori identici). Funzione pura, testata. */
export function righeReport(d: Dataset, p: Dataset, ora = new Date()): Riga[] {
  const out: Riga[] = [];
  for (const [sez, ids] of VOCI) for (const id of ids) {
    const def = kpi(id); if (!def) continue;
    const v = valuta(def, d, {}, ora), w = valuta(def, p, {}, ora);
    const pc = !!def.den, att = pc ? v.pct : v.n, pr = pc ? w.pct : w.n;
    const x = def.fonte === 'aperte' ? null : variazione(att, pr, pc);
    out.push({ sezione: sez, voce: def.titolo, valore: att == null ? '—' : pc ? `${att}%` : String(att), dettaglio: pc ? `${v.n} / ${v.den}` : '',
      prec: def.fonte === 'aperte' ? 'situazione attuale' : pr == null ? '—' : pc ? `${pr}%` : String(pr), var: x ? `${x.su ? '▲' : '▼'} ${Math.abs(x.v)}${pc ? ' pt' : '%'}` : '—',
      def: `${def.spiegazione} Fonte: ${FONTE[def.fonte]}.` });
  }
  const pr = primaRisposta(d.pratiche, d.eventi), prp = primaRisposta(p.pratiche, p.eventi);
  out.push({ sezione: 'Servizio', voce: 'Prima risposta (media)', valore: durata(pr.media), dettaglio: `${pr.n} pratiche`, prec: durata(prp.media), var: '—', def: 'Minuti medi tra la chiamata e il primo passo fatto.' });
  const vp = (l: Dataset['pratiche'], t: string) => fmtEuro(valore(l.filter(x => x.tipo === t)));
  out.push({ sezione: 'Offerte', voce: 'Valore offerte fino a 1.000 €', valore: vp(d.pratiche, 'offerta_piccola'), dettaglio: '', prec: vp(p.pratiche, 'offerta_piccola'), var: '—', def: 'Somma degli importi stimati.' });
  out.push({ sezione: 'Offerte', voce: 'Valore offerte oltre 1.000 €', valore: vp(d.pratiche, 'offerta_grande'), dettaglio: '', prec: vp(p.pratiche, 'offerta_grande'), var: '—', def: 'Somma degli importi stimati.' });
  for (const [n, x] of Object.entries(perCommerciale(d.trasf, ora)))
    out.push({ sezione: 'Offerte', voce: `Richiami entro 2 ore – ${n}`, valore: x.pct == null ? '—' : `${x.pct}%`, dettaglio: `${x.inTempo} / ${x.val}`, prec: '', var: '—', def: `${x.scaduti} scaduti non richiamati.` });
  return out;
}

/** «Report direzione»: riepilogo settimanale o mensile del Centralino, PDF o Excel. */
export default function ReportDirezione({ d, p, da, a, pda, pa }: { d: Dataset; p: Dataset; da: string; a: string; pda: string; pa: string }) {
  const [aperto, setAperto] = useState(false);
  const [lav, setLav] = useState('');
  async function esporta(quale: 'corrente' | 'settimana' | 'mese', t: 'pdf' | 'xlsx') {
    setLav(quale + t); setAperto(false);
    try {
      let [x, y, i, j] = [d, p, [da, a], [pda, pa]];
      if (quale !== 'corrente') { i = intervallo(quale, new Date()); j = precedente(i[0], i[1]); [x, y] = await Promise.all([datiPeriodo(i[0], i[1]), datiPeriodo(j[0], j[1])]); }
      const m = await import('../admin/report/esporta');
      const { data: u } = await supabase.auth.getUser();
      const righe = righeReport(x, y);
      const rep: Report = { id: 'direzione_centralino', titolo: 'Report direzione – Centralino', descrizione: 'Riepilogo dei KPI del centralino con confronto col periodo precedente. Sola lettura; appunti privati mai inclusi.',
        gruppo: 'Controllo e costi', periodo: 'intervallo', filtri: {}, colonne: COL, orizzontale: true, raggruppa: { k: 'sezione', etichetta: r => String(r.sezione) } };
      const c = { periodo: `${testoCella(i[0], 'data')} – ${testoCella(i[1], 'data')}`, filtri: `confronto: ${testoCella(j[0], 'data')} – ${testoCella(j[1], 'data')}`, autore: u.user?.email ?? 'direzione', generato: new Date(), prodotto: 'Direzione' };
      await (t === 'xlsx' ? m.esportaExcel(rep, righe, c) : m.esportaPdf(rep, righe, c));
      toast(t === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(testoErrore(e)); } finally { setLav(''); }
  }
  return (
    <div className="dz-menu">
      <button className="btn" onClick={() => setAperto(!aperto)} aria-expanded={aperto} disabled={!!lav}>{lav ? 'Preparo…' : 'Report direzione'}</button>
      {aperto && <div className="dz-menu-pop" role="menu">
        {([['settimana', 'Settimana (da lunedì)'], ['mese', 'Mese corrente'], ['corrente', 'Periodo mostrato']] as const).map(([q, l]) => (
          <div key={q} className="dz-menu-r"><span>{l}</span><button className="btn-ghost btn-sm" onClick={() => esporta(q, 'pdf')}>PDF</button><button className="btn-ghost btn-sm" onClick={() => esporta(q, 'xlsx')}>Excel</button></div>))}
      </div>}
    </div>
  );
}
