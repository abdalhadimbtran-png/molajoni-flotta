// Molajoni · geocodifica degli interventi importati (coordinate salvate nel DB, una volta sola).
// POST {}            → elabora a blocchi (~40 s) gli interventi del Lazio senza posizione → { fatti, rimanenti, esiti }
// POST { ids }       → solo quelli
// POST { diagnosi }  → (senza login) stato HTTP dei fornitori per un indirizzo di prova; nessun dato del DB
// Fornitori: Photon (primo) poi Nominatim. Se entrambi non rispondono → { errore_servizio } e le righe NON vengono segnate:
// il portale passa alla geocodifica dal browser. Solo responsabile flotta / amministratore (controllo interno).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { catena, ErroreServizio, geocodificaRiga, nominatim, photon, type Cache, type Geo, type RigaGeo } from "./valida.ts";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const INIT = { headers: { "User-Agent": "MolajoniPortale/1.0 (gestione interventi; https://molajoni-flotta.vercel.app)", Accept: "application/json", Referer: "https://molajoni-flotta.vercel.app/" } };
const BUDGET_MS = 40_000;

const cache: Cache = {
  async leggi(k) { const { data } = await db.from("geocache").select("dettaglio").eq("chiave", k).maybeSingle(); return data ? (data.dettaglio as Geo[]) ?? [] : undefined; },
  async scrivi(k, v) { await db.from("geocache").upsert({ chiave: k, dettaglio: v.slice(0, 6) }); },
};

async function diagnosi() {
  const out: Record<string, unknown> = {};
  const q = { tipo: "indirizzo" as const, via: "Via del Corso", civico: "1", cap: "00186", comune: "Roma" };
  for (const f of [photon(fetch, INIT), nominatim(fetch, INIT)]) {
    const t0 = Date.now();
    try { const r = await f.cerca(q); out[f.nome] = { ok: true, risultati: r.length, primo: r[0] ? { postcode: r[0].postcode, tipo: r[0].tipo } : null, ms: Date.now() - t0 }; }
    catch (e) { out[f.nome] = { ok: false, errore: (e as Error).message, stato: (e as ErroreServizio).stato ?? null, ms: Date.now() - t0 }; }
  }
  return out;
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ errore: "Metodo non consentito" }, 405);
  const body = await req.json().catch(() => ({})) as { ids?: number[]; diagnosi?: boolean };
  if (body.diagnosi) return json(await diagnosi());

  const utente = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false } });
  const { data: ok } = await utente.rpc("is_responsabile");
  if (ok !== true) return json({ errore: "Non autorizzato" }, 403);

  const inizio = Date.now();
  let q = db.from("interventi_importati").select("id,via,civico_geo,cap,comune,prov").eq("fuori_lazio", false).is("eliminato_at", null).order("id").limit(60);
  q = body.ids?.length ? q.in("id", body.ids.slice(0, 200)) : q.is("lat", null).is("geo_tentato_at", null);
  const { data: righe, error } = await q;
  if (error) return json({ errore: error.message }, 500);
  const fornitore = catena([photon(fetch, INIT), nominatim(fetch, INIT)]);
  let fatti = 0; let errore_servizio: string | null = null; const esiti: Record<string, number> = {};
  for (const r of (righe ?? []) as (RigaGeo & { id: number })[]) {
    if (Date.now() - inizio > BUDGET_MS) break;
    try {
      const e = await geocodificaRiga(r, fornitore, cache);
      const ora = new Date().toISOString();
      await db.from("interventi_importati").update(e ? { ...e, geo_tentato_at: ora } : { geo_tentato_at: ora }).eq("id", r.id);
      fatti++; const k = e?.geo_qualita ?? "non_trovato"; esiti[k] = (esiti[k] ?? 0) + 1;
    } catch (err) {
      // errore del servizio: la riga resta da fare (geo_tentato_at non si tocca)
      errore_servizio = err instanceof ErroreServizio ? err.message : `Errore: ${String(err).slice(0, 200)}`;
      console.error("geocodifica", r.id, errore_servizio);
      break;
    }
  }
  const { count } = await db.from("interventi_importati").select("id", { count: "exact", head: true }).eq("fuori_lazio", false).is("eliminato_at", null).is("lat", null).is("geo_tentato_at", null);
  return json({ fatti, rimanenti: count ?? 0, esiti, errore_servizio });
});
