/** Azzeramento dati di prova di personale e flotta: etichette e conferma (logica pura). */
export type ContiPf = Record<string, unknown> & { file?: Record<string, string[]> };

export const TABELLE_PF: { k: string; nome: string; sempre?: boolean }[] = [
  { k: 'dipendenti', nome: 'Dipendenti e tecnici', sempre: true },
  { k: 'veicoli', nome: 'Veicoli', sempre: true },
  { k: 'assegnazioni', nome: 'Assegnazioni veicoli' },
  { k: 'movimenti', nome: 'Letture km / QR' },
  { k: 'segnalazioni', nome: 'Segnalazioni problemi' },
  { k: 'segnalazioni_foto', nome: 'Foto delle segnalazioni' },
  { k: 'multe', nome: 'Multe' },
  { k: 'rifornimenti', nome: 'Rifornimenti' },
  { k: 'dotazioni', nome: 'Dotazioni veicoli' },
  { k: 'documenti', nome: 'Documenti veicoli' },
  { k: 'carte_assegnazioni', nome: 'Assegnazioni carte carburante' },
  { k: 'interventi', nome: 'Piano (interventi assegnati)' },
  { k: 'percorsi', nome: 'Percorsi' },
  { k: 'giornate_lavoro', nome: 'Giornate di lavoro' },
  { k: 'ritardi', nome: 'Ritardi' },
  { k: 'da_ripianificare', nome: 'Da ripianificare' },
  { k: 'urgenze', nome: 'Urgenze' },
  { k: 'variazioni_da_inviare', nome: 'Variazioni da inviare' },
  { k: 'notifiche_piano', nome: 'Notifiche del piano' },
  { k: 'piano_inviato', nome: 'Piani inviati' },
  { k: 'assenze_manuali', nome: 'Assenze inserite a mano' },
  { k: 'richieste_assenza', nome: 'Richieste ferie/permessi' },
  { k: 'richieste_assenza_giorni', nome: 'Giorni delle richieste' },
  { k: 'assenze_da_richieste', nome: 'Assenze approvate' },
  { k: 'saldi_iniziali', nome: 'Saldi iniziali ferie' },
  { k: 'rettifiche_saldo', nome: 'Rettifiche saldo' },
  { k: 'spettanze_dipendente', nome: 'Spettanze' },
  { k: 'corsi_dipendente', nome: 'Corsi dei dipendenti' },
  { k: 'corsi_attestati', nome: 'Attestati' },
  { k: 'richieste_attestato', nome: 'Richieste attestato' },
  { k: 'attestati_proposti', nome: 'Attestati proposti' },
  { k: 'formazione_avvisi_inviati', nome: 'Avvisi formazione' },
  { k: 'sessioni_tecnico', nome: 'Accessi tecnici (token/PIN)' },
  { k: 'push_iscrizioni', nome: 'Iscrizioni notifiche push' },
  { k: 'notifiche', nome: 'Notifiche ai tecnici' },
];
export const CONFERMA_PF = 'CANCELLA';
export const confermaPfValida = (t: string) => t.trim() === CONFERMA_PF;
export const totalePf = (c: Record<string, unknown>) => TABELLE_PF.reduce((s, t) => s + (Number(c[t.k]) || 0), 0);
