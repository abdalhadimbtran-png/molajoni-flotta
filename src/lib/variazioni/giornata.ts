/** Variazioni della giornata: anteprima urgenza e suggerimenti tecnico (logica pura, test in giornata.test.ts). */
import { fmtHM, hm } from '../percorsi/ottimizza';

export interface TappaStima {
  key: string; luogo: string; attivita?: string | null; indirizzo?: string | null; cap?: string | null;
  lat?: number | null; lon?: number | null; arrivo: string; partenza: string;
  arrivo_stimato: string; partenza_stimata: string; slittamento: number; ritardi_min?: number;
  urgente?: boolean; intervento_id?: number | null; urgenza_id?: number;
}
export interface StimaTecnico {
  tecnico_id: number; nome: string; sigla: string | null; assente: boolean;
  tappe: TappaStima[]; corrente: string | null; fine_stimata: string | null; rientro_min: number; ritardo_tot: number; soglia: string;
  finita: { alle: string; tutto_fatto: boolean; nota?: string | null } | null; n_ritardi: number;
  ritardi: { key: string; motivo: string; minuti: number; nota?: string | null; alle: string }[];
  urgenze: { id: number; luogo: string; attivita: string; stato: string; arrivo: string; inviata_at: string | null; letta_at: string | null }[];
  percorso_id: number | null;
}
export interface Punto { lat?: number | null; lon?: number | null; cap?: string | null }

/** Distanza in linea d'aria (km). */
export function kmTra(a: Punto, b: Punto): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
/** Stima del tratto: km in linea d'aria × 1,3, 30 km/h medi in città + 10 min di margine; senza coordinate 20 min. */
export function minutiViaggio(a: Punto | null, b: Punto | null): number {
  const km = a && b ? kmTra(a, b) : null;
  if (km == null) return 20;
  return Math.round((km * 1.3) / 30 * 60 + 10);
}
export const capDa = (t: { cap?: string | null; indirizzo?: string | null; luogo?: string | null }): string | null =>
  t.cap || (`${t.indirizzo ?? ''} ${t.luogo ?? ''}`.match(/\b(0\d{4})\b/)?.[1] ?? null);

/** Posizione stimata del tecnico: tappa corrente (o l'ultima prima di essa) con coordinate. */
export function posizione(s: Pick<StimaTecnico, 'tappe' | 'corrente'>): Punto | null {
  const i = Math.max(0, s.tappe.findIndex(t => t.key === s.corrente));
  for (let k = i; k >= 0; k--) { const t = s.tappe[k]; if (t && t.lat != null && t.lon != null) return { lat: t.lat, lon: t.lon, cap: capDa(t) }; }
  const t = s.tappe[i];
  return t ? { cap: capDa(t) } : null;
}
/** Minuti di lavoro ancora da fare dalla tappa corrente in poi. */
export function caricoResiduo(s: Pick<StimaTecnico, 'tappe' | 'corrente'>): number {
  const i = Math.max(0, s.tappe.findIndex(t => t.key === s.corrente));
  return s.tappe.slice(i).reduce((m, t) => m + Math.max(0, hm(t.partenza) - hm(t.arrivo)), 0);
}

export interface Anteprima {
  dopo_key: string | null; arrivo: string; partenza: string; spostamento: number; ritardo_base: number; viaggio: number;
  nuove: { key: string; luogo: string; arrivo: string; partenza: string; prima: string }[];
  fine_prima: string | null; fine_nuova: string; non_entrano: string[];
}

/**
 * L'urgenza va dopo la tappa corrente (o la prima se la giornata non è iniziata e `inTesta`).
 * Le tappe successive (escluse quelle in `spostate`) slittano di quanto serve.
 */
