/** Modello effettivo di un passo: per le modifiche si usa il modello del dettaglio (anagrafica, disdetta);
 *  per la conferma di una girata a un fornitore si usa la variante neutra (senza «Grazie per la preferenza»). */
export function templatePasso(p: { tipo: string; sottotipo?: string | null; tipo_contatto?: string | null }, codice: string | undefined): string | undefined {
  if (codice === 'modifica_evasa' && p.tipo === 'modifica') {
    if (p.sottotipo === 'Anagrafica') return 'conferma_anagrafica';
    if (p.sottotipo === 'Disdetta') return 'conferma_disdetta';
  }
  if (codice === 'girata_ufficio' && (p.tipo_contatto === 'fornitore' || p.tipo === 'fornitori')) return 'girata_fornitore';
  return codice;
}
/** Modelli che dicono «in allegato il preventivo»: la bozza .eml non ha allegati. */
export const AVVISO_ALLEGATO = 'Allega il preventivo in Outlook prima di premere Invia';
export const richiedeAllegato = (t: { corpo_html?: string | null } | null | undefined) => !!t?.corpo_html && /in allegato/i.test(t.corpo_html);
