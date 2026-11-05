/** Segnaposto di caricamento (righe grigie animate) al posto del testo «Caricamento…». */
export function Scheletro({ righe = 4, tessere = 0 }: { righe?: number; tessere?: number }) {
  return (
    <div className="ct-skel" aria-busy="true" aria-label="Caricamento">
      {tessere > 0 && <div className="ct-skel-t">{Array.from({ length: tessere }, (_, i) => <span key={i} />)}</div>}
      {Array.from({ length: righe }, (_, i) => <div key={i} className="ct-skel-r" style={{ width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  );
}
