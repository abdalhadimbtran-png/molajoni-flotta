export type Livello = 'ko' | 'warn' | 'info' | 'ok' | 'na';
export interface Messaggio { l: Livello; m: string }

export const fmtKm = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('it-IT'));

export function fmtData(d: string | null | undefined): string {
  if (!d) return '—';
  const [y, m, g] = d.slice(0, 10).split('-');
  return `${g}/${m}/${y}`;
}

export function fmtOra(ts: string | null | undefined, locale = 'it-IT'): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' });
}

export function fmtGiorno(d: string, locale = 'it-IT'): string {
  const [y, m, g] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, g, 12)).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Data di oggi a Roma in formato YYYY-MM-DD. */
export function oggiISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function prossimoLavorativo(da: string = oggiISO()): string {
  const [y, m, g] = da.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, g, 12));
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

/** Giorni tra oggi e la data (negativo = passata). */
export function giorniA(d: string | null | undefined): number | null {
  if (!d) return null;
  const a = Date.parse(oggiISO() + 'T12:00:00Z');
  const b = Date.parse(d.slice(0, 10) + 'T12:00:00Z');
  return Math.round((b - a) / 86400000);
}

export const CATEGORIE: Record<string, string> = {
  guasto_meccanico: 'Guasto meccanico', spia_accesa: 'Spia accesa', pneumatici: 'Pneumatici',
  danno_carrozzeria: 'Danno carrozzeria', incidente: 'Incidente', dotazioni: 'Dotazioni di bordo',
  pulizia: 'Pulizia', altro: 'Altro',
};
export const GRAVITA: Record<string, [Livello, string]> = {
  utilizzabile: ['ok', 'Utilizzabile'], da_verificare: ['warn', 'Da verificare'], fermo: ['ko', 'Veicolo fermo'],
};
export const STATI_SEGN: Record<string, [Livello, string]> = {
  aperta: ['ko', 'Aperta'], in_lavorazione: ['warn', 'In lavorazione'], chiusa: ['na', 'Chiusa'],
};
export const STATI_VEICOLO: Record<string, [Livello, string]> = {
  disponibile: ['ok', 'Disponibile'], in_uso: ['info', 'In uso'], fermo: ['ko', 'Fermo'],
  non_utilizzabile: ['ko', 'Non utilizzabile'], dismesso: ['na', 'Dismesso'],
};
export const TIPI_MOV: Record<string, [Livello, string]> = {
  presa: ['info', 'Presa in carico'], riconsegna: ['na', 'Riconsegna'], lettura_km: ['ok', 'Lettura km'], rettifica: ['warn', 'Rettifica'],
};
export const CARBURANTE = ['riserva', '1/4', '1/2', '3/4', 'pieno'];
export const lblCarb = (c: string | null) => (c ? (c === 'riserva' ? 'Riserva' : c === 'pieno' ? 'Pieno' : c) : '—');

export const livelloDi = (msgs: Messaggio[]): Livello =>
  msgs.some(x => x.l === 'ko') ? 'ko' : msgs.some(x => x.l === 'warn') ? 'warn' : 'ok';

/** Normalizza la targa come la vuole il database. */
export const normTarga = (t: string) => t.toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

export const TIPI_DOC: Record<string, string> = {
  libretto: 'Carta di circolazione', assicurazione: 'Certificato assicurativo', carta_verde: 'Carta verde', cid: 'Modulo CID (constatazione amichevole)', altro: 'Altro',
};
export const TIPI_DOTAZIONE: Record<string, string> = {
  estintore: 'Estintore di bordo', kit_primo_soccorso: 'Kit primo soccorso', triangolo: 'Triangolo', giubbotto: 'Giubbotto alta visibilità', cassetta_attrezzi: 'Cassetta attrezzi', altro: 'Altro',
};
export const STATI_MULTA: Record<string, [Livello, string]> = {
  da_identificare: ['ko', 'Conducente da identificare'], da_comunicare: ['warn', 'Da comunicare'], comunicata: ['info', 'Comunicata'],
  pagata: ['ok', 'Pagata'], contestata: ['na', 'Contestata'], chiusa: ['na', 'Chiusa'],
};
export const fmtEuro = (n: number | null | undefined) => (n == null ? '—' : Number(n).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' }));
