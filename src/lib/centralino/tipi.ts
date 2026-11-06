import type { RegolaSla } from './sla';

export type Canale = 'telefono' | 'whatsapp' | 'email' | 'collega' | 'tablet_tmq' | 'altro';
export type Esito = 'aperta' | 'chiusa_ok' | 'chiusa_ko' | 'annullata';
export type TipoPratica = 'manutenzione' | 'sopralluogo' | 'offerta_piccola' | 'offerta_grande' | 'modifica' | 'amministrazione' | 'fornitori' | 'informazione' | 'trasferta' | 'abbigliamento';
export type Requisito = 'appuntamento' | 'email' | 'taylor' | 'commerciale' | 'destinatario' | 'urgenza' | 'coordinatore' | 'tecnico' | 'buono' | 'avviso';

export interface Stadio { key: string; nome: string; sla?: RegolaSla; azione?: 'appuntamento' | 'taylor' | 'esito'; template?: string; requisiti?: Requisito[] }
export interface Flusso {
  tipo: TipoPratica; nome: string; icona: string; ordine: number; sottotipi: string[]; sottotipi_urgenti: string[];
  stadi: Stadio[]; sla_sottotipi: Record<string, Record<string, RegolaSla>>; assegnazione: { ruolo: string; nome: string } | null;
  nota_procedura: string | null; attivo: boolean;
}
export interface Pratica {
  id: number; numero: string; canale: Canale; tipo: TipoPratica; sottotipo: string | null; priorita: 'normale' | 'urgente';
  cliente_codice: string | null; cliente_nome: string; sede: string | null; contatto_nome: string | null; telefono: string | null; email: string | null;
  indirizzo: string | null; cap: string | null; comune: string | null; descrizione: string | null;
  assegnato_ruolo: string | null; assegnato_nome: string | null; assegnato_dipendente_id: number | null;
  commerciale_nome: string | null; commerciale_email: string | null; tecnico_nome: string | null; importo_stimato: number | null;
  appuntamento_data: string | null; appuntamento_fascia: 'mattina' | 'pomeriggio' | null; alert_taylor: boolean; tacitazione_tentata: boolean;
  esito_offerta: 'accettata' | 'rifiutata' | 'in_attesa' | null; stato_corrente: string; esito: Esito;
  sla_stadio: string | null; sla_scadenza: string | null; sla_rispettato: boolean | null;
  created_by: string | null; created_at: string; updated_at: string; closed_at: string | null;
  stato_cliente: StatoCliente | null; stato_cliente_manuale: boolean; documento_intervento: string | null;
  urgenza?: 'urgente' | 'ordinario' | null; coordinatore_nome?: string | null; coordinatore_telefonato?: boolean | null;
  tecnico_dipendente_id?: number | null; tecnico_quando?: string | null; tecnico_quando_at?: string | null; whatsapp_tecnico?: boolean | null; avviso_app_at?: string | null;
}
export interface PersonaDisp { nome: string; email: string | null; telefono?: string | null; cellulare?: string | null; account?: boolean; assente: boolean; occupato?: boolean; disponibile: boolean }
export interface TecnicoDisp { id: number; nome: string; telefono: string | null; assente: boolean; interventi_oggi: number }
export type StatoCliente = 'nuovo' | 'ex_cliente' | 'attivo';
export const STATI_CLIENTE: Record<StatoCliente, [string, string]> = { nuovo: ['info', 'Nuovo'], ex_cliente: ['warn', 'Ex cliente'], attivo: ['ok', 'Cliente attivo'] };
export type EsitoTrasf = 'risposto' | 'non_risposto' | 'occupato' | 'richiamera';
export const ESITI_TRASF: Record<EsitoTrasf, string> = { risposto: 'Risposto', non_risposto: 'Non risposto', occupato: 'Occupato', richiamera: 'Richiamerà' };
export interface Trasferimento {
  id: number; pratica_id: number | null; cliente_codice: string | null; cliente_nome: string | null; telefono: string | null;
  destinatario_nome: string; destinatario_ruolo: string | null; destinatario_user: string | null; argomento: string | null; tipo_argomento: string | null;
  esito: EsitoTrasf; modalita: 'trasferita' | 'richiamo'; entro_testo: string | null; cliente_email: string | null;
  esito_richiamo: string | null; email_riepilogo_at: string | null; email_referente_inviata_at: string | null; email_cliente_inviata_at: string | null; referente_email: string | null; stato_cliente: StatoCliente | null; email_non_disponibile: string | null; richiamo_scadenza: string | null; richiamato_at: string | null; richiamato_da: string | null; autore_nome: string | null; at: string; solo_commerciale?: boolean;
}
export interface Destinatario { nome: string; ruolo: string; email: string; nota?: string }
export interface Commerciale { nome: string; email: string | null; account: boolean; assente: boolean; occupato: boolean; disponibile: boolean }
export type TipoEvento = 'creata' | 'stato' | 'nota' | 'email_inviata' | 'chiamata' | 'assegnata' | 'appuntamento' | 'allegato' | 'sla_scaduto' | 'chiusa' | 'modifica';
export interface Evento {
  id: number; pratica_id: number; tipo: TipoEvento; da_stato: string | null; a_stato: string | null; testo: string | null;
  dati: Record<string, unknown>; autore_nome: string | null; at: string;
}
export interface Template {
  id: number; codice: string; nome: string; oggetto: string; corpo_html: string; cc_default: string[]; cc_offerte_grandi: boolean;
  tipo_pratica: string | null; attivo: boolean; ordine: number;
}
export interface Persona { nome: string; email: string }
export interface Impostazioni {
  orario: { inizio: string; fine: string }; soglia_arancio: number; cc_offerte_grandi: Persona[];
  amministrazione: Persona; fornitori: Persona & { giorni?: string }; commerciali: Persona[]; responsabili_info: Persona[];
  firma: string; sostituto: string; destinatari_trasferimento: Destinatario[]; trasferimento_sla: RegolaSla; mesi_cliente_attivo: number;
  commerciali_offerte_grandi: Persona[]; motivi_annullamento: string[]; motivi_senza_email: string[]; motivi_spostamento: string[];
}

