/** Modello effettivo di un passo: per le modifiche si usa il modello del dettaglio (anagrafica, disdetta). */
export function templatePasso(p: { tipo: string; sottotipo?: string | null }, codice: string | undefined): string | undefined {
  if (codice === 'modifica_evasa' && p.tipo === 'modifica') {
    if (p.sottotipo === 'Anagrafica') return 'conferma_anagrafica';
    if (p.sottotipo === 'Disdetta') return 'conferma_disdetta';
  }
  return codice;
}
