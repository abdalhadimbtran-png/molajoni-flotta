/**
 * Import anagrafiche reali da Excel: dipendenti/tecnici e veicoli (logica pura, testata).
 * Niente codice fiscale, IBAN o dati sanitari: colonne sconosciute ignorate.
 */

export type Tipo = 'dipendenti' | 'veicoli';
export interface Colonna { k: string; titolo: string; obbl?: boolean; nota: string; esempio: string; w?: number }

export const COLONNE: Record<Tipo, Colonna[]> = {
  dipendenti: [
    { k: 'codice', titolo: 'Codice', obbl: true, nota: 'Univoco, 2-12 lettere/numeri senza spazi (es. ROSSIM). Serve per l\'accesso del tecnico.', esempio: 'ROSSIM', w: 12 },
    { k: 'nome', titolo: 'Nome', obbl: true, nota: '', esempio: 'Mario', w: 16 },
    { k: 'cognome', titolo: 'Cognome', obbl: true, nota: '', esempio: 'Rossi', w: 16 },
    { k: 'categoria', titolo: 'Categoria', obbl: true, nota: 'Tecnico, Ufficio, Magazzino o Altro', esempio: 'Tecnico', w: 12 },
    { k: 'ruolo', titolo: 'Mansione', nota: 'Testo libero', esempio: 'Tecnico manutenzione', w: 22 },
    { k: 'reparto', titolo: 'Reparto', nota: 'Testo libero', esempio: 'Manutenzione', w: 16 },
    { k: 'email', titolo: 'Email', nota: 'Facoltativa, unica per persona', esempio: 'mario.rossi@esempio.it', w: 26 },
    { k: 'telefono', titolo: 'Telefono', nota: '', esempio: '333 1234567', w: 15 },
    { k: 'sigla', titolo: 'Sigla zona', nota: 'Sigla tecnico per le zone CAP (es. TECA, TECB). Facoltativa', esempio: 'TECA', w: 11 },
    { k: 'data_assunzione', titolo: 'Data assunzione', nota: 'gg/mm/aaaa', esempio: '01/03/2020', w: 15 },
    { k: 'contratto', titolo: 'Contratto', nota: 'Full-time o Part-time', esempio: 'Full-time', w: 12 },
    { k: 'ore_giornaliere', titolo: 'Ore al giorno', nota: 'Da 1 a 12 (vuoto = 8)', esempio: '8', w: 12 },
    { k: 'giorni_riposo', titolo: 'Giorni di riposo', nota: 'Es. "Sab, Dom" (vuoto = Sab, Dom)', esempio: 'Sab, Dom', w: 15 },
    { k: 'patente_categoria', titolo: 'Patente', nota: 'Categoria (es. B)', esempio: 'B', w: 9 },
    { k: 'patente_scadenza', titolo: 'Scadenza patente', nota: 'gg/mm/aaaa', esempio: '15/06/2030', w: 15 },
    { k: 'attivo', titolo: 'Attivo', nota: 'Sì o No (vuoto = Sì)', esempio: 'Sì', w: 8 },
  ],
  veicoli: [
    { k: 'targa', titolo: 'Targa', obbl: true, nota: 'Univoca (es. AB123CD)', esempio: 'AB123CD', w: 12 },
    { k: 'marca_modello', titolo: 'Marca e modello', obbl: true, nota: '', esempio: 'Fiat Ducato', w: 22 },
    { k: 'tipo', titolo: 'Tipo', nota: 'Es. Furgone, Autocarro, Auto', esempio: 'Furgone', w: 12 },
    { k: 'proprieta', titolo: 'Proprietà', nota: 'Proprietà, Noleggio o Leasing', esempio: 'Noleggio', w: 12 },
    { k: 'alimentazione', titolo: 'Alimentazione', nota: 'Benzina, Diesel, GPL, Metano, Elettrica, Ibrida benzina, Ibrida diesel', esempio: 'Diesel', w: 14 },
    { k: 'capacita_serbatoio', titolo: 'Serbatoio (litri)', nota: 'Numero', esempio: '90', w: 14 },
    { k: 'km_attuali', titolo: 'Km attuali', nota: 'Numero intero', esempio: '45000', w: 12 },
    { k: 'km_prossimo_tagliando', titolo: 'Km prossimo tagliando', nota: 'Numero intero', esempio: '60000', w: 18 },
    { k: 'scad_assicurazione', titolo: 'Scadenza assicurazione', nota: 'gg/mm/aaaa', esempio: '31/12/2026', w: 18 },
    { k: 'scad_revisione', titolo: 'Scadenza revisione', nota: 'gg/mm/aaaa', esempio: '30/04/2027', w: 16 },
    { k: 'scad_bollo', titolo: 'Scadenza bollo', nota: 'gg/mm/aaaa', esempio: '31/01/2027', w: 14 },
    { k: 'note', titolo: 'Note', nota: '', esempio: '', w: 24 },
  ],
};

