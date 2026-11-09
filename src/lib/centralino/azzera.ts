/** Azzeramento dati di prova del Centralino: etichette, conferma e nome del backup (logica pura). */
export const TABELLE_AZZERA: { k: string; nome: string }[] = [
  { k: 'pratiche', nome: 'Pratiche' },
  { k: 'pratiche_eventi', nome: 'Storia delle pratiche' },
  { k: 'pratiche_allegati', nome: 'Allegati (anche i file)' },
  { k: 'chiamate_trasferite', nome: 'Chiamate trasferite' },
  { k: 'appunti', nome: 'Appunti del centralino' },
  { k: 'email_in_uscita', nome: 'Email del centralino' },
  { k: 'notifiche', nome: 'Notifiche del centralino' },
  { k: 'chiamate_info', nome: '«+1 chiamata informativa»' },
  { k: 'clienti_contatti', nome: 'Contatti creati dal centralino' },
  { k: 'clienti_contatti_storia', nome: 'Storia dei contatti' },
];
export const PAROLA_CONFERMA = 'AZZERA';
export const confermaValida = (t: string) => t.trim() === PAROLA_CONFERMA;
export const totale = (c: Record<string, unknown>) => TABELLE_AZZERA.reduce((s, t) => s + (Number(c[t.k]) || 0), 0);
/** "Solo pratiche create prima del" giorno scelto (00:00 ora di Roma) → ISO; vuoto = tutto. */
export function finoA(data: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return null;
  const [y, m, d] = data.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const off = new Date(utc).toLocaleString('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'shortOffset' }).match(/GMT([+-]\d+)/);
  return new Date(utc - (off ? Number(off[1]) : 1) * 3600_000).toISOString();
}
export const nomeBackup = (d = new Date()) => `backup-centralino-${d.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
