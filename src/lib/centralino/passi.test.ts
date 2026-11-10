import { describe, expect, it } from 'vitest';
import { avanzaConModello } from './passi';

describe('avanzaConModello', () => {
  it('riconosce le varianti per sottotipo (Disdetta, Anagrafica)', () => {
    expect(avanzaConModello({ tipo: 'modifica', sottotipo: 'Disdetta' }, 'modifica_evasa', 'conferma_disdetta')).toBe(true);
    expect(avanzaConModello({ tipo: 'modifica', sottotipo: 'Anagrafica' }, 'modifica_evasa', 'conferma_anagrafica')).toBe(true);
    expect(avanzaConModello({ tipo: 'modifica', sottotipo: 'Calendario' }, 'modifica_evasa', 'modifica_evasa')).toBe(true);
  });
  it('non avanza il passo coordinatore dal compositore', () => {
    expect(avanzaConModello({ tipo: 'sopralluogo' }, 'sopralluogo_coordinatore', 'sopralluogo_coordinatore')).toBe(false);
  });
  it('modello diverso o passo senza modello: no', () => {
    expect(avanzaConModello({ tipo: 'manutenzione' }, undefined, 'presa_intervento')).toBe(false);
    expect(avanzaConModello({ tipo: 'offerta_piccola' }, 'invio_offerta', 'presa_offerta_piccola')).toBe(false);
  });
});
