import { FASCE, NOME_TIPO, nomeTipoContatto, type Template, type TipoPratica } from './tipi';
import { costruisciEmailHtml, costruisciEmailTesto, htmlInTesto, type FirmaTipo } from './emailHtml';
import { scadenzaSla, partiRoma } from './sla';

export const SEGNAPOSTO = ['cliente', 'contatto', 'numero_pratica', 'data_appuntamento', 'fascia', 'commerciale', 'tecnico', 'firma', 'argomento', 'referente', 'entro',
  'urgenza', 'obiettivo', 'dettaglio', 'descrizione', 'indirizzo', 'telefono', 'email_cliente', 'quando', 'importo', 'stato_cliente', 'scadenza_richiamo',
  'saluto', 'tel_tecnico', 'rif_pratica', 'scadenza', 'tmq', 'chi_chiama', 'link'] as const;
export type Valori = Record<(typeof SEGNAPOSTO)[number], string>;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
export function dataLunga(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${GIORNI[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

interface Dati { numero: string; cliente_nome: string; contatto_nome: string | null; appuntamento_data: string | null; appuntamento_fascia: 'mattina' | 'pomeriggio' | null; commerciale_nome: string | null; tecnico_nome: string | null;
  urgenza?: string | null; sottotipo?: string | null; descrizione?: string | null; indirizzo?: string | null; cap?: string | null; comune?: string | null; telefono?: string | null; email?: string | null;
  tecnico_quando?: string | null; importo_stimato?: number | null; stato_cliente?: string | null; assegnato_nome?: string | null;
  created_at?: string | null; tecnico_telefono?: string | null; id?: number | null; tipo?: string | null; tipo_contatto?: string | null }
const STATO_C: Record<string, string> = { nuovo: 'nuovo cliente', ex_cliente: 'ex cliente', attivo: 'cliente attivo' };
/** Valori dei segnaposto per una pratica (testo semplice, non ancora in HTML). */
/** «Buongiorno» fino alle 13:59, poi «Buonasera» (ora di Roma). */
export const saluto = (d = new Date()) => (partiRoma(d).h < 14 ? 'Buongiorno' : 'Buonasera');
const hhmm = (d: Date) => { const p = partiRoma(d); return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`; };
export function segnaposto(p: Dati, firma: string, ora = new Date()): Valori {
  const richiamo = scadenzaSla(p.created_at ? new Date(p.created_at) : ora, { tipo: 'ore', valore: 2 }, new Set());
  return {
    saluto: saluto(ora), tel_tecnico: p.tecnico_telefono ? ` (tel. ${p.tecnico_telefono})` : '', rif_pratica: p.numero ? ` – ${p.numero}` : '',
    scadenza: '', tmq: p.tecnico_nome || p.assegnato_nome || '',
    cliente: p.cliente_nome, contatto: p.contatto_nome || 'Cliente', numero_pratica: p.numero,
    data_appuntamento: dataLunga(p.appuntamento_data) || 'data da concordare', fascia: p.appuntamento_fascia ? FASCE[p.appuntamento_fascia] : 'da concordare',
    commerciale: p.commerciale_nome || 'il nostro Tecnico Commerciale', tecnico: p.tecnico_nome || p.assegnato_nome || 'il nostro tecnico', firma,
    argomento: p.sottotipo || (p.tipo ? NOME_TIPO[p.tipo as TipoPratica] : '') || 'la Vostra richiesta',
    chi_chiama: nomeTipoContatto(p.tipo_contatto).toLowerCase(),
    link: `${typeof window !== 'undefined' && window.location ? window.location.origin : 'https://molajoni-flotta.vercel.app'}/centralino/${p.id ? `pratica/${p.id}` : 'pratiche'}`,
    referente: p.assegnato_nome || p.commerciale_nome || "l'ufficio competente", entro: 'al più presto',
    urgenza: p.urgenza === 'urgente' ? 'Urgente' : p.urgenza === 'ordinario' ? 'Ordinario' : '',
    obiettivo: p.urgenza === 'urgente' ? 'da fare oggi' : p.urgenza === 'ordinario' ? 'entro 2 giorni lavorativi' : 'da pianificare',
    dettaglio: p.sottotipo || '—', descrizione: p.descrizione || '—',
    indirizzo: [p.indirizzo, [p.cap, p.comune].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—',
    telefono: p.telefono || '—', email_cliente: p.email || '—', quando: p.tecnico_quando || 'al più presto',
    importo: p.importo_stimato != null ? `${p.importo_stimato.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €` : '—',
    stato_cliente: STATO_C[p.stato_cliente ?? ''] ?? 'nuovo cliente', scadenza_richiamo: hhmm(richiamo),
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

/** Modello → email completa (oggetto, HTML premium, testo). `corpo` = corpo già compilato (eventualmente modificato a mano). */
export function emailDaModello(t: Pick<Template, 'oggetto' | 'corpo_html'> & Partial<Pick<Template, 'titolo' | 'dati' | 'firma_tipo' | 'tipo_pratica' | 'codice'>>, v: Valori, corpo?: string) {
  const c = corpo ?? compila(t.corpo_html, v);
  const firma = (t.firma_tipo ?? 'front_office') as FirmaTipo;
  const input = {
    titolo: compila(t.titolo || t.oggetto.split(' – ')[0], v, false),
    dati: (t.dati ?? []).map(([k, x]) => [k, compila(x, v, false)] as [string, string]),
    corpoHtml: c, firma, firmaDati: { nome: v.tmq || v.tecnico },
    interna: /^\[Centralino\]/.test(t.oggetto),
  };
  return { oggetto: compila(t.oggetto, v, false).replace(/\s+–\s*$/, ''), corpo: c, html: costruisciEmailHtml(input), testo: costruisciEmailTesto(input) };
}
/** Segnaposto rimasti senza valore (per i test: nessun «{…}», «00», «xxxx»). */
export const residui = (s: string) => [...s.matchAll(/\{[a-z_]+\}|(?<![\d.,:])0{2,}(?![\d.,:])|x{3,}/gi)].map(m => m[0]);
export { htmlInTesto };
export { templatePasso, richiedeAllegato, AVVISO_ALLEGATO } from './passi';
