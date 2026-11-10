/**
 * Costruttore di link mailto per Outlook (invio dalla casella di Jennifer).
 * - destinatari multipli separati da «;» (Outlook)
 * - testo con a capo CRLF (%0D%0A), tutto con encodeURIComponent
 * - URL entro ~1900 caratteri: se il testo è troppo lungo il corpo diventa una riga breve
 *   e il testo completo va copiato negli appunti (`troncato: true`).
 */
export const MAX_MAILTO = 1900;
export const CORPO_BREVE = 'Testo copiato: incolla con Ctrl+V';

const indirizzi = (x: string | string[] | undefined) =>
  (Array.isArray(x) ? x : (x ?? '').split(/[,;\s]+/)).map(s => s.trim()).filter(Boolean);

export interface Mailto { url: string; troncato: boolean; testo: string }

export function costruisciMailto(e: { a: string | string[]; cc?: string | string[]; oggetto: string; testo: string }, max = MAX_MAILTO): Mailto {
  const testo = e.testo.replace(/\r?\n/g, '\r\n');
  const a = indirizzi(e.a).map(encodeURIComponent).join(';');
  const cc = indirizzi(e.cc);
  const parti = (corpo: string) => [
    ...(cc.length ? [`cc=${cc.map(encodeURIComponent).join(';')}`] : []),
    `subject=${encodeURIComponent(e.oggetto)}`, `body=${encodeURIComponent(corpo)}`,
  ].join('&');
  const pieno = `mailto:${a}?${parti(testo)}`;
  if (pieno.length <= max) return { url: pieno, troncato: false, testo };
  return { url: `mailto:${a}?${parti(CORPO_BREVE)}`, troncato: true, testo };
}

/** Apre Outlook; se il testo non entra nel link lo copia negli appunti. Ritorna true se troncato. */
export async function apriOutlook(e: { a: string | string[]; cc?: string | string[]; oggetto: string; testo: string }): Promise<boolean> {
  const m = costruisciMailto(e);
  if (m.troncato) { try { await navigator.clipboard.writeText(e.testo); } catch { /* il browser può negarlo */ } }
  window.location.href = m.url;
  return m.troncato;
}

export const avvisoOutlook = (troncato: boolean) => troncato
  ? 'Outlook aperto. Il testo era lungo: è negli appunti, incollalo nel messaggio con Ctrl+V. Email registrata.'
  : 'Outlook aperto con il messaggio pronto: controlla e premi Invia. Email registrata.';
