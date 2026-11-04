/** Esportazione dei punti per app di mappe esterne (OsmAnd, Google My Maps, Organic Maps…): GPX, KML, CSV. */
export interface PuntoEsport {
  numero: string | null; cliente: string | null; cod_cliente: string | null; impianto: string | null;
  via: string | null; civico: string | null; cap: string | null; comune: string | null; prov: string | null;
  tipo: string | null; famiglie: string[]; note: string | null; tecnico_sigla: string | null; componenti: number | null;
  lat: number | null; lon: number | null; geo_qualita: string | null;
}

const xml = (s: unknown) => String(s ?? '').replace(/[<>&'"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
export const nomePunto = (p: PuntoEsport) => `${p.numero ?? ''} ${p.cliente ?? ''}`.trim();
const indirizzo = (p: PuntoEsport) => `${[p.via, p.civico].filter(Boolean).join(' ')}, ${[p.cap, p.comune].filter(Boolean).join(' ')}${p.prov ? ` (${p.prov})` : ''}`;
export function descrizione(p: PuntoEsport): string {
  return [indirizzo(p), `Impianto ${p.impianto ?? '—'}${p.cod_cliente ? ` · Cod. cli. ${p.cod_cliente}` : ''}`,
    [p.tipo, p.famiglie.join(', ')].filter(Boolean).join(' · '), p.componenti != null ? `Componenti: ${p.componenti}` : '',
    p.tecnico_sigla ? `Tecnico: ${p.tecnico_sigla}` : '', p.note ?? ''].filter(Boolean).join('\n');
}
const conCoord = (l: PuntoEsport[]) => l.filter(p => p.lat != null && p.lon != null);

export function gpx(l: PuntoEsport[], titolo: string): string {
  const w = conCoord(l).map(p => `  <wpt lat="${p.lat!.toFixed(6)}" lon="${p.lon!.toFixed(6)}">\n    <name>${xml(nomePunto(p))}</name>\n    <desc>${xml(descrizione(p))}</desc>\n    <type>${xml(p.tecnico_sigla ?? 'Senza tecnico')}</type>\n  </wpt>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="MolajoniPortale" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${xml(titolo)}</name></metadata>\n${w.join('\n')}\n</gpx>\n`;
}

export function kml(l: PuntoEsport[], titolo: string): string {
  const gruppi = new Map<string, PuntoEsport[]>();
  for (const p of conCoord(l)) { const k = p.tecnico_sigla ?? 'Senza tecnico'; gruppi.set(k, [...(gruppi.get(k) ?? []), p]); }
  const cartelle = [...gruppi].sort().map(([k, ps]) => `    <Folder><name>${xml(k)}</name>\n${ps.map(p =>
    `      <Placemark><name>${xml(nomePunto(p))}</name><description>${xml(descrizione(p))}</description><Point><coordinates>${p.lon!.toFixed(6)},${p.lat!.toFixed(6)},0</coordinates></Point></Placemark>`).join('\n')}\n    </Folder>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document><name>${xml(titolo)}</name>\n${cartelle.join('\n')}\n  </Document>\n</kml>\n`;
}

const cella = (v: unknown) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
/** CSV con separatore ";" (Excel italiano) e coordinate col punto decimale. */
export function csv(l: PuntoEsport[]): string {
  const h = ['nome', 'numero', 'cliente', 'cod_cliente', 'impianto', 'indirizzo', 'cap', 'comune', 'prov', 'tecnico', 'tipo', 'famiglie', 'componenti', 'note', 'lat', 'lon', 'qualita'];
  const r = l.map(p => [nomePunto(p), p.numero, p.cliente, p.cod_cliente, p.impianto, [p.via, p.civico].filter(Boolean).join(' '), p.cap, p.comune, p.prov, p.tecnico_sigla,
    p.tipo, p.famiglie.join(', '), p.componenti, p.note, p.lat?.toFixed(6), p.lon?.toFixed(6), p.geo_qualita].map(cella).join(';'));
  return '﻿' + [h.join(';'), ...r].join('\r\n') + '\r\n';
}

export function scarica(testo: string, nome: string, tipo: string) {
  const url = URL.createObjectURL(new Blob([testo], { type: tipo }));
  const a = document.createElement('a'); a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function esportaPunti(formato: 'gpx' | 'kml' | 'csv', l: PuntoEsport[], base: string) {
  const nome = base.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 80);
  if (formato === 'gpx') scarica(gpx(l, base), `${nome}.gpx`, 'application/gpx+xml');
  else if (formato === 'kml') scarica(kml(l, base), `${nome}.kml`, 'application/vnd.google-earth.kml+xml');
  else scarica(csv(l), `${nome}.csv`, 'text/csv;charset=utf-8');
}
