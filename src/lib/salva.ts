import { useCallback, useEffect, useRef, useState } from 'react';
import { testoErrore } from './supabase';
import { toast } from '../ui';

/**
 * Salvataggio condiviso: un solo invio alla volta, 1 nuovo tentativo sugli errori di rete
 * (fetch fallita, 5xx, timeout — mai su 4xx/validazione), toast d'errore uniforme in italiano.
 * Non tocca mai i dati del form: chi chiama decide cosa fare solo quando `ok` è true.
 */

export const MESSAGGIO_ERRORE = 'Salvataggio non riuscito. Riprova.';

/** `duplicato`: chiamata ignorata perché un salvataggio è già in corso (nessun toast, nessun errore da mostrare). */
export type EsitoSalva<T> =
  | { ok: true; dato: T; duplicato?: false }
  | { ok: false; duplicato: boolean; errore?: unknown; messaggio: string };

export interface OpzioniSalva {
  /** Riprova una volta sugli errori di rete (default true). Usa false per azioni non idempotenti (invio email, avanzamento passo). */
  riprova?: boolean;
  /** Attesa prima del nuovo tentativo, ms (default 800). */
  attesaMs?: number;
  /** Mostra il toast d'errore (default true). */
  toast?: boolean;
}

type ErroreLike = { message?: unknown; status?: unknown; code?: unknown; name?: unknown };

/** true se l'errore è di rete/server (ritentabile), false per 4xx, permessi, validazione, eccezioni SQL. */
export function erroreDiRete(e: unknown): boolean {
  if (!e || typeof e !== 'object') return typeof e === 'string' && /failed to fetch|network|timeout|timed out/i.test(e);
  const x = e as ErroreLike;
  const status = typeof x.status === 'number' ? x.status : Number.NaN;
  if (status >= 500 && status <= 599) return true;
  if (status >= 400 && status <= 499) return false;
  const code = typeof x.code === 'string' ? x.code : '';
  // SQLSTATE (5 caratteri, es. 42501, P0001, 23505) o codici PostgREST di richiesta: errore applicativo, non ritentare
  if (/^[0-9A-Z]{5}$/.test(code)) return false;
  if (/^PGRST[1-9]/.test(code)) return false;
  if (/^PGRST00/.test(code)) return true; // PostgREST non raggiunge il database
  if (x.name === 'AbortError' || x.name === 'TimeoutError') return true;
  const msg = typeof x.message === 'string' ? x.message : '';
  return /failed to fetch|fetch failed|networkerror|network request failed|load failed|timeout|timed out|ECONNRESET|ERR_NETWORK|50[234]\b|bad gateway|service unavailable|gateway time-?out/i.test(msg);
}

/** Testo del toast: messaggio fisso + dettaglio leggibile. */
export function testoToast(e: unknown): string {
  const d = testoErrore(e);
  return d && d !== 'Errore sconosciuto' ? `${MESSAGGIO_ERRORE} ${d}` : MESSAGGIO_ERRORE;
}

const attendi = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** Esegue fn con un nuovo tentativo sugli errori di rete; non mostra nulla. */
export async function conRiprova<T>(fn: () => Promise<T>, o: OpzioniSalva = {}): Promise<T> {
  try { return await fn(); }
  catch (e) {
    if (o.riprova === false || !erroreDiRete(e)) throw e;
    await attendi(o.attesaMs ?? 800);
    return await fn();
  }
}

/**
 * Crea un esecutore con blocco anti-doppio-clic proprio.
 * `notifica` è iniettabile per i test (default: toast dell'app).
 */
export function creaSalva(notifica: (msg: string) => void = toast) {
  let occupato = false;
  async function esegui<T>(fn: () => Promise<T>, o: OpzioniSalva = {}): Promise<EsitoSalva<T>> {
    if (occupato) return { ok: false, duplicato: true, messaggio: '' };
    occupato = true;
    try {
      return { ok: true, dato: await conRiprova(fn, o) };
    } catch (errore) {
      if (o.toast !== false) notifica(testoToast(errore));
      return { ok: false, duplicato: false, errore, messaggio: testoErrore(errore) };
    } finally { occupato = false; }
  }
  return { esegui, inCorso: () => occupato };
}

/** Hook: `{ salva, inCorso }`. Disabilita il pulsante con `disabled={inCorso}`. */
export function useSalva(base: OpzioniSalva = {}) {
  const [inCorso, setInCorso] = useState(false);
  const ese = useRef(creaSalva());
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const baseRef = useRef(base); baseRef.current = base;
  const salva = useCallback(async <T,>(fn: () => Promise<T>, o: OpzioniSalva = {}): Promise<EsitoSalva<T>> => {
    if (ese.current.inCorso()) return { ok: false, duplicato: true, messaggio: '' };
    setInCorso(true);
    try { return await ese.current.esegui(fn, { ...baseRef.current, ...o }); }
    finally { if (vivo.current) setInCorso(false); }
  }, []);
  return { salva, inCorso };
}
