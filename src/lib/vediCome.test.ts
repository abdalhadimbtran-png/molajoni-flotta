import { describe, expect, it, vi } from 'vitest';
import { analizza, bloccaSeSolaLettura, conGuardia, ErroreSolaLettura, richiestaAmmessa, ruoliEffettivi, type VediCome } from './vediCome';
import { creaSalva } from './salva';

const ID = '11111111-2222-3333-4444-555555555555';
const V: VediCome = { userId: ID, nome: 'Jennifer', email: 'j@x.it', dipendenteId: null, ruoli: { admin: false, flotta: false, hr: false, formazione: false, centralino: true, direzione: false } };
const B = 'https://abc.supabase.co';
const REALI = { admin: true, flotta: true, hr: true, formazione: true, centralino: true, direzione: true };

describe('override vedi come', () => {
  it('valida il contenuto salvato e non accetta admin', () => {
    expect(analizza(null)).toBeNull();
    expect(analizza('{rotto')).toBeNull();
    expect(analizza(JSON.stringify({ userId: 'x', nome: 'a' }))).toBeNull();
    const v = analizza(JSON.stringify({ ...V, ruoli: { admin: true, hr: 'si', centralino: true } }))!;
    expect(v.ruoli).toEqual({ admin: false, flotta: false, hr: false, formazione: false, centralino: true, direzione: false });
  });
  it('vale solo per l\'amministratore reale', () => {
    const nonAdmin = { ...REALI, admin: false, flotta: false };
    expect(ruoliEffettivi(nonAdmin, V)).toBe(nonAdmin);
    expect(ruoliEffettivi(REALI, null)).toBe(REALI);
    expect(ruoliEffettivi(REALI, V)).toEqual(V.ruoli);
  });
});

describe('guardia sola lettura', () => {
  it('ammette letture, auth e RPC di lettura; blocca il resto', () => {
    expect(richiestaAmmessa(`${B}/rest/v1/pratiche?select=*`, 'GET', [B])).toBe(true);
    expect(richiestaAmmessa(`${B}/auth/v1/logout`, 'POST', [B])).toBe(true);
    expect(richiestaAmmessa(`${B}/rest/v1/rpc/hr_richieste`, 'POST', [B])).toBe(true);
    expect(richiestaAmmessa(`${B}/rest/v1/rpc/centralino_avanza`, 'POST', [B])).toBe(false);
    expect(richiestaAmmessa(`${B}/rest/v1/pratiche`, 'POST', [B])).toBe(false);
    expect(richiestaAmmessa(`${B}/rest/v1/pratiche?id=eq.1`, 'PATCH', [B])).toBe(false);
    expect(richiestaAmmessa(`${B}/rest/v1/pratiche?id=eq.1`, 'DELETE', [B])).toBe(false);
    expect(richiestaAmmessa(`${B}/functions/v1/flotta/account`, 'POST', [B])).toBe(false);
    expect(richiestaAmmessa(`${B}/storage/v1/object/x`, 'POST', [B])).toBe(false);
    expect(richiestaAmmessa('https://router.project-osrm.org/route', 'POST', [B])).toBe(true);
  });
  it('fetch con guardia rifiuta senza chiamare la rete', async () => {
    const base = vi.fn(async () => new Response('ok'));
    const f = conGuardia(base as unknown as typeof fetch, [B], () => V);
    await expect(f(`${B}/rest/v1/pratiche`, { method: 'POST' })).rejects.toThrow('Modalità sola lettura: stai vedendo come Jennifer');
    expect(base).not.toHaveBeenCalled();
    await f(`${B}/rest/v1/pratiche`);
    expect(base).toHaveBeenCalledTimes(1);
    const libera = conGuardia(base as unknown as typeof fetch, [B], () => null);
    await libera(`${B}/rest/v1/pratiche`, { method: 'POST' });
    expect(base).toHaveBeenCalledTimes(2);
  });
  it('bloccaSeSolaLettura e salva condiviso', async () => {
    expect(() => bloccaSeSolaLettura(() => V)).toThrow(ErroreSolaLettura);
    expect(() => bloccaSeSolaLettura(() => null)).not.toThrow();
    const notifica = vi.fn(); const fn = vi.fn(async () => 1);
    const r = await creaSalva(notifica, () => V).esegui(fn);
    expect(r.ok).toBe(false); expect(fn).not.toHaveBeenCalled();
    expect(notifica).toHaveBeenCalledWith('Modalità sola lettura: stai vedendo come Jennifer');
    expect((await creaSalva(notifica, () => null).esegui(fn)).ok).toBe(true);
  });
});
