import { useEffect, useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';

/** Ricorda lo scorrimento della pagina per questa voce della cronologia: tornando con «Indietro» si riparte dallo stesso punto. */
export function useRicordaScroll(pronto: boolean) {
  const { key } = useLocation();
  const k = `dz-scroll:${key}`;
  useEffect(() => {
    const salva = () => { try { sessionStorage.setItem(k, String(window.scrollY)); } catch { /* privato */ } };
    window.addEventListener('scroll', salva, { passive: true });
    // niente salvataggio all'uscita: la pagina nuova (più corta) sposterebbe già lo scorrimento
    return () => window.removeEventListener('scroll', salva);
  }, [k]);
  useLayoutEffect(() => {
    if (!pronto) return;
    let y = 0; try { y = Number(sessionStorage.getItem(k) ?? 0); } catch { /* privato */ }
    if (y > 0) window.scrollTo(0, y);
  }, [pronto, k]);
}

/** «Indietro»: torna alla pagina precedente (con filtri e scorrimento); se si è entrati da un link diretto, va a `fallback`. */
export function indietro(nav: (to: string | number) => void, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) nav(-1); else nav(fallback);
}
