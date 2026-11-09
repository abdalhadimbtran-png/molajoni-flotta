import { useEffect, type KeyboardEvent as RKE, type RefObject } from 'react';

/**
 * Tastiera del Centralino: funzioni pure (testate) + piccoli aiuti DOM.
 * Gruppi a scelta (role="radiogroup"): frecce = sposta, Invio/Spazio = scegli e passa al gruppo dopo, 1–9 = n-esima voce.
 */

/** Scorciatoie mostrate nel riquadro «?» e in docs/CENTRALINO.md. */
export const SCORCIATOIE: { tasti: string[]; testo: string; gruppo: 'Ovunque' | 'Elenchi' | 'Moduli' }[] = [
  { tasti: ['N'], testo: 'Nuovo contatto', gruppo: 'Ovunque' },
  { tasti: ['/'], testo: 'Cerca pratica', gruppo: 'Ovunque' },
  { tasti: ['G', 'O'], testo: 'Vai a Oggi', gruppo: 'Ovunque' },
  { tasti: ['G', 'P'], testo: 'Vai a Pratiche', gruppo: 'Ovunque' },
  { tasti: ['G', 'T'], testo: 'Vai a Trasferimenti', gruppo: 'Ovunque' },
  { tasti: ['G', 'C'], testo: 'Vai a Clienti', gruppo: 'Ovunque' },
  { tasti: ['?'], testo: 'Mostra queste scorciatoie', gruppo: 'Ovunque' },
  { tasti: ['Esc'], testo: 'Chiudi finestra / indietro', gruppo: 'Ovunque' },
  { tasti: ['J', 'K'], testo: 'Riga successiva / precedente (anche ↓ ↑)', gruppo: 'Elenchi' },
  { tasti: ['Invio'], testo: 'Apri la riga evidenziata', gruppo: 'Elenchi' },
  { tasti: ['A'], testo: 'Prossimo passo della pratica', gruppo: 'Elenchi' },
  { tasti: ['↑', '↓'], testo: 'Sposta nella scelta (anche ← →)', gruppo: 'Moduli' },
  { tasti: ['Invio'], testo: 'Scegli e passa al gruppo dopo · nel passo: Avanti', gruppo: 'Moduli' },
  { tasti: ['1–9'], testo: 'Scegli la n-esima voce', gruppo: 'Moduli' },
  { tasti: ['Tab'], testo: 'Gruppo / campo successivo (Maiusc+Tab indietro)', gruppo: 'Moduli' },
  { tasti: ['Ctrl', 'Invio'], testo: 'Salva il nuovo contatto', gruppo: 'Moduli' },
];

/** Destinazioni della sequenza «G poi …». */
export const VAI: Record<string, string> = { o: '', p: '/pratiche', t: '/trasferimenti', c: '/clienti' };

interface ElLike { tagName?: string; type?: string; isContentEditable?: boolean; closest?: (s: string) => unknown }
/** true se l'utente sta scrivendo (le scorciatoie a lettera non devono partire). */
export function staScrivendo(el: ElLike | null | undefined): boolean {
  if (!el || !el.tagName) return false;
  const t = el.tagName.toUpperCase();
  if (t === 'TEXTAREA' || t === 'SELECT') return true;
  if (t === 'INPUT') return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes((el.type ?? 'text').toLowerCase());
  return !!el.isContentEditable;
}

/** Nuovo indice per un tasto di movimento (a giro), oppure null se il tasto non muove. */
export function indiceSuccessivo(i: number, n: number, key: string, giro = true): number | null {
  if (n <= 0) return null;
  const avanti = ['ArrowDown', 'ArrowRight', 'j', 'J'].includes(key), indietro = ['ArrowUp', 'ArrowLeft', 'k', 'K'].includes(key);
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (!avanti && !indietro) return null;
  if (i < 0) return avanti ? 0 : n - 1;
  const x = i + (avanti ? 1 : -1);
  return giro ? (x + n) % n : Math.max(0, Math.min(n - 1, x));
}

/** Tasti 1–9 → indice 0–8 (se esiste quella voce). */
export function indiceCifra(key: string, n: number): number | null {
  if (!/^[1-9]$/.test(key)) return null;
  const i = Number(key) - 1;
  return i < n ? i : null;
}

