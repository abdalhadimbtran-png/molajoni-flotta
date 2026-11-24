import { describe, expect, it } from 'vitest';
import { SCORCIATOIE, tastoNuovo, tastoSalva, indiceCifra, indiceSuccessivo, sequenzaVai, staScrivendo, tabRoving, tastoTelefono } from './tastiera';

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
  it('G poi O/P/C (Trasferimenti tolto dal menu)', () => {
    expect(sequenzaVai('g', 'o')).toBe('');
    expect(sequenzaVai('g', 'P')).toBe('/pratiche');
    expect(sequenzaVai('g', 't')).toBeNull();
    expect(sequenzaVai('g', 'c')).toBe('/clienti');
    expect(sequenzaVai('g', 'x')).toBeNull();
    expect(sequenzaVai(null, 'p')).toBeNull();
  });
  it('il riquadro «?» elenca tutte le scorciatoie richieste', () => {
    const t = SCORCIATOIE.map(s => s.tasti.join('+'));
    for (const k of ['N', '/', '?', 'Esc', 'G+O', 'G+P', 'G+C', 'J+K', 'A', 'Ctrl+Invio', 'Ctrl+Maiusc+Invio', '1–5', '1+2', 'U+O', 'Tab', 'T']) expect(t).toContain(k);
  });
  it('niente scorciatoie di funzioni tolte', () => {
    const tutto = SCORCIATOIE.map(s => `${s.tasti.join('+')} ${s.testo}`).join('\n');
    expect(tutto).not.toMatch(/trasferiment/i);
    expect(tutto).not.toContain('G+T');
    expect(new Set(SCORCIATOIE.map(s => s.testo)).size).toBe(SCORCIATOIE.length); // chiavi React uniche
  });
});

describe('tastoTelefono', () => {
  it('T senza modificatori e fuori dai campi', () => {
    expect(tastoTelefono({ key: 't', target: { tagName: 'BUTTON' } })).toBe(true);
    expect(tastoTelefono({ key: 'T', ctrlKey: true })).toBe(false);
    expect(tastoTelefono({ key: 't', target: { tagName: 'INPUT', type: 'text' } })).toBe(false);
    expect(tastoTelefono({ key: 'x' })).toBe(false);
  });
});

describe('Nuovo contatto: cifre fuori dai gruppi (tastoNuovo)', () => {
  const base = { canaleFatto: false, tipoScelto: false, gestione: false, nCanali: 5, nTipi: 5, nSottotipi: 0, urgenza: false };
  it('prima il Canale, poi la Richiesta', () => {
    expect(tastoNuovo('2', base)).toEqual({ gruppo: 'canale', indice: 1 });
    expect(tastoNuovo('3', { ...base, canaleFatto: true })).toEqual({ gruppo: 'tipo', indice: 2 });
    expect(tastoNuovo('6', { ...base, canaleFatto: true })).toBeNull();
  });
  it('richiesta già scelta (anche col mouse): il Canale non si cambia più per sbaglio', () => {
    expect(tastoNuovo('1', { ...base, tipoScelto: true })).toEqual({ gruppo: 'tipo', indice: 0 });
  });
  it('Offerta: 1 Jennifer, 2 Commerciale', () => {
    const o = { ...base, canaleFatto: true, tipoScelto: true, gestione: true };
    expect(tastoNuovo('1', o)).toEqual({ gruppo: 'gestione', indice: 0 });
    expect(tastoNuovo('2', o)).toEqual({ gruppo: 'gestione', indice: 1 });
    expect(tastoNuovo('3', o)).toBeNull();
  });
  it('Intervento: cifre al Dettaglio, U/O all\'urgenza', () => {
    const m = { ...base, canaleFatto: true, tipoScelto: true, nSottotipi: 4, urgenza: true };
    expect(tastoNuovo('4', m)).toEqual({ gruppo: 'sottotipo', indice: 3 });
    expect(tastoNuovo('u', m)).toEqual({ gruppo: 'urgenza', indice: 0 });
    expect(tastoNuovo('O', m)).toEqual({ gruppo: 'urgenza', indice: 1 });
    expect(tastoNuovo('u', { ...m, urgenza: false })).toBeNull();
  });
  it('altri tasti: niente', () => {
    expect(tastoNuovo('0', base)).toBeNull();
    expect(tastoNuovo('x', base)).toBeNull();
    expect(tastoNuovo('Enter', base)).toBeNull();
  });
});

describe('tastoSalva', () => {
  it('Ctrl/⌘+Invio = chiudi, con Maiusc = da seguire', () => {
    expect(tastoSalva({ key: 'Enter', ctrlKey: true })).toBe('chiudi');
    expect(tastoSalva({ key: 'Enter', metaKey: true })).toBe('chiudi');
    expect(tastoSalva({ key: 'Enter', ctrlKey: true, shiftKey: true })).toBe('seguire');
    expect(tastoSalva({ key: 'Enter' })).toBeNull();
    expect(tastoSalva({ key: 'Enter', ctrlKey: true, altKey: true })).toBeNull();
    expect(tastoSalva({ key: 's', ctrlKey: true })).toBeNull();
  });
});