export const NOME_FILE: Record<Tipo, string> = { dipendenti: 'Modello_Dipendenti.xlsx', veicoli: 'Modello_Veicoli.xlsx' };
export const CHIAVE: Record<Tipo, string> = { dipendenti: 'codice', veicoli: 'targa' };

export type Valori = Record<string, string | number | boolean | null>;
export interface RigaImport { riga: number; valori: Valori; errori: string[] }

const norm = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const SINONIMI: Record<string, string[]> = {
  codice: ['codicedipendente', 'matricola'], ruolo: ['ruolo', 'qualifica'], marca_modello: ['modello', 'marcamodello', 'veicolo'],
  telefono: ['cellulare', 'tel'], sigla: ['sigla', 'siglatecnico'], targa: ['targaveicolo'],
};

/** Mappa intestazioni del file → campi (titolo del modello, nome campo o sinonimo). */
export function mappaIntestazioni(intest: unknown[], tipo: Tipo): Record<number, string> {
  const out: Record<number, string> = {};
  intest.forEach((h, i) => {
    const n = norm(h).replace(/obbligatorio$/, '');
    const c = COLONNE[tipo].find(c => norm(c.titolo) === n || norm(c.k) === n || (SINONIMI[c.k] ?? []).includes(n));
    if (c && !Object.values(out).includes(c.k)) out[i] = c.k;
  });
  return out;
}

/** Trova la riga intestazione (la prima che contiene la colonna chiave) e restituisce le righe dati. */
export function leggiMatrice(mat: unknown[][], tipo: Tipo): { mappa: Record<number, string>; righe: { riga: number; celle: unknown[] }[] } {
  const iH = mat.findIndex(r => Object.values(mappaIntestazioni(r ?? [], tipo)).includes(CHIAVE[tipo]));
  if (iH < 0) return { mappa: {}, righe: [] };
  const mappa = mappaIntestazioni(mat[iH], tipo);
  const righe = mat.slice(iH + 1).map((celle, j) => ({ riga: iH + j + 2, celle: celle ?? [] }))
    .filter(r => r.celle.some(c => String(c ?? '').trim() !== ''));
  return { mappa, righe };
}

/** Data italiana (gg/mm/aaaa, gg-mm-aa, aaaa-mm-gg, seriale Excel, Date) → 'aaaa-mm-gg' | null | 'ERR'. */
export function dataIt(v: unknown): string | null | 'ERR' {
  if (v == null || String(v).trim() === '') return null;
  if (v instanceof Date && !isNaN(+v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return d.toISOString().slice(0, 10); }
  const s = String(v).trim();
  let y: number, m: number, d: number;
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) { d = +x[1]; m = +x[2]; y = +x[3]; if (y < 100) y += 2000; }
  else return 'ERR';
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1950 || y > 2100) return 'ERR';
  return dt.toISOString().slice(0, 10);
}

