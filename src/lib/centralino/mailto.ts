/**
 * «Apri in Outlook» con un clic: link mailto (casella di Jennifer) con A/CC/oggetto/testo semplice compilati.
 * - destinatari multipli separati da «;» (Outlook)
 * - testo con a capo CRLF (%0D%0A), tutto con encodeURIComponent
 * - URL entro MAX_MAILTO caratteri: se il testo è troppo lungo il corpo viene accorciato (firma sempre presente),
 *   il testo completo va negli appunti e resta la «Versione formattata (.eml)».
 */
import { AVVISO_EML, firmaFrontOffice, scaricaEml, type Eml } from './emailHtml';
import { firmaOutlookAttiva, formatoEmail } from './preferenze';

export const MAX_MAILTO = 1800;
export const SALUTO_CLIENTE = 'Grazie per la preferenza e distinti saluti';
/** Firma testo dell'operatore collegato; vuota se Outlook aggiunge la firma automatica. */
export const firmaMailto = () => (firmaOutlookAttiva() ? [] : firmaFrontOffice());
const TAGLIO = '[…] Testo completo negli appunti (Ctrl+V).';

const indirizzi = (x: string | string[] | undefined) =>
  (Array.isArray(x) ? x : (x ?? '').split(/[,;\s]+/)).map(s => s.trim()).filter(Boolean);

/**
 * Testo dell'email (versione testo di emailDaModello) → testo semplice pulito per mailto:
 * senza titolo in maiuscolo né firma «--», con chiusura e firma di Jennifer.
 */
export function testoMailto(testo: string): string {
  let r = testo.replace(/\r\n/g, '\n').split('\n');
  if (r.length > 1 && r[0].trim() && r[0] === r[0].toUpperCase() && /[A-ZÀ-Ý]/.test(r[0]) && r[1].trim() === '') r = r.slice(2);
  const sep = r.lastIndexOf('--');
  if (sep >= 0) r = r.slice(0, sep);
  let corpo = r.join('\n').trim();
  const grazie = new RegExp(`${SALUTO_CLIENTE}[.,!]?\\s*$`, 'i').test(corpo) || corpo.includes(SALUTO_CLIENTE);
  corpo = corpo.replace(new RegExp(`\\n*${SALUTO_CLIENTE}[.,!]?\\s*$`, 'i'), '').replace(/\n*(Cordiali|Distinti) saluti[.,!]?\s*$/i, '').trim();
  return [corpo, '', grazie ? SALUTO_CLIENTE : 'Distinti saluti', ...firmaMailto()].join('\n');
}

export interface Mailto { url: string; troncato: boolean; testo: string }

export function costruisciMailto(e: { a: string | string[]; cc?: string | string[]; oggetto: string; testo: string }, max = MAX_MAILTO): Mailto {
  const testo = e.testo.replace(/\r?\n/g, '\r\n');
  const a = indirizzi(e.a).map(encodeURIComponent).join(';');
  const cc = indirizzi(e.cc);
  const url = (corpo: string) => `mailto:${a}?${[
    ...(cc.length ? [`cc=${cc.map(encodeURIComponent).join(';')}`] : []),
    `subject=${encodeURIComponent(e.oggetto)}`, `body=${encodeURIComponent(corpo)}`,
  ].join('&')}`;
  const pieno = url(testo);
  if (pieno.length <= max) return { url: pieno, troncato: false, testo };
  // accorcia il corpo (prima della chiusura) tenendo saluto e firma
  const righe = testo.split('\r\n');
  const n = firmaMailto().length + 1;
  const coda = righe.slice(-n).join('\r\n');
  const testa = righe.slice(0, -n).join('\r\n');
  let lo = 0, hi = testa.length;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (url(`${testa.slice(0, m)}\r\n${TAGLIO}\r\n\r\n${coda}`).length <= max) lo = m; else hi = m - 1; }
  const tagliato = testa.slice(0, lo).replace(/\s+\S*$/, '');
  let u = url(`${tagliato}\r\n${TAGLIO}\r\n\r\n${coda}`);
  if (u.length > max) u = url(TAGLIO);
  return { url: u, troncato: true, testo };
}

/** Solo testo semplice: apre Outlook (mailto); se accorciato copia il testo completo negli appunti. Ritorna l'avviso. */
export function apriMailto(e: { a: string | string[]; cc?: string | string[]; oggetto: string; testo: string }): string {
  const m = costruisciMailto({ ...e, testo: testoMailto(e.testo) });
  if (m.troncato) { try { void navigator.clipboard?.writeText(m.testo.replace(/\r\n/g, '\n')); } catch { /* il browser può negarlo */ } }
  window.location.href = m.url;
  return avvisoOutlook(m.troncato);
}

/**
 * Pulsante unico «Apri in Outlook»: con formato «Formattata (Outlook)» (predefinito) scarica la bozza .eml
 * (HTML con logo, X-Unsent, senza From: parte dalla casella del PC), con «Testo semplice» usa mailto.
 */
export function apriEmail(e: { a: string | string[]; cc?: string | string[]; oggetto: string; testo: string; html?: string; numero?: string | null }): string {
  if (formatoEmail() === 'html' && e.html) return apriBozza({ ...e, html: e.html });
  return apriMailto(e);
}

export const avvisoOutlook = (troncato: boolean) => troncato
  ? 'Outlook aperto con il testo accorciato: il testo completo è negli appunti (Ctrl+V). Premi Invia.'
  : 'Outlook aperto: controlla e premi Invia.';

/** Bozza formattata .eml (X-Unsent): scarica e restituisce il testo dell'avviso. */
export function apriBozza(e: Eml & { numero?: string | null }): string {
  scaricaEml(e);
  return AVVISO_EML;
}
