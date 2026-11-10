import { describe, expect, it } from 'vitest';
import { eErroreChunk } from './Protezione';
describe('eErroreChunk', () => {
  it('riconosce errori di chunk dopo deploy', () => {
    expect(eErroreChunk(new TypeError('Failed to fetch dynamically imported module: /assets/x.js'))).toBe(true);
    expect(eErroreChunk(new Error('Importing a module script failed.'))).toBe(true);
  });
  it('ignora errori normali', () => { expect(eErroreChunk(new Error('permission denied'))).toBe(false); });
});
