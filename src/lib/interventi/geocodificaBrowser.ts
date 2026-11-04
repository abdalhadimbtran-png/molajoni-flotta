/**
 * Geocodifica degli interventi: prima la funzione server; se i fornitori la bloccano (errore_servizio),
 * riserva dal browser (Nominatim + Photon, ≤ 1 richiesta/s per fornitore) con la stessa logica condivisa,
 * salvando ogni risultato nel DB (tabella + geocache via RPC). Gli errori del servizio non segnano mai la riga.
 */
import { supabase } from '../supabase';
import { catena, ErroreServizio, geocodificaRiga, nominatim, photon, type Cache, type Geo, type RigaGeo } from '../../../supabase/functions/geocodifica/valida';

export interface Avanzamento { fatti: number; tot: number; modo: 'server' | 'browser'; errore?: string | null }

const INIT: RequestInit = { headers: { Accept: 'application/json' }, referrerPolicy: 'strict-origin-when-cross-origin' };
const fetchBrowser = (u: string, i?: RequestInit) => fetch(u, i);

const cacheRpc: Cache = {
  async leggi(k) {
    const { data, error } = await supabase.rpc('geocache_leggi', { p_chiave: k });
    if (error) return undefined;
    const d = data as { trovato: boolean; v: Geo[] | null };
    return d.trovato ? d.v ?? [] : undefined;
  },
  async scrivi(k, v) { await supabase.rpc('geocache_scrivi', { p_chiave: k, p_dettaglio: v.slice(0, 6) }); },
};

async function contaDaFare(): Promise<number> {
  const { count } = await supabase.from('interventi_importati').select('id', { count: 'exact', head: true }).eq('fuori_lazio', false).is('lat', null).is('geo_tentato_at', null);
  return count ?? 0;
}

async function dalBrowser(onProg: (a: Avanzamento) => void, base: number, tot: number, fermato: () => boolean): Promise<Avanzamento> {
  const f = catena([nominatim(fetchBrowser, INIT), photon(fetchBrowser, INIT)]);
  let fatti = base;
  for (;;) {
    const { data, error } = await supabase.from('interventi_importati').select('id,via,civico_geo,cap,comune,prov')
      .eq('fuori_lazio', false).is('lat', null).is('geo_tentato_at', null).order('id').limit(50);
    if (error) throw error;
    if (!data.length) return { fatti, tot, modo: 'browser' };
    for (const r of data as (RigaGeo & { id: number })[]) {
      if (fermato()) return { fatti, tot, modo: 'browser' };
      const e = await geocodificaRiga(r, f, cacheRpc); // ErroreServizio risale: la riga resta da fare
      const ora = new Date().toISOString();
      const u = await supabase.from('interventi_importati').update(e ? { ...e, geo_tentato_at: ora } : { geo_tentato_at: ora }).eq('id', r.id);
      if (u.error) throw u.error;
      fatti++; onProg({ fatti, tot, modo: 'browser' });
    }
  }
}

/** Geocodifica tutto ciò che manca. Server prima, browser come riserva. */
export async function geocodificaTutto(onProg: (a: Avanzamento) => void, fermato: () => boolean = () => false): Promise<Avanzamento> {
  const tot = await contaDaFare();
  let fatti = 0;
  onProg({ fatti, tot, modo: 'server' });
  if (!tot) return { fatti, tot, modo: 'server' };
  let motivo: string | null = null;
  for (let giro = 0; giro < 100 && !fermato(); giro++) {
    const { data, error } = await supabase.functions.invoke('geocodifica', { body: {} });
    if (error) { motivo = error.message; break; }
    const d = data as { fatti: number; rimanenti: number; errore_servizio?: string | null };
    fatti += d.fatti; onProg({ fatti, tot, modo: 'server' });
    if (d.errore_servizio) { motivo = d.errore_servizio; break; }
    if (!d.rimanenti || !d.fatti) return { fatti, tot, modo: 'server' };
  }
  if (fermato()) return { fatti, tot, modo: 'server' };
  console.warn('Geocodifica server non disponibile, passo al browser:', motivo);
  try { return await dalBrowser(onProg, fatti, tot, fermato); }
  catch (e) {
    if (e instanceof ErroreServizio) return { fatti, tot, modo: 'browser', errore: 'Servizio indirizzi non raggiungibile. Riprova più tardi.' };
    throw e;
  }
}
