// Molajoni · Gestione flotta — funzione server
// /push      (chiamata dal database) invia la notifica push ai telefoni iscritti
// /foto      (app tecnico) carica una foto su una segnalazione propria
// /documento (app tecnico) restituisce un link temporaneo a un documento del veicolo
// /attestato (app dipendente) link temporaneo a un proprio attestato
// /carica-attestato (app dipendente) carica l'attestato richiesto dal responsabile (da verificare)
// /account   (amministratore) elenco, creazione con invito, link password, pannelli e stato degli account
// /recupero  (pubblico) «Password dimenticata?»: link sicuro via email (Resend), risposta sempre uguale
// Le chiavi stanno nella tabella privata config_privata, letta con la chiave di servizio.
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
import { componiEmail, type Saluto } from "./invito.ts";

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


async function attestato(req: Request) {
  const { token, id } = await req.json().catch(() => ({}));
  if (typeof token !== "string" || !Number.isInteger(id)) return json({ errore: "Richiesta non valida" }, 400);
  const { data: path, error } = await db.rpc("dipendente_percorso_attestato", { p_token: token, p_id: id });
  if (error) return json({ errore: error.message.includes("SESSIONE_NON_VALIDA") ? "SESSIONE_NON_VALIDA" : "Attestato non disponibile" }, 401);
  if (!path) return json({ errore: "Attestato non trovato" }, 404);
  const s = await db.storage.from("attestati").createSignedUrl(path, 120);
  if (s.error) return json({ errore: "Attestato non disponibile" }, 500);
  return json({ url: s.data.signedUrl });
}

