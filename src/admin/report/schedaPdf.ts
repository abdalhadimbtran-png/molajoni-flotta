import { logo, scarica } from './esporta';

export interface DatiScheda { nome: string; cognome: string; codice: string; pin: string }

/** Scheda personale A4 per installare l'app (stesso stile dei report). */
export async function schedaPdf(d: DatiScheda | null, url: string, qr: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 18;
  const lg = await logo(); const lw = 46, lh = lw * lg.h / lg.w;
  doc.addImage(lg.dataUrl, 'PNG', M, 14, lw, lh);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(110, 110, 115);
  doc.text('APP AZIENDALE', W - M, 20, { align: 'right' });
  doc.setDrawColor(227, 6, 19); doc.setLineWidth(0.8); doc.line(M, 14 + lh + 4, W - M, 14 + lh + 4);
  let y = 14 + lh + 16;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(110, 110, 115);
  doc.text('Scheda personale di accesso', M, y);
  y += 9; doc.setFont('helvetica', 'bold'); doc.setFontSize(24); doc.setTextColor(29, 29, 31);
  doc.text(d ? `${d.nome} ${d.cognome}` : '______________________', M, y);
  // QR grande al centro
  y += 10; const q = 72;
  doc.setFillColor(245, 245, 247); doc.roundedRect((W - q) / 2 - 6, y, q + 12, q + 18, 4, 4, 'F');
  doc.addImage(qr, 'PNG', (W - q) / 2, y + 6, q, q);
  doc.setFont('courier', 'normal'); doc.setFontSize(9.5); doc.setTextColor(80, 80, 86);
  doc.text(url, W / 2, y + q + 12.5, { align: 'center' });
  y += q + 28;
  // tre colonne di passaggi
  const col = (W - 2 * M - 12) / 3;
  const passi: [string, string[]][] = [
    ['Android', ['Inquadra il QR con la fotocamera.', "Tocca «Installa l'app».", 'Conferma «Installa».']],
    ['iPhone / iPad', ['Inquadra il QR e apri con Safari.', 'Tocca Condividi.', '«Aggiungi alla schermata Home».']],
    ['Primo accesso', ["Apri l'app dall'icona.", 'Scrivi codice e PIN.', '«Attiva le notifiche».']],
  ];
  passi.forEach(([tit, righe], i) => {
    const x = M + i * (col + 6);
    doc.setFillColor(227, 6, 19); doc.rect(x, y - 4.5, 1.2, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(29, 29, 31); doc.text(tit, x + 4, y);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(60, 60, 66);
    let yy = y + 8;
    righe.forEach((r, k) => { const l = doc.splitTextToSize(`${k + 1}.  ${r}`, col - 4); doc.text(l, x + 4, yy); yy += l.length * 4.8 + 1.6; });
  });
  y += 32;
  // riquadri codice e PIN
  const bw = (W - 2 * M - 8) / 2;
  ([['CODICE', d?.codice], ['PIN', d?.pin]] as [string, string | undefined][]).forEach(([l, v], i) => {
    const x = M + i * (bw + 8);
    doc.setDrawColor(29, 29, 31); doc.setLineWidth(0.5); doc.roundedRect(x, y, bw, 26, 3, 3, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(110, 110, 115); doc.text(l, x + 6, y + 8);
    doc.setFont('courier', 'bold'); doc.setFontSize(20); doc.setTextColor(29, 29, 31); doc.text(v ?? '', x + 6, y + 19);
  });
  y += 36;
  doc.setFillColor(252, 235, 236); doc.roundedRect(M, y, W - 2 * M, 14, 3, 3, 'F');
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(176, 0, 16);
  doc.text('Il PIN è personale: non condividerlo. Se lo dimentichi, chiedine uno nuovo al responsabile.', W / 2, y + 8.6, { align: 'center' });
  doc.setFontSize(7.5); doc.setTextColor(142, 142, 147);
  doc.text('Molajoni Antincendi · Documento riservato', M, H - 10);
  doc.text(new Date().toLocaleDateString('it-IT'), W - M, H - 10, { align: 'right' });
  scarica(doc.output('blob'), d ? `Molajoni - Scheda app - ${d.cognome} ${d.nome}.pdf` : 'Molajoni - Scheda app.pdf');
}
