// Geocodifica degli interventi: logica condivisa tra la funzione server (Deno) e il browser (riserva).
// Nessuna dipendenza: i fornitori ricevono la fetch da usare. Test: src/lib/interventi/interventi.test.ts.
// Fornitori: Photon (komoot, accetta richieste dai server) e Nominatim (spesso blocca gli IP dei datacenter).
// Gli errori del servizio (HTTP ≠ 200, rete) lanciano ErroreServizio e NON vanno salvati come "non trovato".

export type LL = [number, number]; // [lon, lat] come GeoJSON
/** Risultato normalizzato, uguale per tutti i fornitori. */
export interface Geo {
  lat: number; lon: number; postcode: string | null; luoghi: string[]; street: string | null; housenumber: string | null;
  tipo: "casa" | "strada" | "altro"; bbox: [number, number, number, number] | null; // [minLat, maxLat, minLon, maxLon]
  linee: LL[][]; fonte?: "photon" | "nominatim";
}
export interface Riga { cap: string | null; comune: string | null }
export interface RigaGeo extends Riga { via: string | null; civico_geo: string | null; prov: string | null }
export interface Centro { lat: number; lon: number }
export interface Query { via?: string | null; civico?: string | null; cap?: string | null; comune?: string | null; prov?: string | null; geometria?: boolean; tipo: "indirizzo" | "cap" | "comune" }
export type Fornitore = { nome: string; cerca: (q: Query) => Promise<Geo[]> };
export type Esito = { lat: number; lon: number; geo_qualita: "esatto" | "via" | "centro_cap" | "centro_comune"; geo_indirizzo: string; geo_dubbio: boolean; geo_fonte: "photon" | "nominatim" };

export class ErroreServizio extends Error {
  constructor(msg: string, public stato: number | null = null) { super(msg); this.name = "ErroreServizio"; }
}

export const RAGGIO_CAP_KM = 3;
const BBOX_LAZIO = "11.4,40.7,14.1,42.9"; // lon min, lat min, lon max, lat max

