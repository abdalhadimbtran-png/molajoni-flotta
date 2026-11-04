// Logica pura della geocodifica (nessuna rete): validazione dei risultati Nominatim e punto medio della via.
// Usata dalla funzione `geocodifica` (Deno) e testata con vitest (src/lib/interventi/interventi.test.ts).

export interface RisultatoNominatim {
  lat: string; lon: string; display_name?: string; class?: string; type?: string; addresstype?: string;
  address?: Record<string, string | undefined>;
  geojson?: { type: string; coordinates: unknown };
  boundingbox?: [string, string, string, string];
}
export interface Riga { cap: string | null; comune: string | null }
export interface Centro { lat: number; lon: number }

export const RAGGIO_CAP_KM = 3;

export function chiaveLuogo(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function distanzaKm(a: Centro, b: Centro): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nomi di luogo del risultato (città, comune, frazione…), normalizzati. */
function luoghi(x: RisultatoNominatim): string[] {
  const a = x.address ?? {};
  return ["city", "town", "village", "municipality", "hamlet", "suburb", "city_district", "locality", "county"]
    .map(k => chiaveLuogo(a[k])).filter(Boolean);
}

export type Esito = { ok: true; dubbio: boolean; motivo: string } | { ok: false; motivo: string };

/**
 * Il risultato è coerente con la riga? Accettato se il CAP coincide; oppure se il comune coincide
 * ed è entro RAGGIO_CAP_KM dal centro del CAP (se noto). Con solo il comune uguale e nessun centro CAP → accettato ma dubbio.
 */
export function valida(x: RisultatoNominatim, riga: Riga, centroCap: Centro | null): Esito {
  const p = { lat: Number(x.lat), lon: Number(x.lon) };
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return { ok: false, motivo: "coordinate non valide" };
  const pc = (x.address?.postcode ?? "").replace(/\s/g, "").slice(0, 5);
  const comune = chiaveLuogo(riga.comune);
  const comuneOk = !comune || luoghi(x).some(l => l === comune || l.includes(comune) || comune.includes(l));
  const dist = centroCap ? distanzaKm(p, centroCap) : null;
  if (riga.cap && pc === riga.cap) {
    if (dist != null && dist > RAGGIO_CAP_KM * 3) return { ok: false, motivo: `CAP uguale ma a ${dist.toFixed(1)} km dal centro CAP` };
    return { ok: true, dubbio: false, motivo: "CAP corrispondente" };
  }
  if (!comuneOk) return { ok: false, motivo: "comune diverso" };
  if (dist != null) {
    if (dist <= RAGGIO_CAP_KM) return { ok: true, dubbio: false, motivo: `entro ${dist.toFixed(1)} km dal centro CAP` };
    return { ok: false, motivo: `a ${dist.toFixed(1)} km dal centro CAP` };
  }
  return { ok: true, dubbio: true, motivo: "solo comune corrispondente" };
}

export const haCivico = (x: RisultatoNominatim) => Boolean(x.address?.house_number);
export const eStrada = (x: RisultatoNominatim) => x.class === "highway" || x.addresstype === "road" || Boolean(x.address?.road && !x.address?.house_number);

type LL = [number, number]; // [lon, lat] come GeoJSON

/** Tutte le linee (GeoJSON LineString / MultiLineString / Polygon) di un risultato. */
export function linee(x: RisultatoNominatim): LL[][] {
  const g = x.geojson; if (!g) return [];
  if (g.type === "LineString") return [g.coordinates as LL[]];
  if (g.type === "MultiLineString" || g.type === "Polygon") return g.coordinates as LL[][];
  if (g.type === "MultiPolygon") return (g.coordinates as LL[][][]).flat();
  return [];
}

function puntoAMeta(linea: LL[]): Centro | null {
  if (!linea.length) return null;
  if (linea.length === 1) return { lon: linea[0][0], lat: linea[0][1] };
  const seg: number[] = [];
  let tot = 0;
  for (let i = 1; i < linea.length; i++) {
    const d = distanzaKm({ lon: linea[i - 1][0], lat: linea[i - 1][1] }, { lon: linea[i][0], lat: linea[i][1] });
    seg.push(d); tot += d;
  }
  let resto = tot / 2;
  for (let i = 0; i < seg.length; i++) {
    if (resto <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, resto / seg[i]) : 0;
      const [a, b] = [linea[i], linea[i + 1]];
      return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f };
    }
    resto -= seg[i];
  }
  return null;
}

/**
 * Punto medio della via, limitato alla zona del CAP: tiene solo i tratti entro RAGGIO_CAP_KM dal centro del CAP
 * (le vie lunghe come la Tuscolana attraversano molti CAP), poi prende il punto a metà della lunghezza del tratto
 * più lungo rimasto. Senza geometria: centro del riquadro (bounding box) o il punto del risultato.
 */
export function puntoMedioVia(risultati: RisultatoNominatim[], centroCap: Centro | null): Centro | null {
  const tratti: LL[][] = [];
  for (const x of risultati) for (const l of linee(x)) {
    if (!centroCap) { tratti.push(l); continue; }
    // spezza la linea tenendo solo i vertici vicini al centro CAP
    let cur: LL[] = [];
    for (const v of l) {
      if (distanzaKm({ lon: v[0], lat: v[1] }, centroCap) <= RAGGIO_CAP_KM) cur.push(v);
      else { if (cur.length) tratti.push(cur); cur = []; }
    }
    if (cur.length) tratti.push(cur);
  }
  if (tratti.length) {
    const lung = (l: LL[]) => l.slice(1).reduce((s, v, i) => s + distanzaKm({ lon: l[i][0], lat: l[i][1] }, { lon: v[0], lat: v[1] }), 0);
    tratti.sort((a, b) => lung(b) - lung(a) || b.length - a.length);
    return puntoAMeta(tratti[0]);
  }
  // nessuna geometria utile: riquadro o punto del primo risultato vicino al CAP
  for (const x of risultati) {
    const bb = x.boundingbox?.map(Number);
    const c = bb && bb.every(Number.isFinite) ? { lat: (bb[0] + bb[1]) / 2, lon: (bb[2] + bb[3]) / 2 } : { lat: Number(x.lat), lon: Number(x.lon) };
    if (!centroCap || distanzaKm(c, centroCap) <= RAGGIO_CAP_KM) return c;
    const p = { lat: Number(x.lat), lon: Number(x.lon) };
    if (distanzaKm(p, centroCap) <= RAGGIO_CAP_KM) return p;
  }
  return null;
}

/** Chiave della cache: indirizzo normalizzato. */
export function chiaveCache(tipo: string, ...parti: (string | null | undefined)[]): string {
  return `${tipo}|${parti.map(p => chiaveLuogo(p)).join("|")}`;
}
