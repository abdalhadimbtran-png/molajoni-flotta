import { Component, type ErrorInfo, type ReactNode } from 'react';

const CHIAVE_RICARICA = 'molajoni:ricarica-chunk';

/** Errore di caricamento di un modulo JS (tipico dopo un nuovo deploy: i vecchi chunk non esistono più). */
export function eErroreChunk(e: unknown): boolean {
  const m = String((e as { message?: string })?.message ?? e ?? '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk|ChunkLoadError|preload/i.test(m);
}

/** Ricarica la pagina una sola volta per minuto (evita loop se il problema persiste). */
export function ricaricaUnaVolta(): boolean {
  try {
    const t = Number(sessionStorage.getItem(CHIAVE_RICARICA) ?? 0);
    if (Date.now() - t < 60_000) return false;
    sessionStorage.setItem(CHIAVE_RICARICA, String(Date.now()));
  } catch { /* storage non disponibile: ricarica comunque */ }
  window.location.reload();
  return true;
}

/** Gestori globali: chunk mancanti dopo un deploy → ricarica; promesse non gestite → log in console. */
export function installaGestoriGlobali() {
  window.addEventListener('vite:preloadError', (ev) => { ev.preventDefault(); ricaricaUnaVolta(); });
  window.addEventListener('unhandledrejection', (ev) => {
    if (eErroreChunk(ev.reason)) { ricaricaUnaVolta(); return; }
    console.error('[promessa non gestita]', ev.reason);
  });
}

type Props = { children: ReactNode; chiave?: string };
type Stato = { errore: Error | null };

/** Error boundary: un errore di rendering mostra "Ricarica" invece della pagina bianca. */
export class Protezione extends Component<Props, Stato> {
  state: Stato = { errore: null };
  static getDerivedStateFromError(errore: Error): Stato { return { errore }; }
  componentDidCatch(errore: Error, info: ErrorInfo) {
    console.error('[errore interfaccia]', errore, info.componentStack);
    if (eErroreChunk(errore)) ricaricaUnaVolta();
  }
  componentDidUpdate(prev: Props) {
    // Cambiando pagina si riprova a mostrare il contenuto.
    if (this.state.errore && prev.chiave !== this.props.chiave) this.setState({ errore: null });
  }
  render() {
    if (!this.state.errore) return this.props.children;
    return (
      <div className="wrap" role="alert">
        <div className="banner ko">
          <strong>Si è verificato un errore in questa schermata.</strong>
          <div style={{ marginTop: 8 }}>I dati già salvati non sono persi. Le bozze del modulo contatto restano su questo dispositivo.</div>
          <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => window.location.reload()}>Ricarica</button>
            <button className="btn" onClick={() => this.setState({ errore: null })}>Riprova</button>
          </div>
        </div>
      </div>
    );
  }
}
