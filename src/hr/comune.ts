/** Area Ufficio personale: tipi delle risposte delle funzioni hr_* e formattazione (nessun calcolo di saldo: lo fa il server). */
import { useOutletContext } from 'react-router-dom';
import type { Livello } from '../lib/format';

export type Stato = 'in_attesa' | 'approvata' | 'rifiutata' | 'annullata';
export type Unita = 'giorni' | 'ore';
export type Categoria = 'TEC' | 'UFFICIO' | 'MAGAZZINO' | 'ALTRO';

export interface GiornoImpatto {
  giorno: string; quantita: number; frazione: number; tec_attivi: number; tec_assenti: number; tec_in_attesa: number; tec_disponibili: number;
  interventi: { ora: string | null; luogo: string | null; attivita: string | null }[]; colleghi_assenti: string[];
}
export interface Impatto { tec: boolean; interventi_totali: number; giorni: GiornoImpatto[] }
export interface SaldoRichiesta { anno: number; quantita: number; saldo: number; saldo_dopo_approvazione: number; in_attesa_altre: number; alla_data: string }

export interface Richiesta {
  id: number; numero: string; tipo: string; tipo_descrizione: string; unita: Unita;
  primo_giorno: string; ultimo_giorno: string; rientro: string; ora_inizio: string | null; ora_fine: string | null;
  mezza_giornata: boolean; quantita: number; giorni_lavorativi: number; note: string | null; stato: Stato;
  saldo_insufficiente: boolean; avvisi: string[]; motivo_decisione: string | null; deciso_il: string | null;
  motivo_annullamento: string | null; annullata_da: string | null; annullata_il: string | null;
  creata_da: 'dipendente' | 'hr'; creato_il: string; annullabile: boolean;
  dipendente_id: number; dipendente: { id: number; nome: string; codice: string; categoria: Categoria; reparto: string | null };
  deciso_da: string | null; creata_da_utente: string | null; annullata_da_utente: string | null;
  auto_decisione: boolean; decide_solo: string | null; puo_decidere: boolean;
  impatto?: Impatto; saldi?: SaldoRichiesta[]; per_anno?: { anno: number; quantita: number }[];
}

export interface Saldo {
  anno: number; tipo: string; descrizione: string; unita: Unita; alla_data: string; spettanza_annua: number | null; spettanza_da_confermare: boolean;
  fattore_part_time: number; quota_mensile: number; origine: 'saldo_iniziale' | 'riporto_anno_precedente' | 'da_inizio_anno';
  data_riferimento: string | null; saldo_iniziale: number; mesi_maturati: number; maturato: number; goduto: number; in_attesa: number;
  rettifiche: number; saldo: number; saldo_dopo_attesa: number; saldo_fine_anno: number;
}
export interface SaldiDipendente {
  dipendente_id: number; nome: string; codice: string; categoria: Categoria; reparto: string | null; contratto: string | null;
  ore_giornaliere: number; attivo: boolean; saldi: Saldo[];
}

export interface Anteprima {
  ok: boolean; errori: string[]; avvisi: string[]; tipo: string; tipo_descrizione: string; unita: Unita;
  modalita: 'giorni' | 'mezza_giornata' | 'ore'; primo_giorno: string; ora_inizio: string | null; ora_fine: string | null; ultimo_giorno: string; rientro: string;
  quantita: number; giorni_lavorativi: number; festivita_escluse: { data: string; nome: string }[];
  saldi: { anno: number; quantita: number; saldo: number; in_attesa: number; saldo_dopo: number; insufficiente: boolean; spettanza_mancante: boolean }[];
  saldo_insufficiente: boolean; interventi_in_piano: number;
}

export interface AssenzaCal {
  origine: 'richiesta' | 'manuale'; richiesta_id?: number; assenza_id?: number; numero?: string; dipendente_id: number; nome: string;
  categoria: Categoria; reparto: string | null; tipo: string | null; etichetta: string; stato: Stato; dal: string; al: string;
  ora_inizio: string | null; ora_fine: string | null; mezza_giornata: boolean; quantita: number | null; unita: Unita | null;
}

export interface Dipendente {
  id: number; codice: string; nome: string; cognome: string; ruolo: string | null; telefono: string | null; email: string | null;
  categoria: Categoria; reparto: string | null; data_assunzione: string | null; data_cessazione: string | null;
  contratto: 'full-time' | 'part-time' | null; ore_giornaliere: number; giorni_riposo: string;
  patente_categoria: string | null; patente_scadenza: string | null; attivo: boolean; ha_pin: boolean;
  tentativi_falliti: number; bloccato_fino: string | null;
}
export const SEL_DIP = 'id,codice,nome,cognome,ruolo,telefono,email,categoria,reparto,data_assunzione,data_cessazione,contratto,ore_giornaliere,giorni_riposo,patente_categoria,patente_scadenza,attivo,ha_pin,tentativi_falliti,bloccato_fino';

export interface TipoAssenza { codice: string; descrizione: string; unita: Unita; con_saldo: boolean; mezza_giornata: boolean; etichetta_piano: string; richiedibile: boolean; ordine: number; attivo: boolean }

/** Contesto dell'area (dato da ShellHR alle pagine). */
export interface CtxHR { admin: boolean; mioDipendente: number | null; nomeAccount: string; aggiornaContatore: () => void }
export const useHR = () => useOutletContext<CtxHR>();

