// Molajoni · geocodifica degli interventi importati (una volta sola, coordinate salvate nel DB).
// POST {} → elabora a blocchi (~40 s) gli interventi del Lazio senza posizione; risponde { fatti, rimanenti, esiti }.
// POST { ids: number[] } → solo quelli (anche già tentati). Solo responsabile flotta / amministratore.
// Nominatim: ricerca strutturata, User-Agent dedicato, max 1 richiesta/s, cache in public.geocache.
// Ordine: via+civico → via+solo numero → via senza iniziali → via senza civico (punto medio nel CAP) → centro CAP → centro comune.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { chiaveCache, eStrada, haCivico, puntoMedioVia, valida, type Centro, type RisultatoNominatim } from "./valida.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const UA = "MolajoniPortale/1.0 (gestione interventi; https://molajoni-flotta.vercel.app)";
const BUDGET_MS = 40_000;

let ultima = 0;
async function nominatim(params: Record<string, string>): Promise<RisultatoNominatim[]> {
  const attesa = ultima + 1100 - Date.now();
  if (attesa > 0) await new Promise(r => setTimeout(r, attesa));
  ultima = Date.now();
  const q = new URLSearchParams({ format: "jsonv2", addressdetails: "1", countrycodes: "it", "accept-language": "it", limit: "5", ...params });
  const r = await fetch(`https://nominatim.openstreetmap.org/search?${q}`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 429) throw new Error("limite Nominatim");
  if (!r.ok) throw new Error(`Nominatim ${r.status}`);
  return await r.json();
}

async function cache<T>(chiave: string, fn: () => Promise<T>): Promise<T> {
  const { data } = await db.from("geocache").select("dettaglio").eq("chiave", chiave).maybeSingle();
  if (data) return data.dettaglio as T;
  const v = await fn();
  await db.from("geocache").upsert({ chiave, dettaglio: v as unknown as Record<string, unknown> });
  return v;
}

const primo = (l: RisultatoNominatim[]): Centro | null => l[0] ? { lat: Number(l[0].lat), lon: Number(l[0].lon) } : null;
const centroCap = (cap: string) => cache(chiaveCache("cap", cap), async () => primo(await nominatim({ postalcode: cap, country: "Italia", limit: "1" })));
const centroComune = (c: string, prov: string | null) => cache(chiaveCache("comune", c, prov), async () => primo(await nominatim({ city: c, ...(prov ? { county: prov } : {}), limit: "1" })));
const cercaVia = (via: string, civ: string | null, cap: string | null, comune: string | null, geo = false) =>
  cache(chiaveCache(geo ? "via_geo" : "via", via, civ, cap, comune), () => nominatim({
    street: civ ? `${civ} ${via}` : via, ...(cap ? { postalcode: cap } : {}), ...(comune ? { city: comune } : {}), ...(geo ? { polygon_geojson: "1", polygon_threshold: "0.0001" } : {}),
  }));
// La ricerca strutturata con postalcode è restrittiva: se non trova nulla si riprova senza CAP (la validazione resta).
async function cercaViaLarga(via: string, civ: string | null, cap: string | null, comune: string | null, geo = false) {
  const a = await cercaVia(via, civ, cap, comune, geo);
  return a.length ? a : await cercaVia(via, civ, null, comune, geo);
}

interface Riga { id: number; via: string | null; civico_geo: string | null; cap: string | null; comune: string | null; prov: string | null }
type Esito = { lat: number; lon: number; geo_qualita: string; geo_indirizzo: string; geo_dubbio: boolean } | null;

function senzaIniziali(v: string) { return v.replace(/(^|\s)(?:[A-Z]\.\s*)+(?=[A-Z][a-z])/g, "$1").replace(/\s+/g, " ").trim(); }

async function geocodifica(r: Riga): Promise<Esito> {
  const cc = r.cap ? await centroCap(r.cap) : null;
  const luogo = [r.cap, r.comune].filter(Boolean).join(" ");
  if (r.via && r.via.length > 2) {
    const varianti = [...new Set([r.via, senzaIniziali(r.via)])];
    const civici = [...new Set([r.civico_geo, r.civico_geo?.match(/^\d+/)?.[0] ?? null].filter(Boolean))] as string[];
    for (const via of varianti) for (const civ of civici) {
      for (const x of await cercaViaLarga(via, civ, r.cap, r.comune)) {
        const e = valida(x, r, cc);
        if (e.ok && haCivico(x)) return { lat: Number(x.lat), lon: Number(x.lon), geo_qualita: "esatto", geo_indirizzo: `${via} ${civ}, ${luogo}`, geo_dubbio: e.dubbio };
      }
    }
    for (const via of varianti) {
      const ris = (await cercaViaLarga(via, null, r.cap, r.comune, true)).filter(x => eStrada(x) && valida(x, r, cc).ok);
      const p = ris.length ? puntoMedioVia(ris, cc) : null;
      if (p) return { ...p, geo_qualita: "via", geo_indirizzo: `${via}, ${luogo}`, geo_dubbio: !cc || !r.cap };
    }
  }
  if (cc) return { ...cc, geo_qualita: "centro_cap", geo_indirizzo: `CAP ${r.cap}`, geo_dubbio: true };
  if (r.comune) { const c = await centroComune(r.comune, r.prov); if (c) return { ...c, geo_qualita: "centro_comune", geo_indirizzo: r.comune, geo_dubbio: true }; }
  return null;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405);
  // solo responsabile flotta / amministratore
  const utente = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok } = await utente.rpc("is_responsabile");
  if (ok !== true) return json({ errore: "Non autorizzato" }, 403);

  const body = await req.json().catch(() => ({})) as { ids?: number[] };
  const inizio = Date.now();
  let q = db.from("interventi_importati").select("id,via,civico_geo,cap,comune,prov").eq("fuori_lazio", false).order("id").limit(60);
  q = body.ids?.length ? q.in("id", body.ids.slice(0, 200)) : q.is("lat", null).is("geo_tentato_at", null);
  const { data: righe, error } = await q;
  if (error) return json({ errore: error.message }, 500);
  let fatti = 0, falliti = 0; const esiti: Record<string, number> = {};
  for (const r of (righe ?? []) as Riga[]) {
    if (Date.now() - inizio > BUDGET_MS) break;
    let e: Esito = null;
    try { e = await geocodifica(r); }
    catch (err) { if (String(err).includes("limite")) break; falliti++; }
    await db.from("interventi_importati").update(e ? { ...e, geo_tentato_at: new Date().toISOString() } : { geo_tentato_at: new Date().toISOString() }).eq("id", r.id);
    fatti++; const k = e?.geo_qualita ?? "non_trovato"; esiti[k] = (esiti[k] ?? 0) + 1;
  }
  const { count } = await db.from("interventi_importati").select("id", { count: "exact", head: true }).eq("fuori_lazio", false).is("lat", null).is("geo_tentato_at", null);
  return json({ fatti, falliti, rimanenti: body.ids?.length ? 0 : count ?? 0, esiti });
});