export function anteprimaUrgenza(s: Pick<StimaTecnico, 'tappe' | 'corrente' | 'fine_stimata' | 'rientro_min' | 'soglia'>, u: Punto & { durata: number },
  ora: string, spostate: Set<string> = new Set(), dopo: string | null = s.corrente): Anteprima {
  const restanti = s.tappe.filter(t => !spostate.has(t.key) || t.key === dopo);
  const iDopo = dopo ? restanti.findIndex(t => t.key === dopo) : -1;
  const prev = iDopo >= 0 ? restanti[iDopo] : null;
  const viaggio = minutiViaggio(prev, u);
  const inizio = Math.max(prev ? hm(prev.partenza_stimata) : hm(ora), hm(ora));
  const arrivo = inizio + viaggio, partenza = arrivo + u.durata;
  const dopoU = restanti.slice(iDopo + 1);
  const next = dopoU[0];
  let spost = 0;
  if (next) spost = Math.max(0, partenza + minutiViaggio(u, next) - hm(next.arrivo_stimato));
  const nuove = dopoU.map(t => ({ key: t.key, luogo: t.luogo, prima: t.arrivo_stimato, arrivo: fmtHM(hm(t.arrivo_stimato) + spost), partenza: fmtHM(hm(t.partenza_stimata) + spost) }));
  const ultima = nuove.length ? hm(nuove[nuove.length - 1].partenza) : partenza;
  const fine = ultima + (s.rientro_min || 0);
  const soglia = hm(s.soglia || '18:00');
  return {
    dopo_key: prev?.key ?? null, arrivo: fmtHM(arrivo), partenza: fmtHM(partenza), spostamento: spost, ritardo_base: prev?.slittamento ?? 0, viaggio,
    nuove, fine_prima: s.fine_stimata, fine_nuova: fmtHM(fine), non_entrano: nuove.filter(t => hm(t.partenza) > soglia).map(t => t.key),
  };
}

export interface SuggTecnico { tecnico_id: number; nome: string; motivo: string; km: number | null; carico: number; zona: boolean }

/** Tecnici per l'urgenza: zona CAP prima, poi più vicino alla posizione stimata, poi meno carico. Esclusi assenti e chi ha finito. */
export function suggerisciTecnici(tecnici: StimaTecnico[], u: Punto, capZone: Record<string, number>): SuggTecnico[] {
  const cap = u.cap ?? null; const zonaDi = cap ? capZone[cap] : undefined;
  return tecnici.filter(t => !t.assente && !t.finita).map(t => {
    const pos = posizione(t); const km = pos ? kmTra(pos, u) : null; const carico = caricoResiduo(t); const zona = zonaDi === t.tecnico_id;
    const parti = [zona ? `zona CAP ${cap}` : null, km != null ? `${km.toFixed(1).replace('.', ',')} km dalla posizione stimata` : null, `${Math.round(carico / 6) / 10} h ancora da fare`].filter(Boolean);
    return { tecnico_id: t.tecnico_id, nome: t.sigla || t.nome, motivo: parti.join(' · '), km, carico, zona };
  }).sort((a, b) => Number(b.zona) - Number(a.zona) || (a.km ?? 1e9) - (b.km ?? 1e9) || a.carico - b.carico);
}

export interface Carico { data: string; tecnico_id: number; n: number; minuti: number; lat: number | null; lon: number | null }
export interface Compito extends Punto { key: string; data: string; tecnico_id: number; luogo: string; attivita?: string | null; indirizzo?: string | null }

/** Riassegnazione per assenza: stessa zona CAP, poi più vicino (baricentro del giorno), poi meno carico quel giorno. */
export function suggerisciRiassegnazione(c: Compito, carichi: Carico[], capZone: Record<string, number>, nomi: Record<number, string>): { tecnico_id: number; motivo: string } | null {
  const del = carichi.filter(x => x.data === c.data && x.tecnico_id !== c.tecnico_id);
  if (!del.length) return null;
  const cap = capDa(c);
  const z = cap ? capZone[cap] : undefined;
  const inZona = del.find(x => x.tecnico_id === z);
  if (inZona) return { tecnico_id: inZona.tecnico_id, motivo: `stessa zona CAP ${cap} (${nomi[inZona.tecnico_id] ?? ''})` };
  const conKm = del.map(x => ({ x, km: kmTra(c, x) })).filter(y => y.km != null).sort((a, b) => a.km! - b.km!);
  if (conKm.length) return { tecnico_id: conKm[0].x.tecnico_id, motivo: `più vicino: ${conKm[0].km!.toFixed(1).replace('.', ',')} km` };
  const meno = [...del].sort((a, b) => a.minuti - b.minuti || a.n - b.n)[0];
  return { tecnico_id: meno.tecnico_id, motivo: `meno carico quel giorno (${meno.n} interventi)` };
}

export const MOTIVI_RITARDO: [string, string][] = [
  ['cliente', 'Il cliente mi ha chiesto di aspettare'], ['tempo', "L'intervento richiede più tempo"], ['traffico', 'Traffico'], ['veicolo', 'Problema al veicolo'], ['altro', 'Altro'],
];
export const MINUTI_RITARDO = [15, 30, 45, 60, 90];
export const mapsLink = (p: { lat?: number | null; lon?: number | null; indirizzo?: string | null; luogo?: string | null }) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.lat != null && p.lon != null ? `${p.lat},${p.lon}` : (p.indirizzo || p.luogo || ''))}`;