async function caricaAttestato(req: Request) {
  const form = await req.formData();
  const token = String(form.get("token") ?? "");
  const id = Number(form.get("richiesta_id"));
  const file = form.get("file");
  if (!(file instanceof File)) return json({ errore: "File mancante" }, 400);
  if (file.size > 10 * 1024 * 1024) return json({ errore: "File troppo grande (massimo 10 MB)." }, 400);
  if (!Number.isInteger(id) || id <= 0) return json({ errore: "Richiesta non valida" }, 400);
  const t = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const asc = String.fromCharCode(...t);
  const tipo = t[0] === 0xff && t[1] === 0xd8 ? "image/jpeg" : t[0] === 0x89 && t[1] === 0x50 ? "image/png"
    : asc.startsWith("%PDF") ? "application/pdf" : asc.slice(4, 8) === "ftyp" && /heic|heix|mif1|heif/.test(asc.slice(8, 12)) ? "image/heic" : null;
  if (!tipo) return json({ errore: "Formato non supportato: usa foto JPG, PNG, HEIC o PDF." }, 400);
  const { data: did, error: e1 } = await db.rpc("dipendente_id_token", { p_token: token });
  if (e1 || !did) return json({ errore: "SESSIONE_NON_VALIDA" }, 401);
  const est = { "image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf", "image/heic": "heic" }[tipo];
  const path = `dip/${did}/${crypto.randomUUID()}.${est}`;
  const up = await db.storage.from("attestati").upload(path, file, { contentType: tipo, upsert: false });
  if (up.error) return json({ errore: "Caricamento non riuscito" }, 500);
  const { error } = await db.rpc("dipendente_carica_attestato", { p_token: token, p_id: id, p_path: path,
    p_nome: (file.name || "attestato").slice(0, 120), p_mime: tipo });
  if (error) { await db.storage.from("attestati").remove([path]); return json({ errore: error.message }, 400); }
  return json({ ok: true });
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SITO = "https://molajoni-flotta.vercel.app";
const PANNELLI = ["admin", "flotta", "hr", "formazione", "centralino", "direzione"] as const;
type Pann = Record<(typeof PANNELLI)[number], boolean>;
const pannelliDa = (x: unknown): Pann => Object.fromEntries(PANNELLI.map(k => [k, !!(x as Record<string, unknown>)?.[k]])) as Pann;
const pannelliDi = (r: Record<string, unknown>) => r.ruolo === "admin" ? ["admin"] : PANNELLI.filter(k => k !== "admin" && r[k]);
const attesa = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Stato leggibile di un'email della coda. In modalità test Resend rifiuta (403) gli indirizzi diversi dal proprietario. */
function statoEmail(r: { stato: string; errore: string | null } | null) {
  if (!r) return "in_coda";
  if (r.stato === "inviata") return "inviata";
  if (r.stato === "errore" && /Resend 403|testing emails|own email|verify a domain/i.test(r.errore ?? "")) return "non_consegnabile_test";
  if (r.stato === "errore") return "errore";
  return "in_coda";
}

/** Link sicuro (invito o recupero) verso la nostra pagina /imposta-password; nessuna email da Supabase. */
async function creaLink(email: string, nome: string, preferisci: "invite" | "recovery") {
  const tenta = async (type: "invite" | "recovery") =>
    // deno-lint-ignore no-explicit-any
    await db.auth.admin.generateLink({ type, email, ...(type === "invite" ? { options: { data: { nome } } } : {}) } as any);
  let tipo = preferisci;
  let r = await tenta(tipo);
  if (r.error && tipo === "invite") { tipo = "recovery"; r = await tenta(tipo); }
  if (r.error || !r.data?.properties?.hashed_token) return { errore: r.error?.message ?? "link non creato" };
  const link = `${SITO}/imposta-password?th=${encodeURIComponent(r.data.properties.hashed_token)}&t=${tipo}`;
  return { link, tipo, user: r.data.user };
}

/** Mette l'email nella coda (notifica-email / Resend), la avvia e aspetta qualche secondo l'esito. */
async function accoda(dest: string, c: { oggetto: string; html: string; testo: string }, dati: Record<string, unknown>) {
  const { data: riga, error } = await db.from("email_in_uscita").insert({ destinatario: dest, oggetto: c.oggetto, html: c.html, testo: c.testo, dati, stato: "in_coda" }).select("id").single();
  if (error || !riga) return { id: null, stato: "errore" };
  await db.rpc("email_avvia_coda");
  let r: { stato: string; errore: string | null } | null = null;
  for (let i = 0; i < 6; i++) {
    await attesa(1200);
    const q = await db.from("email_in_uscita").select("stato,errore").eq("id", riga.id).single();
    r = q.data;
    if (r && r.stato !== "in_coda") break;
  }
  return { id: riga.id, stato: statoEmail(r) };
}

async function inviaLink(r: { user_id: string; nome: string; email: string; ruolo: string } & Record<string, unknown>, preferisci: "invite" | "recovery", saluto?: Saluto) {
  const l = await creaLink(r.email, r.nome, preferisci);
  if ("errore" in l) return { errore: "Link non creato. Riprova tra poco." };
  const c = componiEmail(l.tipo === "invite" ? "invito" : "recupero", { nome: r.nome, email: r.email, link: l.link, saluto, pannelli: pannelliDi(r) });
  const e = await accoda(r.email, c, { tipo: l.tipo === "invite" ? "invito_account" : "recupero_password", user_id: r.user_id });
  return { link: l.link, tipo: l.tipo, oggetto: c.oggetto, testo: c.testo, email: e };
}

/** Pubblico: «Password dimenticata?». Risponde sempre allo stesso modo (non rivela se l'email esiste). */
async function recupero(req: Request) {
  const b = await req.json().catch(() => ({}));
  const email = String(b.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return json({ errore: "Email non valida" }, 400);
  const { data: r } = await db.from("responsabili").select("user_id,nome,email,ruolo,attivo,flotta,hr,formazione,centralino,direzione").ilike("email", email).maybeSingle();
  if (r?.attivo) {
    const dieciMin = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { count } = await db.from("email_in_uscita").select("id", { count: "exact", head: true })
      .eq("destinatario", r.email).gte("creato_il", dieciMin).contains("dati", { tipo: "recupero_password" });
    if ((count ?? 0) < 3) {
      await inviaLink(r, "recovery");
      await db.from("audit_log").insert({ tabella: "account", record_id: r.user_id, azione: "RECUPERO_RICHIESTO", dopo: {}, utente: r.user_id });
    }
  }
  return json({ ok: true });
}

async function account(req: Request) {
  const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: io, error: e1 } = await db.auth.getUser(jwt);
  if (e1 || !io?.user) return json({ errore: "Sessione non valida: accedi di nuovo." }, 401);
  const { data: me } = await db.from("responsabili").select("ruolo,attivo").eq("user_id", io.user.id).maybeSingle();
  if (!me || !me.attivo || me.ruolo !== "admin") return json({ errore: "Accesso riservato all'amministratore" }, 403);
  const b = await req.json().catch(() => ({}));
  const traccia = (azione: string, record: string, dopo: unknown) =>
    db.from("audit_log").insert({ tabella: "account", record_id: record, azione, dopo, utente: io.user.id });
  const COLS = "user_id,nome,email,ruolo,area,dipendente_id,attivo,creato_il,flotta,hr,formazione,centralino,direzione,cambio_password,invitato_il";
  const leggi = async (id: string) => (await db.from("responsabili").select(COLS).eq("user_id", id).maybeSingle()).data;

  if (b.azione === "elenco") {
    const { data: rs, error } = await db.from("responsabili").select(COLS).order("creato_il");
    if (error) return json({ errore: "Errore del server" }, 500);
    const out = [];
    for (const r of rs ?? []) {
      const { data: u } = await db.auth.admin.getUserById(r.user_id);
      const ultimo = u?.user?.last_sign_in_at ?? null;
      const stato = !r.attivo ? "disattivato" : ultimo ? "attivo" : "invitato";
      out.push({ ...r, email: u?.user?.email ?? r.email, ultimo_accesso: ultimo, stato, io: r.user_id === io.user.id });
    }
    return json({ account: out });
  }
  if (b.azione === "crea") {
    const email = String(b.email ?? "").trim().toLowerCase(), nome = String(b.nome ?? "").trim();
    const p = pannelliDa(b.pannelli);
    const saluto: Saluto = ["Benvenuta", "Benvenuto"].includes(b.saluto) ? b.saluto : "Benvenuta/o";
    const dip = b.dipendente_id == null || b.dipendente_id === "" ? null : Number(b.dipendente_id);
    if (!EMAIL.test(email)) return json({ errore: "Email non valida" }, 400);
    if (nome.length < 2 || nome.length > 80) return json({ errore: "Scrivi nome e cognome" }, 400);
    if (!PANNELLI.some(k => p[k])) return json({ errore: "Scegli almeno un pannello" }, 400);
    if (dip !== null && !Number.isInteger(dip)) return json({ errore: "Dipendente non valido" }, 400);
    const { data: gia } = await db.from("responsabili").select("user_id").ilike("email", email).maybeSingle();
    if (gia) return json({ errore: "Esiste già un account con questa email." }, 400);
    const l = await creaLink(email, nome, "invite");
    if ("errore" in l || !l.user) return json({ errore: /already|registered|exists/i.test(("errore" in l && l.errore) || "") ? "Esiste già un account con questa email." : "Creazione account non riuscita" }, 400);
    const uid = l.user.id;
    const riga = {
      user_id: uid, nome, email, attivo: true, ruolo: p.admin ? "admin" : "responsabile",
      flotta: !p.admin && p.flotta, hr: !p.admin && p.hr, area: !p.admin && p.hr ? "hr" : "flotta",
      formazione: !p.admin && p.formazione, centralino: !p.admin && p.centralino, direzione: !p.admin && p.direzione,
      dipendente_id: dip, invitato_il: new Date().toISOString(),
    };
    const ins = await db.from("responsabili").insert(riga);
    if (ins.error) {
      await db.auth.admin.deleteUser(uid);
      return json({ errore: /dipendente/i.test(ins.error.message) ? "Questo dipendente è già collegato a un altro account." : "Creazione account non riuscita" }, 500);
    }
    await traccia("CREA", uid, { email, nome, pannelli: pannelliDi(riga), dipendente_id: dip });
    const c = componiEmail("invito", { nome, email, link: l.link, saluto, pannelli: pannelliDi(riga) });
    const e = await accoda(email, c, { tipo: "invito_account", user_id: uid });
    await traccia("INVITO", uid, { email_id: e.id, stato: e.stato });
    return json({ ok: true, user_id: uid, link: l.link, oggetto: c.oggetto, testo: c.testo, email: e });
  }
  if (b.azione === "invito") {
    // reinvia l'invito (mai entrato) o manda il link per reimpostare la password
    const r = await leggi(String(b.user_id ?? ""));
    if (!r) return json({ errore: "Account non trovato" }, 404);
    if (!r.attivo) return json({ errore: "Account disattivato: riattivalo prima." }, 400);
    const { data: u } = await db.auth.admin.getUserById(r.user_id);
    const mai = !u?.user?.last_sign_in_at;
    const out = await inviaLink(r, mai ? "invite" : "recovery", ["Benvenuta", "Benvenuto"].includes(b.saluto) ? b.saluto : undefined);
    if ("errore" in out) return json({ errore: out.errore }, 400);
    if (mai) await db.from("responsabili").update({ invitato_il: new Date().toISOString() }).eq("user_id", r.user_id);
    await traccia(mai ? "INVITO" : "LINK_PASSWORD", r.user_id, { email_id: out.email.id, stato: out.email.stato });
    return json({ ok: true, ...out });
  }
  if (b.azione === "stato_email") {
    const { data: r } = await db.from("email_in_uscita").select("stato,errore").eq("id", Number(b.id)).maybeSingle();
    return json({ stato: statoEmail(r) });
  }
  if (b.azione === "password") {
    // password temporanea: l'utente deve cambiarla al primo accesso
    const id = String(b.user_id ?? ""), password = String(b.password ?? "");
    if (password.length < 10 || password.length > 72) return json({ errore: "La password deve avere almeno 10 caratteri." }, 400);
    const r = await leggi(id);
    if (!r) return json({ errore: "Account non trovato" }, 404);
    const { error } = await db.auth.admin.updateUserById(id, { password, email_confirm: true });
    if (error) return json({ errore: "Cambio password non riuscito" }, 400);
    const obbligo = b.obbligo !== false && id !== io.user.id;
    await db.from("responsabili").update({ cambio_password: obbligo }).eq("user_id", id);
    await traccia("PASSWORD_TEMPORANEA", id, { cambio_obbligatorio: obbligo });
    return json({ ok: true });
  }
  if (b.azione === "stato") {
    const id = String(b.user_id ?? ""), attivo = b.attivo === true;
    if (id === io.user.id) return json({ errore: "Non puoi modificare il tuo stesso account" }, 400);
    const up = await db.from("responsabili").update({ attivo }).eq("user_id", id).select("user_id");
    if (up.error || !up.data?.length) return json({ errore: "Account non trovato" }, 404);
    // account disattivato: bloccato anche l'accesso (ban, nessuna cancellazione)
    await db.auth.admin.updateUserById(id, { ban_duration: attivo ? "none" : "876000h" });
    await traccia("STATO", id, { attivo });
    return json({ ok: true });
  }
  return json({ errore: "Richiesta non valida" }, 400);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ errore: "metodo non ammesso" }, 405);
  const p = new URL(req.url).pathname;
  try {
    if (p.endsWith("/push")) return await push(req);
    if (p.endsWith("/foto")) return await foto(req);
    if (p.endsWith("/documento")) return await documento(req);
    if (p.endsWith("/carica-attestato")) return await caricaAttestato(req);
    if (p.endsWith("/attestato")) return await attestato(req);
    if (p.endsWith("/account")) return await account(req);
    if (p.endsWith("/recupero")) return await recupero(req);
    return json({ errore: "percorso sconosciuto" }, 404);
  } catch (e) {
    console.error(e);
    return json({ errore: "Errore del server" }, 500);
  }
});
