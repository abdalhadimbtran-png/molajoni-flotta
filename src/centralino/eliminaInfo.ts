/** Eliminazione contatti informativi (solo admin) — regole pure, testabili. */
import { fmtOra } from '../lib/format';
export { PAROLA_ELIMINA, MAX_ELIMINA, MOTIVO_PREDEFINITO, confermaElimina, motivoElimina, rpcMancante, aBlocchi } from './eliminaPratiche';
export interface InfoDaEliminare { id: number; at: string; canale: string; nota: string | null }
/** Mostrare i comandi di eliminazione: admin reale, non in «vedi come». */
export const puoEliminareInfo = (admin: boolean | undefined, vista: boolean) => !!admin && !vista;
/** Stato della casella «Tutte» rispetto agli id visibili. */
export function statoTutte(visibili: number[], sel: Set<number>): 'tutte' | 'alcune' | 'nessuna' {
  const n = visibili.filter(i => sel.has(i)).length;
  return n === 0 ? 'nessuna' : n === visibili.length ? 'tutte' : 'alcune';
}
export function cambiaTutte(visibili: number[], sel: Set<number>): Set<number> {
  return statoTutte(visibili, sel) === 'tutte' ? new Set() : new Set(visibili);
}
export const rigaAnteprima = (x: InfoDaEliminare, nome: (c: string) => string) => `${fmtOra(x.at)} · ${nome(x.canale)} · ${x.nota?.trim() || '—'}`;
