// Molajoni · Gestione flotta — funzione server
// /push      (chiamata dal database) invia la notifica push ai telefoni iscritti
// /foto      (app tecnico) carica una foto su una segnalazione propria
// /documento (app tecnico) restituisce un link temporaneo a un documento del veicolo
// Le chiavi stanno nella tabella privata config_privata, letta con la chiave di servizio.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

let cfg: Record<string, string> | null = null;
async function config() {
  if (cfg) return cfg;
  const { data, error } = await db.from("config_privata").select("chiave,valore");
  if (error) throw error;
  cfg = Object.fromEntries(data.map((r: { chiave: string; valore: string }) => [r.chiave, r.valore]));
  webpush.setVapidDetails(cfg.vapid_subject, cfg.vapid_public, cfg.vapid_private);
  return cfg;
}

const CAT: Record<string, [string, string]> = {
  guasto_meccanico: ["Guasto meccanico", "عطل ميكانيكي"], spia_accesa: ["Spia accesa", "ضوء تحذير"], pneumatici: ["Pneumatici", "الإطارات"],
  danno_carrozzeria: ["Danno carrozzeria", "ضرر في الهيكل"], incidente: ["Incidente", "حادث"], dotazioni: ["Dotazioni di bordo", "تجهيزات السيارة"],
  pulizia: ["Pulizia", "النظافة"], altro: ["Altro", "أخرى"],
};
function giorno(d: string, ar: boolean) {
  const [y, m, g] = d.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, g, 12)).toLocaleDateString(ar ? "ar-u-nu-latn" : "it-IT", { weekday: "long", day: "2-digit", month: "2-digit", timeZone: "UTC" });
}
// deno-lint-ignore no-explicit-any
function testo(tipo: string, d: any, lingua: string): { title: string; body: string } {
  const ar = lingua === "ar";
  if (tipo === "piano") {
    const ints = (d.interventi ?? []) as { ora: string | null; luogo: string; attivita: string }[];
    const v = d.veicolo ? `${ar ? "السيارة" : "Veicolo"} ${d.veicolo.targa}` : (ar ? "بدون سيارة مخصصة" : "Nessun veicolo assegnato");
    const primo = ints[0] ? ` · ${ints[0].ora ?? ""} ${ints[0].luogo} — ${ints[0].attivita}` : "";
    const altri = ints.length > 1 ? (ar ? ` (+${ints.length - 1})` : ` (+${ints.length - 1})`) : "";
    if (d.annullato) return { title: ar ? `أُلغيت خطتك ليوم ${giorno(d.data, true)}` : `Piano annullato: ${giorno(d.data, false)}`, body: ar ? "لم يعد لديك مهمات أو سيارة لهذا اليوم." : "Non hai più attività o veicolo per questo giorno." };
    const pre = d.aggiornato ? (ar ? "تم تعديل الخطة · " : "Piano modificato · ") : "";
    return { title: pre + (ar ? `خطة ${giorno(d.data, true)}` : `Piano di ${giorno(d.data, false)}`), body: v + primo + altri };
  }
  if (tipo === "segnalazione_fermo") {
    const c = CAT[d.categoria]?.[ar ? 1 : 0] ?? d.categoria;
    return { title: (ar ? "سيارة متوقفة: " : "Veicolo fermo: ") + d.targa, body: `${c} · ${d.tecnico ?? ""}: ${d.descrizione ?? ""}` };
  }
  if (tipo === "avviso") {
    const pre = d.livello === "urgente" ? (ar ? "🔴 عاجل: " : "🔴 URGENTE: ") : d.livello === "importante" ? (ar ? "⚠️ مهم: " : "⚠️ Importante: ") : "";
    return { title: pre + (d.titolo ?? ""), body: [d.ora, d.luogo, d.testo].filter(Boolean).join(" · ") };
  }
  if (tipo === "segnalazione_risolta") {
    return { title: (ar ? "تم حل المشكلة: " : "Problema risolto: ") + d.targa, body: d.nota ?? "" };
  }
  return { title: ar ? "مواعيد الأسطول" : "Scadenze flotta", body: ar ? `${d.superate} منتهية، ${d.in_scadenza} قريبة` : `${d.superate} superate, ${d.in_scadenza} in scadenza` };
}

