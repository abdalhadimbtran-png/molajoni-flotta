// Report Direzione: rendering PDF (A4) + email HTML. pdf-lib è passato come parametro, così gira in Deno e in Node per le prove.
// Forma standard di una sezione {codice,titolo,kpi[],tabelle[],serie[],attenzione[]} più campi facoltativi:
//   kpi[].def (definizione in una riga), kpi[].hero (in prima pagina), kpi[].sotto («18 su 25»), kpi[].blocco, kpi[].meglio ('su'|'giu'|'neutro')
//   blocchi[] {codice,titolo,nota}, barre[] {titolo,blocco,orientamento:'h'|'v',serie[],voci[{label,valori[]}]}, tabelle[].blocco
// Una sezione senza blocchi viene disegnata come un blocco unico (KPI, grafico della prima serie, tabelle).

export type Kpi = { label: string; valore: number | null; unita?: string; delta?: number | null; precedente?: number | null; confronta?: boolean;
  def?: string; hero?: boolean; sotto?: string; blocco?: string; meglio?: 'su' | 'giu' | 'neutro' };
export type Tabella = { titolo: string; colonne: string[]; righe: (string | number | null)[][]; larga?: boolean; blocco?: string };
export type Serie = { titolo: string; punti: { label: string; valore: number }[] };
export type Barre = { titolo: string; blocco?: string; orientamento?: 'h' | 'v'; serie?: string[]; voci: { label: string; valori: number[] }[] };
export type Blocco = { codice: string; titolo: string; nota?: string };
export type Sezione = { codice: string; titolo: string; kpi: Kpi[]; tabelle: Tabella[]; serie: Serie[]; attenzione: { testo: string; livello?: string }[];
  blocchi?: Blocco[]; barre?: Barre[] };
export type Periodo = { tipo: 'settimana' | 'mese'; dal: string; al: string; chiave: string; etichetta: string; file: string };
export type Report = { periodo: Periodo; precedente?: Periodo; generato_il?: string; sezioni: Sezione[] };

// deno-lint-ignore no-explicit-any
type Lib = any;

const W = 595.28, H = 841.89, M = 44;
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI_B = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const num = (n: number) => Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 });
const fmt = (n: number | null | undefined, u?: string) => n == null ? '—' : `${num(n)}${u === '%' ? '%' : u ? ` ${u}` : ''}`;
const dataIt = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
const parti = (s: string) => s.slice(0, 10).split('-').map(Number);
// Helvetica standard = WinAnsi: sostituisce i caratteri non rappresentabili
const pulisci = (s: unknown) => String(s ?? '').replace(/[▲]/g, '+').replace(/[▼]/g, '-').replace(/[^\x20-\x7E\u00A0-\u00FF–—‘’“”•…€·]/g, '?');

/** «23–27 nov 2026» / «30 nov–4 dic 2026» (breve) o con il mese per intero. */
export function intervallo(p: Periodo, breve = true) {
  const [y1, m1, d1] = parti(p.dal), [y2, m2, d2] = parti(p.al), N = breve ? MESI_B : MESI;
  if (y1 === y2 && m1 === m2) return d1 === d2 ? `${d1} ${N[m1 - 1]} ${y1}` : `${d1}–${d2} ${N[m1 - 1]} ${y1}`;
  if (y1 === y2) return `${d1} ${N[m1 - 1]}–${d2} ${N[m2 - 1]} ${y1}`;
  return `${d1} ${N[m1 - 1]} ${y1}–${d2} ${N[m2 - 1]} ${y2}`;
}
const meseAnno = (p: Periodo) => { const [y, m] = parti(p.dal); return `${MESI[m - 1][0].toUpperCase()}${MESI[m - 1].slice(1)} ${y}`; };
/** Oggetto email e sottotitolo: «Report settimanale · 23–27 nov 2026» / «Report mensile · Novembre 2026». */
export function oggettoReport(p: Periodo) { return p.tipo === 'settimana' ? `Report settimanale · ${intervallo(p)}` : `Report mensile · ${meseAnno(p)}`; }
export function titoloReport(p: Periodo) { return `Report Direzione – ${p.tipo === 'settimana' ? 'Settimana' : 'Mese'}`; }

