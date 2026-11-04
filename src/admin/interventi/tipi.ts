export interface Intervento {
  id: number; id_intervento: string; numero: string | null; data_riferimento: string | null;
  tecnico_sigla: string | null; tecnico_id: number | null; impianto: string | null; cod_cliente: string | null; cliente: string | null;
  comune: string | null; cap: string | null; prov: string | null; indirizzo_originale: string | null; via: string | null; civico: string | null;
  note: string | null; componenti: number | null; tipo: string | null; famiglie: string[]; fuori_lazio: boolean;
  lat: number | null; lon: number | null; geo_qualita: 'esatto' | 'via' | 'centro_cap' | 'centro_comune' | 'manuale' | null;
  geo_indirizzo: string | null; geo_dubbio: boolean; geo_tentato_at: string | null;
  stato: 'da_pianificare' | 'pianificato' | 'eseguito' | 'annullato'; durata_minuti: number | null;
  geo_fonte: string | null; indirizzo_cambiato: boolean;
}
export const CAMPI = 'id,id_intervento,numero,data_riferimento,tecnico_sigla,tecnico_id,impianto,cod_cliente,cliente,comune,cap,prov,indirizzo_originale,via,civico,note,componenti,tipo,famiglie,fuori_lazio,lat,lon,geo_qualita,geo_indirizzo,geo_dubbio,geo_tentato_at,stato,durata_minuti,geo_fonte,indirizzo_cambiato';

export const QUALITA: Record<string, string> = { esatto: 'Esatta (civico)', via: 'Via (punto medio)', centro_cap: 'Centro CAP', centro_comune: 'Centro comune', manuale: 'Manuale' };
export const STATI: Record<string, string> = { da_pianificare: 'Da pianificare', pianificato: 'Pianificato', eseguito: 'Eseguito', annullato: 'Annullato' };

const PALETTE: Record<string, string> = { TECA: '#1f77b4', TECB: '#2ca02c', TECE: '#9467bd', TECI: '#ff7f0e', TECF: '#17becf', TECC: '#8c564b', TECH: '#e377c2' };
const ALTRI = ['#bcbd22', '#7f7f7f', '#393b79', '#637939', '#8c6d31'];
export function coloreTecnico(s: string | null): string {
  if (!s) return '#C8102E';
  if (PALETTE[s]) return PALETTE[s];
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ALTRI[h % ALTRI.length];
}

/** Da verificare: posizione mancante, approssimata al centro CAP/comune o segnata come dubbia. */
export const daVerificare = (i: Intervento) => !i.fuori_lazio && i.geo_qualita !== 'manuale' && (i.lat == null || i.geo_dubbio || i.geo_qualita === 'centro_cap' || i.geo_qualita === 'centro_comune');

/** "Cliente X – sede/impianto Y" (un cliente può avere molte sedi: si identifica sempre l'impianto). */
export const etichettaSede = (i: Pick<Intervento, 'cliente' | 'cod_cliente' | 'impianto'>) =>
  `${i.cliente ?? 'Cliente'}${i.cod_cliente ? ` (${i.cod_cliente})` : ''} – sede/impianto ${i.impianto ?? '—'}`;
export const indirizzoBreve = (i: Pick<Intervento, 'via' | 'civico' | 'cap' | 'comune'>) =>
  `${[i.via, i.civico].filter(Boolean).join(' ')}${i.cap || i.comune ? `, ${[i.cap, i.comune].filter(Boolean).join(' ')}` : ''}`;
export const linkGoogle = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;
