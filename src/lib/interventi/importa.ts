/**
 * Lettura del "Listato interventi" esportato da Taylor. Le colonne si cercano per NOME nella riga d'intestazione
 * (non per lettera), così un cambio d'ordine non rompe l'importazione. Logica pura: la lettura del file (SheetJS) è in leggiFile().
 */
import { noteIndirizzo, pulisciIndirizzo } from './indirizzo';

export const PROV_LAZIO = ['RM', 'LT', 'FR', 'VT', 'RI'];
/** Prime due cifre del CAP nel Lazio: 00 Roma, 01 Viterbo, 02 Rieti, 03 Frosinone, 04 Latina. */
const CAP_LAZIO = /^0[0-4]\d{3}$/;

export const COLONNE = {
  id: 'ID intervento', tecnico: 'Tecnici attivi', numero: 'Num/serie', del: 'Del', impianto: 'Imp. num/serie',
  codCliente: 'Cod. cli.', cliente: 'Cliente', comune: 'Loc. imp.', cap: 'CAP', prov: 'Prov.', ubicazione: 'Ubicazione',
  componenti: 'Tot. Comp.', tipo: 'Tipo di intervento', famiglie: 'Famiglie servizi',
} as const;
type Chiave = keyof typeof COLONNE;
const OBBLIGATORIE: Chiave[] = ['id', 'numero', 'ubicazione', 'cap', 'comune'];

export interface RigaImport {
  id_intervento: string; numero: string | null; data_riferimento: string | null; tecnico_sigla: string | null;
  impianto: string | null; cod_cliente: string | null; cliente: string | null; comune: string | null; cap: string | null; prov: string | null;
  indirizzo_originale: string | null; via: string | null; civico: string | null; civico_geo: string | null; note: string | null;
  componenti: number | null; tipo: string | null; famiglie: string[]; fuori_lazio: boolean;
  lat: number | null; lon: number | null; // solo se il file ha colonne di coordinate
}
export interface Scartata { riga: number; motivo: string }
export interface Lettura { righe: RigaImport[]; scartate: Scartata[]; mancanti: string[]; mese: string | null }

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const testo = (v: unknown): string | null => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s ? s : null; };

/** CAP sempre di 5 caratteri (Excel toglie gli zeri iniziali: 186 → "00186"). */
export function capTesto(v: unknown): string | null {
  const s = String(v ?? '').trim().replace(/\.0+$/, '');
  if (!/^\d{1,5}$/.test(s)) return null;
  return s.padStart(5, '0');
}

/** "01/11/2026" o data Excel → "2026-11-01". */
export function dataIso(v: unknown): string | null {
  if (v instanceof Date && !isNaN(+v)) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }
  const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (!m) return null;
  const a = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${a}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/** Il punto è nel Lazio? Provincia, oppure (provincia vuota o sbagliata) CAP 00–04. */
export function inLazio(prov: string | null, cap: string | null): boolean {
  const p = (prov ?? '').toUpperCase();
  if (/^[A-Z]{2}$/.test(p)) return PROV_LAZIO.includes(p);
  return cap != null && CAP_LAZIO.test(cap);
}

const ALIAS_LAT = ['lat', 'latitudine', 'latitude', 'lat.'];
const ALIAS_LON = ['lon', 'lng', 'long', 'longitudine', 'longitude', 'lon.'];
const ALIAS_COORD = ['coordinate', 'coordinates', 'coord', 'coordinate gps', 'gps', 'posizione'];

/** Numero con virgola o punto decimale ("41,9" / "41.9"). */
const numero = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v ?? '').trim().replace(',', '.'); if (!s) return null;
  const n = Number(s); return Number.isFinite(n) ? n : null;
};
/** "41.9,12.5" / "41,9; 12,5" / "41.9 12.5" → [lat, lon] in Italia, altrimenti null. */
export function coordinateTesto(v: unknown): [number, number] | null {
  const m = String(v ?? '').trim().match(/^(-?\d{1,2}(?:[.,]\d+)?)\s*[;,\s]\s*(-?\d{1,3}(?:[.,]\d+)?)$/);
  if (!m) return null;
  const a = Number(m[1].replace(',', '.')), b = Number(m[2].replace(',', '.'));
  return coordinateValide(a, b);
}
/** Coordinate plausibili per l'Italia; se invertite (lon, lat) le raddrizza. */
export function coordinateValide(lat: number | null, lon: number | null): [number, number] | null {
  if (lat == null || lon == null) return null;
  const ok = (a: number, b: number) => a >= 35 && a <= 48 && b >= 6 && b <= 19;
  if (ok(lat, lon)) return [lat, lon];
  if (ok(lon, lat)) return [lon, lat];
  return null;
}

