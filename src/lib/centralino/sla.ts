/**
 * Motore SLA del centralino, stessa logica di privato.ct_sla (database).
 * Giorni lavorativi lun–ven, festività escluse, orario d'ufficio (default 08:30–17:30), ora di Roma.
 *   minuti/ore n  : minuti d'ufficio (oltre l'orario si continua il giorno lavorativo dopo)
 *   stesso_giorno : fine orario dello stesso giorno lavorativo (dopo la chiusura o nel weekend: del successivo)
 *   giorni_lav n  : fine orario dell'n-esimo giorno lavorativo dopo la data di ricezione
 */
export type TipoSla = 'minuti' | 'ore' | 'stesso_giorno' | 'giorni_lav';
export interface RegolaSla { tipo: TipoSla; valore?: number; da?: 'creazione' | 'ingresso' }
export interface Orario { inizio: string; fine: string }
export const ORARIO_DEFAULT: Orario = { inizio: '08:30', fine: '17:30' };

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

/** Parti dell'ora di Roma. */
export function partiRoma(d: Date) {
  const p = Object.fromEntries(fmt.formatToParts(d).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, g: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
/** Ora locale di Roma → istante. */
export function daRoma(y: number, m: number, g: number, h: number, mi: number): Date {
  const voluto = Date.UTC(y, m - 1, g, h, mi);
  let t = voluto;
  for (let i = 0; i < 3; i++) {
    const p = partiRoma(new Date(t));
    const visto = Date.UTC(p.y, p.m - 1, p.g, p.h, p.mi);
    t += voluto - visto;
  }
  return new Date(t);
}

const iso = (y: number, m: number, g: number) => `${y}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`;
const piuGiorno = (d: string) => { const [y, m, g] = d.split('-').map(Number); return new Date(Date.UTC(y, m - 1, g + 1)).toISOString().slice(0, 10); };
const minuti = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function lavorativo(d: string, festivi: Set<string>): boolean {
  const [y, m, g] = d.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, g)).getUTCDay();
  return dow !== 0 && dow !== 6 && !festivi.has(d);
}
export function prossimoLavorativo(d: string, festivi: Set<string>): string {
  let x = piuGiorno(d);
  while (!lavorativo(x, festivi)) x = piuGiorno(x);
  return x;
}

const istante = (d: string, min: number) => { const [y, m, g] = d.split('-').map(Number); return daRoma(y, m, g, Math.floor(min / 60), min % 60); };

export function scadenzaSla(da: Date, r: RegolaSla, festivi: Set<string>, orario: Orario = ORARIO_DEFAULT): Date {
  const hi = minuti(orario.inizio), hf = minuti(orario.fine);
  const p = partiRoma(da);
  let d = iso(p.y, p.m, p.g);
  let t = p.h * 60 + p.mi + (p.s > 0 ? 1 / 60 : 0);
  const n = r.valore ?? 0;
  if (r.tipo === 'giorni_lav') {
    for (let i = 0; i < n; i++) d = prossimoLavorativo(d, festivi);
    if (n <= 0 && !lavorativo(d, festivi)) d = prossimoLavorativo(d, festivi);
    return istante(d, hf);
  }
  if (!lavorativo(d, festivi) || t >= hf) { d = prossimoLavorativo(d, festivi); t = hi; }
  else if (t < hi) t = hi;
  if (r.tipo === 'stesso_giorno') return istante(d, hf);
  let m = r.tipo === 'ore' ? n * 60 : n;
  for (;;) {
    const disp = hf - t;
    if (m <= disp) return new Date(istante(d, Math.floor(t)).getTime() + (t - Math.floor(t)) * 60000 + m * 60000);
    m -= disp; d = prossimoLavorativo(d, festivi); t = hi;
  }
}

export type Semaforo = 'verde' | 'arancio' | 'rosso' | 'nessuno';
/** verde = in tempo, arancio = resta meno della soglia (25%) del tempo totale, rosso = scaduto. */
export function semaforo(inizio: string | Date, scadenza: string | Date | null, ora = new Date(), soglia = 0.25): Semaforo {
  if (!scadenza) return 'nessuno';
  const s = new Date(scadenza).getTime(), i = new Date(inizio).getTime(), o = ora.getTime();
  if (o > s) return 'rosso';
  const tot = Math.max(1, s - i);
  return (s - o) / tot < soglia ? 'arancio' : 'verde';
}

