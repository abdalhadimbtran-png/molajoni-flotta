import { numerica, testoCella, type Col, type Report, type Riga } from './catalogo';

export interface Contesto { periodo: string; filtri: string; autore: string; generato: Date; /** intestazione dei file (default «Gestione flotta») */ prodotto?: string }

const nomeFile = (r: Report, c: Contesto, est: string) =>
  `Molajoni_${r.titolo.replace(/[^A-Za-z0-9]+/g, '_')}_${c.periodo.replace(/[^0-9]+/g, '-').replace(/^-|-$/g, '')}.${est}`;

function scarica(blob: Blob, nome: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 2000);
}

async function logo(): Promise<{ dataUrl: string; w: number; h: number }> {
  const b = await (await fetch('/logo-molajoni.png')).blob();
  const dataUrl = await new Promise<string>(ok => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result)); fr.readAsDataURL(b); });
  const img = await new Promise<HTMLImageElement>(ok => { const i = new Image(); i.onload = () => ok(i); i.src = dataUrl; });
  return { dataUrl, w: img.naturalWidth, h: img.naturalHeight };
}

/** Righe con gruppi e subtotali, comuni a Excel e PDF. */
type Voce = { tipo: 'gruppo'; testo: string } | { tipo: 'riga'; r: Riga } | { tipo: 'subtotale'; testo: string; valori: Record<string, number> } | { tipo: 'totale'; valori: Record<string, number> };
function struttura(rep: Report, righe: Riga[]): Voce[] {
  const tot = rep.colonne.filter(c => c.tot);
  const somma = (rr: Riga[]) => Object.fromEntries(tot.map(c => [c.k, rr.reduce((s, x) => s + (Number(x[c.k]) || 0), 0)]));
  const out: Voce[] = [];
  if (rep.raggruppa) {
    const mappa = new Map<string, Riga[]>();
    righe.forEach(r => { const k = String(r[rep.raggruppa!.k]); mappa.set(k, [...(mappa.get(k) ?? []), r]); });
    for (const [, rr] of mappa) {
      out.push({ tipo: 'gruppo', testo: rep.raggruppa.etichetta(rr[0]) });
      rr.forEach(r => out.push({ tipo: 'riga', r }));
      if (tot.length) out.push({ tipo: 'subtotale', testo: `Totale ${rr[0][rep.raggruppa.k]}`, valori: somma(rr) });
    }
  } else righe.forEach(r => out.push({ tipo: 'riga', r }));
  if (tot.length && righe.length) out.push({ tipo: 'totale', valori: somma(righe) });
  return out;
}

