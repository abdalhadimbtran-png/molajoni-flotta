import { describe, expect, it, vi } from 'vitest';
import { conRiprova, creaSalva, erroreDiRete, MESSAGGIO_ERRORE, testoToast } from './salva';

describe('erroreDiRete', () => {
  it('rete, 5xx e timeout: sì', () => {
    expect(erroreDiRete(new TypeError('Failed to fetch'))).toBe(true);
    expect(erroreDiRete({ message: 'TypeError: Load failed', code: '' })).toBe(true);
    expect(erroreDiRete({ message: 'x', status: 503 })).toBe(true);
    expect(erroreDiRete({ name: 'AbortError', message: 'aborted' })).toBe(true);
    expect(erroreDiRete({ message: 'Request timed out' })).toBe(true);
    expect(erroreDiRete({ code: 'PGRST001', message: 'db down' })).toBe(true);
  });
  it('4xx, permessi, validazione, SQL: no', () => {
    expect(erroreDiRete({ message: 'bad', status: 400 })).toBe(false);
    expect(erroreDiRete({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(erroreDiRete({ code: 'P0001', message: 'Scegli il tecnico' })).toBe(false);
    expect(erroreDiRete({ code: '23505', message: 'duplicate key' })).toBe(false);
    expect(erroreDiRete({ code: 'PGRST202', message: 'function not found' })).toBe(false);
    expect(erroreDiRete(new Error('Email non valida'))).toBe(false);
    expect(erroreDiRete(null)).toBe(false);
  });
});

describe('conRiprova', () => {
  it('un solo nuovo tentativo su errore di rete', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(7);
    await expect(conRiprova(fn, { attesaMs: 0 })).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('al secondo errore di rete si arrende', async () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(conRiprova(fn, { attesaMs: 0 })).rejects.toThrow('Failed to fetch');
    expect(fn).toHaveBeenCalledTimes(2);
  });
  it('nessun nuovo tentativo su validazione o con riprova:false', async () => {
    const v = vi.fn().mockRejectedValue({ code: 'P0001', message: 'Scegli il tecnico' });
    await expect(conRiprova(v, { attesaMs: 0 })).rejects.toMatchObject({ code: 'P0001' });
    expect(v).toHaveBeenCalledTimes(1);
    const r = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(conRiprova(r, { attesaMs: 0, riprova: false })).rejects.toBeTruthy();
    expect(r).toHaveBeenCalledTimes(1);
  });
});

describe('creaSalva', () => {
  it('blocca la seconda chiamata mentre la prima è in corso', async () => {
    const { esegui, inCorso } = creaSalva(() => {});
    let fine!: (v: string) => void;
    const fn = vi.fn(() => new Promise<string>(r => { fine = r; }));
    const p1 = esegui(fn);
    expect(inCorso()).toBe(true);
    await expect(esegui(fn)).resolves.toEqual({ ok: false, duplicato: true, messaggio: '' });
    fine('ok');
    await expect(p1).resolves.toEqual({ ok: true, dato: 'ok' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(inCorso()).toBe(false);
  });
  it('errore: toast uniforme con dettaglio, esito ko, sblocca', async () => {
    const msg: string[] = [];
    const { esegui, inCorso } = creaSalva(m => msg.push(m));
    const r = await esegui(() => Promise.reject({ code: '42501', message: 'permission denied for function x' }));
    expect(r.ok).toBe(false);
    expect(msg).toEqual([`${MESSAGGIO_ERRORE} Permesso negato per questa operazione.`]);
    expect(inCorso()).toBe(false);
  });
  it('toast:false non notifica', async () => {
    const n = vi.fn();
    await creaSalva(n).esegui(() => Promise.reject(new Error('x')), { toast: false });
    expect(n).not.toHaveBeenCalled();
  });
  it('testoToast senza dettaglio', () => {
    expect(testoToast(undefined)).toBe(MESSAGGIO_ERRORE);
  });
});
