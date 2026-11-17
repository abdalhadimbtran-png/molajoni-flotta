/**
 * Preferenze email per dispositivo (localStorage, sempre in try/catch) e operatore collegato.
 * - formato: 'html' = «Formattata (Outlook)» (.eml, predefinito) | 'testo' = «Testo semplice» (mailto)
 * - firmaOutlook: Outlook aggiunge già la firma automatica → la nostra firma di testo non si mette
 * - operatore: nome ed email dell'account (responsabili) → firma e Reply-To; mai info@
 */
export type FormatoEmail = 'html' | 'testo';
const K_FORMATO = 'ct-formato-email';
const K_FIRMA = 'ct-firma-outlook';
const K_GUIDA = 'ct-eml-guida-vista';

/** copia in memoria: vale anche se lo storage non c'è (finestra privata, test) */
const mem = new Map<string, string | null>();
const leggi = (k: string): string | null => { if (mem.has(k)) return mem.get(k)!; try { return localStorage.getItem(k); } catch { return null; } };
const scrivi = (k: string, v: string | null) => { mem.set(k, v); try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage non disponibile */ } };

export const formatoEmail = (): FormatoEmail => (leggi(K_FORMATO) === 'testo' ? 'testo' : 'html');
export const impostaFormatoEmail = (f: FormatoEmail) => scrivi(K_FORMATO, f);
export const firmaOutlookAttiva = () => leggi(K_FIRMA) === '1';
export const impostaFirmaOutlook = (on: boolean) => scrivi(K_FIRMA, on ? '1' : null);
export const guidaEmlVista = () => leggi(K_GUIDA) === '1';
export const segnaGuidaEmlVista = () => scrivi(K_GUIDA, '1');

export const NOME_FIRMA_DEFAULT = 'J. Marchetti';
export const TELEFONO_AZIENDA = 'tel. 06 6941 4281';
let operatore: { nome: string | null; email: string | null } = { nome: null, email: null };
const emailValida = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim()) && !/^info@/i.test(s.trim());
export function impostaOperatore(o: { nome?: string | null; email?: string | null }) {
  operatore = { nome: o.nome?.trim() || null, email: emailValida(o.email) ? o.email!.trim() : null };
}
export const nomeOperatore = () => operatore.nome || NOME_FIRMA_DEFAULT;
export const emailOperatore = () => operatore.email;

/** Toglie info@… dalla firma configurata (righe o pezzi «· info@molajoni.it»). */
export const pulisciFirma = (s: string) => s.split('\n')
  .map(r => r.replace(/\s*[·|,-]?\s*(e-?mail:?\s*)?info@molajoni\.it\s*/gi, ' ').replace(/\s+·\s*$/, '').trim())
  .filter(Boolean).join('\n');