/** Trova la riga d'intestazione (quella con "ID intervento") e l'indice di ogni colonna. */
export function trovaIntestazione(m: unknown[][]): { riga: number; indici: Partial<Record<Chiave, number>>; lat?: number; lon?: number; coord?: number } | null {
  for (let r = 0; r < Math.min(m.length, 15); r++) {
    const celle = (m[r] ?? []).map(norm);
    if (!celle.includes(norm(COLONNE.id))) continue;
    const indici: Partial<Record<Chiave, number>> = {};
    for (const k of Object.keys(COLONNE) as Chiave[]) { const i = celle.indexOf(norm(COLONNE[k])); if (i >= 0) indici[k] = i; }
    const trova = (al: string[]) => { const i = celle.findIndex(c => al.includes(c)); return i >= 0 ? i : undefined; };
    return { riga: r, indici, lat: trova(ALIAS_LAT), lon: trova(ALIAS_LON), coord: trova(ALIAS_COORD) };
  }
  return null;
}

/** Matrice di celle (prima riga = riga 1 del foglio) → righe pronte per il database. */
export function leggiMatrice(m: unknown[][]): Lettura {
  const h = trovaIntestazione(m);
  if (!h) return { righe: [], scartate: [], mancanti: [COLONNE.id], mese: null };
  const mancanti = OBBLIGATORIE.filter(k => h.indici[k] == null).map(k => COLONNE[k]);
  if (mancanti.length) return { righe: [], scartate: [], mancanti, mese: null };
  const cella = (r: unknown[], k: Chiave) => (h.indici[k] == null ? null : r[h.indici[k]!]);
  const righe: RigaImport[] = []; const scartate: Scartata[] = [];
  const visti = new Map<string, number>();
  const mesi = new Map<string, number>();
  for (let i = h.riga + 1; i < m.length; i++) {
    const r = m[i] ?? [];
    if (!r.some(c => testo(c))) continue;
    const idGrezzo = cella(r, 'id');
    const id = typeof idGrezzo === 'number' ? String(Math.round(idGrezzo)) : testo(idGrezzo)?.replace(/\.0+$/, '') ?? null;
    if (!id) { scartate.push({ riga: i + 1, motivo: 'ID intervento mancante' }); continue; }
    if (visti.has(id)) { scartate.push({ riga: i + 1, motivo: `ID ${id} ripetuto (riga ${visti.get(id)})` }); continue; }
    visti.set(id, i + 1);
    const cap = capTesto(cella(r, 'cap'));
    let prov = testo(cella(r, 'prov'))?.toUpperCase() ?? null;
    if (prov && !/^[A-Z]{2}$/.test(prov)) prov = null; // es. un CAP finito nella colonna provincia
    const ubic = testo(cella(r, 'ubicazione'));
    const p = pulisciIndirizzo(ubic);
    const comp = Number(String(cella(r, 'componenti') ?? '').replace(',', '.'));
    const data = dataIso(cella(r, 'del'));
    if (data) { const k = data.slice(0, 7); mesi.set(k, (mesi.get(k) ?? 0) + 1); }
    righe.push({
      id_intervento: id,
      numero: testo(cella(r, 'numero'))?.replace(/\/+$/, '') ?? null,
      data_riferimento: data,
      tecnico_sigla: testo(cella(r, 'tecnico'))?.toUpperCase() ?? null,
      impianto: testo(cella(r, 'impianto')),
      cod_cliente: testo(cella(r, 'codCliente'))?.replace(/\.0+$/, '') ?? null,
      cliente: testo(cella(r, 'cliente')),
      comune: testo(cella(r, 'comune'))?.toUpperCase() ?? null,
      cap, prov,
      indirizzo_originale: ubic,
      via: p.via || null, civico: p.civico, civico_geo: p.civicoGeo,
      note: noteIndirizzo(p),
      componenti: Number.isFinite(comp) && String(cella(r, 'componenti') ?? '').trim() !== '' ? Math.round(comp) : null,
      tipo: testo(cella(r, 'tipo')),
      famiglie: (testo(cella(r, 'famiglie')) ?? '').split(',').map(x => x.trim().toUpperCase()).filter(Boolean),
      fuori_lazio: !inLazio(prov, cap),
      ...(() => {
        const c = (h.lat != null && h.lon != null ? coordinateValide(numero(r[h.lat]), numero(r[h.lon])) : null) ?? (h.coord != null ? coordinateTesto(r[h.coord]) : null);
        return { lat: c?.[0] ?? null, lon: c?.[1] ?? null };
      })(),
    });
  }
  const mese = [...mesi.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { righe, scartate, mancanti: [], mese };
}

/** Legge il primo foglio di un file .xlsx (SheetJS, caricato solo quando serve). */
export async function leggiFile(file: File | ArrayBuffer): Promise<Lettura> {
  const XLSX = await import('xlsx');
  const buf = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const m = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true });
  return leggiMatrice(m);
}
