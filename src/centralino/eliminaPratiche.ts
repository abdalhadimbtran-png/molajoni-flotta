/** Eliminazione definitiva pratiche (solo admin) — regole pure, testabili. */
export const PAROLA_ELIMINA = 'ELIMINA';
export const MAX_ELIMINA = 200;
export const MOTIVO_PREDEFINITO = 'Prova';
export const confermaElimina = (t: string) => t.trim().toUpperCase() === PAROLA_ELIMINA;
export const motivoElimina = (m: string) => m.trim() || MOTIVO_PREDEFINITO;
/** RPC assente (migrazione 0101 non applicata). */
export const rpcMancante = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && /PGRST202|42883|Could not find|does not exist/i.test(`${e.code ?? ''} ${e.message ?? ''}`);
/** Primi numeri da mostrare nella conferma multipla. */
export const anteprimaNumeri = (numeri: string[], n = 5) => numeri.slice(0, n).join(', ') + (numeri.length > n ? ` … (+${numeri.length - n})` : '');
/** Blocchi da al massimo MAX_ELIMINA id. */
export function aBlocchi<T>(v: T[], n = MAX_ELIMINA): T[][] {
  const r: T[][] = []; for (let i = 0; i < v.length; i += n) r.push(v.slice(i, i + n)); return r;
}