/** Variazione rispetto al periodo prima: testo + verso (1 su, -1 giù, 0) + giudizio (buono/cattivo/neutro). */
export function variazione(k: Kpi): { testo: string; verso: number; tono: 'buono' | 'cattivo' | 'neutro' } | null {
  if (k.confronta === false) return null;
  let d: number | null = null, testo = '';
  if (k.unita === '%' && k.valore != null && k.precedente != null) { d = Math.round((k.valore - k.precedente) * 10) / 10; testo = `${d > 0 ? '+' : ''}${num(d)} pt`; }
  else if (k.delta != null) { d = k.delta; testo = `${d > 0 ? '+' : ''}${num(d)}%`; }
  else if (k.precedente === 0 && k.valore != null && k.valore > 0) { d = 1; testo = 'prima: 0'; }
  else if (k.precedente != null && k.valore != null && k.valore === k.precedente) { d = 0; testo = '='; }
  if (d == null) return null;
  const verso = d > 0 ? 1 : d < 0 ? -1 : 0, m = k.meglio ?? 'su';
  const tono = verso === 0 || m === 'neutro' ? 'neutro' : (verso > 0) === (m === 'su') ? 'buono' : 'cattivo';
  return { testo: verso === 0 ? 'uguale' : testo, verso, tono };
}
const heroDi = (r: Report) => {
  const h = r.sezioni.flatMap(s => s.kpi.filter(k => k.hero));
  return (h.length ? h : (r.sezioni[0]?.kpi ?? [])).slice(0, 4);
};

