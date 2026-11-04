/** Tecnico suggerito per un intervento senza tecnico: prima la zona del CAP (cap_zone), poi il baricentro più vicino. */
import { distanzaKm } from '../../../supabase/functions/geocodifica/valida';

export interface Suggerimento { sigla: string; motivo: string; km?: number }
interface Punto { cap: string | null; lat: number | null; lon: number | null }
interface Assegnato { tecnico_sigla: string | null; lat: number | null; lon: number | null }

const km1 = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Baricentri dei tecnici, calcolati sugli interventi già assegnati del mese. */
export function baricentri(assegnati: Assegnato[], attive: Set<string>): Map<string, { lat: number; lon: number }> {
  const acc = new Map<string, { lat: number; lon: number; n: number }>();
  for (const a of assegnati) {
    if (!a.tecnico_sigla || a.lat == null || a.lon == null || !attive.has(a.tecnico_sigla)) continue;
    const x = acc.get(a.tecnico_sigla) ?? { lat: 0, lon: 0, n: 0 };
    x.lat += a.lat; x.lon += a.lon; x.n++; acc.set(a.tecnico_sigla, x);
  }
  return new Map([...acc].map(([k, v]) => [k, { lat: v.lat / v.n, lon: v.lon / v.n }]));
}

export function suggerisci(p: Punto, capZone: Map<string, string>, assegnati: Assegnato[] | Map<string, { lat: number; lon: number }>, attive: Set<string>): Suggerimento | null {
  const z = p.cap ? capZone.get(p.cap) : undefined;
  if (z && attive.has(z)) return { sigla: z, motivo: `CAP ${p.cap} → ${z}` };
  if (p.lat == null || p.lon == null) return null;
  const bc = assegnati instanceof Map ? assegnati : baricentri(assegnati, attive);
  let best: Suggerimento | null = null;
  for (const [s, c] of bc) {
    const d = distanzaKm({ lat: p.lat, lon: p.lon }, c);
    if (!best || d < best.km!) best = { sigla: s, km: d, motivo: '' };
  }
  if (best) best.motivo = `più vicino: ${best.sigla}, ${km1(best.km!)} km`;
  return best;
}
