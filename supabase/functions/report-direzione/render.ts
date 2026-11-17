// Report Direzione: rendering PDF generico (pdf-lib passato come parametro, così gira in Deno e in Node per le prove).
// Disegna QUALSIASI sezione con la forma standard {codice,titolo,kpi[],tabelle[],serie[],attenzione[]}:
// copertina (sintesi KPI di ogni sezione + «Da attenzionare» + indice se > 2 sezioni), poi un blocco per sezione,
// con salto pagina automatico, intestazione e piè di pagina «Report automatico – Portale Molajoni».

export type Kpi = { label: string; valore: number | null; unita?: string; delta?: number | null; precedente?: number | null; confronta?: boolean };
export type Tabella = { titolo: string; colonne: string[]; righe: (string | number | null)[][]; larga?: boolean };
export type Serie = { titolo: string; punti: { label: string; valore: number }[] };
export type Sezione = { codice: string; titolo: string; kpi: Kpi[]; tabelle: Tabella[]; serie: Serie[]; attenzione: { testo: string; livello?: string }[] };
export type Periodo = { tipo: 'settimana' | 'mese'; dal: string; al: string; chiave: string; etichetta: string; file: string };
export type Report = { periodo: Periodo; precedente?: Periodo; generato_il?: string; sezioni: Sezione[] };

// deno-lint-ignore no-explicit-any
type Lib = any;

const W = 595.28, H = 841.89, M = 40;
const fmt = (n: number | null | undefined, u?: string) => n == null ? '—'
  : `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 1 })}${u === '%' ? '%' : u ? ` ${u}` : ''}`;
const dataIt = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-'); return `${d}/${m}/${y}`; };
// Helvetica standard = WinAnsi: sostituisce i caratteri non rappresentabili
const pulisci = (s: unknown) => String(s ?? '').replace(/[▲]/g, '+').replace(/[▼]/g, '-').replace(/[^\x20-\x7E -ÿ–—‘’“”•…€]/g, '?');

export function titoloReport(p: Periodo) { return `Report Direzione – ${p.tipo === 'settimana' ? 'Settimana' : 'Mese'}`; }

