/**
 * Email «premium» del Centralino (stile Apple Light, solo CSS inline, layout a tabelle sicuro per Outlook desktop)
 * e bozza .eml (X-Unsent: 1) che Outlook apre come messaggio pronto da inviare.
 */
export const LOGO_URL = 'https://molajoni-flotta.vercel.app/logo-molajoni.png';
export const ROSSO = '#E30613';

export type FirmaTipo = 'front_office' | 'tmq' | 'nessuna';
export interface FirmaDati { nome?: string }

export const FIRMA_FRONT_OFFICE = ['Jennifer Marchetti', 'Front office', 'Molajoni Antincendi s.r.l. · dal 1930', 'tel. 06 6941 4281 · info@molajoni.it'];
export const firmaRighe = (tipo: FirmaTipo, f: FirmaDati = {}): string[] =>
  tipo === 'nessuna' ? []
    : tipo === 'tmq' ? [f.nome || 'Il TMQ', 'TMQ – Tecnico Manutentore Qualificato dal Corpo Nazionale dei Vigili del Fuoco', 'Molajoni Antincendi s.r.l. · dal 1930', 'tel. 06 6941 4281 · info@molajoni.it']
    : FIRMA_FRONT_OFFICE;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
/** Valori vuoti o segnaposto non compilati: la riga dei dati non si mostra. */
export const valoreVuoto = (v: string) => { const t = v.replace(/<[^>]+>/g, '').trim(); return !t || t === '—' || t === '-' || /\{[a-z_]+\}/.test(t); };

export interface EmailInput {
  titolo: string;
  /** coppie [etichetta, valore] già compilate (testo semplice) */
  dati?: [string, string][];
  /** corpo HTML semplice (p, b, br, a) */
  corpoHtml: string;
  firma?: FirmaTipo;
  firmaDati?: FirmaDati;
  /** email interna: etichetta «Centralino · uso interno» */
  interna?: boolean;
}

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

export function costruisciEmailHtml(e: EmailInput): string {
  const dati = (e.dati ?? []).filter(([, v]) => !valoreVuoto(v));
  const righe = dati.map(([k, v], i) => `<tr><td style="padding:9px 14px;border-top:${i ? '1px solid #ececf0' : '0'};font:13px/1.4 ${FONT};color:#6e6e73;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:9px 14px;border-top:${i ? '1px solid #ececf0' : '0'};font:600 14px/1.4 ${FONT};color:#1d1d1f;vertical-align:top">${esc(v).replace(/\n/g, '<br>')}</td></tr>`).join('');
  const blocco = righe ? `<tr><td style="padding:4px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#f5f5f7;border-radius:10px">${righe}</table></td></tr>` : '';
  const f = firmaRighe(e.firma ?? 'front_office', e.firmaDati);
  const firma = f.length ? `<tr><td style="padding:8px 32px 28px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-left:3px solid ${ROSSO};padding:2px 0 2px 12px;font:13px/1.5 ${FONT};color:#6e6e73"><b style="color:#1d1d1f;font-size:14px">${esc(f[0])}</b><br>${f.slice(1).map(esc).join('<br>')}</td></tr></table></td></tr>` : '';
  const etichetta = e.interna ? 'CENTRALINO · USO INTERNO' : 'MOLAJONI ANTINCENDI · DAL 1930';
  return `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(e.titolo)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #e5e5ea;border-radius:14px">
<tr><td style="padding:24px 32px 18px"><img src="${LOGO_URL}" width="150" alt="Molajoni Antincendi" style="display:block;width:150px;height:auto;border:0"></td></tr>
<tr><td style="padding:0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td height="3" style="height:3px;line-height:3px;font-size:0;background:${ROSSO}">&nbsp;</td></tr></table></td></tr>
<tr><td style="padding:20px 32px 4px;font:600 11px/1.4 ${FONT};letter-spacing:.12em;color:${ROSSO}">${etichetta}</td></tr>
<tr><td style="padding:0 32px 16px;font:700 22px/1.3 ${FONT};color:#1d1d1f">${esc(e.titolo)}</td></tr>
${blocco}
<tr><td style="padding:12px 32px 8px;font:15px/1.6 ${FONT};color:#1d1d1f">${e.corpoHtml}</td></tr>
${firma}
</table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px"><tr><td style="padding:14px 32px;font:11px/1.5 ${FONT};color:#8e8e93;text-align:center">Molajoni Antincendi s.r.l. · Roma · tel. 06 6941 4281 · info@molajoni.it</td></tr></table>
</td></tr></table></body></html>`;
}