/** «tra 42 min», «tra 3 h 10», «scaduta da 2 h», «domani 17:30». */
export function testoResiduo(scadenza: string | Date | null, ora = new Date()): string {
  if (!scadenza) return '';
  const s = new Date(scadenza);
  const diff = Math.round((s.getTime() - ora.getTime()) / 60000);
  const dur = (m: number) => (m < 60 ? `${m} min` : m < 24 * 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${Math.round(m / 1440)} g`);
  if (diff < 0) return `scaduta da ${dur(-diff)}`;
  if (diff < 12 * 60) return `tra ${dur(diff)}`;
  const ps = partiRoma(s), po = partiRoma(ora);
  const hhmm = `${String(ps.h).padStart(2, '0')}:${String(ps.mi).padStart(2, '0')}`;
  const gs = iso(ps.y, ps.m, ps.g), go = iso(po.y, po.m, po.g);
  if (gs === go) return `oggi ${hhmm}`;
  if (gs === piuGiorno(go)) return `domani ${hhmm}`;
  return `${String(ps.g).padStart(2, '0')}/${String(ps.m).padStart(2, '0')} ${hhmm}`;
}

/** Data di Roma (AAAA-MM-GG) di un istante. */
export const giornoRoma = (d: string | Date) => { const p = partiRoma(new Date(d)); return iso(p.y, p.m, p.g); };

/** Se ora è fuori orario d'ufficio: quando riapre (altrimenti null). Il conto alla rovescia è «in pausa» fino ad allora. */
export function riapertura(ora: Date, festivi: Set<string>, orario: Orario = ORARIO_DEFAULT): Date | null {
  const p = partiRoma(ora);
  const d = iso(p.y, p.m, p.g), t = p.h * 60 + p.mi, hi = minuti(orario.inizio), hf = minuti(orario.fine);
  if (lavorativo(d, festivi) && t >= hi && t < hf) return null;
  if (lavorativo(d, festivi) && t < hi) return istante(d, hi);
  return istante(prossimoLavorativo(d, festivi), hi);
}

/** Secondi d'ufficio tra due istanti (lun–ven, festività escluse, solo nell'orario). */
export function secondiUfficio(da: Date, a: Date, festivi: Set<string>, orario: Orario = ORARIO_DEFAULT): number {
  if (a <= da) return 0;
  const hi = minuti(orario.inizio), hf = minuti(orario.fine);
  let tot = 0;
  const pd = partiRoma(da); let d = iso(pd.y, pd.m, pd.g);
  const pa = partiRoma(a); const fine = iso(pa.y, pa.m, pa.g);
  for (let i = 0; i < 400 && d <= fine; i++) {
    if (lavorativo(d, festivi)) {
      const ap = istante(d, hi).getTime(), ch = istante(d, hf).getTime();
      const x = Math.max(ap, da.getTime()), y = Math.min(ch, a.getTime());
      if (y > x) tot += (y - x) / 1000;
    }
    d = piuGiorno(d);
  }
  return Math.round(tot);
}

/** «entro 60 min», «entro 2 ore», «in giornata», «entro il giorno lavorativo dopo», «entro 2 giorni lav.». */
export function testoRegola(r: RegolaSla | null | undefined): string {
  if (!r) return '';
  const n = r.valore ?? 0;
  if (r.tipo === 'minuti') return `entro ${n} min`;
  if (r.tipo === 'ore') return `entro ${n} ${n === 1 ? 'ora' : 'ore'}`;
  if (r.tipo === 'stesso_giorno') return 'in giornata';
  return n === 1 ? 'entro il giorno lavorativo dopo' : `entro ${n} giorni lavorativi`;
}

const due = (n: number) => String(Math.floor(n)).padStart(2, '0');
/** «47:12» / «1:05:09» (sotto le 24 h) oppure «1 g 03 h». */
export function orologio(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s >= 86400) return `${Math.floor(s / 86400)} g ${due((s % 86400) / 3600)} h`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${due(m)}:${due(x)}` : `${due(m)}:${due(x)}`;
}

export interface StatoConto { testo: string; colore: Semaforo; pausa: string | null; scaduto: boolean }
/**
 * Conto alla rovescia della procedura. Il tempo residuo è in ore d'ufficio (si ferma fuori orario e nei festivi);
 * dopo la scadenza conta il ritardo («in ritardo da 00:18»).
 */
export function conto(inizio: string | Date, scadenza: string | Date | null, ora: Date, festivi: Set<string>, orario: Orario = ORARIO_DEFAULT, soglia = 0.25): StatoConto | null {
  if (!scadenza) return null;
  const s = new Date(scadenza), i = new Date(inizio);
  if (ora > s) { const sec = (ora.getTime() - s.getTime()) / 1000; return { testo: `in ritardo da ${sec >= 86400 ? orologio(sec) : `${due(sec / 3600)}:${due((sec % 3600) / 60)}`}`, colore: 'rosso', pausa: null, scaduto: true }; }
  const resto = secondiUfficio(ora, s, festivi, orario), tot = Math.max(1, secondiUfficio(i, s, festivi, orario));
  const r = riapertura(ora, festivi, orario);
  const g = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
  const pausa = r ? (() => { const p = partiRoma(r); const dow = new Date(Date.UTC(p.y, p.m - 1, p.g)).getUTCDay(); return `in pausa fino a ${giornoRoma(r) === giornoRoma(ora) ? 'oggi' : g[dow].slice(0, 3)} ${due(p.h)}:${due(p.mi)}`; })() : null;
  return { testo: `mancano ${orologio(resto)}`, colore: resto / tot < soglia ? 'arancio' : 'verde', pausa, scaduto: false };
}
