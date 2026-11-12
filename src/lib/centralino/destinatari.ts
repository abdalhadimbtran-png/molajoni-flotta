/**
 * Instradamento delle email del Centralino: per ogni modello (azione) chi deve ricevere l'email,
 * come si risolvono A e CC, e i controlli che bloccano un invio sbagliato.
 *
 * Regole (vedi docs/CENTRALINO.md › «Destinatari delle email»):
 * - email al cliente (o a chi ha chiamato) → solo l'email della pratica / del trasferimento, MAI un indirizzo interno;
 * - email interne (oggetto «[Centralino] …») → solo colleghi (referenti attivi), MAI l'email del cliente;
 * - coordinatore: il primo disponibile CON email tra i coordinatori attivi (Alberto Chiaradonna → Antonella D'Orazio);
 * - oggetto con il numero pratica (se la pratica esiste); nessun segnaposto essenziale vuoto.
 */
export type Ruolo = 'cliente' | 'coordinatore' | 'commerciale' | 'referente' | 'tecnico';

export const NOME_RUOLO: Record<Ruolo, string> = {
  cliente: 'cliente', coordinatore: 'coordinatore', commerciale: 'Tecnico Commerciale', referente: 'referente', tecnico: 'tecnico',
};

/** Modello → destinatario previsto. Ogni modello attivo DEVE essere qui (test). */
export const RUOLO_MODELLO: Record<string, Ruolo> = {
  // Intervento (manutenzione)
  presa_intervento: 'cliente', intervento_coordinatore: 'coordinatore', intervento_cliente: 'cliente',
  // Sopralluogo
  presa_sopralluogo: 'cliente', sopralluogo_coordinatore: 'coordinatore', sopralluogo_cliente: 'cliente',
  // Offerte
  presa_offerta_piccola: 'cliente', invio_offerta: 'cliente', presa_offerta_grande: 'cliente', riepilogo_commerciale: 'commerciale', preventivo_tmq: 'cliente',
  // Modifiche / disdetta
  modifica_evasa: 'cliente', conferma_anagrafica: 'cliente', conferma_disdetta: 'cliente',
  // Informazione / amministrazione / fornitori (girata)
  girata_referente: 'referente', girata_ufficio: 'cliente', girata_fornitore: 'cliente',
  // Trasferimenti e richiami
  trasf_referente: 'referente', riepilogo_trasferita: 'cliente', riepilogo_richiamo: 'cliente',
};

/** Ruolo del modello; per un modello nuovo non in elenco: interno se l'oggetto inizia con «[Centralino]». */
export function ruoloModello(codice: string | null | undefined, oggetto?: string | null): Ruolo {
  if (codice && RUOLO_MODELLO[codice]) return RUOLO_MODELLO[codice];
  if (codice?.endsWith('_coordinatore')) return 'coordinatore';
  return /^\s*\[Centralino\]/.test(oggetto ?? '') ? 'referente' : 'cliente';
}
export const eInterno = (r: Ruolo) => r !== 'cliente';

export const emailValida = (s: string | null | undefined) => !!s && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const lista = (x: string | string[] | null | undefined) => (Array.isArray(x) ? x : (x ?? '').split(/[,;\s]+/)).map(norm).filter(Boolean);

export interface PersonaEmail { nome: string; email?: string | null; attivo?: boolean | null; disponibile?: boolean | null }
export interface ContestoDest {
  pratica?: { email?: string | null; contatto_nome?: string | null; cliente_nome?: string | null; commerciale_nome?: string | null; commerciale_email?: string | null;
    assegnato_nome?: string | null; coordinatore_nome?: string | null } | null;
  trasf?: { cliente_email?: string | null; cliente_nome?: string | null; destinatario_nome?: string | null; referente_email?: string | null } | null;
  /** coordinatori in ordine (centralino_coordinatori) */
  coordinatori?: PersonaEmail[];
  /** coordinatore/tecnico scelto nel passo (vince sul fallback) */
  coordinatoreScelto?: PersonaEmail | null;
  /** referenti / destinatari dei trasferimenti (solo attivi; quelli con attivo=false sono ignorati) */
  referenti?: PersonaEmail[];
  commerciali?: PersonaEmail[];
  /** nome del referente scelto nel passo (girata) */
  referenteScelto?: string | null;
}
export interface Destinatario { ruolo: Ruolo; nome: string; email: string | null; errore: string | null }

const attivi = (l?: PersonaEmail[]) => (l ?? []).filter(p => p.attivo !== false);
const perNome = (l: PersonaEmail[] | undefined, nome: string | null | undefined) => (nome ? attivi(l).find(p => norm(p.nome) === norm(nome)) : undefined);

/** Messaggio chiaro quando manca l'email del destinatario. */
export function msgEmailMancante(ruolo: Ruolo, nome: string | null | undefined): string {
  const chi = nome ? `${nome} (${NOME_RUOLO[ruolo]})` : `del ${NOME_RUOLO[ruolo]}`;
  const dove = ruolo === 'cliente' ? 'scrivila nel campo A' : 'aggiungila in Referenti';
  return `Manca l'email di ${chi}: ${dove} oppure usa «Avvisato per telefono».`;
}