export function chiaveLuogo(s: string | null | undefined): string {
  return String(s ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function distanzaKm(a: Centro, b: Centro): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------- conversione dei risultati ----------
// deno-lint-ignore no-explicit-any
type Qualsiasi = any;

/** Nominatim (format=jsonv2, addressdetails=1) → Geo. */
export function daNominatim(x: Qualsiasi): Geo {
  const a = x.address ?? {};
  const g = x.geojson;
  let linee: LL[][] = [];
  if (g?.type === "LineString") linee = [g.coordinates];
  else if (g?.type === "MultiLineString" || g?.type === "Polygon") linee = g.coordinates;
  else if (g?.type === "MultiPolygon") linee = g.coordinates.flat();
  const bb = Array.isArray(x.boundingbox) ? x.boundingbox.map(Number) : null;
  return {
    lat: Number(x.lat), lon: Number(x.lon), postcode: a.postcode ? String(a.postcode).replace(/\s/g, "").slice(0, 5) : null,
    luoghi: ["city", "town", "village", "municipality", "hamlet", "suburb", "city_district", "locality", "county"].map(k => chiaveLuogo(a[k])).filter(Boolean),
    street: a.road ?? null, housenumber: a.house_number ?? null,
    tipo: a.house_number ? "casa" : (x.class === "highway" || x.addresstype === "road" ? "strada" : "altro"),
    bbox: bb && bb.length === 4 && bb.every(Number.isFinite) ? [bb[0], bb[1], bb[2], bb[3]] : null, linee, fonte: "nominatim",
  };
}

/** Photon (GeoJSON Feature) → Geo. extent = [minLon, maxLat, maxLon, minLat]. */
export function daPhoton(f: Qualsiasi): Geo {
  const p = f.properties ?? {};
  const [lon, lat] = f.geometry?.coordinates ?? [NaN, NaN];
  const e = Array.isArray(p.extent) ? p.extent.map(Number) : null;
  const strada = p.osm_key === "highway" || p.type === "street";
  return {
    lat: Number(lat), lon: Number(lon), postcode: p.postcode ? String(p.postcode).replace(/\s/g, "").slice(0, 5) : null,
    luoghi: [p.city, p.county, p.district, p.locality, p.type === "city" ? p.name : null].map(chiaveLuogo).filter(Boolean),
    street: p.street ?? (strada ? p.name : null), housenumber: p.housenumber ?? null,
    tipo: p.housenumber ? "casa" : strada ? "strada" : "altro",
    bbox: e && e.length === 4 && e.every(Number.isFinite) ? [e[3], e[1], e[0], e[2]] : null, linee: [], fonte: "photon",
  };
}

// ---------- fornitori ----------
type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Coda per fornitore: almeno `ms` tra due richieste. */
export function limitatore(ms = 1100) {
  let ultima = 0; let coda: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const p = coda.then(async () => {
      const att = ultima + ms - Date.now();
      if (att > 0) await new Promise(r => setTimeout(r, att));
      ultima = Date.now();
      return fn();
    });
    coda = p.catch(() => undefined);
    return p;
  };
}

async function scarica(nome: string, f: Fetch, url: string, init: RequestInit): Promise<Qualsiasi> {
  let r: Response;
  try { r = await f(url, init); } catch (e) { throw new ErroreServizio(`${nome} non raggiungibile (${String((e as Error)?.message ?? e).slice(0, 80)})`); }
  if (!r.ok) throw new ErroreServizio(`${nome} HTTP ${r.status}`, r.status);
  try { return await r.json(); } catch { throw new ErroreServizio(`${nome}: risposta non valida`, r.status); }
}

export function nominatim(f: Fetch, init: RequestInit = {}, coda = limitatore()): Fornitore {
  return {
    nome: "Nominatim",
    cerca: q => coda(async () => {
      const p = new URLSearchParams({ format: "jsonv2", addressdetails: "1", countrycodes: "it", "accept-language": "it", limit: "5" });
      if (q.tipo === "cap") { p.set("postalcode", q.cap ?? ""); p.set("limit", "1"); }
      else if (q.tipo === "comune") { p.set("city", q.comune ?? ""); if (q.prov) p.set("county", q.prov); p.set("limit", "1"); }
      else {
        p.set("street", q.civico ? `${q.civico} ${q.via}` : q.via ?? "");
        if (q.cap) p.set("postalcode", q.cap);
        if (q.comune) p.set("city", q.comune);
        if (q.geometria) { p.set("polygon_geojson", "1"); p.set("polygon_threshold", "0.0001"); }
      }
      const j = await scarica("Nominatim", f, `https://nominatim.openstreetmap.org/search?${p}`, init);
      return (Array.isArray(j) ? j : []).map(daNominatim).filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lon));
    }),
  };
}

export function photon(f: Fetch, init: RequestInit = {}, coda = limitatore()): Fornitore {
  return {
    nome: "Photon",
    cerca: q => coda(async () => {
      const testo = q.tipo === "cap" ? `${q.cap} ${q.comune ?? ""}` : q.tipo === "comune" ? `${q.comune}` : [q.civico ? `${q.via} ${q.civico}` : q.via, q.cap, q.comune].filter(Boolean).join(", ");
      const p = new URLSearchParams({ q: testo.trim(), limit: q.tipo === "indirizzo" ? "6" : "5", bbox: BBOX_LAZIO });
      if (q.tipo === "comune") { p.append("layer", "city"); }
      const j = await scarica("Photon", f, `https://photon.komoot.io/api/?${p}`, init);
      let l = ((j?.features ?? []) as Qualsiasi[]).map(daPhoton).filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lon));
      if (q.tipo === "cap") {
        // centro CAP: media dei risultati con quel CAP
        l = l.filter(g => g.postcode === q.cap);
        if (!l.length) return [];
        const m = { lat: l.reduce((s, g) => s + g.lat, 0) / l.length, lon: l.reduce((s, g) => s + g.lon, 0) / l.length };
        return [{ ...l[0], ...m, tipo: "altro" as const, linee: [], bbox: null }];
      }
      return l;
    }),
  };
}

