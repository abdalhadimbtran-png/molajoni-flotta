import { describe, expect, it } from 'vitest';
import { SCORCIATOIE, indiceCifra, indiceSuccessivo, sequenzaVai, staScrivendo, tabRoving } from './tastiera';

describe('indiceSuccessivo (roving focus)', () => {
  it('frecce avanti/indietro a giro', () => {
    expect(indiceSuccessivo(0, 3, 'ArrowRight')).toBe(1);
    expect(indiceSuccessivo(2, 3, 'ArrowDown')).toBe(0);
    expect(indiceSuccessivo(0, 3, 'ArrowLeft')).toBe(2);
    expect(indiceSuccessivo(1, 3, 'ArrowUp')).toBe(0);
  });
  it('J/K e limiti senza giro (elenchi)', () => {
    expect(indiceSuccessivo(-1, 5, 'j', false)).toBe(0);
    expect(indiceSuccessivo(-1, 5, 'k', false)).toBe(4);
    expect(indiceSuccessivo(4, 5, 'J', false)).toBe(4);
    expect(indiceSuccessivo(0, 5, 'K', false)).toBe(0);
  });
  it('Home/End, altri tasti, elenco vuoto', () => {
    expect(indiceSuccessivo(2, 5, 'Home')).toBe(0);
    expect(indiceSuccessivo(2, 5, 'End')).toBe(4);
    expect(indiceSuccessivo(2, 5, 'x')).toBeNull();
    expect(indiceSuccessivo(0, 0, 'ArrowDown')).toBeNull();
  });
});

describe('gruppo a scelta (radio group)', () => {
  it('cifre 1–9 → n-esima voce se esiste', () => {
    expect(indiceCifra('1', 4)).toBe(0);
    expect(indiceCifra('4', 4)).toBe(3);
    expect(indiceCifra('5', 4)).toBeNull();
    expect(indiceCifra('0', 4)).toBeNull();
    expect(indiceCifra('a', 4)).toBeNull();
  });
  it('roving tabindex: solo la scelta, o la prima se nessuna', () => {
    expect([0, 1, 2].map(i => tabRoving(i === 1, i, true))).toEqual([-1, 0, -1]);
    expect([0, 1, 2].map(i => tabRoving(false, i, false))).toEqual([0, -1, -1]);
  });
});

describe('scorciatoie globali', () => {
  it('non partono mentre si scrive', () => {
    expect(staScrivendo({ tagName: 'INPUT', type: 'text' })).toBe(true);
    expect(staScrivendo({ tagName: 'INPUT', type: 'search' })).toBe(true);
    expect(staScrivendo({ tagName: 'TEXTAREA' })).toBe(true);
    expect(staScrivendo({ tagName: 'SELECT' })).toBe(true);
    expect(staScrivendo({ tagName: 'DIV', isContentEditable: true })).toBe(true);
    expect(staScrivendo({ tagName: 'INPUT', type: 'checkbox' })).toBe(false);
    expect(staScrivendo({ tagName: 'BUTTON' })).toBe(false);
    expect(staScrivendo(null)).toBe(false);
  });
  it('G poi O/P/T/C', () => {
    expect(sequenzaVai('g', 'o')).toBe('');
    expect(sequenzaVai('g', 'P')).toBe('/pratiche');
    expect(sequenzaVai('g', 't')).toBe('/trasferimenti');
    expect(sequenzaVai('g', 'c')).toBe('/clienti');
    expect(sequenzaVai('g', 'x')).toBeNull();
    expect(sequenzaVai(null, 'p')).toBeNull();
  });
  it('il riquadro «?» elenca tutte le scorciatoie richieste', () => {
    const t = SCORCIATOIE.map(s => s.tasti.join('+'));
    for (const k of ['N', '/', '?', 'Esc', 'G+O', 'G+P', 'G+T', 'G+C', 'J+K', 'A', 'Ctrl+Invio', '1–9']) expect(t).toContain(k);
  });
});