export async function generaPdf(lib: Lib, r: Report, opz: { logo?: Uint8Array | null; esempio?: boolean } = {}): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, degrees } = lib;
  const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
  const C = { rosso: hex('#C8102E'), testo: hex('#1A1A1A'), grigio: hex('#6B6B6B'), chiaro: hex('#F4F4F4'), linea: hex('#E2E2E2'), rosa: hex('#FDECEE'), bianco: rgb(1, 1, 1), verde: hex('#1F7A3A') };
  const doc = await PDFDocument.create();
  doc.setTitle(`${titoloReport(r.periodo)} – ${r.periodo.etichetta}`); doc.setAuthor('Portale Molajoni'); doc.setLanguage('it-IT');
  const F = await doc.embedFont(StandardFonts.Helvetica), B = await doc.embedFont(StandardFonts.HelveticaBold);
  let logo: Lib = null;
  try { if (opz.logo) logo = await doc.embedPng(opz.logo); } catch { logo = null; }

  let pg: Lib, y = 0;
  const pagine: Lib[] = [];
  const testo = (t: unknown, x: number, yy: number, s = 9, f = F, c = C.testo) => pg.drawText(pulisci(t), { x, y: yy, size: s, font: f, color: c });
  const larg = (t: unknown, s: number, f = F) => f.widthOfTextAtSize(pulisci(t), s);
  const taglia = (t: unknown, w: number, s: number, f = F) => {
    let x = pulisci(t); if (f.widthOfTextAtSize(x, s) <= w) return x;
    while (x.length > 1 && f.widthOfTextAtSize(x + '…', s) > w) x = x.slice(0, -1);
    return x + '…';
  };
  const rett = (x: number, yy: number, w: number, h: number, c: Lib) => pg.drawRectangle({ x, y: yy, width: w, height: h, color: c });

  function nuovaPagina() {
    pg = doc.addPage([W, H]); pagine.push(pg);
    rett(0, H - 6, W, 6, C.rosso);
    if (logo) { const h = 26, w = logo.width * h / logo.height; pg.drawImage(logo, { x: M, y: H - 46, width: w, height: h }); }
    else { testo('MOLAJONI', M, H - 38, 18, B, C.rosso); }
    const t1 = titoloReport(r.periodo), t2 = r.periodo.etichetta;
    testo(t1, W - M - larg(t1, 10, B), H - 30, 10, B);
    testo(t2, W - M - larg(t2, 9), H - 43, 9, F, C.grigio);
    pg.drawLine({ start: { x: M, y: H - 56 }, end: { x: W - M, y: H - 56 }, thickness: 0.6, color: C.linea });
    if (opz.esempio) {
      pg.drawText('ESEMPIO', { x: 150, y: 300, size: 110, font: B, color: C.rosso, opacity: 0.07, rotate: degrees(35) });
      const e = 'ESEMPIO – dati fittizi'; rett(W / 2 - 60, H - 52, 120, 14, C.rosa); testo(e, W / 2 - larg(e, 8, B) / 2, H - 47, 8, B, C.rosso);
    }
    y = H - 76;
  }
  const spazio = (h: number) => { if (y - h < M + 30) nuovaPagina(); };

  function titoloSez(t: string, s = 13) { spazio(30); testo(t, M, y - s, s, B); rett(M, y - s - 7, 28, 2, C.rosso); y -= s + 18; }
  function sottotitolo(t: string) { spazio(22); testo(t.toUpperCase(), M, y - 9, 8, B, C.grigio); y -= 16; }

  function tiles(k: Kpi[], perRiga = 4) {
    const gap = 8, w = (W - 2 * M - gap * (perRiga - 1)) / perRiga, h = 54;
    for (let i = 0; i < k.length; i += perRiga) {
      spazio(h + gap);
      k.slice(i, i + perRiga).forEach((t, j) => {
        const x = M + j * (w + gap);
        rett(x, y - h, w, h, C.chiaro); rett(x, y - h, 3, h, C.rosso);
        testo(taglia(t.label, w - 16, 8), x + 10, y - 14, 8, F, C.grigio);
        testo(fmt(t.valore, t.unita), x + 10, y - 34, 17, B);
        const d = t.delta;
        const dt = t.confronta === false ? 'situazione a fine periodo' : d == null ? (t.precedente != null ? `prec.: ${fmt(t.precedente, t.unita)}` : 'nessun confronto')
          : `${d > 0 ? '+' : ''}${d}% vs periodo prec.`;
        testo(taglia(dt, w - 16, 7), x + 10, y - 47, 7, d == null ? F : B, d == null ? C.grigio : C.testo);
      });
      y -= h + gap;
    }
    y -= 4;
  }

  function grafico(s: Serie) {
    const h = 110; spazio(h + 26); sottotitolo(s.titolo);
    const x0 = M + 22, w = W - 2 * M - 22, max = Math.max(1, ...s.punti.map(p => p.valore));
    const top = y, base = y - h + 14;
    for (let i = 0; i <= 4; i++) {
      const yy = base + (h - 24) * i / 4, v = Math.round(max * i / 4 * 10) / 10;
      pg.drawLine({ start: { x: x0, y: yy }, end: { x: x0 + w, y: yy }, thickness: 0.4, color: C.linea });
      testo(fmt(v), x0 - 4 - larg(fmt(v), 6.5), yy - 2, 6.5, F, C.grigio);
    }
    const n = Math.max(1, s.punti.length), passo = w / n, bw = Math.min(26, passo * 0.65);
    const ogni = Math.ceil(n / 16);
    s.punti.forEach((p, i) => {
      const bh = (h - 24) * p.valore / max, x = x0 + i * passo + (passo - bw) / 2;
      if (bh > 0) rett(x, base, bw, bh, C.rosso);
      if (p.valore > 0 && n <= 16) testo(String(p.valore), x + bw / 2 - larg(String(p.valore), 6.5, B) / 2, base + bh + 2, 6.5, B);
      if (i % ogni === 0) testo(p.label, x + bw / 2 - larg(p.label, 6.5) / 2, base - 10, 6.5, F, C.grigio);
    });
    y = top - h - 8;
  }

  function tabella(t: Tabella, x: number, w: number): number {
    // ritorna l'altezza usata; disegna dalla y corrente
    const rh = 15, nc = t.colonne.length;
    const pesi = nc === 2 ? [0.78, 0.22] : t.colonne.map((_, i) => i === 1 || i === nc - 1 ? 2 : i === 2 ? 1.6 : 1);
    const tot = pesi.reduce((a, b) => a + b, 0), cw = pesi.map(p => w * p / tot);
    let yy = y;
    testo(taglia(t.titolo.toUpperCase(), w, 8, B), x, yy - 9, 8, B, C.grigio); yy -= 15;
    rett(x, yy - rh, w, rh, C.testo);
    let cx = x; t.colonne.forEach((c, i) => { const num = i > 0 && nc === 2; const tx = taglia(c, cw[i] - 8, 7.5, B);
      testo(tx, num ? cx + cw[i] - 4 - larg(tx, 7.5, B) : cx + 4, yy - 10.5, 7.5, B, C.bianco); cx += cw[i]; });
    yy -= rh;
    const righe = t.righe.length ? t.righe : [['Nessun dato nel periodo', ...Array(nc - 1).fill('')]];
    righe.forEach((r, k) => {
      if (k % 2 === 1) rett(x, yy - rh, w, rh, C.chiaro);
      let cx2 = x;
      r.forEach((v, i) => {
        const num = typeof v === 'number';
        const tx = taglia(num ? fmt(v) : v, cw[i] - 8, 8, num ? B : F);
        testo(tx, num ? cx2 + cw[i] - 4 - larg(tx, 8, B) : cx2 + 4, yy - 10.5, 8, num ? B : F, t.righe.length ? C.testo : C.grigio);
        cx2 += cw[i];
      });
      yy -= rh;
    });
    pg.drawLine({ start: { x, y: yy }, end: { x: x + w, y: yy }, thickness: 0.6, color: C.linea });
    return y - yy + 12;
  }
  const altezzaTab = (t: Tabella) => 15 + 15 * (1 + Math.max(1, t.righe.length)) + 12;

  function tabelle(ts: Tabella[]) {
    const strette = ts.filter(t => !t.larga), larghe = ts.filter(t => t.larga);
    const gap = 14, w2 = (W - 2 * M - gap) / 2;
    for (let i = 0; i < strette.length; i += 2) {
      const a = strette[i], b = strette[i + 1];
      spazio(Math.max(altezzaTab(a), b ? altezzaTab(b) : 0));
      const ha = tabella(a, M, w2), hb = b ? tabella(b, M + w2 + gap, w2) : 0;
      y -= Math.max(ha, hb);
    }
    for (const t of larghe) {
      // tabelle lunghe: se non entra, nuova pagina (max 15 righe → sempre entra in una pagina)
      spazio(altezzaTab(t)); y -= tabella(t, M, W - 2 * M);
    }
  }

  function attenzione(items: { testo: string; livello?: string }[], vuoto = 'Nessuna criticità rilevata nel periodo.') {
    if (!items.length) { spazio(24); rett(M, y - 20, W - 2 * M, 20, C.chiaro); testo(vuoto, M + 10, y - 13.5, 8.5, F, C.verde); y -= 28; return; }
    for (const a of items) {
      spazio(22); const alto = a.livello === 'alto';
      rett(M, y - 18, W - 2 * M, 18, alto ? C.rosa : C.chiaro); rett(M, y - 18, 3, 18, alto ? C.rosso : C.grigio);
      testo(taglia(a.testo, W - 2 * M - 20, 8.5, alto ? B : F), M + 10, y - 12.5, 8.5, alto ? B : F, alto ? hex('#7A0B1C') : C.testo);
      y -= 22;
    }
    y -= 6;
  }

  // ── Copertina ──
  nuovaPagina();
  testo(titoloReport(r.periodo), M, y - 22, 22, B); y -= 34;
  testo(`${r.periodo.etichetta}  ·  dal ${dataIt(r.periodo.dal)} al ${dataIt(r.periodo.al)}`, M, y - 11, 11, F, C.grigio); y -= 18;
  if (r.precedente) { testo(`Confronto con: ${r.precedente.etichetta}`, M, y - 9, 8.5, F, C.grigio); y -= 14; }
  y -= 10;
  const multi = r.sezioni.length > 1;
  for (const s of r.sezioni) {
    if (multi || r.sezioni.length === 1) sottotitolo(`Sintesi – ${s.titolo}`);
    tiles(s.kpi.slice(0, 4));
  }
  titoloSez('Da attenzionare', 12);
  attenzione(r.sezioni.flatMap(s => s.attenzione.map(a => ({ ...a, testo: multi ? `${s.titolo}: ${a.testo}` : a.testo }))));
  if (r.sezioni.length > 2) {
    titoloSez('Indice', 12);
    r.sezioni.forEach((s, i) => { spazio(16); testo(`${i + 1}.  ${s.titolo}`, M + 4, y - 10, 10); y -= 16; });
  }

  // ── Sezioni ──
  for (const s of r.sezioni) {
    if (r.sezioni.length > 1 || y < H / 2) nuovaPagina(); else y -= 10;
    titoloSez(s.titolo, 15);
    tiles(s.kpi);
    for (const se of s.serie) if (se.punti.length) grafico(se);
    tabelle(s.tabelle);
  }

  // ── Piè di pagina ──
  const gen = r.generato_il ? new Date(r.generato_il) : new Date();
  const genTxt = gen.toLocaleString('it-IT', { timeZone: 'Europe/Rome', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  pagine.forEach((p, i) => {
    pg = p;
    pg.drawLine({ start: { x: M, y: M }, end: { x: W - M, y: M }, thickness: 0.6, color: C.linea });
    testo(`Report automatico – Portale Molajoni · generato il ${genTxt}`, M, M - 12, 7.5, F, C.grigio);
    const n = `Pagina ${i + 1} di ${pagine.length}`; testo(n, W - M - larg(n, 7.5), M - 12, 7.5, F, C.grigio);
  });
  return await doc.save();
}

/** Email HTML riassuntiva (logo, 4–5 KPI, criticità, link alla pagina Direzione). */
export function emailHtml(r: Report, link: string, logoUrl: string): { html: string; testo: string; oggetto: string } {
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const R = '#C8102E';
  const oggetto = `Report Direzione – ${r.periodo.etichetta}`;
  const kpi = r.sezioni.flatMap(s => s.kpi.slice(0, s === r.sezioni[0] ? 5 : 2).map(k => ({ ...k, sez: s.titolo })));
  const att = r.sezioni.flatMap(s => s.attenzione);
  const celle = kpi.map(k => `<td style="padding:6px;width:${Math.floor(100 / Math.min(kpi.length, 5))}%" valign="top"><div style="background:#f4f4f4;border-left:3px solid ${R};padding:10px 12px">
<div style="font-size:11px;color:#6b6b6b">${esc(k.label)}</div><div style="font-size:22px;font-weight:700;color:#1a1a1a;margin-top:2px">${esc(fmt(k.valore, k.unita))}</div>
<div style="font-size:11px;color:#6b6b6b">${k.delta == null ? '&nbsp;' : `${k.delta > 0 ? '+' : ''}${k.delta}% vs prec.`}</div></div></td>`);
  const righeKpi: string[] = []; for (let i = 0; i < celle.length; i += 3) righeKpi.push(`<tr>${celle.slice(i, i + 3).join('')}</tr>`);
  const attHtml = att.length
    ? att.map(a => `<p style="margin:0 0 6px;padding:8px 10px;background:${a.livello === 'alto' ? '#fdecee' : '#f4f4f4'};border-left:3px solid ${a.livello === 'alto' ? R : '#999'};font-size:13px;color:#1a1a1a">${esc(a.testo)}</p>`).join('')
    : `<p style="margin:0;font-size:13px;color:#1f7a3a">Nessuna criticità rilevata nel periodo.</p>`;
  const html = `<!doctype html><html lang="it"><body style="margin:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-top:4px solid ${R}">
<tr><td style="padding:20px 24px 0"><img src="${esc(logoUrl)}" alt="Molajoni" height="34" style="display:block;height:34px;border:0"></td></tr>
<tr><td style="padding:14px 24px 2px;font-size:20px;font-weight:700;color:#1a1a1a">${esc(titoloReport(r.periodo))}</td></tr>
<tr><td style="padding:0 24px 14px;font-size:13px;color:#6b6b6b">${esc(r.periodo.etichetta)} · dal ${dataIt(r.periodo.dal)} al ${dataIt(r.periodo.al)}</td></tr>
<tr><td style="padding:0 18px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${righeKpi.join('')}</table></td></tr>
<tr><td style="padding:16px 24px 4px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#6b6b6b">DA ATTENZIONARE</td></tr>
<tr><td style="padding:0 24px 12px">${attHtml}</td></tr>
<tr><td style="padding:4px 24px 8px;font-size:13px;color:#1a1a1a">Il report completo è nel PDF allegato (${esc(r.periodo.file)}).</td></tr>
<tr><td style="padding:4px 24px 24px"><a href="${esc(link)}" style="display:inline-block;background:${R};color:#fff;text-decoration:none;padding:10px 18px;border-radius:4px;font-weight:600">Apri l'area Direzione</a></td></tr>
<tr><td style="padding:12px 24px;border-top:1px solid #eee;font-size:11px;color:#8a8a8a">Report automatico – Portale Molajoni. Gli appunti privati non sono mai inclusi.</td></tr>
</table></td></tr></table></body></html>`;
  const testoPiano = [oggetto, `Dal ${dataIt(r.periodo.dal)} al ${dataIt(r.periodo.al)}`, '',
    ...kpi.map(k => `${k.label}: ${fmt(k.valore, k.unita)}${k.delta == null ? '' : ` (${k.delta > 0 ? '+' : ''}${k.delta}%)`}`), '',
    'Da attenzionare:', ...(att.length ? att.map(a => `- ${a.testo}`) : ['- Nessuna criticità']), '', `Report completo nel PDF allegato. Area Direzione: ${link}`].join('\n');
  return { html, testo: testoPiano, oggetto };
}
