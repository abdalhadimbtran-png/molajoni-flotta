// Esporta i testi della Direzione/Offerte in Markdown (italiano | definizione | arabo) per la revisione con un collega madrelingua.
// node --experimental-strip-types scripts/esporta-testi-direzione.ts > Testi_Direzione_da_rivedere.md
import { ANALISI, CANALI_NOMI, DIR, DRILL, ELENCO, ESITI_NOMI, FONTI, JEN, KPI_OFFERTE, KPI_TESTI, LEGENDA, MOTIVI, MOTIVI_AR, MOVIMENTI, PAN, REPORT, SOTTOTIPI_OFFERTA, STATI_OFFERTA, TIPI_ALTRI, TIPI_RICHIESTA } from '../src/lib/centralino/testiDirezione.ts';
const esc = (s = '') => s.replace(/\|/g, '\\|');
const tab = (titolo: string, o: Record<string, { it: string; def?: string; ar: string }>) =>
  [`## ${titolo}`, '', '| Italiano | Definizione | Significato in arabo |', '|---|---|---|',
   ...Object.values(o).map(x => `| ${esc(x.it)} | ${esc(x.def ?? '')} | ${esc(x.ar)} |`), ''].join('\n');
console.log(['# Testi Direzione e Offerte — da rivedere', '', 'Fonte unica: `src/lib/centralino/testiDirezione.ts` (le stesse parole sono nel Report Direzione PDF).', '',
  tab('Tipi di richiesta (nomi usati ovunque)', TIPI_RICHIESTA), tab('Tipi di offerta', SOTTOTIPI_OFFERTA), tab('Tipi non più usati (solo dati vecchi)', TIPI_ALTRI),
  tab('Canali', CANALI_NOMI), tab('Stati di una richiesta', ESITI_NOMI), tab('Legenda', LEGENDA),
  tab('Numeri delle offerte', KPI_OFFERTE), tab('Stati di un\'offerta', STATI_OFFERTA),
  tab('Motivi', Object.fromEntries(MOTIVI.map(m => [m, { it: m, ar: MOTIVI_AR[m] }]))),
  tab('Pagina Direzione', DIR), tab('Panoramica', PAN), tab('Movimenti', MOVIMENTI), tab('Report direzione (PDF / Excel)', REPORT),
  tab('Altri numeri (tessere, dettaglio, report)', KPI_TESTI), tab('Da dove vengono i numeri', FONTI), tab('Pagina di dettaglio di un numero', ANALISI), tab('Elenco di un numero (drill-down)', DRILL), tab('Colonne e pulsanti dell\'elenco', ELENCO),
  tab('Pagina Offerte di Jennifer', JEN)].join('\n'));