const FMT_XLS: Record<string, string> = { km: '#,##0', num: '#,##0', euro: '#,##0.00 "€"', dec1: '#,##0.0', dec3: '0.000', data: 'dd/mm/yyyy', dataora: 'dd/mm/yyyy hh:mm' };
const partiRoma = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function valoreXls(v: unknown, c: Col): unknown {
  if (v == null || v === '') return null;
  if (numerica(c.t)) return Number(v);
  if (c.t === 'data') { const [y, m, d] = String(v).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  if (c.t === 'dataora') {
    const p = Object.fromEntries(partiRoma.formatToParts(new Date(String(v))).map(x => [x.type, x.value]));
    return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
  }
  return String(v);
}

export async function esportaExcel(rep: Report, righe: Riga[], ctx: Contesto) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = `Molajoni Antincendi · ${ctx.prodotto ?? 'Gestione flotta'}`; wb.created = ctx.generato;
  const ws = wb.addWorksheet(rep.titolo.slice(0, 31), {
    pageSetup: { orientation: rep.orizzontale ? 'landscape' : 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } },
    headerFooter: { oddFooter: `&L&8Molajoni Antincendi · ${rep.titolo}&R&8Pagina &P di &N` },
  });
  const nc = rep.colonne.length;
  ws.columns = rep.colonne.map(c => ({ key: c.k, width: c.w ?? 14 }));
  const lg = await logo();
  const id = wb.addImage({ base64: lg.dataUrl, extension: 'png' });
  ws.getRow(1).height = 22; ws.getRow(2).height = 22;
  ws.addImage(id, { tl: { col: 0.15, row: 0.25 }, ext: { width: 150, height: Math.round(150 * lg.h / lg.w) } });
  const tit = ws.getCell(1, Math.min(3, nc)); tit.value = rep.titolo; tit.font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF1D1D1F' } };
  const sot = ws.getCell(2, Math.min(3, nc)); sot.value = `Periodo: ${ctx.periodo}${ctx.filtri ? ` · ${ctx.filtri}` : ''}`; sot.font = { size: 10, color: { argb: 'FF6E6E73' } };
  const gen = ws.getCell(3, Math.min(3, nc)); gen.value = `Generato il ${testoCella(ctx.generato.toISOString(), 'dataora')} da ${ctx.autore}`; gen.font = { size: 9, color: { argb: 'FF8E8E93' } };
  let r = 5;
  if (rep.riepilogo && righe.length) {
    rep.riepilogo(righe).forEach((x, i) => {
      const cl = ws.getCell(r, 1 + i * 2); cl.value = x.l; cl.font = { size: 9, color: { argb: 'FF6E6E73' } };
      const cv = ws.getCell(r + 1, 1 + i * 2); cv.value = x.v; cv.font = { size: 13, bold: true, color: { argb: 'FF1D1D1F' } };
    });
    r += 3;
  }
  const bordo = { bottom: { style: 'thin' as const, color: { argb: 'FFE5E5EA' } } };
  const testa = ws.getRow(r);
  rep.colonne.forEach((c, i) => {
    const cell = testa.getCell(i + 1); cell.value = c.l;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D1D1F' } };
    cell.alignment = { vertical: 'middle', horizontal: numerica(c.t) ? 'right' : 'left', wrapText: true, indent: numerica(c.t) ? 0 : 1 };
  });
  testa.height = 30;
  const rigaTesta = r;
  ws.views = [{ state: 'frozen', ySplit: rigaTesta }];
  let zebra = false;
  for (const v of struttura(rep, righe)) {
    r++;
    const row = ws.getRow(r);
    if (v.tipo === 'gruppo') {
      ws.mergeCells(r, 1, r, nc);
      const c = row.getCell(1); c.value = v.testo; c.font = { bold: true, size: 11, color: { argb: 'FF1D1D1F' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDEDF0' } }; row.height = 20; zebra = false; continue;
    }
    if (v.tipo === 'riga') {
      rep.colonne.forEach((c, i) => {
        const cell = row.getCell(i + 1); cell.value = valoreXls(v.r[c.k], c) as never;
        if (FMT_XLS[c.t]) cell.numFmt = FMT_XLS[c.t];
        cell.alignment = { vertical: 'top', wrapText: c.t === 'testo', horizontal: numerica(c.t) ? 'right' : 'left', indent: numerica(c.t) ? 0 : 1 };
        if (c.t === 'targa') cell.font = { bold: true };
        cell.border = bordo;
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F9' } };
      });
      zebra = !zebra; continue;
    }
    const grande = v.tipo === 'totale';
    rep.colonne.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (i === 0) cell.value = grande ? 'TOTALE' : (v as { testo: string }).testo;
      if (c.tot) { cell.value = v.valori[c.k]; cell.numFmt = FMT_XLS[c.t] ?? '#,##0'; cell.alignment = { horizontal: 'right' }; }
      cell.font = { bold: true, color: { argb: grande ? 'FFFFFFFF' : 'FF1D1D1F' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: grande ? 'FFE30613' : 'FFF2F2F5' } };
    });
  }
  if (righe.length) ws.autoFilter = { from: { row: rigaTesta, column: 1 }, to: { row: rigaTesta, column: nc } };
  else ws.getCell(rigaTesta + 1, 1).value = 'Nessun dato nel periodo selezionato.';
  const buf = await wb.xlsx.writeBuffer();
  scarica(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nomeFile(rep, ctx, 'xlsx'));
}

