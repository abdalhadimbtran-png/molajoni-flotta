// notifica-email: elabora la coda public.email_in_uscita e invia con Resend.
// Chiamata da pg_net (trigger richieste / email di prova) con l'intestazione x-email-secret (segreto in Vault).
// Senza RESEND_API_KEY le email restano in stato 'in_attesa_configurazione' (nessun errore).
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const LINK = 'https://molajoni-flotta.vercel.app/hr/richieste';
const ROSSO = '#C8102E';
const MAX_TENTATIVI = 5;

type Dati = Record<string, unknown>;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const data = (iso: unknown) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return `${GIORNI[dt.getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
};
const num = (n: unknown) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
const q = (n: unknown, u: unknown) => `${num(n)} ${u === 'ore' ? (Math.abs(Number(n)) === 1 ? 'ora' : 'ore') : (Math.abs(Number(n)) === 1 ? 'giorno' : 'giorni')}`;
const CAT: Record<string, string> = { TEC: 'Tecnico', IMP: 'Impiegato', AMM: 'Amministrazione' };

function righe(d: Dati): [string, string][] {
  const r: [string, string][] = [];
  r.push(['Dipendente', `${d.cognome} ${d.nome}${d.categoria ? ` · ${CAT[String(d.categoria)] ?? d.categoria}` : ''}`]);
  r.push(['Tipo', String(d.tipo)]);
  if (d.ora_inizio) r.push(['Quando', `${data(d.primo)}, dalle ${d.ora_inizio} alle ${d.ora_fine}`]);
  else if (d.mezza) r.push(['Quando', `${data(d.primo)}, ${d.meta === 'pomeriggio' ? 'pomeriggio' : 'mattina'} (mezza giornata)`]);
  else if (d.primo === d.ultimo) r.push(['Quando', data(d.primo)]);
  else r.push(['Periodo', `dal ${data(d.primo)} al ${data(d.ultimo)}`]);
  if (d.rientro) r.push(['Rientro', data(d.rientro)]);
  if (d.quantita != null) r.push(['Quantità', q(d.quantita, d.unita)]);
  if (d.saldo_dopo != null) r.push(['Saldo residuo', `${q(d.saldo_dopo, d.unita)} a fine anno, dopo questa richiesta`]);
  if (d.note) r.push(['Nota del dipendente', String(d.note)]);
  return r;
}

function componi(oggetto: string, d: Dati): { html: string; testo: string } {
  if (d.prova) {
    const t = 'Questa è un\'email di prova del portale Molajoni. Se la ricevi, le notifiche delle richieste di ferie e permessi arriveranno a questo indirizzo.';
    return { testo: t, html: guscio('Email di prova', `<p style="margin:0 0 16px">${esc(t)}</p>`) };
  }
  const rr = righe(d);
  const avviso = Number(d.interventi) > 0
    ? `Attenzione: ${d.interventi} ${Number(d.interventi) === 1 ? 'intervento già pianificato' : 'interventi già pianificati'} in quei giorni (${d.date_interventi}).` : '';
  const testo = [oggetto, '', ...rr.map(([k, v]) => `${k}: ${v}`), ...(avviso ? ['', avviso] : []), '', `Richiesta ${d.numero}`, `Apri la richiesta: ${LINK}`].join('\n');
  const tab = rr.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#6b6b6b;white-space:nowrap;vertical-align:top">${esc(k)}</td><td style="padding:6px 0;color:#1a1a1a">${esc(v)}</td></tr>`).join('');
  const corpo = `<table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.45;margin:0 0 16px">${tab}</table>`
    + (avviso ? `<p style="margin:0 0 16px;padding:10px 12px;background:#fdecee;border-left:3px solid ${ROSSO};color:#7a0b1c">${esc(avviso)}</p>` : '')
    + `<p style="margin:0 0 8px"><a href="${LINK}" style="display:inline-block;background:${ROSSO};color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Apri la richiesta</a></p>`
    + `<p style="margin:12px 0 0;color:#8a8a8a;font-size:12px">Richiesta ${esc(d.numero)}</p>`;
  return { testo, html: guscio(oggetto, corpo) };
}

function guscio(titolo: string, corpo: string) {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-top:4px solid ${ROSSO}">
<tr><td style="padding:20px 24px 4px;font-size:12px;letter-spacing:.08em;color:${ROSSO};font-weight:700">MOLAJONI · UFFICIO PERSONALE</td></tr>
<tr><td style="padding:4px 24px 12px;font-size:18px;font-weight:700;color:#1a1a1a">${esc(titolo)}</td></tr>
<tr><td style="padding:0 24px 24px">${corpo}</td></tr></table></td></tr></table></body></html>`;
}

Deno.serve(async req => {
  const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (req.method !== 'POST') return json({ errore: 'Metodo non consentito' }, 405);
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: ok } = await db.rpc('email_segreto_valido', { p: req.headers.get('x-email-secret') ?? '' });
  if (ok !== true) return json({ errore: 'Non autorizzato' }, 401);

  const { data: righeCoda, error } = await db.from('email_in_uscita')
    .select('id,destinatario,cc,oggetto,html,testo,dati,tentativi,stato')
    .or(`stato.in.(in_coda,in_attesa_configurazione),and(stato.eq.errore,tentativi.lt.${MAX_TENTATIVI})`)
    .not('destinatario', 'is', null).order('id').limit(20);
  if (error) return json({ errore: error.message }, 500);
  if (!righeCoda?.length) return json({ ok: true, elaborate: 0 });

  const chiave = Deno.env.get('RESEND_API_KEY');
  if (!chiave) {
    await db.from('email_in_uscita').update({ stato: 'in_attesa_configurazione', errore: null }).in('id', righeCoda.map(r => r.id));
    return json({ ok: true, stato: 'in_attesa_configurazione', elaborate: righeCoda.length });
  }
  const { data: m } = await db.from('impostazioni_portale').select('valore').eq('chiave', 'email_mittente').maybeSingle();
  const mittente = m?.valore || 'Molajoni Portale <onboarding@resend.dev>';

  let inviate = 0;
  for (const r of righeCoda) {
    const c = r.html ? { html: r.html, testo: r.testo ?? '' } : componi(r.oggetto, (r.dati ?? {}) as Dati);
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chiave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: mittente, to: [r.destinatario], ...(Array.isArray(r.cc) && r.cc.length ? { cc: r.cc } : {}), subject: r.oggetto, html: c.html, text: c.testo }),
      });
      if (res.ok) {
        await db.from('email_in_uscita').update({ stato: 'inviata', html: c.html, testo: c.testo, inviato_il: new Date().toISOString(), errore: null, tentativi: r.tentativi + 1 }).eq('id', r.id);
        inviate++;
      } else {
        const t = (await res.text()).slice(0, 500);
        await db.from('email_in_uscita').update({ stato: 'errore', html: c.html, testo: c.testo, errore: `Resend ${res.status}: ${t}`, tentativi: r.tentativi + 1 }).eq('id', r.id);
      }
    } catch (e) {
      await db.from('email_in_uscita').update({ stato: 'errore', errore: String(e).slice(0, 500), tentativi: r.tentativi + 1 }).eq('id', r.id);
    }
  }
  return json({ ok: true, inviate, elaborate: righeCoda.length });
});