export const CANALI: { v: Canale; l: string; ic: string }[] = [
  { v: 'telefono', l: 'Telefono', ic: 'telefono' }, { v: 'whatsapp', l: 'WhatsApp', ic: 'whatsapp' }, { v: 'email', l: 'Email', ic: 'email' },
  { v: 'collega', l: 'Collega / Tecnico', ic: 'collega' }, { v: 'tablet_tmq', l: 'Tablet TMQ', ic: 'tablet' }, { v: 'altro', l: 'Altro', ic: 'altro' },
];
export const nomeCanale = (c: string) => CANALI.find(x => x.v === c)?.l ?? c;

/** «Cosa chiede?»: le offerte sono un solo pulsante, la soglia 1.000 € decide il flusso. */
export const RICHIESTE: { v: TipoPratica | 'offerta'; l: string; ic: string; breve: string }[] = [
  { v: 'manutenzione', l: 'Intervento manutenzione', ic: 'manutenzione', breve: 'Guasto, ritardo, allarme' },
  { v: 'sopralluogo', l: 'Sopralluogo tecnico', ic: 'sopralluogo', breve: 'Visita per valutare' },
  { v: 'offerta', l: 'Richiesta offerta', ic: 'offerta', breve: 'Preventivo' },
  { v: 'modifica', l: 'Modifica / anagrafica / disdetta', ic: 'modifica', breve: 'Calendario, dati, disdetta' },
  { v: 'amministrazione', l: 'Fatture / amministrazione', ic: 'amministrazione', breve: '→ Simona Colagrossi' },
  { v: 'fornitori', l: 'Fornitori', ic: 'fornitori', breve: '→ Roberta Felci' },
  { v: 'informazione', l: 'Informazione / altro', ic: 'informazione', breve: '→ responsabile (anche info@)' },
];

export const NOME_TIPO: Record<TipoPratica, string> = {
  manutenzione: 'Manutenzione', sopralluogo: 'Sopralluogo', offerta_piccola: 'Offerta ≤ 1.000 €', offerta_grande: 'Offerta > 1.000 €',
  modifica: 'Modifica / anagrafica', amministrazione: 'Amministrazione', fornitori: 'Fornitori', informazione: 'Informazione', trasferta: 'Trasferta (alloggio)', abbigliamento: 'Abbigliamento',
};
export const ESITI: Record<Esito, [string, string]> = {
  aperta: ['info', 'Aperta'], chiusa_ok: ['ok', 'Chiusa'], chiusa_ko: ['ko', 'Chiusa (negativa)'], annullata: ['na', 'Annullata'],
};
export const RUOLI_ASSEGNA: { v: string; l: string }[] = [
  { v: 'tecnico', l: 'Tecnico' }, { v: 'tecnico_commerciale', l: 'Tecnico commerciale' }, { v: 'amministrazione', l: 'Amministrazione (Simona)' },
  { v: 'fornitori', l: 'Fornitori (Roberta)' }, { v: 'responsabile', l: 'Responsabile' }, { v: 'centralino', l: 'Centralino' },
];
export const FASCE: Record<'mattina' | 'pomeriggio', string> = { mattina: 'mattina (8:30–13:00)', pomeriggio: 'pomeriggio (13:00–17:30)' };

export const SCRIPT_TELEFONO = 'Molajoni dal 1930, buongiorno, sono Jennifer: come posso aiutarla?';
export const REGOLA_ANAGRAFICA = 'Non chiedere al cliente di mandare per email l\'anagrafica completa: si completa dopo.';
export const REGOLA_SQUILLI = 'Rispondi entro 3 squilli.';

export const stadioDi = (f: Flusso | undefined, key: string | null) => f?.stadi.find(s => s.key === key);
export const indiceStadio = (f: Flusso | undefined, key: string | null) => f ? f.stadi.findIndex(s => s.key === key) : -1;
/** Prossimo stadio dopo quello attuale (null se ultimo). */
export const prossimoStadio = (f: Flusso | undefined, p: Pratica) => {
  const i = indiceStadio(f, p.stato_corrente);
  return f && i >= 0 && i < f.stadi.length - 1 ? f.stadi[i + 1] : null;
};
export const richiedeAppuntamento = (t: string) => t === 'manutenzione' || t === 'sopralluogo';

/** Chiamata trasferita senza email di riepilogo (né motivo): segnale rosso. */
export const senzaCliente = (t: Trasferimento) => !t.email_cliente_inviata_at && !t.email_riepilogo_at && !t.email_non_disponibile;
export const senzaReferente = (t: Trasferimento) => !t.email_referente_inviata_at;
export const senzaRiepilogo = (t: Trasferimento) => !t.solo_commerciale && (senzaCliente(t) || senzaReferente(t));