/** Da HTML semplice a testo (senza DOM: funziona anche nei test). */
export function htmlInTesto(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|h\d)>/gi, '\n').replace(/<\/td>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map(r => r.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function costruisciEmailTesto(e: EmailInput): string {
  const dati = (e.dati ?? []).filter(([, v]) => !valoreVuoto(v)).map(([k, v]) => `${k}: ${v}`);
  const f = firmaRighe(e.firma ?? 'front_office', e.firmaDati);
  return [e.titolo.toUpperCase(), '', ...(dati.length ? [...dati, ''] : []), htmlInTesto(e.corpoHtml), ...(f.length ? ['', '--', ...f] : [])].join('\n');
}

// ---------- .eml (bozza non inviata) ----------
const utf8 = (s: string) => new TextEncoder().encode(s);
function b64(bytes: Uint8Array): string {
  let bin = ''; for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
/** Base64 a righe di 76 caratteri con CRLF. */
const b64Righe = (s: string) => (b64(utf8(s)).match(/.{1,76}/g) ?? []).join('\r\n');
/** RFC 2047 (B) in parole codificate ≤ 75 caratteri, senza spezzare i caratteri UTF-8. */
export function codificaIntestazione(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const parole: string[] = []; let pezzo = '';
  for (const ch of s) {
    if (utf8(pezzo + ch).length > 45) { parole.push(pezzo); pezzo = ''; }
    pezzo += ch;
  }
  if (pezzo) parole.push(pezzo);
  return parole.map(p => `=?UTF-8?B?${b64(utf8(p))}?=`).join('\r\n ');
}
const indirizzi = (x: string | string[] | undefined) => (Array.isArray(x) ? x : (x ?? '').split(/[,;\s]+/)).map(s => s.trim()).filter(Boolean);

export interface Eml { a: string | string[]; cc?: string | string[]; oggetto: string; html: string; testo: string; data?: Date }
export function costruisciEml(e: Eml, confine = `----=_Molajoni_${Math.random().toString(36).slice(2)}`): string {
  const a = indirizzi(e.a), cc = indirizzi(e.cc);
  const testo = e.testo.replace(/\r?\n/g, '\r\n');
  const righe = [
    'X-Unsent: 1',
    ...(a.length ? [`To: ${a.join(', ')}`] : []),
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Subject: ${codificaIntestazione(e.oggetto)}`,
    `Date: ${(e.data ?? new Date()).toUTCString().replace('GMT', '+0000')}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${confine}"`,
    '',
    `--${confine}`,
    'Content-Type: text/plain; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Righe(testo),
    '',
    `--${confine}`,
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: base64',
    '',
    b64Righe(e.html),
    '',
    `--${confine}--`,
    '',
  ];
  return righe.join('\r\n');
}

/** «CT-2026-000012 - PREVENTIVO – Rossi.eml» (caratteri non validi tolti, max ~80). */
export function nomeFileEml(numero: string | null | undefined, oggetto: string): string {
  const breve = oggetto.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70).trim();
  return `${[numero, breve].filter(Boolean).join(' - ') || 'Email'}.eml`;
}

/** Scarica la bozza .eml (si apre in Outlook come messaggio pronto da inviare). */
export function scaricaEml(e: Eml & { numero?: string | null }): string {
  const nome = nomeFileEml(e.numero, e.oggetto);
  const blob = new Blob([costruisciEml(e)], { type: 'message/rfc822' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = nome; link.style.display = 'none';
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return nome;
}

export const AVVISO_EML = 'Bozza pronta: aprila (si apre in Outlook) e premi Invia';
const CHIAVE_SUGG = 'ct-eml-suggerimento-visto';
/** Suggerimento una tantum: in Chrome/Edge «Apri sempre i file di questo tipo». */
export function suggerimentoEml(): string | null {
  try { if (localStorage.getItem(CHIAVE_SUGG)) return null; localStorage.setItem(CHIAVE_SUGG, '1'); } catch { return null; }
  return 'Suggerimento: in Chrome/Edge, dopo il primo download clicca la freccia accanto al file → «Apri sempre i file di questo tipo». Le prossime bozze si apriranno da sole in Outlook.';
}