export async function esportaPdf(rep: Report, righe: Riga[], ctx: Contesto) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: rep.orizzontale ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 12;
  const lg = await logo();
  const lw = 34, lh = lw * lg.h / lg.w;
  const intestazione = () => {
    doc.addImage(lg.dataUrl, 'PNG', M, 9, lw, lh);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(110, 110, 115);
    doc.text(ctx.prodotto ?? 'Gestione flotta', W - M, 12, { align: 'right' });
    doc.setFont('helvetica', 'normal'); doc.text(rep.titolo, W - M, 16.5, { align: 'right' });
    doc.setDrawColor(227, 6, 19); doc.setLineWidth(0.6); doc.line(M, 9 + lh + 3, W - M, 9 + lh + 3);
  };
  intestazione();
  let y = 9 + lh + 12;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(29, 29, 31);
  doc.text(rep.titolo, M, y);
  y += 6.5; doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110, 110, 115);
  doc.text(`Periodo: ${ctx.periodo}${ctx.filtri ? `   ·   ${ctx.filtri}` : ''}`, M, y);
  y += 5; doc.text(`Generato il ${testoCella(ctx.generato.toISOString(), 'dataora')} da ${ctx.autore}`, M, y);
  y += 5;
  if (rep.riepilogo && righe.length) {
    const box = rep.riepilogo(righe); const gap = 4; const bw = Math.min(58, (W - 2 * M - gap * (box.length - 1)) / box.length);
    box.forEach((b, i) => {
      const x = M + i * (bw + gap);
      doc.setFillColor(245, 245, 247); doc.roundedRect(x, y + 2, bw, 17, 2.5, 2.5, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110, 110, 115); doc.text(b.l, x + 4, y + 8);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(29, 29, 31); doc.text(b.v, x + 4, y + 15.5);
    });
    y += 24;
  }
  const cols = rep.colonne;
  const corpo: unknown[][] = [];
  const stili: Record<number, 'gruppo' | 'subtotale' | 'totale'> = {};
  for (const v of struttura(rep, righe)) {
    if (v.tipo === 'gruppo') { stili[corpo.length] = 'gruppo'; corpo.push([{ content: v.testo, colSpan: cols.length }]); }
    else if (v.tipo === 'riga') corpo.push(cols.map(c => testoCella(v.r[c.k], c.t)));
    else { stili[corpo.length] = v.tipo; corpo.push(cols.map((c, i) => i === 0 ? (v.tipo === 'totale' ? 'TOTALE' : v.testo) : c.tot ? testoCella(v.valori[c.k], c.t) : '')); }
  }
  const totW = cols.reduce((s, c) => s + (c.w ?? 14), 0);
  autoTable(doc, {
    startY: y + 2, margin: { left: M, right: M, top: 9 + lh + 9, bottom: 14 },
    head: [cols.map(c => c.l)], body: corpo.length ? corpo as never : [[{ content: 'Nessun dato nel periodo selezionato.', colSpan: cols.length }]],
    styles: { font: 'helvetica', fontSize: 8, cellPadding: { top: 2, bottom: 2, left: 2.2, right: 2.2 }, textColor: [29, 29, 31], lineColor: [229, 229, 234], lineWidth: { bottom: 0.15 }, overflow: 'linebreak', valign: 'top' },
    headStyles: { fillColor: [29, 29, 31], textColor: 255, fontStyle: 'bold', fontSize: 8, valign: 'middle' },
    alternateRowStyles: { fillColor: [249, 249, 251] },
    columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: numerica(c.t) ? 'right' : 'left', cellWidth: ((c.w ?? 14) / totW) * (W - 2 * M), fontStyle: c.t === 'targa' ? 'bold' : 'normal' }])),
    didParseCell: d => {
      if (d.section === 'head') { d.cell.styles.halign = numerica(cols[d.column.index]?.t ?? 'testo') ? 'right' : 'left'; return; }
      const s = stili[d.row.index];
      if (s === 'gruppo') { d.cell.styles.fillColor = [237, 237, 240]; d.cell.styles.fontStyle = 'bold'; d.cell.styles.fontSize = 9; }
      if (s === 'subtotale') { d.cell.styles.fillColor = [242, 242, 245]; d.cell.styles.fontStyle = 'bold'; }
      if (s === 'totale') { d.cell.styles.fillColor = [227, 6, 19]; d.cell.styles.textColor = 255; d.cell.styles.fontStyle = 'bold'; }
    },
    didDrawPage: d => { if (d.pageNumber > 1) intestazione(); },
  });
  const pagine = doc.getNumberOfPages();
  for (let p = 1; p <= pagine; p++) {
    doc.setPage(p); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(142, 142, 147);
    doc.text(`Molajoni Antincendi · ${ctx.prodotto ?? 'Gestione flotta'} · ${rep.titolo} · ${ctx.periodo}`, M, H - 7);
    doc.text(`Pagina ${p} di ${pagine}`, W - M, H - 7, { align: 'right' });
  }
  scarica(doc.output('blob'), nomeFile(rep, ctx, 'pdf'));
}