/** Chi riceve l'email di questo modello e a quale indirizzo. */
export function destinatarioPerAzione(codice: string, ctx: ContestoDest, oggetto?: string): Destinatario {
  const ruolo = ruoloModello(codice, oggetto);
  const p = ctx.pratica ?? {};
  const t = ctx.trasf;
  const esito = (nome: string | null | undefined, email: string | null | undefined): Destinatario => {
    const ok = emailValida(email) ? norm(email) : null;
    return { ruolo, nome: nome || '', email: ok, errore: ok ? null : msgEmailMancante(ruolo, nome) };
  };
  switch (ruolo) {
    case 'cliente':
      return esito(t?.cliente_nome ?? p.contatto_nome ?? p.cliente_nome, t ? (t.cliente_email || p.email) : p.email);
    case 'coordinatore': {
      if (ctx.coordinatoreScelto) {
        const c = ctx.coordinatoreScelto;
        const r = perNome(ctx.coordinatori, c.nome) ?? perNome(ctx.referenti, c.nome);
        return esito(c.nome, c.email || r?.email);
      }
      if (p.coordinatore_nome) { const c = perNome(ctx.coordinatori, p.coordinatore_nome) ?? perNome(ctx.referenti, p.coordinatore_nome); if (c) return esito(c.nome, c.email); }
      const l = attivi(ctx.coordinatori);
      const c = l.find(x => x.disponibile !== false && emailValida(x.email)) ?? l.find(x => emailValida(x.email)) ?? l[0];
      return esito(c?.nome ?? 'coordinatore', c?.email);
    }
    case 'commerciale': {
      const c = perNome(ctx.commerciali, p.commerciale_nome) ?? perNome(ctx.referenti, p.commerciale_nome);
      return esito(p.commerciale_nome, p.commerciale_email || c?.email);
    }
    case 'referente':
    case 'tecnico': {
      const nome = codice === 'trasf_referente' ? t?.destinatario_nome : (ctx.referenteScelto ?? p.assegnato_nome);
      const r = perNome(ctx.referenti, nome) ?? perNome(ctx.commerciali, nome);
      return esito(nome, (codice === 'trasf_referente' ? t?.referente_email : null) || r?.email);
    }
  }
}

/** Segnaposto essenziali per modello: se il dato manca si blocca l'invio (niente «il nostro tecnico» vuoti al cliente). */
export const DATI_RICHIESTI: Record<string, { campo: string; etichetta: string }[]> = {
  sopralluogo_cliente: [{ campo: 'tecnico_nome', etichetta: 'il tecnico ({tecnico})' }, { campo: 'tecnico_quando', etichetta: 'quando ({quando})' }],
  presa_offerta_grande: [{ campo: 'commerciale_nome', etichetta: 'il Tecnico Commerciale ({commerciale})' }],
  riepilogo_commerciale: [{ campo: 'commerciale_nome', etichetta: 'il Tecnico Commerciale ({commerciale})' }],
  girata_referente: [{ campo: 'assegnato_nome', etichetta: 'il referente ({referente})' }],
  girata_ufficio: [{ campo: 'assegnato_nome', etichetta: 'il referente ({referente})' }],
  girata_fornitore: [{ campo: 'assegnato_nome', etichetta: 'il referente ({referente})' }],
};
export function datiMancanti(codice: string, dati: Record<string, unknown>): string[] {
  return (DATI_RICHIESTI[codice] ?? []).filter(d => !String(dati[d.campo] ?? '').trim()).map(d => d.etichetta);
}

export interface EmailDaControllare {
  codice: string; oggetto: string; testo: string; a: string | string[]; cc?: string | string[];
  numero?: string | null; clienteEmail?: string | null; emailInterne?: (string | null | undefined)[];
  dati?: Record<string, unknown>; nomeDest?: string | null;
}
/**
 * Controllo finale prima di «Apri in Outlook» / .eml / invio automatico.
 * Ritorna il primo errore (in italiano) o null.
 */
export function controllaEmail(e: EmailDaControllare): string | null {
  const ruolo = ruoloModello(e.codice, e.oggetto);
  const a = lista(e.a), cc = lista(e.cc);
  if (!a.length || !a.every(emailValida)) return msgEmailMancante(ruolo, e.nomeDest);
  const cli = norm(e.clienteEmail);
  const interne = new Set((e.emailInterne ?? []).map(norm).filter(Boolean));
  if (eInterno(ruolo)) {
    if (cli && (a.includes(cli) || cc.includes(cli)) && !interne.has(cli))
      return `Email interna per il ${NOME_RUOLO[ruolo]}: non può andare all'indirizzo del cliente (${cli}). Controlla il campo A/CC.`;
  } else {
    const intA = a.filter(x => interne.has(x) && x !== cli);
    if (intA.length) return `Email per il cliente: l'indirizzo ${intA[0]} è di un collega. Scrivi l'email del cliente nel campo A.`;
  }
  if (e.numero && !e.oggetto.includes(e.numero)) return `L'oggetto deve contenere il numero pratica ${e.numero}.`;
  const residui = [...`${e.oggetto}\n${e.testo}`.matchAll(/\{[a-z_]+\}/g)].map(m => m[0]);
  if (residui.length) return `Testo incompleto: ${[...new Set(residui)].join(', ')} senza valore.`;
  if (e.dati) { const m = datiMancanti(e.codice, e.dati); if (m.length) return `Prima di inviare manca ${m.join(' e ')}.`; }
  return null;
}