function uguali(a: string, b: string) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function push(req: Request) {
  const c = await config();
  if (!uguali(req.headers.get("x-flotta-secret") ?? "", c.push_secret)) return json({ errore: "non autorizzato" }, 401);
  const { id } = await req.json();
  if (!Number.isInteger(id)) return json({ errore: "Richiesta non valida" }, 400);
  const { data: n, error } = await db.from("notifiche").select("*").eq("id", id).single();
  if (error || !n) return json({ errore: "notifica non trovata" }, 404);
  let q = db.from("push_iscrizioni").select("*");
  q = n.tecnico_id ? q.eq("tecnico_id", n.tecnico_id) : q.eq("user_id", n.user_id);
  const { data: iscr } = await q;
  let inviate = 0;
  for (const s of iscr ?? []) {
    const msg = testo(n.tipo, n.dati, s.lingua);
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ ...msg, url: n.link ?? "/", tag: `${n.tipo}-${n.id}`, urgente: n.tipo === "avviso" && n.dati?.livello === "urgente" }), { TTL: 60 * 60 * 24, urgency: n.tipo === "avviso" && n.dati?.livello === "urgente" ? "high" : "normal" });
      inviate++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from("push_iscrizioni").delete().eq("id", s.id);
      else await db.from("push_iscrizioni").update({ ultimo_errore: String((e as Error).message ?? e).slice(0, 300) }).eq("id", s.id);
    }
  }
  return json({ inviate });
}

async function foto(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? ""); const segn = Number(form.get("segnalazione_id"));
  const file = form.get("file");
  if (!(file instanceof File)) return json({ errore: "File mancante" }, 400);
  if (file.size > 8 * 1024 * 1024) return json({ errore: "Foto troppo grande" }, 400);
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return json({ errore: "Formato non supportato" }, 400);
  if (!Number.isInteger(segn) || segn <= 0) return json({ errore: "Richiesta non valida" }, 400);
  const testa = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpg = testa[0] === 0xff && testa[1] === 0xd8 && testa[2] === 0xff;
  const png = testa[0] === 0x89 && testa[1] === 0x50 && testa[2] === 0x4e && testa[3] === 0x47;
  const webp = String.fromCharCode(...testa.slice(0, 4)) === "RIFF" && String.fromCharCode(...testa.slice(8, 12)) === "WEBP";
  if (!(jpg || png || webp)) return json({ errore: "Formato non supportato" }, 400);
  const { data: ok, error } = await db.rpc("tecnico_puo_caricare_foto", { p_token: token, p_segnalazione: segn });
  if (error) return json({ errore: error.message.includes("SESSIONE_NON_VALIDA") ? "SESSIONE_NON_VALIDA" : "Non autorizzato" }, 401);
  if (!ok) return json({ errore: "Non puoi aggiungere altre foto a questa segnalazione." }, 403);
  const est = png ? "png" : webp ? "webp" : "jpg";
  const tipo = png ? "image/png" : webp ? "image/webp" : "image/jpeg";
  const path = `segnalazioni/${segn}/${crypto.randomUUID()}.${est}`;
  const up = await db.storage.from("foto").upload(path, file, { contentType: tipo, upsert: false });
  if (up.error) return json({ errore: "Caricamento non riuscito" }, 500);
  const ins = await db.from("segnalazioni_foto").insert({ segnalazione_id: segn, path });
  if (ins.error) return json({ errore: "Caricamento non riuscito" }, 500);
  return json({ ok: true });
}

async function documento(req: Request) {
  const { token, id, qr } = await req.json();
  if (typeof token !== "string" || typeof qr !== "string" || !Number.isInteger(id)) return json({ errore: "Richiesta non valida" }, 400);
  const { data: path, error } = await db.rpc("tecnico_percorso_documento", { p_token: token, p_id: id, p_qr: qr });
  if (error) return json({ errore: error.message.includes("SESSIONE_NON_VALIDA") ? "SESSIONE_NON_VALIDA" : "Documento non disponibile" }, 401);
  if (!path) return json({ errore: "Documento non trovato" }, 404);
  const s = await db.storage.from("documenti").createSignedUrl(path, 300);
  if (s.error) return json({ errore: "Documento non disponibile" }, 500);
  return json({ url: s.data.signedUrl });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ errore: "metodo non ammesso" }, 405);
  const p = new URL(req.url).pathname;
  try {
    if (p.endsWith("/push")) return await push(req);
    if (p.endsWith("/foto")) return await foto(req);
    if (p.endsWith("/documento")) return await documento(req);
    return json({ errore: "percorso sconosciuto" }, 404);
  } catch (e) {
    console.error(e);
    return json({ errore: "Errore del server" }, 500);
  }
});
