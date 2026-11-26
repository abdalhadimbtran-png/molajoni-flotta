import { describe, expect, it } from 'vitest';
import { aBlocchi, anteprimaNumeri, confermaElimina, motivoElimina, rpcMancante } from './eliminaPratiche';

describe('elimina pratiche', () => {
  it('conferma solo con ELIMINA', () => {
    expect(confermaElimina('ELIMINA')).toBe(true); expect(confermaElimina(' elimina ')).toBe(true);
    expect(confermaElimina('ELIMIN')).toBe(false); expect(confermaElimina('')).toBe(false);
  });
  it('motivo predefinito', () => { expect(motivoElimina('  ')).toBe('Prova'); expect(motivoElimina(' Doppia ')).toBe('Doppia'); });
  it('rpc mancante', () => {
    expect(rpcMancante({ code: 'PGRST202', message: 'x' })).toBe(true);
    expect(rpcMancante({ code: '42501', message: 'riservata' })).toBe(false); expect(rpcMancante(null)).toBe(false);
  });
  it('anteprima e blocchi', () => {
    expect(anteprimaNumeri(['a', 'b'])).toBe('a, b');
    expect(anteprimaNumeri(['1', '2', '3', '4', '5', '6', '7'])).toBe('1, 2, 3, 4, 5 … (+2)');
    expect(aBlocchi(Array.from({ length: 401 }, (_, i) => i)).map(b => b.length)).toEqual([200, 200, 1]);
  });
});
