import type ExcelJSType from 'exceljs';
import { COLONNE, type Tipo } from './anagrafiche';

const TITOLO: Record<Tipo, string> = { dipendenti: 'Dipendenti e tecnici', veicoli: 'Veicoli' };

/** Modello Excel: foglio dati (intestazioni, obbligatori in rosso) + foglio «Istruzioni» con esempio e regole. */
export async function creaModello(ExcelJS: typeof ExcelJSType, tipo: Tipo): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Molajoni Antincendi';
  const cols = COLONNE[tipo];
  const ws = wb.addWorksheet(TITOLO[tipo], { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = cols.map(c => ({ header: c.obbl ? `${c.titolo} *` : c.titolo, key: c.k, width: c.w ?? 14 }));
  const h = ws.getRow(1); h.height = 22;
  h.eachCell((cell, i) => {
    cell.font = { bold: true, color: { argb: cols[i - 1].obbl ? 'FFC0392B' : 'FF1D1D1F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F7' } };
    cell.alignment = { vertical: 'middle' };
    cell.note = cols[i - 1].nota || cols[i - 1].titolo;
  });
  for (let r = 2; r <= 500; r++) cols.forEach((c, i) => { if (/data|scad/.test(c.k)) ws.getCell(r, i + 1).numFmt = 'dd/mm/yyyy'; else ws.getCell(r, i + 1).numFmt = '@'; });

  const ist = wb.addWorksheet('Istruzioni');
  ist.columns = [{ width: 26 }, { width: 14 }, { width: 70 }, { width: 24 }];
  ist.addRow([`Modello ${TITOLO[tipo]} – Molajoni`]).font = { bold: true, size: 14 };
  ist.addRow(['Compila il primo foglio: una riga per ' + (tipo === 'dipendenti' ? 'persona' : 'veicolo') + '. Le colonne con * sono obbligatorie.']);
  ist.addRow([tipo === 'dipendenti' ? 'Il Codice identifica la persona: reimportando lo stesso codice la riga viene aggiornata, non duplicata.' : 'La Targa identifica il veicolo: reimportando la stessa targa la riga viene aggiornata, non duplicata.']);
  ist.addRow(['Date nel formato gg/mm/aaaa. Non inserire codice fiscale, IBAN o dati sanitari.']);
  ist.addRow([]);
  const t = ist.addRow(['Colonna', 'Obbligatoria', 'Come compilarla', 'Esempio']); t.font = { bold: true };
  for (const c of cols) ist.addRow([c.titolo, c.obbl ? 'Sì' : '', c.nota, c.esempio]);
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
