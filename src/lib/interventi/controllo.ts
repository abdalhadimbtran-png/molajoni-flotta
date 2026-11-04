/** Controllo qualità delle posizioni: punti lontani dal centro della loro zona CAP. */
import { distanzaKm, RAGGIO_CAP_KM } from '../../../supabase/functions/geocodifica/valida';

interface P { id: number; cap: string | null; lat: number | null; lon: number | null }
const mediana = (v: number[]) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * Centro di ogni CAP = mediana delle posizioni dei punti con quel CAP (robusta agli errori isolati),
 * oppure il centro noto passato in `centri`. Ritorna, per i punti a più di `km` dal centro, la distanza.
 * Con meno di 3 punti nel CAP e nessun centro noto il controllo non è affidabile e il punto non viene segnalato.
 */
export function fuoriZona(punti: P[], km = RAGGIO_CAP_KM, centri: Map<string, { lat: number; lon: number }> = new Map()): Map<number, number> {
  const per = new Map<string, P[]>();
  for (const p of punti) if (p.cap && p.lat != null && p.lon != null) per.set(p.cap, [...(per.get(p.cap) ?? []), p]);
  const out = new Map<number, number>();
  for (const [cap, l] of per) {
    const c = centri.get(cap) ?? (l.length >= 3 ? { lat: mediana(l.map(p => p.lat!)), lon: mediana(l.map(p => p.lon!)) } : null);
    if (!c) continue;
    for (const p of l) { const d = distanzaKm({ lat: p.lat!, lon: p.lon! }, c); if (d > km) out.set(p.id, d); }
  }
  return out;
}
