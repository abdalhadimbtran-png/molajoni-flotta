/** «Registra chiamata»: logica pura (testata) per le chiamate registrate dopo. */
export type GiornoReg = 'oggi' | 'ieri';
export type CanaleReg = 'telefono' | 'whatsapp' | 'email' | 'altro';
export type TipoReg = 'manutenzione' | 'sopralluogo' | 'offerta' | 'modifica' | 'informazione';
export type EsitoReg = 'gestita' | 'passata';

export const CANALI_REG: { v: CanaleReg; l: string }[] = [
  { v: 'telefono', l: 'Telefono' }, { v: 'whatsapp', l: 'WhatsApp' }, { v: 'email', l: 'Email' }, { v: 'altro', l: 'Altro' },
];
export const TIPI_REG: { v: TipoReg; l: string }[] = [
  { v: 'manutenzione', l: 'Intervento' }, { v: 'sopralluogo', l: 'Sopralluogo' }, { v: 'offerta', l: 'Offerta' }, { v: 'modifica', l: 'Modifiche' }, { v: 'informazione', l: 'Informazione' },
];

export interface StatoReg {
  giorno: GiornoReg; ora: string; canale: CanaleReg; tipo: TipoReg; esito: EsitoReg | null; passata: string;
  cliente: { codice: string | null; nome: string } | null; nome: string; telefono: string; cosa: string;
}
export const vuotoReg = (ora: string, giorno: GiornoReg = 'oggi', canale: CanaleReg = 'telefono'): StatoReg =>
  ({ giorno, ora, canale, tipo: 'informazione', esito: null, passata: '', cliente: null, nome: '', telefono: '', cosa: '' });

/** HH:MM dell'istante (ora di Roma). */
export function oraRoma(d: Date): string {
  return new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}
/** Normalizza «930», «9.30», «9:3» → «09:30»; null se non valida. */
export function normOra(t: string): string | null {
  const s = t.trim().replace(/[.,h]/g, ':');
  const m = /^(\d{1,2}):?(\d{2})$/.exec(s.includes(':') ? s.replace(/:(\d)$/, ':0$1') : s.padStart(3, '0'));
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : null;
}
/** Offset di Roma (minuti) in un istante. */
function offsetRoma(d: Date): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - d.getTime()) / 60000;
}
/** Istante (ISO) di oggi/ieri alle HH:MM, ora di Roma. */
export function istante(giorno: GiornoReg, ora: string, adesso = new Date()): string | null {
  const o = normOra(ora); if (!o) return null;
  const g = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date(adesso.getTime() - (giorno === 'ieri' ? 864e5 : 0)));
  const [y, m, d] = g.split('-').map(Number); const [h, mi] = o.split(':').map(Number);
  const utc = Date.UTC(y, m - 1, d, h, mi);
  let t = utc - offsetRoma(new Date(utc)) * 60000;
  t = utc - offsetRoma(new Date(t)) * 60000;
  return new Date(t).toISOString();
}

/** Cosa manca (vuoto = si può registrare). */
export function mancaReg(s: StatoReg, adesso = new Date()): string[] {
  const l: string[] = [];
  const q = istante(s.giorno, s.ora, adesso);
  if (!q) l.push('ora valida');
  else if (new Date(q).getTime() > adesso.getTime() + 60e3) l.push('ora non nel futuro');
  if (!s.cliente && !s.nome.trim() && !s.telefono.trim()) l.push('cliente o telefono');
  if (!s.cosa.trim()) l.push('cosa voleva');
  if (!s.esito) l.push('esito');
  if (s.esito === 'passata' && !s.passata) l.push('a chi è stata passata');
  return l;
}

/** Parametro per centralino_registra_chiamata. */
export function payloadReg(s: StatoReg, adesso = new Date()) {
  return {
    quando: istante(s.giorno, s.ora, adesso), canale: s.canale, tipo: s.tipo, esito: s.esito,
    passata_a: s.esito === 'passata' ? s.passata : null,
    cliente_codice: s.cliente?.codice ?? null, cliente_nome: (s.cliente?.nome ?? s.nome).trim(), telefono: s.telefono.trim(), descrizione: s.cosa.trim(),
  };
}
/** «Registra e nuova»: tiene giorno e canale, svuota il resto (ora = adesso). */
export const nuovaReg = (s: StatoReg, ora: string): StatoReg => vuotoReg(ora, s.giorno, s.canale);

/** Tasti nella finestra (fuori dai campi): 1–4 canale, G gestita, P passata. */
export function tastoReg(key: string): { canale: CanaleReg } | { esito: EsitoReg } | null {
  if (/^[1-4]$/.test(key)) return { canale: CANALI_REG[Number(key) - 1].v };
  const k = key.toLowerCase();
  if (k === 'g') return { esito: 'gestita' };
  if (k === 'p') return { esito: 'passata' };
  return null;
}