/** Numero italiano ("1.234,5", "45000", "45.000 km") → number | null | NaN. */
export function numeroIt(v: unknown): number | null {
  if (v == null || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return s === '' ? NaN : n;
}

const GIORNI = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
/** "Sab, Dom" → '0000011'; vuoto → default; 'ERR' se non valido. */
export function giorniRiposo(v: unknown): string | 'ERR' {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return '0000011';
  if (/^[01]{7}$/.test(s)) return s === '1111111' ? 'ERR' : s;
  if (/^(nessuno|-)$/.test(s)) return '0000000';
  const bit = Array(7).fill('0');
  for (const p of s.replace(/\se\s/g, ',').split(/[\s,;/+]+/).filter(Boolean)) { const i = GIORNI.indexOf(p.slice(0, 3)); if (i < 0) return 'ERR'; bit[i] = '1'; }
  const out = bit.join('');
  return out === '1111111' ? 'ERR' : out;
}

const scelta = (v: unknown, opz: Record<string, string>): string | null | 'ERR' => {
  const n = norm(v); if (!n) return null;
  return opz[n] ?? 'ERR';
};
const CATEGORIE = { tecnico: 'TEC', tec: 'TEC', tecnici: 'TEC', ufficio: 'UFFICIO', impiegato: 'UFFICIO', magazzino: 'MAGAZZINO', magazziniere: 'MAGAZZINO', altro: 'ALTRO' };
const CONTRATTI = { fulltime: 'full-time', tempopieno: 'full-time', parttime: 'part-time', tempoparziale: 'part-time' };
const PROPRIETA = { proprieta: 'proprieta', diproprieta: 'proprieta', noleggio: 'noleggio', nolo: 'noleggio', leasing: 'leasing' };
const ALIM = { benzina: 'benzina', diesel: 'diesel', gasolio: 'diesel', gpl: 'gpl', metano: 'metano', elettrica: 'elettrica', elettrico: 'elettrica',
  ibridabenzina: 'ibrida_benzina', ibrida: 'ibrida_benzina', ibridadiesel: 'ibrida_diesel' };
const SI = { si: true, s: true, yes: true, x: true, '1': true, vero: true, attivo: true, no: false, n: false, '0': false, falso: false, cessato: false };

/** Valida e converte una riga. `esistenti`: email già usate da altri codici (minuscolo → codice). */
export function validaRiga(tipo: Tipo, grezzi: Record<string, unknown>, riga: number): RigaImport {
  const e: string[] = []; const v: Valori = {};
  const txt = (k: string) => { const s = String(grezzi[k] ?? '').trim(); return s === '' ? null : s; };
  const data = (k: string, nome: string) => { const d = dataIt(grezzi[k]); if (d === 'ERR') e.push(`${nome}: data non valida (usa gg/mm/aaaa)`); else v[k] = d; };
  for (const c of COLONNE[tipo]) if (c.obbl && !txt(c.k)) e.push(`${c.titolo} obbligatorio`);
  if (tipo === 'dipendenti') {
    const cod = (txt('codice') ?? '').toUpperCase().replace(/\s+/g, '');
    if (cod && !/^[A-Z0-9]{2,12}$/.test(cod)) e.push('Codice: solo lettere/numeri, da 2 a 12'); v.codice = cod;
    v.nome = txt('nome'); v.cognome = txt('cognome'); v.ruolo = txt('ruolo'); v.reparto = txt('reparto'); v.telefono = txt('telefono');
    const cat = scelta(grezzi.categoria, CATEGORIE); if (cat === 'ERR') e.push('Categoria: usa Tecnico, Ufficio, Magazzino o Altro'); else if (cat) v.categoria = cat;
    const em = txt('email')?.toLowerCase() ?? null; if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) e.push('Email non valida'); v.email = em;
    const sg = txt('sigla')?.toUpperCase().replace(/\s+/g, '') ?? null; if (sg && !/^[A-Z0-9]{2,10}$/.test(sg)) e.push('Sigla zona non valida'); v.sigla = sg;
    const ct = scelta(grezzi.contratto, CONTRATTI); if (ct === 'ERR') e.push('Contratto: Full-time o Part-time'); else v.contratto = ct;
    const ore = numeroIt(grezzi.ore_giornaliere); if (ore != null && !(ore > 0 && ore <= 12)) e.push('Ore al giorno: da 1 a 12'); v.ore_giornaliere = ore ?? 8;
    const gr = giorniRiposo(grezzi.giorni_riposo); if (gr === 'ERR') e.push('Giorni di riposo: es. "Sab, Dom"'); else v.giorni_riposo = gr;
    v.patente_categoria = txt('patente_categoria')?.toUpperCase() ?? null;
    data('data_assunzione', 'Data assunzione'); data('patente_scadenza', 'Scadenza patente');
    const at = scelta(grezzi.attivo, SI as unknown as Record<string, string>) as unknown; if (at === 'ERR') e.push('Attivo: Sì o No'); else v.attivo = at == null ? true : Boolean(at);
  } else {
    const tg = (txt('targa') ?? '').toUpperCase().replace(/[\s-]+/g, '');
    if (tg && !/^[A-Z0-9]{5,10}$/.test(tg)) e.push('Targa non valida'); v.targa = tg;
    v.marca_modello = txt('marca_modello'); v.tipo = txt('tipo'); v.note = txt('note');
    const pr = scelta(grezzi.proprieta, PROPRIETA); if (pr === 'ERR') e.push('Proprietà: Proprietà, Noleggio o Leasing'); else v.proprieta = pr;
    const al = scelta(grezzi.alimentazione, ALIM); if (al === 'ERR') e.push('Alimentazione non riconosciuta'); else v.alimentazione = al;
    const cap = numeroIt(grezzi.capacita_serbatoio); if (cap != null && !(cap > 0 && cap < 1000)) e.push('Serbatoio non valido'); v.capacita_serbatoio = cap;
    for (const [k, nome] of [['km_attuali', 'Km attuali'], ['km_prossimo_tagliando', 'Km prossimo tagliando']] as const) {
      const n = numeroIt(grezzi[k]); if (n != null && !(Number.isInteger(n) && n >= 0)) e.push(`${nome}: numero intero`); v[k] = n;
    }
    data('scad_assicurazione', 'Scadenza assicurazione'); data('scad_revisione', 'Scadenza revisione'); data('scad_bollo', 'Scadenza bollo');
  }
  return { riga, valori: v, errori: e };
}

