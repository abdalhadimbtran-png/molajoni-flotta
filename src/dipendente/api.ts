/**
 * Accesso e tipi dati dell'app del dipendente (funzioni dipendente_* della migrazione 0012).
 * Il token è lo stesso dell'app tecnico (chiave `molajoni_flotta_token`): chi era già dentro resta dentro.
 */
import { createContext, useContext } from 'react';
import { testoErrore } from '../lib/supabase';
import type { Unita } from './periodo';

export const CHIAVE_TOKEN = 'molajoni_flotta_token';
export const CHIAVE_BOZZA = 'molajoni_bozza_richiesta';

/** Token: localStorage (telefono personale) oppure sessionStorage (computer condiviso, finisce chiudendo il browser). */
export function leggiToken(): string | null {
  try { return localStorage.getItem(CHIAVE_TOKEN) ?? sessionStorage.getItem(CHIAVE_TOKEN); } catch { return null; }
}
export function scriviToken(t: string | null, condiviso = false) {
  try {
    localStorage.removeItem(CHIAVE_TOKEN); sessionStorage.removeItem(CHIAVE_TOKEN);
    if (t) (condiviso ? sessionStorage : localStorage).setItem(CHIAVE_TOKEN, t);
  } catch { /* archivio non disponibile: l'accesso dura finché la pagina resta aperta */ }
}
export const sessioneScaduta = (e: unknown) => testoErrore(e).includes('SESSIONE_NON_VALIDA');

export type Categoria = 'TEC' | 'UFFICIO' | 'MAGAZZINO' | 'ALTRO';
export type StatoRichiesta = 'in_attesa' | 'approvata' | 'rifiutata' | 'annullata';

export interface LoginRisposta { ok: boolean; token?: string; errore?: string; nome?: string; codice?: string; categoria?: Categoria; tec?: boolean }

export interface Saldo {
  anno: number; tipo: string; descrizione: string; unita: Unita; alla_data: string;
  spettanza_annua: number | null; quota_mensile: number; origine: string; saldo_iniziale: number;
  mesi_maturati: number; maturato: number; goduto: number; in_attesa: number; rettifiche: number;
  saldo: number; saldo_dopo_attesa: number; saldo_fine_anno: number;
}

export interface TipoAssenza { codice: string; descrizione: string; unita: Unita; mezza_giornata: boolean; con_saldo: boolean }

export interface Richiesta {
  id: number; numero: string; tipo: string; tipo_descrizione: string; unita: Unita;
  primo_giorno: string; ultimo_giorno: string; rientro: string;
  ora_inizio: string | null; ora_fine: string | null; mezza_giornata: boolean;
  quantita: number; giorni_lavorativi: number; note: string | null; stato: StatoRichiesta;
  saldo_insufficiente: boolean; avvisi: string[];
  motivo_decisione: string | null; deciso_il: string | null;
  motivo_annullamento: string | null; annullata_da: 'dipendente' | 'hr' | null; annullata_il: string | null;
  creata_da: 'dipendente' | 'hr'; creato_il: string; annullabile: boolean;
}

export interface Profilo {
  nome: string; cognome: string; codice: string; categoria: Categoria; reparto: string | null; ruolo: string | null;
  contratto: string | null; ore_giornaliere: number; giorni_riposo: string; data_assunzione: string | null;
  email: string | null; telefono: string | null;
}

export interface HomeDipendente {
  profilo: Profilo; tec: boolean; anno: number; saldi: Saldo[]; richieste: Richiesta[]; in_attesa: number;
  tipi: TipoAssenza[]; festivita: { data: string; nome: string }[]; non_lette: number;
}

export interface SaldoAnteprima { anno: number; quantita: number; saldo: number; in_attesa: number; saldo_dopo: number; alla_data: string; insufficiente: boolean; spettanza_mancante: boolean }
export interface Anteprima {
  ok: boolean; errori: string[]; avvisi: string[]; tipo: string; tipo_descrizione: string; unita: Unita;
  modalita: 'giorni' | 'mezza_giornata' | 'ore'; primo_giorno: string; ultimo_giorno: string; rientro: string;
  ora_inizio: string | null; ora_fine: string | null; mezza_giornata: boolean;
  giorni: { giorno: string; quantita: number; frazione: number }[];
  quantita: number; giorni_lavorativi: number; giorni_calendario: number;
  festivita_escluse: { data: string; nome: string }[]; saldi: SaldoAnteprima[]; saldo_insufficiente: boolean; interventi_in_piano: number;
}

export interface Notifica { id: number; tipo: string; dati: Record<string, unknown>; creato_il: string; letta: boolean }

/** Nomi semplici dei tipi (niente sigle come ROL nell'app del dipendente). */
const NOMI: Record<string, [string, string]> = {
  FERIE: ['Ferie', 'Uno o più giorni'],
  ROL: ['Permesso', 'Qualche ora'],
  EXF: ['Permesso ex festività', 'A ore'],
  PNR: ['Permesso non retribuito', 'A ore, senza paga'],
  MAL: ['Malattia', "Avvisa l'ufficio"],
  ALTRO: ['Altro motivo', 'Visita, lutto, …'],
};
export const nomeTipo = (codice: string, descrizione?: string) => NOMI[codice]?.[0] ?? (descrizione ?? codice).replace(/\s*\(.*\)\s*$/, '');
export const sottotitoloTipo = (t: TipoAssenza) => NOMI[t.codice]?.[1] ?? (t.unita === 'ore' ? 'A ore' : 'A giorni');

/** Contesto dell'app: token, dati della home (dipendente_home), ricarica e uscita. */
export interface Sessione {
  token: string; home: HomeDipendente | null; errore: string | null;
  ricarica: () => void; esci: () => void; scaduta: () => void;
}
export const SessioneCtx = createContext<Sessione | null>(null);
export function useSessione(): Sessione {
  const s = useContext(SessioneCtx);
  if (!s) throw new Error('SessioneCtx mancante');
  return s;
}
