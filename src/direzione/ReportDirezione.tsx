import { useState } from 'react';
import { supabase, testoErrore } from '../lib/supabase';
import { toast } from '../ui';
import { testoCella, type Col, type Report, type Riga } from '../admin/report/catalogo';
import { datiPeriodo } from '../centralino/Direzione';
import { kpi, valuta, type Dataset } from '../lib/centralino/registro';
import { intervallo, precedente, valore, variazione } from '../lib/direzione/analisi';
import { fmtEuro } from '../lib/format';
import { FONTE } from './comuni';
import { REPORT, nomeTipo } from '../lib/centralino/testiDirezione';

const VOCI: [string, string[]][] = [
  [REPORT.sez_volumi.it, ['pratiche', 'richieste_chiuse', 'reg_telefonate', 'reg_whatsapp', 'reg_email', 'reg_info']],
  [REPORT.sez_offerte.it, ['off_piccole', 'offerte60', 'off_piccole_inviate', 'off_grandi', 'off_grandi_passate', 'in_ritardo']],
  [REPORT.sez_seguire.it, ['da_seguire']],
  [REPORT.sez_qualita.it, ['annullate', 'annullate_motivo', 'senza_contatti', 'reg_anagrafica']],
];
const COL: Col[] = [
  { k: 'sezione', l: REPORT.col_sezione.it, t: 'testo', w: 14 }, { k: 'voce', l: REPORT.col_voce.it, t: 'testo', w: 30 }, { k: 'valore', l: REPORT.col_valore.it, t: 'testo', w: 12 },
  { k: 'dettaglio', l: REPORT.col_conteggio.it, t: 'testo', w: 16 }, { k: 'prec', l: REPORT.col_prec.it, t: 'testo', w: 14 }, { k: 'var', l: REPORT.col_var.it, t: 'testo', w: 11 },
  { k: 'def', l: REPORT.col_def.it, t: 'testo', w: 60 },
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
      prec: def.fonte === 'aperte' ? REPORT.adesso.it : pr == null ? '—' : pc ? `${pr}%` : String(pr), var: x ? `${x.su ? '▲' : '▼'} ${Math.abs(x.v)}${pc ? ' punti' : '%'}` : '—',
      def: `${def.spiegazione} Contati: ${FONTE[def.fonte]}.` });
  }
  const vp = (l: Dataset['pratiche'], t: string) => fmtEuro(valore(l.filter(x => x.tipo === t)));
  out.push({ sezione: REPORT.sez_offerte.it, voce: REPORT.val_jen.it, valore: vp(d.pratiche, 'offerta_piccola'), dettaglio: '', prec: vp(p.pratiche, 'offerta_piccola'), var: '—', def: `${nomeTipo('offerta_piccola')}: ${REPORT.val_jen.def}` });
  out.push({ sezione: REPORT.sez_offerte.it, voce: REPORT.val_col.it, valore: vp(d.pratiche, 'offerta_grande'), dettaglio: '', prec: vp(p.pratiche, 'offerta_grande'), var: '—', def: `${nomeTipo('offerta_grande')}: ${REPORT.val_col.def}` });
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
      const rep: Report = { id: 'direzione_centralino', titolo: REPORT.titolo.it, descrizione: REPORT.descr.it,
        gruppo: 'Controllo e costi', periodo: 'intervallo', filtri: {}, colonne: COL, orizzontale: true, raggruppa: { k: 'sezione', etichetta: r => String(r.sezione) } };
      const c = { periodo: `${testoCella(i[0], 'data')} – ${testoCella(i[1], 'data')}`, filtri: `confronto con: ${testoCella(j[0], 'data')} – ${testoCella(j[1], 'data')}`, autore: u.user?.email ?? 'direzione', generato: new Date(), prodotto: 'Direzione' };
      await (t === 'xlsx' ? m.esportaExcel(rep, righe, c) : m.esportaPdf(rep, righe, c));
      toast(t === 'xlsx' ? 'File Excel pronto' : 'File PDF pronto');
    } catch (e) { toast(testoErrore(e)); } finally { setLav(''); }
  }
  return (
    <div className="dz-menu">
      <button className="btn" onClick={() => setAperto(!aperto)} aria-expanded={aperto} disabled={!!lav}>{lav ? 'Preparo…' : REPORT.bottone.it}</button>
      {aperto && <div className="dz-menu-pop" role="menu">
        {([['settimana', REPORT.settimana.it], ['mese', REPORT.mese.it], ['corrente', REPORT.corrente.it]] as const).map(([q, l]) => (
          <div key={q} className="dz-menu-r"><span>{l}</span><button className="btn-ghost btn-sm" onClick={() => esporta(q, 'pdf')}>PDF</button><button className="btn-ghost btn-sm" onClick={() => esporta(q, 'xlsx')}>Excel</button></div>))}
      </div>}
    </div>
  );
}