/**
 * Catena di fornitori: il primo che risponde con risultati vince; se uno risponde vuoto si prova il successivo.
 * Lancia ErroreServizio solo se TUTTI i fornitori sono in errore (così un "non trovato" non è mai un errore di rete).
 */
export function catena(fornitori: Fornitore[]): Fornitore & { errori: string[] } {
  const errori: string[] = [];
  return {
    nome: fornitori.map(f => f.nome).join("+"), errori,
    cerca: async q => {
      let risposto = false; const err: string[] = [];
      for (const f of fornitori) {
        try { const r = await f.cerca(q); risposto = true; if (r.length) return r; }
        catch (e) { if (e instanceof ErroreServizio) { err.push(e.message); continue; } throw e; }
      }
      if (!risposto) { errori.push(...err); throw new ErroreServizio(`Servizio indirizzi non raggiungibile: ${err.join("; ")}`); }
      return [];
    },
  };
}

// ---------- validazione ----------
export type Verifica = { ok: true; dubbio: boolean; motivo: string } | { ok: false; motivo: string };

/** Accettato se il CAP coincide; oppure stesso comune ed entro RAGGIO_CAP_KM dal centro CAP; con solo il comune (centro CAP ignoto) → dubbio. */
export function valida(g: Geo, riga: Riga, centroCap: Centro | null): Verifica {
  if (!Number.isFinite(g.lat) || !Number.isFinite(g.lon)) return { ok: false, motivo: "coordinate non valide" };
  const comune = chiaveLuogo(riga.comune);
  const comuneOk = !comune || g.luoghi.some(l => l === comune || l.includes(comune) || comune.includes(l));
  const dist = centroCap ? distanzaKm(g, centroCap) : null;
  if (riga.cap && g.postcode === riga.cap) {
    if (dist != null && dist > RAGGIO_CAP_KM * 3) return { ok: false, motivo: `CAP uguale ma a ${dist.toFixed(1)} km dal centro CAP` };
    return { ok: true, dubbio: false, motivo: "CAP corrispondente" };
  }
  if (!comuneOk) return { ok: false, motivo: "comune diverso" };
  if (dist != null) return dist <= RAGGIO_CAP_KM ? { ok: true, dubbio: false, motivo: `entro ${dist.toFixed(1)} km dal centro CAP` } : { ok: false, motivo: `a ${dist.toFixed(1)} km dal centro CAP` };
  return { ok: true, dubbio: true, motivo: "solo comune corrispondente" };
}

function puntoAMeta(linea: LL[]): Centro | null {
  if (!linea.length) return null;
  if (linea.length === 1) return { lon: linea[0][0], lat: linea[0][1] };
  const seg: number[] = []; let tot = 0;
  for (let i = 1; i < linea.length; i++) { const d = distanzaKm({ lon: linea[i - 1][0], lat: linea[i - 1][1] }, { lon: linea[i][0], lat: linea[i][1] }); seg.push(d); tot += d; }
  let resto = tot / 2;
  for (let i = 0; i < seg.length; i++) {
    if (resto <= seg[i] || i === seg.length - 1) {
      const f = seg[i] ? Math.min(1, resto / seg[i]) : 0; const [a, b] = [linea[i], linea[i + 1]];
      return { lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f };
    }
    resto -= seg[i];
  }
  return null;
}

/**
 * Punto medio della via limitato alla zona del CAP: tratti di geometria entro RAGGIO_CAP_KM dal centro CAP,
 * punto a metà del tratto più lungo. Senza geometria: centro del riquadro, oppure il punto del risultato.
 */