/** Valida tutte le righe + duplicati nel file (codice/targa, email) e email già usate da altri codici in archivio. */
export function validaTutto(tipo: Tipo, mat: unknown[][], emailEsistenti: Record<string, string> = {}): { righe: RigaImport[]; mancaChiave: boolean } {
  const { mappa, righe } = leggiMatrice(mat, tipo);
  if (!Object.values(mappa).includes(CHIAVE[tipo])) return { righe: [], mancaChiave: true };
  const out = righe.map(r => {
    const g: Record<string, unknown> = {};
    for (const [i, k] of Object.entries(mappa)) g[k] = r.celle[Number(i)];
    return validaRiga(tipo, g, r.riga);
  });
  const chiave = CHIAVE[tipo]; const visti = new Map<string, number>(); const email = new Map<string, number>();
  for (const r of out) {
    const k = String(r.valori[chiave] ?? '');
    if (k) { if (visti.has(k)) r.errori.push(`${chiave === 'codice' ? 'Codice' : 'Targa'} ripetuto (riga ${visti.get(k)})`); else visti.set(k, r.riga); }
    const em = r.valori.email ? String(r.valori.email) : '';
    if (em) {
      if (email.has(em)) r.errori.push(`Email ripetuta (riga ${email.get(em)})`); else email.set(em, r.riga);
      const altro = emailEsistenti[em]; if (altro && altro !== k) r.errori.push(`Email già usata da ${altro}`);
    }
  }
  return { righe: out, mancaChiave: false };
}
