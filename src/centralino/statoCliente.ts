import type { StatoCliente } from '../lib/centralino/tipi';

/** Stato cliente nel «Nuovo contatto»: valore, scelta manuale, cliente collegato a cui si riferisce. */
export interface StatoSel { stato: StatoCliente | null; man: boolean; chiave: string | null }
export interface ClienteRif { codice: string | null; nome: string; fonte: string }

export const chiaveCliente = (c: ClienteRif | null | undefined): string | null => c ? `${c.fonte}|${c.codice ?? ''}|${c.nome}` : null;

/**
 * Aggiorna lo stato quando cambia il cliente collegato.
 * - stesso cliente → invariato (la scelta manuale resta)
 * - nuovo cliente collegato → «attivo», scelta manuale azzerata
 * - cliente scollegato → «nuovo» se non scelto a mano, altrimenti invariato
 */
export function statoPerCliente(s: StatoSel, c: ClienteRif | null | undefined): StatoSel {
  const k = chiaveCliente(c);
  if (k === s.chiave) return s;
  if (k) return { stato: 'attivo', man: false, chiave: k };
  return s.man ? { ...s, chiave: null } : { stato: 'nuovo', man: false, chiave: null };
}