export function puntoMedioVia(risultati: Geo[], centroCap: Centro | null): Centro | null {
  const tratti: LL[][] = [];
  for (const x of risultati) for (const l of x.linee) {
    if (!centroCap) { tratti.push(l); continue; }
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
  for (const x of risultati) {
    const c = x.bbox ? { lat: (x.bbox[0] + x.bbox[1]) / 2, lon: (x.bbox[2] + x.bbox[3]) / 2 } : { lat: x.lat, lon: x.lon };
    if (!centroCap || distanzaKm(c, centroCap) <= RAGGIO_CAP_KM) return c;
    if (distanzaKm(x, centroCap) <= RAGGIO_CAP_KM) return { lat: x.lat, lon: x.lon };
  }
  return null;
}

export function chiaveCache(tipo: string, ...parti: (string | null | undefined)[]): string {
  return `${tipo}|${parti.map(p => chiaveLuogo(p)).join("|")}`;
}

export function senzaIniziali(v: string): string {
  return v.replace(/(^|\s)(?:[A-Z]\.\s*)+(?=[A-Z][a-z])/g, "$1").replace(/\s+/g, " ").trim();
}

/** Cache: legge/scrive per chiave; `undefined` = non presente. Non si salvano mai gli errori del servizio. */
export interface Cache { leggi(k: string): Promise<Geo[] | undefined>; scrivi(k: string, v: Geo[]): Promise<void> }

/**
 * Geocodifica una riga. Ordine: via+civico → via+solo numero → via senza iniziali → via senza civico (punto medio nel CAP)
 * → centro CAP → centro comune. null = non trovato. Lancia ErroreServizio se il servizio non risponde.
 */
export async function geocodificaRiga(r: RigaGeo, f: Fornitore, cache: Cache): Promise<Esito | null> {
  const cerca = async (k: string, q: Query) => {
    const c = await cache.leggi(k); if (c) return c;
    const v = await f.cerca(q); await cache.scrivi(k, v); return v;
  };
  const cc = r.cap ? (await cerca(chiaveCache("cap", r.cap), { tipo: "cap", cap: r.cap, comune: r.comune }))[0] ?? null : null;
  const centro = cc ? { lat: cc.lat, lon: cc.lon } : null;
  const luogo = [r.cap, r.comune].filter(Boolean).join(" ");
  if (r.via && r.via.length > 2) {
    const varianti = [...new Set([r.via, senzaIniziali(r.via)])];
    const civici = [...new Set([r.civico_geo, r.civico_geo?.match(/^\d+/)?.[0] ?? null].filter(Boolean))] as string[];
    for (const via of varianti) for (const civ of civici) {
      for (const x of await cerca(chiaveCache("via", via, civ, r.cap, r.comune), { tipo: "indirizzo", via, civico: civ, cap: r.cap, comune: r.comune })) {
        const e = valida(x, r, centro);
        if (e.ok && x.tipo === "casa") return { lat: x.lat, lon: x.lon, geo_qualita: "esatto", geo_indirizzo: `${via} ${civ}, ${luogo}`, geo_dubbio: e.dubbio, geo_fonte: x.fonte ?? "photon" };
      }
    }
    for (const via of varianti) {
      const ris = (await cerca(chiaveCache("via_geo", via, null, r.cap, r.comune), { tipo: "indirizzo", via, cap: r.cap, comune: r.comune, geometria: true }))
        .filter(x => x.tipo !== "altro" && valida(x, r, centro).ok && (!x.street || chiaveLuogo(x.street).includes(chiaveLuogo(via).split(" ").pop()!)));
      const p = ris.length ? puntoMedioVia(ris, centro) : null;
      if (p) return { ...p, geo_qualita: "via", geo_indirizzo: `${via}, ${luogo}`, geo_dubbio: !centro, geo_fonte: ris[0].fonte ?? "photon" };
    }
  }
  if (centro) return { lat: centro.lat, lon: centro.lon, geo_qualita: "centro_cap", geo_indirizzo: `CAP ${r.cap}`, geo_dubbio: true, geo_fonte: cc!.fonte ?? "photon" };
  if (r.comune) {
    const c = (await cerca(chiaveCache("comune", r.comune, r.prov), { tipo: "comune", comune: r.comune, prov: r.prov }))[0];
    if (c) return { lat: c.lat, lon: c.lon, geo_qualita: "centro_comune", geo_indirizzo: r.comune, geo_dubbio: true, geo_fonte: c.fonte ?? "photon" };
  }
  return null;
}
