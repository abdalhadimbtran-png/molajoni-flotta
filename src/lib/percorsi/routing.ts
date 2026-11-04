/**
 * Fornitore di geocodifica e percorsi. Oggi: Nominatim + OSRM pubblici (server dimostrativi, nessun traffico reale).
 * Per passare a OpenRouteService / Google basta sostituire `geocodifica`, `matrice` e `traccia` mantenendo le firme.
 */
import type { Matrice } from './ottimizza';

export interface Punto { lat: number; lon: number }
export interface Risultato extends Punto { etichetta: string }

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const OSRM = 'https://router.project-osrm.org';
const VIEWBOX_ROMA = '12.23,42.10,12.86,41.65'; // preferenza, non vincolo
const CHIAVE_CACHE = 'molajoni_percorsi_geo_v1';

export class ErroreServizio extends Error {}

// coda: almeno 1,1 s tra due richieste a Nominatim (regola d'uso: 1 richiesta al secondo)
let ultima = 0;
let coda: Promise<unknown> = Promise.resolve();
function inCoda<T>(fn: () => Promise<T>): Promise<T> {
  const p = coda.then(async () => {
    const attesa = ultima + 1100 - Date.now();
    if (attesa > 0) await new Promise(r => setTimeout(r, attesa));
    ultima = Date.now();
    return fn();
  });
  coda = p.catch(() => undefined);
  return p;
}

function leggiCache(): Record<string, Risultato[]> { try { return JSON.parse(localStorage.getItem(CHIAVE_CACHE) || '{}'); } catch { return {}; } }
function scriviCache(c: Record<string, Risultato[]>) {
  try {
    const k = Object.keys(c); if (k.length > 400) for (const x of k.slice(0, k.length - 400)) delete c[x];
    localStorage.setItem(CHIAVE_CACHE, JSON.stringify(c));
  } catch { /* nulla */ }
}

export async function geocodifica(q: string): Promise<Risultato[]> {
  const chiave = q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (chiave.length < 3) return [];
  const cache = leggiCache();
  if (cache[chiave]) return cache[chiave];
  const url = `${NOMINATIM}?format=json&countrycodes=it&limit=5&accept-language=it&viewbox=${VIEWBOX_ROMA}&q=${encodeURIComponent(q)}`;
  let r: Response;
  try { r = await inCoda(() => fetch(url, { headers: { Accept: 'application/json' } })); }
  catch { throw new ErroreServizio('Ricerca indirizzi non raggiungibile. Controlla la rete e riprova.'); }
  if (!r.ok) throw new ErroreServizio(r.status === 429 ? 'Troppe ricerche ravvicinate: attendi qualche secondo.' : 'Ricerca indirizzi non disponibile al momento.');
  const j = await r.json() as { lat: string; lon: string; display_name: string }[];
  const out = j.map(x => ({ lat: Number(x.lat), lon: Number(x.lon), etichetta: x.display_name }));
  cache[chiave] = out; scriviCache(cache);
  return out;
}

const coord = (p: Punto[]) => p.map(x => `${x.lon.toFixed(6)},${x.lat.toFixed(6)}`).join(';');
const cacheMatrici = new Map<string, Matrice>();