export async function generaPdf(lib: Lib, r: Report, opz: { logo?: Uint8Array | null; esempio?: boolean } = {}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = {
    rosso: hex('#E30613'), nero: hex('#111318'), testo: hex('#1F2329'), grigio: hex('#6B7280'), grigio2: hex('#9CA3AF'),
    card: hex('#F5F5F7'), linea: hex('#E5E7EB'), barra: hex('#D9DBE0'), scuro: hex('#2B2F36'), bianco: rgb(1, 1, 1),
    verde: hex('#15803D'), verdeBg: hex('#E8F5EC'), rossoBg: hex('#FDECEC'), neutroBg: hex('#EEEFF2'),
    ambraBg: hex('#FFF6E5'), ambra: hex('#F59E0B'), ambraT: hex('#7A4A00'),
  };
  const doc = await PDFDocument.create();
  doc.setTitle(`Report Direzione – ${oggettoReport(r.periodo)}`); doc.setAuthor('Portale Molajoni'); doc.setLanguage('it-IT');
  const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: Lib = null;
  try { if (opz.logo) logo = await doc.embedPng(opz.logo); } catch { logo = null; }

  let pg: Lib, y = 0;
  const pagine: Lib[] = [];
  const BASSO = M + 26;
  const larg = (t: unknown, s: number, f = F) => f.widthOfTextAtSize(pulisci(t), s);
  const testo = (t: unknown, x: number, yy: number, s = 9, f = F, c = C.testo) => pg.drawText(pulisci(t), { x, y: yy, size: s, font: f, color: c });
  const destra = (t: unknown, xr: number, yy: number, s = 9, f = F, c = C.testo) => testo(t, xr - larg(t, s, f), yy, s, f, c);
  const taglia = (t: unknown, w: number, s: number, f = F) => {
    let x = pulisci(t); if (f.widthOfTextAtSize(x, s) <= w) return x;
    while (x.length > 1 && f.widthOfTextAtSize(x + '…', s) > w) x = x.slice(0, -1);
    return x.trimEnd() + '…';
  };
  /** A capo per parole, al massimo maxR righe (l'ultima con «…» se serve). */
  const aCapo = (t: unknown, w: number, s: number, f = F, maxR = 99): string[] => {
    const parole = pulisci(t).split(/\s+/).filter(Boolean), out: string[] = [];
    let riga = '';
    for (const p of parole) {
      const prova = riga ? `${riga} ${p}` : p;
      if (f.widthOfTextAtSize(prova, s) <= w) { riga = prova; continue; }
      if (riga) out.push(riga);
      riga = f.widthOfTextAtSize(p, s) <= w ? p : taglia(p, w, s, f);
    }
    if (riga) out.push(riga);
    if (out.length > maxR) { const k = out.slice(0, maxR); k[maxR - 1] = taglia(out.slice(maxR - 1).join(' '), w, s, f); return k; }
    return out.length ? out : [''];
  };
  const rett = (x: number, yy: number, w: number, h: number, c: Lib) => pg.drawRectangle({ x, y: yy, width: w, height: h, color: c });
  /** Rettangolo con angoli arrotondati; (x, yTop) = angolo in alto a sinistra. */
  const tondo = (x: number, yTop: number, w: number, h: number, r: number, c: Lib, bordo?: Lib) => {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    const p = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
    pg.drawSvgPath(p, { x, y: yTop, color: c, ...(bordo ? { borderColor: bordo, borderWidth: 0.6 } : {}) });
  };
  const freccia = (x: number, yBase: number, s: number, verso: number, c: Lib) => {
    const p = verso > 0 ? `M 0 ${s} L ${s / 2} 0 L ${s} ${s} Z` : verso < 0 ? `M 0 0 L ${s} 0 L ${s / 2} ${s} Z` : `M 0 ${s * 0.35} H ${s} V ${s * 0.65} H 0 Z`;
    pg.drawSvgPath(p, { x, y: yBase + s, color: c });
  };
  const linea = (x1: number, yy: number, x2: number, c = C.linea, t = 0.6) => pg.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: t, color: c });

  function esempio() {
    if (!opz.esempio) return;
    const e = 'ESEMPIO · dati fittizi', w = larg(e, 7.5, B) + 16;
    tondo(W - M - w, H - 14, w, 15, 7.5, C.rossoBg); testo(e, W - M - w + 8, H - 24.5, 7.5, B, C.rosso);
  }
  function nuovaPagina() {
    pg = doc.addPage([W, H]); pagine.push(pg);
    if (pagine.length > 1) {
      if (logo) { const h = 20, w = logo.width * h / logo.height; pg.drawImage(logo, { x: M, y: H - 48, width: w, height: h }); }
      else testo('MOLAJONI', M, H - 44, 13, B, C.rosso);
      destra('Report Direzione', W - M, H - 36, 9, B, C.nero);
      destra(oggettoReport(r.periodo), W - M, H - 48, 8, F, C.grigio);
      linea(M, H - 60, W - M);
      y = H - 82;
    }
    esempio();
  }
  const spazio = (h: number) => { if (y - h < BASSO) { nuovaPagina(); return true; } return false; };

  // ── Copertina: fascia con logo, titolo, periodo, data ──
  const gen = r.generato_il ? new Date(r.generato_il) : new Date();
  const genTxt = gen.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  nuovaPagina();
  const fasciaH = 150;
  rett(0, H - fasciaH, W, fasciaH, C.card);
  rett(0, H - fasciaH, W, 3, C.rosso);
  if (logo) { const h = 30, w = logo.width * h / logo.height; pg.drawImage(logo, { x: M, y: H - 34 - h - 10, width: w, height: h }); }
  else testo('MOLAJONI', M, H - 66, 20, B, C.rosso);
  esempio();
  const tipoTxt = r.periodo.tipo === 'settimana' ? 'REPORT SETTIMANALE' : 'REPORT MENSILE';
  destra(tipoTxt, W - M, H - 58, 8, B, C.rosso);
  testo('Report Direzione', M, H - 104, 26, B, C.nero);
  const perTxt = r.periodo.tipo === 'settimana' ? `Settimana ${intervallo(r.periodo, false)}` : meseAnno(r.periodo);
  testo(perTxt, M, H - 126, 16, F, C.scuro);
  destra(`Generato il ${genTxt}`, W - M, H - 126, 9, F, C.grigio);
  y = H - fasciaH - 24;
  if (r.precedente) {
    const pr = `Frecce: confronto con ${r.precedente.tipo === 'settimana' ? `la settimana ${intervallo(r.precedente)}` : meseAnno(r.precedente)} (stessi giorni e ore).`;
    testo(taglia(pr, W - 2 * M, 8.5), M, y, 8.5, F, C.grigio); y -= 16;
  }

  // ── Card KPI (hero o secondarie) ──
  function cards(k: Kpi[], grande: boolean) {
    if (!k.length) return;
    const n = grande ? 4 : Math.min(4, Math.max(k.length, 3)), gap = 10, w = (W - 2 * M - gap * (n - 1)) / n;
    const sV = grande ? 26 : 16, pad = 11, sDef = 7, rDef = grande ? 4 : 3;
    for (let i = 0; i < k.length; i += n) {
      const riga = k.slice(i, i + n);
      const defs = riga.map(t => t.def ? aCapo(t.def, w - 2 * pad, sDef, F, rDef) : []);
      const nDef = Math.max(0, ...defs.map(d => d.length));
      const conSotto = grande && riga.some(t => t.sotto);
      const h = pad + 9 + 6 + sV + (conSotto ? 13 : 0) + 6 + 14 + (nDef ? 6 + nDef * (sDef + 2.2) : 0) + pad;
      spazio(h + gap);
      riga.forEach((t, j) => {
        const x = M + j * (w + gap), top = y;
        tondo(x, top, w, h, 8, C.card);
        if (grande) rett(x + pad, top - 4, 18, 2, C.rosso);
        let yy = top - pad - 9;
        testo(taglia(t.label, w - 2 * pad, 8.5, B), x + pad, yy, 8.5, B, C.grigio);
        yy -= 6 + sV;
        const vt = fmt(t.valore, t.unita); testo(vt, x + pad, yy, sV, B, C.nero);
        if (t.sotto && grande) { yy -= 13; testo(taglia(t.sotto, w - 2 * pad, 8), x + pad, yy, 8, F, C.grigio); }
        else if (conSotto) yy -= 13;
        else if (t.sotto) { const xs = x + pad + larg(vt, sV, B) + 6, ws = x + w - pad - xs; if (ws > 20) testo(taglia(t.sotto, ws, 7.5), xs, yy + 1, 7.5, F, C.grigio); }
        yy -= 6 + 12;
        const v = variazione(t);
        if (v) {
          const col = v.tono === 'buono' ? C.verde : v.tono === 'cattivo' ? C.rosso : C.grigio, bg = v.tono === 'buono' ? C.verdeBg : v.tono === 'cattivo' ? C.rossoBg : C.neutroBg;
          const tw = larg(v.testo, 7.5, B), pw = tw + 22;
          tondo(x + pad, yy + 11, pw, 13, 6.5, bg); freccia(x + pad + 6, yy + 1.5, 6, v.verso, col); testo(v.testo, x + pad + 15, yy + 1.8, 7.5, B, col);
        } else testo(t.confronta === false ? 'situazione adesso' : 'nessun confronto', x + pad, yy + 1.8, 7, F, C.grigio2);
        if (defs[j].length) {
          yy -= 6;
          linea(x + pad, yy + 3, x + w - pad, C.linea, 0.5);
          defs[j].forEach(l => { yy -= sDef + 2.2; testo(l, x + pad, yy, sDef, F, C.grigio); });
        }
      });
      y -= h + gap;
    }
    y -= 6;
  }

  function titoloBlocco(t: string, nota?: string) {
    spazio((nota ? 60 : 44) + 90);
    rett(M, y - 16, 3, 16, C.rosso);
    testo(t, M + 10, y - 13, 16, B, C.nero); y -= 22;
    if (nota) { testo(taglia(nota, W - 2 * M - 10, 9), M + 10, y - 9, 9, F, C.grigio); y -= 16; }
    y -= 8;
  }
  function etichetta(t: string, x: number, w: number, yy: number) { testo(taglia(t.toUpperCase(), w, 7.5, B), x, yy, 7.5, B, C.grigio); }

  // ── Barre orizzontali (una o due serie: la seconda sovrapposta, es. Ricevute / Completate) ──
  const altezzaBarreH = (b: Barre) => 18 + (b.serie && b.serie.length > 1 ? 14 : 0) + Math.max(1, b.voci.length) * 19 + 6;
  function barreH(b: Barre, x: number, w: number) {
    let yy = y; etichetta(b.titolo, x, w, yy - 8); yy -= 18;
    const due = (b.serie?.length ?? 0) > 1;
    if (due) {
      let lx = x; [[C.barra, b.serie![0]], [C.scuro, b.serie![1]]].forEach(([c, s]) => { tondo(lx, yy - 1, 8, 8, 2, c); testo(s, lx + 12, yy - 8, 7.5, F, C.grigio); lx += 20 + larg(s, 7.5); });
      yy -= 14;
    }
    const max = Math.max(1, ...b.voci.map(v => Math.max(...v.valori)));
    const lw = Math.min(w * 0.38, Math.max(...b.voci.map(v => larg(v.label, 8))) + 6), nw = 44, bw = w - lw - nw;
    if (!b.voci.length) { testo('Nessun dato nel periodo', x, yy - 10, 8, F, C.grigio); return; }
    for (const v of b.voci) {
      testo(taglia(v.label, lw - 6, 8), x, yy - 10, 8, F, C.testo);
      const a = v.valori[0] ?? 0, c = v.valori[1];
      tondo(x + lw, yy - 3, bw, 10, 3, C.card);
      if (a > 0) tondo(x + lw, yy - 3, Math.max(5, bw * a / max), 10, 3, due ? C.barra : C.scuro);
      if (due && c != null && c > 0) tondo(x + lw, yy - 3, Math.max(5, bw * c / max), 10, 3, C.scuro);
      destra(due ? `${num(c ?? 0)} / ${num(a)}` : num(a), x + w, yy - 10.5, 8, B, C.nero);
      yy -= 19;
    }
  }

  // ── Barre verticali (giorni) ──
  function barreV(b: Barre) {
    const h = 112; spazio(h + 26);
    etichetta(b.titolo, M, W - 2 * M, y - 8); y -= 20;
    const top = y, base = y - h + 22, ah = h - 40, max = Math.max(1, ...b.voci.map(v => v.valori[0] ?? 0));
    linea(M, base, W - M, C.linea, 0.8);
    const n = Math.max(1, b.voci.length), passo = (W - 2 * M) / n, bw = Math.min(46, passo * 0.5), maxV = Math.max(...b.voci.map(v => v.valori[0] ?? 0));
    b.voci.forEach((v, i) => {
      const val = v.valori[0] ?? 0, bh = ah * val / max, x = M + i * passo + (passo - bw) / 2;
      if (bh > 0) tondo(x, base + bh, bw, bh, Math.min(4, bh / 2), val === maxV && maxV > 0 ? C.rosso : C.scuro);
      const t = num(val); testo(t, x + bw / 2 - larg(t, 9, B) / 2, base + bh + 5, 9, B, val ? C.nero : C.grigio2);
      const l = taglia(v.label, passo - 4, 8); testo(l, x + bw / 2 - larg(l, 8) / 2, base - 13, 8, F, C.grigio);
    });
    y = top - h - 6;
  }

  // ── Tabelle: larghezze misurate, testo a capo (max 3 righe), numeri a destra, righe alterne ──
  const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && /^[\d.,]+%?$|^—$|^\d+ \(\d+%\)$/.test(v.trim()));
  const colNum = (t: Tabella, i: number) => i > 0 && t.righe.some(r => r[i] != null && r[i] !== '') && t.righe.every(r => r[i] == null || r[i] === '' || isNum(r[i]));
  function misura(t: Tabella, w: number) {
    const nc = t.colonne.length, s = 8, pad = 6;
    const nat = t.colonne.map((c, i) => Math.max(larg(c, 7, B), ...t.righe.map(r => larg(typeof r[i] === 'number' ? num(r[i] as number) : r[i] ?? '', s, isNum(r[i]) ? B : F))) + 2 * pad + 2);
    const numC = t.colonne.map((_, i) => colNum(t, i));
    const min = t.colonne.map((c, i) => numC[i] ? nat[i] : Math.min(nat[i], Math.max(larg(c, 7, B) + 2 * pad, 70)));
    let cw = nat.slice(), tot = cw.reduce((a, b) => a + b, 0);
    if (tot < w) { const testoCol = numC.map(n => !n); const k = testoCol.filter(Boolean).length || nc;
      cw = cw.map((c, i) => c + (testoCol[i] || k === nc ? (w - tot) / k : 0)); }
    else {
      // riduce le colonne più larghe fino a entrare
      for (let g = 0; g < 50 && tot > w + 0.5; g++) {
        const i = cw.indexOf(Math.max(...cw.map((c, j) => c > min[j] ? c : -1)));
        if (i < 0 || cw[i] <= min[i]) break;
        cw[i] = Math.max(min[i], cw[i] - (tot - w)); tot = cw.reduce((a, b) => a + b, 0);
      }
      if (tot > w) cw = cw.map(c => c * w / tot);
    }
    const celle = (t.righe.length ? t.righe : [['Nessun dato nel periodo', ...Array(nc - 1).fill('')]]).map(r => r.map((v, i) => {
      const n = numC[i] || (isNum(v) && i > 0), tx = typeof v === 'number' ? num(v) : String(v ?? '');
      return { n, righe: n ? [taglia(tx, cw[i] - 2 * pad, s, B)] : aCapo(tx, cw[i] - 2 * pad, s, F, 3) };
    }));
    const hr = celle.map(r => 6 + Math.max(...r.map(c => c.righe.length)) * 10.5);
    return { cw, celle, hr, h: 16 + 18 + hr.reduce((a, b) => a + b, 0) + 14, pad, s };
  }
  function tabella(t: Tabella, x: number, w: number, m = misura(t, w)) {
    let yy = y; etichetta(t.titolo, x, w, yy - 8); yy -= 16;
    let cx = x;
    t.colonne.forEach((c, i) => {
      const destraCol = colNum(t, i);
      const tx = taglia(c, m.cw[i] - 2 * m.pad, 7, B);
      if (destraCol) destra(tx, cx + m.cw[i] - m.pad, yy - 11, 7, B, C.grigio); else testo(tx, cx + m.pad, yy - 11, 7, B, C.grigio);
      cx += m.cw[i];
    });
    yy -= 16; linea(x, yy, x + w, C.scuro, 0.8); yy -= 2;
    m.celle.forEach((r, k) => {
      const h = m.hr[k];
      if (k % 2 === 1) rett(x, yy - h, w, h, C.card);
      let cx2 = x;
      r.forEach((c, i) => {
        c.righe.forEach((l, j) => {
          const yl = yy - 3 - 8 - j * 10.5;
          if (c.n) destra(l, cx2 + m.cw[i] - m.pad, yl, m.s, B, C.nero); else testo(l, cx2 + m.pad, yl, m.s, i === 0 ? B : F, t.righe.length ? C.testo : C.grigio);
        });
        cx2 += m.cw[i];
      });
      yy -= h;
    });
    linea(x, yy, x + w);
    return y - yy + 14;
  }
  function tabelle(ts: Tabella[]) {
    const strette = ts.filter(t => !t.larga), larghe = ts.filter(t => t.larga), gap = 18, w2 = (W - 2 * M - gap) / 2;
    for (let i = 0; i < strette.length; i += 2) {
      const a = strette[i], b = strette[i + 1], ma = misura(a, w2), mb = b ? misura(b, w2) : null;
      spazio(Math.max(ma.h, mb?.h ?? 0));
      const ha = tabella(a, M, w2, ma), hb = b ? tabella(b, M + w2 + gap, w2, mb!) : 0;
      y -= Math.max(ha, hb);
    }
    for (const t of larghe) {
      const m = misura(t, W - 2 * M);
      // tabella più alta di una pagina: spezza le righe
      if (m.h > H - 2 * M - 120) { for (let i = 0; i < t.righe.length; i += 25) tabelle([{ ...t, titolo: i ? `${t.titolo} (continua)` : t.titolo, righe: t.righe.slice(i, i + 25) }]); continue; }
      spazio(m.h); y -= tabella(t, M, W - 2 * M, m);
    }
  }

  function attenzione(items: { testo: string; livello?: string }[]) {
    const pad = 14, w = W - 2 * M, s = 9.5;
    const righe = items.map(a => aCapo(a.testo, w - 2 * pad - 14, s, a.livello === 'alto' ? B : F, 3));
    const h = pad + 14 + 8 + (items.length ? righe.reduce((t, r) => t + r.length * 13 + 4, 0) : 14) + pad - 4;
    spazio(h + 12);
    tondo(M, y, w, h, 8, items.length ? C.ambraBg : C.verdeBg);
    rett(M, y - h + 8, 3, h - 16, items.length ? C.ambra : C.verde);
    let yy = y - pad - 10;
    testo('Da attenzionare', M + pad, yy, 11, B, items.length ? C.ambraT : C.verde); yy -= 8;
    if (!items.length) { yy -= 13; testo('Nessuna criticità rilevata nel periodo.', M + pad, yy, s, F, C.verde); }
    items.forEach((a, i) => {
      yy -= 13; const alto = a.livello === 'alto';
      pg.drawCircle({ x: M + pad + 3, y: yy + 3, size: 2.2, color: alto ? C.rosso : C.ambra });
      righe[i].forEach((l, j) => { if (j) yy -= 13; testo(l, M + pad + 14, yy, s, alto ? B : F, C.testo); });
      yy -= 4;
    });
    y -= h + 18;
  }

  // ── Prima pagina: 4 numeri grandi + Da attenzionare ──
  cards(heroDi(r), true);
  const multi = r.sezioni.length > 1;
  attenzione(r.sezioni.flatMap(s => s.attenzione.map(a => ({ ...a, testo: multi ? `${s.titolo}: ${a.testo}` : a.testo }))));

  // ── Sezioni e blocchi ──
  for (const s of r.sezioni) {
    if (multi) titoloBlocco(s.titolo);
    const blocchi: Blocco[] = s.blocchi?.length ? s.blocchi : [{ codice: '_', titolo: multi ? '' : s.titolo }];
    const di = (b: Blocco, x?: string) => b.codice === '_' ? true : x === b.codice;
    for (const b of blocchi) {
      if (b.titolo) titoloBlocco(b.titolo, b.nota);
      cards(s.kpi.filter(k => !k.hero && di(b, k.blocco)), false);
      const barre = (s.barre ?? []).filter(x => di(b, x.blocco));
      if (b.codice === '_' && !s.barre?.length) for (const se of s.serie.slice(0, 1)) if (se.punti.length)
        barre.push({ titolo: se.titolo, orientamento: 'v', voci: se.punti.map(p => ({ label: p.label, valori: [p.valore] })) });
      const orizz = barre.filter(x => x.orientamento !== 'v'), gap = 24, w2 = (W - 2 * M - gap) / 2;
      for (let i = 0; i < orizz.length; i += 2) {
        const a = orizz[i], c = orizz[i + 1];
        spazio(Math.max(altezzaBarreH(a), c ? altezzaBarreH(c) : 0) + 8);
        const top = y; barreH(a, M, c ? w2 : W - 2 * M); if (c) { y = top; barreH(c, M + w2 + gap, w2); }
        y = top - Math.max(altezzaBarreH(a), c ? altezzaBarreH(c) : 0) - 8;
      }
      for (const v of barre.filter(x => x.orientamento === 'v')) barreV(v);
      tabelle(s.tabelle.filter(t => di(b, t.blocco)));
    }
    // tabelle senza blocco noto (es. legenda dei tipi): in fondo
    const noti = new Set(blocchi.map(b => b.codice));
    const resto = s.blocchi?.length ? s.tabelle.filter(t => !noti.has(t.blocco ?? '')) : [];
    if (resto.length) { y -= 6; tabelle(resto); }
  }

  // ── Piè di pagina ──
  pagine.forEach((p, i) => {
    pg = p;
    linea(M, M, W - M);
    testo('Report automatico · Portale Molajoni', M, M - 13, 7.5, B, C.grigio);
    const g = `Generato il ${genTxt}`; testo(g, W / 2 - larg(g, 7.5) / 2, M - 13, 7.5, F, C.grigio2);
    destra(`Pagina ${i + 1} / ${pagine.length}`, W - M, M - 13, 7.5, F, C.grigio);
  });
  return await doc.save();
}