/** Roving tabindex: solo la voce scelta (o la prima, se nessuna) è raggiungibile con Tab. */
export const tabRoving = (scelta: boolean, i: number, qualcunaScelta: boolean): 0 | -1 => (scelta || (!qualcunaScelta && i === 0) ? 0 : -1);

/** Sequenza «G poi lettera»: restituisce il percorso (relativo alla base) o null. */
export function sequenzaVai(prec: string | null, key: string): string | null {
  if (prec?.toLowerCase() !== 'g') return null;
  const k = key.toLowerCase();
  return k in VAI ? VAI[k] : null;
}

/* ---------- aiuti DOM ---------- */
const TABBABILI = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]';
export function tabbabili(radice: ParentNode): HTMLElement[] {
  return [...radice.querySelectorAll<HTMLElement>(TABBABILI)].filter(e => e.tabIndex >= 0 && !e.hasAttribute('disabled') && e.offsetParent !== null);
}
/** Porta il focus al primo elemento raggiungibile dopo `gruppo` (dopo il render). */
export function focusDopo(gruppo: HTMLElement) {
  window.setTimeout(() => {
    const radice = gruppo.closest('form, .modal-card') ?? document.body;
    const prossimo = tabbabili(radice).find(e => !gruppo.contains(e) && (gruppo.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING));
    prossimo?.focus();
  }, 0);
}
/** Focus sulla voce scelta (o sulla prima) di un gruppo. */
export function focusGruppo(g: Element | null | undefined) {
  if (!g) return;
  const v = [...g.querySelectorAll<HTMLElement>('[role=radio]:not([disabled])')];
  (v.find(x => x.getAttribute('aria-checked') === 'true') ?? v[0])?.focus();
}

/** onKeyDown per un contenitore role="radiogroup" con voci role="radio" (button). */
export function tastiRadio(e: RKE<HTMLElement>) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const g = e.currentTarget;
  const voci = [...g.querySelectorAll<HTMLElement>('[role=radio]:not([disabled])')];
  const i = voci.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  const k = e.key === 'j' || e.key === 'k' || e.key === 'J' || e.key === 'K' ? '' : e.key; // J/K solo negli elenchi
  const m = indiceSuccessivo(i, voci.length, k);
  if (m !== null) { e.preventDefault(); voci[m].focus(); return; }
  const c = indiceCifra(e.key, voci.length);
  const scegli = c ?? (e.key === 'Enter' || e.key === ' ' ? i : null);
  if (scegli === null) return;
  e.preventDefault();
  voci[scegli].click();
  focusDopo(g);
}

/**
 * Elenchi: J/K o ↓/↑ spostano il focus (riga evidenziata) tra le righe `sel` dentro `ref`;
 * Invio apre (link della riga, nativo); A clicca il pulsante «prossimo passo» della riga, se c'è.
 * Le righe devono contenere un elemento con [data-k-apri] (link) e facoltativamente [data-k-avanza].
 */
export function useListaTastiera(ref: RefObject<HTMLElement>, sel: string) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !ref.current) return;
      const t = e.target as HTMLElement;
      if (staScrivendo(t) || t.closest?.('.modal, [role=radiogroup], [role=listbox], .ct-split-r')) return;
      const righe = [...ref.current.querySelectorAll<HTMLElement>(sel)];
      if (!righe.length) return;
      const i = righe.findIndex(r => r.contains(document.activeElement));
      const frecce = e.key === 'ArrowDown' || e.key === 'ArrowUp';
      // ↑↓ solo se il focus è già nell'elenco o da nessuna parte (non rubare le frecce ad altri controlli)
      if (frecce && i < 0 && document.activeElement && document.activeElement !== document.body) return;
      const m = ['j', 'J', 'k', 'K', 'ArrowDown', 'ArrowUp'].includes(e.key) ? indiceSuccessivo(i, righe.length, e.key, false) : null;
      if (m !== null) {
        e.preventDefault();
        const r = righe[m]; const a = r.querySelector<HTMLElement>('[data-k-apri]') ?? r;
        a.focus(); r.scrollIntoView({ block: 'nearest' });
        return;
      }
      if ((e.key === 'a' || e.key === 'A') && i >= 0) {
        const b = righe[i].querySelector<HTMLElement>('[data-k-avanza]');
        if (b) { e.preventDefault(); b.click(); }
      }
    };
    document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
  }, [ref, sel]);
}
