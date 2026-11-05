import { FASCE } from './tipi';

export const SEGNAPOSTO = ['cliente', 'contatto', 'numero_pratica', 'data_appuntamento', 'fascia', 'commerciale', 'tecnico', 'firma', 'argomento', 'referente', 'entro'] as const;
export type Valori = Record<(typeof SEGNAPOSTO)[number], string>;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
export function dataLunga(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${GIORNI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

interface Dati { numero: string; cliente_nome: string; contatto_nome: string | null; appuntamento_data: string | null; appuntamento_fascia: 'mattina' | 'pomeriggio' | null; commerciale_nome: string | null; tecnico_nome: string | null }
/** Valori dei segnaposto per una pratica (testo semplice, non ancora in HTML). */
export function segnaposto(p: Dati, firma: string): Valori {
  return {
    cliente: p.cliente_nome, contatto: p.contatto_nome || 'Cliente', numero_pratica: p.numero,
    data_appuntamento: dataLunga(p.appuntamento_data) || 'data da concordare', fascia: p.appuntamento_fascia ? FASCE[p.appuntamento_fascia] : 'da concordare',
    commerciale: p.commerciale_nome || 'il nostro commerciale', tecnico: p.tecnico_nome || 'il nostro tecnico', firma,
    argomento: 'la sua richiesta', referente: p.commerciale_nome || 'il nostro referente', entro: 'al più presto',
  };
}

/** Sostituisce {segnaposto} con valori in HTML sicuro (a capo → <br>). */
export function compila(modello: string, v: Valori, html = true): string {
  return modello.replace(/\{([a-z_]+)\}/g, (m, k: string) => {
    if (!(k in v)) return m;
    const s = v[k as keyof Valori];
    return html ? esc(s).replace(/\n/g, '<br>') : s;
  });
}

/** Da HTML semplice a testo (per «Copia testo», Outlook e la versione testo dell'email). */
export function inTesto(html: string): string {
  const d = document.createElement('div');
  d.innerHTML = html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>\s*/gi, '\n\n');
  return (d.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
}

/** Guscio dell'email (stile del portale, compatibile con i client di posta). */
export function guscioEmail(corpo: string): string {
  return `<!doctype html><html lang="it"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-top:4px solid #E30613">
<tr><td style="padding:18px 28px 0;font-size:11px;letter-spacing:.12em;color:#E30613;font-weight:700">MOLAJONI ANTINCENDI · DAL 1930</td></tr>
<tr><td style="padding:12px 28px 24px;font-size:15px;line-height:1.55;color:#1a1a1a">${corpo}</td></tr></table></td></tr></table></body></html>`;
}