/** Email HTML (tabelle, compatibile Outlook): logo, periodo, 4 numeri, «Da attenzionare», pulsante, PDF allegato. */
export function emailHtml(r: Report, link: string, logoUrl: string): { html: string; testo: string; oggetto: string } {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const R = '#E30613', FONT = 'font-family:Helvetica,Arial,sans-serif';
  const oggetto = oggettoReport(r.periodo);
  const kpi = heroDi(r);
  const att = r.sezioni.flatMap(s => s.attenzione).slice(0, 5);
  const tile = (k: Kpi) => {
    const v = variazione(k);
    const col = !v ? '#9CA3AF' : v.tono === 'buono' ? '#15803D' : v.tono === 'cattivo' ? R : '#6B7280';
    const fr = !v ? '' : v.verso > 0 ? '&#9650; ' : v.verso < 0 ? '&#9660; ' : '';
    return `<td width="50%" valign="top" style="padding:6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F7;border-radius:10px"><tr><td style="padding:14px 16px;${FONT}">
<div style="font-size:12px;color:#6B7280;font-weight:bold">${esc(k.label)}</div>
<div style="font-size:28px;line-height:34px;font-weight:bold;color:#111318;margin-top:4px">${esc(fmt(k.valore, k.unita))}${k.sotto ? ` <span style="font-size:12px;font-weight:normal;color:#6B7280">${esc(k.sotto)}</span>` : ''}</div>
<div style="font-size:12px;color:${col};font-weight:bold;margin-top:2px">${v ? `${fr}${esc(v.testo)} <span style="color:#9CA3AF;font-weight:normal">vs periodo prima</span>` : '&nbsp;'}</div>
</td></tr></table></td>`;
  };
  const righe: string[] = []; for (let i = 0; i < kpi.length; i += 2) righe.push(`<tr>${tile(kpi[i])}${kpi[i + 1] ? tile(kpi[i + 1]) : '<td width="50%"></td>'}</tr>`);
  const attHtml = att.length
    ? att.map(a => `<tr><td valign="top" width="16" style="padding:3px 0;color:${a.livello === 'alto' ? R : '#F59E0B'};font-size:14px">&#9679;</td><td style="padding:3px 0;${FONT};font-size:14px;line-height:20px;color:#1F2329${a.livello === 'alto' ? ';font-weight:bold' : ''}">${esc(a.testo)}</td></tr>`).join('')
    : `<tr><td style="${FONT};font-size:14px;color:#15803D">Nessuna criticità rilevata nel periodo.</td></tr>`;
  const html = `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(oggetto)}</title></head>
<body style="margin:0;padding:0;background:#ECEDEF">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ECEDEF"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border-radius:12px">
<tr><td style="height:4px;background:${R};font-size:0;line-height:0;border-radius:12px 12px 0 0">&nbsp;</td></tr>
<tr><td style="padding:24px 28px 8px"><img src="${esc(logoUrl)}" alt="Molajoni" height="32" style="display:block;height:32px;border:0"></td></tr>
<tr><td style="padding:12px 28px 0;${FONT};font-size:11px;font-weight:bold;letter-spacing:1px;color:${R}">${r.periodo.tipo === 'settimana' ? 'REPORT SETTIMANALE' : 'REPORT MENSILE'}</td></tr>
<tr><td style="padding:4px 28px 0;${FONT};font-size:24px;font-weight:bold;color:#111318">Report Direzione</td></tr>
<tr><td style="padding:2px 28px 18px;${FONT};font-size:15px;color:#4B5563">${esc(r.periodo.tipo === 'settimana' ? `Settimana ${intervallo(r.periodo, false)}` : meseAnno(r.periodo))}</td></tr>
<tr><td style="padding:0 22px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${righe.join('')}</table></td></tr>
<tr><td style="padding:18px 28px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${att.length ? '#FFF6E5' : '#E8F5EC'};border-left:3px solid ${att.length ? '#F59E0B' : '#15803D'}">
<tr><td style="padding:14px 16px"><div style="${FONT};font-size:14px;font-weight:bold;color:${att.length ? '#7A4A00' : '#15803D'};margin-bottom:6px">Da attenzionare</div>
<table role="presentation" cellpadding="0" cellspacing="0">${attHtml}</table></td></tr></table></td></tr>
<tr><td style="padding:22px 28px 6px" align="left"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:${R};border-radius:8px">
<a href="${esc(link)}" style="display:inline-block;padding:12px 22px;${FONT};font-size:14px;font-weight:bold;color:#FFFFFF;text-decoration:none">Apri la pagina Direzione</a></td></tr></table></td></tr>
<tr><td style="padding:10px 28px 24px;${FONT};font-size:13px;color:#4B5563">Tutti i numeri, con il significato di ognuno, sono nel PDF allegato (${esc(r.periodo.file)}).</td></tr>
<tr><td style="padding:14px 28px;border-top:1px solid #E5E7EB;${FONT};font-size:11px;color:#9CA3AF">Report automatico · Portale Molajoni. Gli appunti privati non sono mai inclusi.</td></tr>
</table></td></tr></table></body></html>`;
  const testoPiano = [oggetto, `Dal ${dataIt(r.periodo.dal)} al ${dataIt(r.periodo.al)}`, '',
    ...kpi.map(k => { const v = variazione(k); return `${k.label}: ${fmt(k.valore, k.unita)}${k.sotto ? ` (${k.sotto})` : ''}${v ? ` · ${v.testo} vs periodo prima` : ''}`; }), '',
    'Da attenzionare:', ...(att.length ? att.map(a => `- ${a.testo}`) : ['- Nessuna criticità']), '', `Report completo nel PDF allegato. Pagina Direzione: ${link}`].join('\n');
  return { html, testo: testoPiano, oggetto };
}