export async function matrice(punti: Punto[]): Promise<Matrice> {
  const k = coord(punti);
  const c = cacheMatrici.get(k); if (c) return c;
  let r: Response;
  try { r = await fetch(`${OSRM}/table/v1/driving/${k}?annotations=duration,distance`); }
  catch { throw new ErroreServizio('Servizio percorsi (OSRM) non raggiungibile. Riprova tra qualche minuto.'); }
  if (!r.ok) throw new ErroreServizio('Servizio percorsi (OSRM) non disponibile al momento. Riprova più tardi.');
  const j = await r.json() as { code: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
  if (j.code !== 'Ok' || !j.durations) throw new ErroreServizio('Il servizio percorsi non ha trovato strade tra alcuni indirizzi. Controlla le tappe.');
  const fix = (m: (number | null)[][]) => m.map(r => r.map(v => (v == null ? Infinity : v)));
  const out = { durate: fix(j.durations), distanze: fix(j.distances ?? j.durations.map(r => r.map(() => 0))) };
  cacheMatrici.set(k, out);
  return out;
}

/** Linea del percorso (lat, lon) per la mappa. */
export async function traccia(punti: Punto[]): Promise<[number, number][]> {
  let r: Response;
  try { r = await fetch(`${OSRM}/route/v1/driving/${coord(punti)}?overview=full&geometries=geojson`); }
  catch { throw new ErroreServizio('Traccia del percorso non disponibile.'); }
  if (!r.ok) throw new ErroreServizio('Traccia del percorso non disponibile.');
  const j = await r.json() as { code: string; routes?: { geometry: { coordinates: [number, number][] } }[] };
  if (j.code !== 'Ok' || !j.routes?.length) throw new ErroreServizio('Traccia del percorso non disponibile.');
  return j.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
}

/** Link Google Maps con al massimo 9 tappe intermedie. */
export function linkGoogleMaps(sede: Punto, tappe: Punto[]): string {
  const f = (p: Punto) => `${p.lat},${p.lon}`;
  const w = tappe.slice(0, 9).map(f).join('|');
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${f(sede)}&destination=${f(sede)}${w ? `&waypoints=${encodeURIComponent(w)}` : ''}`;
}

/** Primo risultato per un testo libero: prima dentro Roma (bounded), poi in tutta Italia. */
export async function geocodificaPrimo(q: string): Promise<Risultato | null> {
  const chiave = 'b1:' + q.trim().toLowerCase().replace(/\s+/g, ' ');
  if (chiave.length < 6) return null;
  const cache = leggiCache();
  if (cache[chiave]) return cache[chiave][0] ?? null;
  const url = `${NOMINATIM}?format=json&countrycodes=it&limit=1&accept-language=it&bounded=1&viewbox=${VIEWBOX_ROMA}&q=${encodeURIComponent(q)}`;
  let r: Response;
  try { r = await inCoda(() => fetch(url, { headers: { Accept: 'application/json' } })); }
  catch { throw new ErroreServizio('Ricerca indirizzi non raggiungibile. Controlla la rete e riprova.'); }
  if (!r.ok) throw new ErroreServizio('Ricerca indirizzi non disponibile al momento.');
  const j = await r.json() as { lat: string; lon: string; display_name: string }[];
  let out: Risultato[] = j.map(x => ({ lat: Number(x.lat), lon: Number(x.lon), etichetta: x.display_name }));
  if (!out.length) out = (await geocodifica(q)).slice(0, 1);
  cache[chiave] = out; scriviCache(cache);
  return out[0] ?? null;
}

/** Indirizzo leggibile per un punto (clic o trascinamento sulla mappa). */
export async function indirizzoDi(lat: number, lon: number): Promise<string> {
  const chiave = `rev:${lat.toFixed(5)},${lon.toFixed(5)}`;
  const cache = leggiCache();
  if (cache[chiave]) return cache[chiave][0]?.etichetta ?? '';
  const url = `${NOMINATIM.replace('/search', '/reverse')}?format=json&accept-language=it&zoom=18&lat=${lat}&lon=${lon}`;
  let r: Response;
  try { r = await inCoda(() => fetch(url, { headers: { Accept: 'application/json' } })); }
  catch { throw new ErroreServizio('Ricerca indirizzi non raggiungibile. Controlla la rete e riprova.'); }
  if (!r.ok) throw new ErroreServizio('Ricerca indirizzi non disponibile al momento.');
  const j = await r.json() as { display_name?: string };
  const et = j.display_name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  cache[chiave] = [{ lat, lon, etichetta: et }]; scriviCache(cache);
  return et;
}