export const CATEGORIE: [Categoria, string][] = [['TEC', 'Tecnico'], ['UFFICIO', 'Ufficio'], ['MAGAZZINO', 'Magazzino'], ['ALTRO', 'Altro']];
export const nomeCategoria = (c: string | null | undefined) => CATEGORIE.find(x => x[0] === c)?.[1] ?? '—';
export const categoriaReparto = (c: string, r: string | null) => [nomeCategoria(c), r].filter(Boolean).join(' · ');

export const STATI: Record<Stato, [Livello, string]> = {
  in_attesa: ['warn', 'In valutazione'], approvata: ['ok', 'Approvata'], rifiutata: ['ko', 'Rifiutata'], annullata: ['na', 'Annullata'],
};

/** Nome breve del tipo: «Permesso ROL (riduzione …)» → «Permesso ROL». */
export const nomeTipo = (d: string | null | undefined) => (d ?? '').replace(/\s*\(.*\)\s*$/, '');
/** Lettera del calendario (con la legenda: mai solo colore). */
export const letteraTipo = (tipo: string | null) =>
  tipo === 'FERIE' ? 'F' : tipo === 'MAL' ? 'M' : tipo === 'ROL' || tipo === 'EXF' || tipo === 'PNR' ? 'P' : 'A';

// ---------- numeri e date (stringhe AAAA-MM-GG, mai new Date('AAAA-MM-GG')) ----------
export const num = (n: number | null | undefined, dec = 2) =>
  n == null ? '—' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: dec }).replace('-', '−');

export function fmtOre(h: number): string {
  const neg = h < 0; const tot = Math.round(Math.abs(h) * 60); const o = Math.floor(tot / 60), m = tot % 60;
  const s = o && m ? `${o} ${o === 1 ? 'ora' : 'ore'} e ${m} minuti` : o ? `${o} ${o === 1 ? 'ora' : 'ore'}` : `${m} minuti`;
  return (neg ? '−' : '') + s;
}
export function fmtQ(q: number | null | undefined, unita: Unita | null | undefined): string {
  if (q == null) return '—';
  if (unita === 'ore') return fmtOre(Number(q));
  const n = Number(q);
  return n === 0.5 ? 'mezza giornata' : n === 1 ? '1 giorno' : `${num(n)} giorni`;
}
/** Saldo compatto per tabelle: «12,5 gg», «16 h». */
export const fmtSaldo = (q: number | null | undefined, unita: Unita) => (q == null ? '—' : `${num(q)} ${unita === 'ore' ? 'h' : 'gg'}`);

const D = (iso: string) => { const [y, m, g] = iso.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, g, 12)); };
export const isoDi = (d: Date) => d.toISOString().slice(0, 10);
export const piuGiorni = (iso: string, n: number) => { const d = D(iso); d.setUTCDate(d.getUTCDate() + n); return isoDi(d); };
/** 1 = lunedì … 7 = domenica */
export const giornoSett = (iso: string) => ((D(iso).getUTCDay() + 6) % 7) + 1;
const GS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
export const nomeMese = (m: number) => MESI[m - 1];
export const meseBreve = (m: number) => MESI[m - 1].slice(0, 3);
/** «lun 7 dic» */
export function giornoBreve(iso: string, conMese = true) {
  const [, m, g] = iso.slice(0, 10).split('-').map(Number);
  return `${GS[giornoSett(iso) - 1]} ${g}${conMese ? ` ${meseBreve(m)}` : ''}`;
}
/** «lunedì 7 dicembre» */
export function giornoLungo(iso: string) {
  const [, m, g] = iso.slice(0, 10).split('-').map(Number);
  return `${D(iso).toLocaleDateString('it-IT', { weekday: 'long', timeZone: 'UTC' })} ${g} ${nomeMese(m)}`;
}
/** Periodo di una richiesta: «Ferie · da lun 7 a mar 8 dic · rientro mer 9». */
export function periodo(r: { primo_giorno: string; ultimo_giorno: string; rientro?: string; ora_inizio?: string | null; ora_fine?: string | null; mezza_giornata?: boolean }) {
  if (r.ora_inizio) return `${giornoBreve(r.primo_giorno)} · ${r.ora_inizio}–${r.ora_fine}`;
  if (r.mezza_giornata) return `${giornoBreve(r.primo_giorno)} · mezza giornata`;
  const rientro = r.rientro ?? piuGiorni(r.ultimo_giorno, 1);
  const stessoMese = r.primo_giorno.slice(0, 7) === rientro.slice(0, 7);
  const base = r.primo_giorno === r.ultimo_giorno ? giornoBreve(r.primo_giorno)
    : `da ${giornoBreve(r.primo_giorno, r.primo_giorno.slice(0, 7) !== r.ultimo_giorno.slice(0, 7))} a ${giornoBreve(r.ultimo_giorno)}`;
  return `${base} · rientro ${giornoBreve(rientro, !stessoMese)}`;
}

/** Primo giorno lavorativo dopo `iso` per i giorni di riposo (stringa 7 caratteri) e le festività date. */
export function prossimoLavorativo(iso: string, riposo: string, festivita: Set<string>) {
  let d = piuGiorni(iso, 1);
  for (let i = 0; i < 30; i++) {
    if (riposo[giornoSett(d) - 1] !== '1' && !festivita.has(d)) return d;
    d = piuGiorni(d, 1);
  }
  return piuGiorni(iso, 1);
}

export function testoQuando(iso: string) {
  const [y, m, g] = iso.slice(0, 10).split('-');
  return `${g}/${m}/${y}`;
}
