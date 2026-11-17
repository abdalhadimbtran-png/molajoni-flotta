// report-direzione: Report Direzione settimanale/mensile (PDF + email HTML via Resend).
// Azioni (POST JSON):
//   {azione:'pianificato', tipo, rif}  → da pg_cron (intestazione x-email-secret): invia agli iscritti, idempotente (report_direzione_prenota)
//   {azione:'scarica', tipo, rif?}     → utente admin/direzione (JWT): restituisce il PDF
//   {azione:'prova', tipo}             → solo admin (JWT): invia subito il report all'email dell'admin
// verify_jwt = false: l'autenticazione è fatta qui (segreto email oppure JWT dell'utente).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as PDFLib from 'npm:pdf-lib@1.17.1';
import { emailHtml, generaPdf, type Report } from './render.ts';

const SITO = 'https://molajoni-flotta.vercel.app';
const LOGO = `${SITO}/logo-molajoni.png`;
const LINK = `${SITO}/direzione/centralino`;
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

let logoCache: Uint8Array | null | undefined;
async function logo() {
  if (logoCache !== undefined) return logoCache;
  try { const r = await fetch(LOGO); logoCache = r.ok ? new Uint8Array(await r.arrayBuffer()) : null; } catch { logoCache = null; }
  return logoCache;
}
const b64 = (u: Uint8Array) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };

// deno-lint-ignore no-explicit-any
async function invia(db: any, a: string, r: Report, pdf: Uint8Array, categoria: string) {
  const e = emailHtml(r, LINK, LOGO);
  const allegati = [{ nome: r.periodo.file, byte: pdf.length }];
  const base = { destinatario: a, oggetto: e.oggetto, html: e.html, testo: e.testo, allegati, dati: { categoria, periodo: r.periodo.chiave, tipo: r.periodo.tipo } };
  const chiave = Deno.env.get('RESEND_API_KEY');
  // tentativi = 5: la coda generica (notifica-email) non deve ritentare queste righe senza allegato
  if (!chiave) { await db.from('email_in_uscita').insert({ ...base, stato: 'errore', tentativi: 5, errore: 'RESEND_API_KEY non configurata' }); return { a, ok: false, errore: 'RESEND_API_KEY non configurata' }; }
  const { data: m } = await db.from('impostazioni_portale').select('valore').eq('chiave', 'email_mittente').maybeSingle();
  const mittente = m?.valore || 'Molajoni Portale <onboarding@resend.dev>';
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: mittente, to: [a], subject: e.oggetto, html: e.html, text: e.testo, attachments: [{ filename: r.periodo.file, content: b64(pdf) }] }),
    });
    if (res.ok) {
      await db.from('email_in_uscita').insert({ ...base, stato: 'inviata', tentativi: 1, inviato_il: new Date().toISOString() });
      return { a, ok: true };
    }
    const t = `Resend ${res.status}: ${(await res.text()).slice(0, 400)}`;
    await db.from('email_in_uscita').insert({ ...base, stato: 'errore', tentativi: 5, errore: t });
    return { a, ok: false, errore: t };
  } catch (x) {
    await db.from('email_in_uscita').insert({ ...base, stato: 'errore', tentativi: 5, errore: String(x).slice(0, 400) });
    return { a, ok: false, errore: String(x) };
  }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ errore: 'Metodo non consentito' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!, srv = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const db = createClient(url, srv, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));
  const tipo = body.tipo === 'mese' ? 'mese' : 'settimana';
  const rif = typeof body.rif === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.rif) ? body.rif : null;

  try {
    if (body.azione === 'pianificato') {
      const { data: ok } = await db.rpc('email_segreto_valido', { p: req.headers.get('x-email-secret') ?? '' });
      if (ok !== true) return json({ errore: 'Non autorizzato' }, 401);
      if (!rif) return json({ errore: 'Periodo mancante' }, 400);
      const { data, error } = await db.rpc('report_direzione_prenota', { p_tipo: tipo, p_rif: rif });
      if (error) return json({ errore: error.message }, 500);
      const dest: string[] = data?.destinatari ?? [];
      if (!dest.length) return json({ ok: true, inviate: 0 });
      const r = data.report as Report;
      const pdf = await generaPdf(PDFLib, r, { logo: await logo() });
      const esiti = [];
      for (const a of dest) esiti.push(await invia(db, a, r, pdf, `report_direzione_${tipo}`));
      return json({ ok: true, esiti });
    }

    // Azioni dell'utente: JWT obbligatorio, controlli di ruolo nel database
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth.startsWith('Bearer ')) return json({ errore: 'Non autorizzato' }, 401);
    const utente = createClient(url, anon, { auth: { persistSession: false }, global: { headers: { Authorization: auth } } });
    const { data: u } = await utente.auth.getUser(auth.slice(7));
    if (!u?.user) return json({ errore: 'Non autorizzato' }, 401);
    const { data: rep, error } = await utente.rpc('report_direzione_dati', { p_tipo: tipo, p_rif: rif });
    if (error) return json({ errore: error.message }, 403);
    const r = rep as Report;

    if (body.azione === 'scarica') {
      const pdf = await generaPdf(PDFLib, r, { logo: await logo() });
      return new Response(pdf, { headers: { ...CORS, 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${r.periodo.file}"` } });
    }
    if (body.azione === 'prova') {
      const { data: adm } = await utente.rpc('is_admin');
      if (adm !== true) return json({ errore: 'Solo l\'amministratore può inviare il report di prova' }, 403);
      if (!u.user.email) return json({ errore: 'Il tuo account non ha un indirizzo email' }, 400);
      const pdf = await generaPdf(PDFLib, r, { logo: await logo() });
      const esito = await invia(db, u.user.email.toLowerCase(), r, pdf, 'report_direzione_prova');
      return json({ ok: esito.ok, esito });
    }
    return json({ errore: 'Azione non valida' }, 400);
  } catch (e) {
    return json({ errore: String(e).slice(0, 300) }, 500);
  }
});
