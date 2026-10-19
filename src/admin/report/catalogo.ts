/** Catalogo dei report: colonne, filtri e formato. Le etichette sono in italiano (anche nei file esportati). */
export type TipoCol = 'testo' | 'num' | 'km' | 'euro' | 'data' | 'dataora' | 'dec1' | 'dec3' | 'targa';
export interface Col { k: string; l: string; t: TipoCol; tot?: boolean; w?: number }
export interface Report {
  id: string; titolo: string; descrizione: string; gruppo: 'Veicoli' | 'Tecnici' | 'Controllo e costi';
  periodo: 'intervallo' | 'scadenza' | 'oggi';
  filtri: { veicolo?: boolean; tecnico?: boolean };
  colonne: Col[]; raggruppa?: { k: string; etichetta: (r: Riga) => string };
  orizzontale?: boolean;
  riepilogo?: (righe: Riga[]) => { l: string; v: string }[];
}
export type Riga = Record<string, unknown>;

const n = (v: unknown) => Number(v ?? 0) || 0;
const somma = (r: Riga[], k: string) => r.reduce((s, x) => s + n(x[k]), 0);
const km = (v: number) => `${Math.round(v).toLocaleString('it-IT')} km`;
const eur = (v: number) => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

export const CATALOGO: Report[] = [
  {
    id: 'km_veicoli', gruppo: 'Veicoli', titolo: 'Km per veicolo', periodo: 'intervallo', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Km di inizio e fine periodo, km percorsi, giorni di utilizzo e media giornaliera per ogni veicolo.',
    colonne: [
      { k: 'targa', l: 'Targa', t: 'targa', w: 12 }, { k: 'modello', l: 'Modello', t: 'testo', w: 22 }, { k: 'proprieta', l: 'Proprietà', t: 'testo', w: 11 },
      { k: 'km_inizio', l: 'Km inizio', t: 'km', w: 12 }, { k: 'km_fine', l: 'Km fine', t: 'km', w: 12 },
      { k: 'km_percorsi', l: 'Km percorsi', t: 'km', tot: true, w: 12 }, { k: 'giorni_uso', l: 'Giorni di utilizzo', t: 'num', tot: true, w: 10 },
      { k: 'km_giorno', l: 'Media km/giorno', t: 'dec1', w: 11 }, { k: 'prese', l: 'Prese in carico', t: 'num', tot: true, w: 10 },
      { k: 'tecnici', l: 'Conducenti diversi', t: 'num', w: 10 }, { k: 'km_attuali', l: 'Km attuali', t: 'km', w: 12 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Veicoli', v: String(r.length) }, { l: 'Km percorsi', v: km(somma(r, 'km_percorsi')) }, { l: 'Giorni di utilizzo', v: String(somma(r, 'giorni_uso')) }],
  },
  {
    id: 'movimenti', gruppo: 'Veicoli', titolo: 'Movimenti dei veicoli', periodo: 'intervallo', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Ogni presa, riconsegna e lettura km, raggruppata per veicolo con il totale dei km di ciascuno.',
    colonne: [
      { k: 'quando', l: 'Data e ora', t: 'dataora', w: 16 }, { k: 'tipo', l: 'Operazione', t: 'testo', w: 15 }, { k: 'tecnico', l: 'Tecnico', t: 'testo', w: 20 },
      { k: 'km_prima', l: 'Km precedenti', t: 'km', w: 12 }, { k: 'km', l: 'Km registrati', t: 'km', w: 12 }, { k: 'km_percorsi', l: 'Km percorsi', t: 'km', tot: true, w: 11 },
      { k: 'carburante', l: 'Carburante', t: 'testo', w: 10 }, { k: 'danni', l: 'Danni', t: 'testo', w: 7 }, { k: 'note', l: 'Note', t: 'testo', w: 34 },
    ],
    raggruppa: { k: 'targa', etichetta: r => `${r.targa} · ${r.modello ?? ''}` }, orizzontale: true,
    riepilogo: r => [{ l: 'Movimenti', v: String(r.length) }, { l: 'Veicoli', v: String(new Set(r.map(x => x.targa)).size) }, { l: 'Km percorsi', v: km(somma(r, 'km_percorsi')) }],
  },
  {
    id: 'costi_veicoli', gruppo: 'Veicoli', titolo: 'Costi per veicolo', periodo: 'intervallo', filtri: { veicolo: true },
    descrizione: 'Km, carburante, consumo, costo al km, multe e totale per ogni veicolo.',
    colonne: [
      { k: 'targa', l: 'Targa', t: 'targa', w: 12 }, { k: 'modello', l: 'Modello', t: 'testo', w: 22 }, { k: 'km_percorsi', l: 'Km percorsi', t: 'km', tot: true, w: 12 },
      { k: 'litri', l: 'Litri', t: 'dec1', tot: true, w: 10 }, { k: 'carburante', l: 'Carburante', t: 'euro', tot: true, w: 13 },
      { k: 'l_100km', l: 'Litri/100 km', t: 'dec1', w: 11 }, { k: 'eur_km', l: '€/km', t: 'dec3', w: 9 },
      { k: 'multe', l: 'Multe', t: 'num', tot: true, w: 8 }, { k: 'multe_eur', l: 'Importo multe', t: 'euro', tot: true, w: 13 },
      { k: 'totale', l: 'Totale costi', t: 'euro', tot: true, w: 13 }, { k: 'segnalazioni', l: 'Segnalazioni', t: 'num', tot: true, w: 11 },
    ],
    orizzontale: true,
    riepilogo: r => { const k = somma(r, 'km_percorsi'), c = somma(r, 'carburante'); return [{ l: 'Km percorsi', v: km(k) }, { l: 'Carburante', v: eur(c) }, { l: 'Costo medio al km', v: k > 0 && c > 0 ? `${(c / k).toLocaleString('it-IT', { maximumFractionDigits: 3 })} €` : '—' }, { l: 'Totale costi', v: eur(somma(r, 'totale')) }]; },
  },
  {
    id: 'flotta', gruppo: 'Veicoli', titolo: 'Situazione della flotta', periodo: 'oggi', filtri: { veicolo: true },
    descrizione: 'Elenco veicoli con stato, chi li ha in carico, km e tutte le scadenze. Fotografia di oggi.',
    colonne: [
      { k: 'targa', l: 'Targa', t: 'targa', w: 12 }, { k: 'modello', l: 'Modello', t: 'testo', w: 22 }, { k: 'tipo', l: 'Tipo', t: 'testo', w: 11 },
      { k: 'stato', l: 'Stato', t: 'testo', w: 15 }, { k: 'in_carico', l: 'In carico a', t: 'testo', w: 18 }, { k: 'km', l: 'Km', t: 'km', w: 11 },
      { k: 'assicurazione', l: 'Assicurazione', t: 'data', w: 12 }, { k: 'revisione', l: 'Revisione', t: 'data', w: 12 }, { k: 'bollo', l: 'Bollo', t: 'data', w: 12 },
      { k: 'prossimo_tagliando_km', l: 'Tagliando a km', t: 'km', w: 12 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Veicoli', v: String(r.length) }, { l: 'In uso', v: String(r.filter(x => x.stato === 'In uso').length) }, { l: 'Fermi o non utilizzabili', v: String(r.filter(x => x.stato === 'Fermo' || x.stato === 'Non utilizzabile').length) }],
  },
  {
    id: 'scadenze', gruppo: 'Veicoli', titolo: 'Scadenze', periodo: 'scadenza', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Assicurazioni, revisioni, bolli, dotazioni di bordo e patenti in scadenza entro la data scelta (comprese quelle già scadute).',
    colonne: [
      { k: 'scadenza', l: 'Scadenza', t: 'data', w: 12 }, { k: 'stato', l: 'Stato', t: 'testo', w: 15 }, { k: 'giorni', l: 'Giorni', t: 'num', w: 8 },
      { k: 'tipo', l: 'Tipo', t: 'testo', w: 22 }, { k: 'oggetto', l: 'Veicolo o persona', t: 'testo', w: 38 },
    ],
    riepilogo: r => [{ l: 'Scadute', v: String(r.filter(x => x.stato === 'Scaduta').length) }, { l: 'Entro 30 giorni', v: String(r.filter(x => x.stato === 'Entro 30 giorni').length) }, { l: 'In programma', v: String(r.filter(x => x.stato === 'In programma').length) }],
  },
  {
    id: 'km_tecnici', gruppo: 'Tecnici', titolo: 'Km per tecnico', periodo: 'intervallo', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Km guidati, giorni di guida, prese e riconsegne, veicoli usati, segnalazioni e multe per ogni tecnico.',
    colonne: [
      { k: 'tecnico', l: 'Tecnico', t: 'testo', w: 20 }, { k: 'codice', l: 'Codice', t: 'testo', w: 9 }, { k: 'km_percorsi', l: 'Km guidati', t: 'km', tot: true, w: 11 },
      { k: 'giorni_guida', l: 'Giorni di guida', t: 'num', tot: true, w: 10 }, { k: 'prese', l: 'Prese', t: 'num', tot: true, w: 8 }, { k: 'riconsegne', l: 'Riconsegne', t: 'num', tot: true, w: 10 },
      { k: 'veicoli', l: 'Veicoli usati', t: 'testo', w: 26 }, { k: 'segnalazioni', l: 'Segnalazioni', t: 'num', tot: true, w: 11 }, { k: 'multe', l: 'Multe', t: 'num', tot: true, w: 8 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Tecnici', v: String(r.length) }, { l: 'Km guidati', v: km(somma(r, 'km_percorsi')) }, { l: 'Segnalazioni', v: String(somma(r, 'segnalazioni')) }],
  },
  {
    id: 'giornaliero', gruppo: 'Tecnici', titolo: 'Giornate di lavoro', periodo: 'intervallo', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Per ogni giorno lavorativo e tecnico: veicolo assegnato, interventi, assenze, km e stato del piano.',
    colonne: [
      { k: 'data', l: 'Data', t: 'data', w: 11 }, { k: 'tecnico', l: 'Tecnico', t: 'testo', w: 18 }, { k: 'veicolo', l: 'Veicolo', t: 'targa', w: 11 },
      { k: 'assenza', l: 'Assenza', t: 'testo', w: 10 }, { k: 'n_interventi', l: 'Interventi', t: 'num', tot: true, w: 9 }, { k: 'interventi', l: 'Dettaglio interventi', t: 'testo', w: 60 },
      { k: 'km_giorno', l: 'Km', t: 'km', tot: true, w: 9 }, { k: 'piano', l: 'Piano', t: 'testo', w: 13 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Giornate', v: String(r.length) }, { l: 'Interventi', v: String(somma(r, 'n_interventi')) }, { l: 'Giorni di assenza', v: String(r.filter(x => x.assenza).length) }],
  },
  {
    id: 'avvisi', gruppo: 'Tecnici', titolo: 'Avvisi e letture', periodo: 'intervallo', filtri: { tecnico: true },
    descrizione: 'Avvisi inviati ai tecnici, quando sono stati letti e in quanto tempo.',
    colonne: [
      { k: 'inviato', l: 'Inviato', t: 'dataora', w: 16 }, { k: 'tecnico', l: 'Tecnico', t: 'testo', w: 18 }, { k: 'livello', l: 'Livello', t: 'testo', w: 12 },
      { k: 'titolo', l: 'Titolo', t: 'testo', w: 34 }, { k: 'dove', l: 'Dove', t: 'testo', w: 22 }, { k: 'letto', l: 'Letto', t: 'dataora', w: 16 }, { k: 'minuti_lettura', l: 'Minuti per leggere', t: 'num', w: 10 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Avvisi', v: String(r.length) }, { l: 'Letti', v: String(r.filter(x => x.letto).length) }, { l: 'Non letti', v: String(r.filter(x => !x.letto).length) }],
  },
  {
    id: 'assenze', gruppo: 'Tecnici', titolo: 'Assenze', periodo: 'intervallo', filtri: { tecnico: true },
    descrizione: 'Ferie, permessi e altre assenze nel periodo, con i giorni lavorativi interessati.',
    colonne: [
      { k: 'tecnico', l: 'Tecnico', t: 'testo', w: 22 }, { k: 'motivo', l: 'Motivo', t: 'testo', w: 14 }, { k: 'dal', l: 'Dal', t: 'data', w: 12 }, { k: 'al', l: 'Al', t: 'data', w: 12 },
      { k: 'giorni_lavorativi', l: 'Giorni lavorativi nel periodo', t: 'num', tot: true, w: 14 },
    ],
    riepilogo: r => [{ l: 'Assenze', v: String(r.length) }, { l: 'Giorni lavorativi', v: String(somma(r, 'giorni_lavorativi')) }],
  },
  {
    id: 'tecnici', gruppo: 'Tecnici', titolo: 'Anagrafica tecnici', periodo: 'oggi', filtri: { tecnico: true },
    descrizione: 'Tecnici attivi con contatti, patente e scadenza, stato dell\'app e veicolo in carico. Fotografia di oggi.',
    colonne: [
      { k: 'tecnico', l: 'Tecnico', t: 'testo', w: 20 }, { k: 'codice', l: 'Codice', t: 'testo', w: 9 }, { k: 'ruolo', l: 'Ruolo', t: 'testo', w: 22 },
      { k: 'telefono', l: 'Telefono', t: 'testo', w: 14 }, { k: 'email', l: 'Email', t: 'testo', w: 24 }, { k: 'patente', l: 'Patente', t: 'testo', w: 8 },
      { k: 'scadenza_patente', l: 'Scadenza patente', t: 'data', w: 12 }, { k: 'app', l: 'App', t: 'testo', w: 13 }, { k: 'veicolo_in_carico', l: 'Veicolo in carico', t: 'targa', w: 12 },
    ],
    orizzontale: true,
  },
  {
    id: 'segnalazioni', gruppo: 'Controllo e costi', titolo: 'Segnalazioni e guasti', periodo: 'intervallo', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Tutte le segnalazioni con categoria, gravità, stato, tempo di risoluzione e risposta.',
    colonne: [
      { k: 'aperta_il', l: 'Aperta il', t: 'dataora', w: 16 }, { k: 'targa', l: 'Targa', t: 'targa', w: 11 }, { k: 'tecnico', l: 'Segnalata da', t: 'testo', w: 17 },
      { k: 'categoria', l: 'Categoria', t: 'testo', w: 16 }, { k: 'gravita', l: 'Gravità', t: 'testo', w: 13 }, { k: 'descrizione', l: 'Descrizione', t: 'testo', w: 36 },
      { k: 'stato', l: 'Stato', t: 'testo', w: 12 }, { k: 'ore_risoluzione', l: 'Ore per risolvere', t: 'dec1', w: 10 }, { k: 'nota_chiusura', l: 'Risposta', t: 'testo', w: 28 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Segnalazioni', v: String(r.length) }, { l: 'Veicolo fermo', v: String(r.filter(x => x.gravita === 'Veicolo fermo').length) }, { l: 'Risolte', v: String(r.filter(x => x.stato === 'Risolta').length) }, { l: 'Aperte', v: String(r.filter(x => x.stato !== 'Risolta').length) }],
  },
  {
    id: 'carburante', gruppo: 'Controllo e costi', titolo: 'Rifornimenti carburante', periodo: 'intervallo', filtri: { veicolo: true },
    descrizione: 'Rifornimenti importati dalla carta carburante, con il conducente che aveva il veicolo in quel giorno.',
    colonne: [
      { k: 'data', l: 'Data', t: 'data', w: 11 }, { k: 'targa', l: 'Targa', t: 'targa', w: 11 }, { k: 'conducente', l: 'Conducente', t: 'testo', w: 18 },
      { k: 'prodotto', l: 'Prodotto', t: 'testo', w: 12 }, { k: 'fornitore', l: 'Fornitore', t: 'testo', w: 20 }, { k: 'litri', l: 'Litri', t: 'dec1', tot: true, w: 9 },
      { k: 'importo', l: 'Importo', t: 'euro', tot: true, w: 12 }, { k: 'eur_litro', l: '€/litro', t: 'dec3', w: 9 }, { k: 'km', l: 'Km dichiarati', t: 'km', w: 12 },
    ],
    raggruppa: { k: 'targa', etichetta: r => String(r.targa) }, orizzontale: true,
    riepilogo: r => [{ l: 'Rifornimenti', v: String(r.length) }, { l: 'Litri', v: somma(r, 'litri').toLocaleString('it-IT', { maximumFractionDigits: 1 }) }, { l: 'Importo', v: eur(somma(r, 'importo')) }],
  },
  {
    id: 'multe', gruppo: 'Controllo e costi', titolo: 'Multe', periodo: 'intervallo', filtri: { veicolo: true, tecnico: true },
    descrizione: 'Verbali con conducente, importo, decurtazione punti, termine di comunicazione e stato.',
    colonne: [
      { k: 'data', l: 'Infrazione', t: 'dataora', w: 16 }, { k: 'targa', l: 'Targa', t: 'targa', w: 11 }, { k: 'conducente', l: 'Conducente', t: 'testo', w: 18 },
      { k: 'luogo', l: 'Luogo', t: 'testo', w: 26 }, { k: 'ente', l: 'Ente', t: 'testo', w: 20 }, { k: 'verbale', l: 'Verbale', t: 'testo', w: 15 },
      { k: 'importo', l: 'Importo', t: 'euro', tot: true, w: 11 }, { k: 'punti', l: 'Punti', t: 'testo', w: 7 }, { k: 'scadenza_comunicazione', l: 'Comunicare entro', t: 'data', w: 12 }, { k: 'stato', l: 'Stato', t: 'testo', w: 18 },
    ],
    orizzontale: true,
    riepilogo: r => [{ l: 'Multe', v: String(r.length) }, { l: 'Importo', v: eur(somma(r, 'importo')) }, { l: 'Con decurtazione punti', v: String(r.filter(x => x.punti === 'Sì').length) }],
  },
];

export const GRUPPI_REPORT = ['Veicoli', 'Tecnici', 'Controllo e costi'] as const;

/** Data e ora nel fuso di Roma, per tabelle e file. */
const fmtRoma = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export function testoCella(v: unknown, t: TipoCol): string {
  if (v == null || v === '') return '';
  switch (t) {
    case 'km': case 'num': return Math.round(Number(v)).toLocaleString('it-IT');
    case 'euro': return Number(v).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
    case 'dec1': return Number(v).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    case 'dec3': return Number(v).toLocaleString('it-IT', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    case 'data': { const [y, m, d] = String(v).slice(0, 10).split('-'); return `${d}/${m}/${y}`; }
    case 'dataora': return fmtRoma.format(new Date(String(v))).replace(',', '');
    default: return String(v);
  }
}
export const numerica = (t: TipoCol) => ['km', 'num', 'euro', 'dec1', 'dec3'].includes(t);
