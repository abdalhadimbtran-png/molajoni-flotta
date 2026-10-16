import type { Livello, Messaggio } from './format';

export interface Veicolo {
  id: number; targa: string; marca_modello: string; tipo: string | null; proprieta: string | null;
  km_attuali: number; km_prossimo_tagliando: number | null;
  scad_assicurazione: string | null; scad_revisione: string | null; scad_bollo: string | null;
  tecnico_in_carico: number | null; in_carico_dal: string | null; in_carico_nome: string | null;
  in_officina: boolean; dismesso: boolean; qr_token: string; note: string | null;
  controlli: Messaggio[]; stato: string;
}

export interface Tecnico {
  id: number; codice: string; nome: string; cognome: string; ruolo: string | null; telefono: string | null;
  patente_categoria: string | null; patente_scadenza: string | null; attivo: boolean; ha_pin: boolean;
  tentativi_falliti: number; bloccato_fino: string | null;
}

export interface Segnalazione {
  id: number; veicolo_id: number; tecnico_id: number | null; categoria: string; gravita: string; descrizione: string;
  stato: string; nota_chiusura: string | null; chiusa_il: string | null; creato_il: string;
  veicoli?: { targa: string } | null; tecnici?: { nome: string; cognome: string } | null;
}

export interface Intervento { id: number; ora: string | null; luogo: string; attivita: string; note: string | null }

export interface RigaPiano {
  tecnico_id: number; nome: string; codice: string; ruolo: string | null; patente: string | null;
  assenza: string | null; interventi: Intervento[]; veicolo_id: number | null;
  livello: Livello; messaggi: Messaggio[]; prima_ora: string | null;
}
export interface Piano { data: string; confermato_il: string | null; righe: RigaPiano[] }

export const SEL_VEICOLI = 'id,targa,marca_modello,tipo,proprieta,km_attuali,km_prossimo_tagliando,scad_assicurazione,scad_revisione,scad_bollo,tecnico_in_carico,in_carico_dal,in_carico_nome,in_officina,dismesso,qr_token,note,controlli,stato';
export const SEL_TECNICI = 'id,codice,nome,cognome,ruolo,telefono,patente_categoria,patente_scadenza,attivo,ha_pin,tentativi_falliti,bloccato_fino';
