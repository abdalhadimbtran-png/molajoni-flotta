// Esporta i testi della Direzione/Offerte in Markdown (italiano | definizione | arabo) per la revisione con un collega madrelingua.
// node --experimental-strip-types scripts/esporta-testi-direzione.ts > Testi_Direzione_da_rivedere.md
import { DIR, JEN, KPI_OFFERTE, MOTIVI, MOTIVI_AR, STATI_OFFERTA } from '../src/lib/centralino/testiDirezione.ts';
const esc = (s = '') => s.replace(/\|/g, '\\|');
const tab = (titolo: string, o: Record<string, { it: string; def?: string; ar: string }>) =>
  [`## ${titolo}`, '', '| Etichetta (italiano) | Definizione sotto il numero | Significato (arabo) |', '|---|---|---|',
   ...Object.values(o).map(x => `| ${esc(x.it)} | ${esc(x.def ?? '')} | ${esc(x.ar)} |`), ''].join('\n');
console.log(['# Testi Direzione e Offerte — da rivedere', '', 'Fonte unica: `src/lib/centralino/testiDirezione.ts` (le stesse parole sono nel Report Direzione PDF).', '',
  tab('Numeri delle offerte', KPI_OFFERTE), tab('Stati di un\'offerta', STATI_OFFERTA),
  tab('Motivi', Object.fromEntries(MOTIVI.map(m => [m, { it: m, ar: MOTIVI_AR[m] }]))),
  tab('Pagina Direzione', DIR), tab('Pagina Offerte di Jennifer', JEN)].join('\n'));
