/** «Informazione»: 3 esiti del passo (0083). L'esito resta in pratiche_eventi (tipo 'stato', dati.esito_info, dati.assegnato_nome). */
export type EsitoInfo = 'voce' | 'email' | 'girata';
export const ESITI_INFO: { v: EsitoInfo; l: string; d: string }[] = [
  { v: 'voce', l: 'Risposto a voce', d: 'Chiude subito, nessuna email' },
  { v: 'email', l: 'Risposto via email', d: 'Email al cliente e chiude' },
  { v: 'girata', l: 'Girata a un responsabile', d: 'Email al responsabile e chiude' },
];
export const TEMPLATE_RISPOSTA = 'risposta_informazione';

const emailOk = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
/** Errore bloccante dell'esito scelto (lato browser; la stessa regola è in privato.ct_mancanti). */
export function erroreEsito(esito: EsitoInfo | null, p: { email?: string | null }, referente?: string | null): string | null {
  if (!esito) return 'Scegli l\'esito: 1 a voce, 2 via email, 3 girata.';
  if (esito === 'email' && !emailOk(p.email)) return 'Manca l\'email del cliente: aggiungila nei dati della pratica oppure scegli «Risposto a voce» (1).';
  if (esito === 'girata' && !referente?.trim()) return 'Scegli il responsabile.';
  return null;
}

export interface ContoEsiti { voce: number; email: number; girata: number; perReferente: Record<string, number> }
/** Conteggio per KPI/Direzione dagli eventi del periodo. */
export function contaEsitiInfo(eventi: { tipo: string; dati?: Record<string, unknown> | null }[]): ContoEsiti {
  const c: ContoEsiti = { voce: 0, email: 0, girata: 0, perReferente: {} };
  for (const e of eventi) {
    const x = e.tipo === 'stato' ? e.dati?.esito_info : undefined;
    if (x !== 'voce' && x !== 'email' && x !== 'girata') continue;
    c[x]++;
    if (x === 'girata') { const n = String(e.dati?.assegnato_nome ?? '').trim() || '—'; c.perReferente[n] = (c.perReferente[n] ?? 0) + 1; }
  }
  return c;
}
