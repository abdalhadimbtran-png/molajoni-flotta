import { describe, expect, it } from 'vitest';
import { noteIndirizzo, pulisciIndirizzo, senzaIniziali } from './indirizzo';
import { capTesto, coordinateTesto, dataIso, inLazio, leggiMatrice } from './importa';
import { catena, daNominatim, daPhoton, ErroreServizio, geocodificaRiga, puntoMedioVia, valida, distanzaKm, type Fornitore, type Geo } from '../../../supabase/functions/geocodifica/valida';
import { suggerisci } from './suggerimenti';

// Indirizzi di prova inventati (stessi schemi dell'export Taylor, nessun dato reale)
const casi: [string, string, string | null, string | null][] = [
  ['V.LE DELLE PROVE 19', 'Viale delle Prove', '19', null],
  ['P.ZZA FINTA 7', 'Piazza Finta', '7', null],
  ['P.ZA ESEMPIO, 3', 'Piazza Esempio', '3', null],
  ['L.GO TEST 5/B', 'Largo Test', '5/B', null],
  ['C.SO IMMAGINARIO II, 18', 'Corso Immaginario II', '18', null],
  ['V. G.ROSSI 12', 'Via G. Rossi', '12', null],
  ['VIA INVENTATA 8 -00034', 'Via Inventata', '8', null],
  ['VIA INVENTATA 8 -00040 0N9', 'Via Inventata', '8', null],
  ['PIAZZA PROVA -Piano 2 interno 4a 45', 'Piazza Prova', '45', 'Accesso: Piano 2, interno 4a'],
  ['VIALE FASULLO 74 Sc C Int.3', 'Viale Fasullo', '74', 'Accesso: interno 3, scala C'],
  ['VIALE FASULLO, 215 SCALA D', 'Viale Fasullo', '215', 'Accesso: scala D'],
  ['VIA FINTA scala B p.4 int.22 21', 'Via Finta', '21', 'Accesso: Piano 4, interno 22, scala B'],
  ['VIA PROVA, 14 4^PIANO', 'Via Prova', '14', 'Accesso: Piano 4'],
  ['VIA PROVA, 35 I^ PIANO', 'Via Prova', '35', 'Accesso: Piano I'],
  ['VIA XXIV FINTO 8', 'Via XXIV Finto', '8', null],
  ['VIA IV ESEMPIO, 149', 'Via IV Esempio', '149', null],
  ['VIA DELLE PROVE, 20-22', 'Via delle Prove', '20-22', null],
  ['VIA DELLE PROVE 98 E', 'Via delle Prove', '98/E', null],
  ['VIA DELLE PROVE 19 E 31', 'Via delle Prove', '19', 'Altro: E 31'],
  ['VIA FINTA N.23', 'Via Finta', '23', null],
  ['VIA FINTA KM 12 -00012', 'Via Finta', null, 'Altro: Km 12'],
  ['VIA FINTA 1 - VIA ALTRA ,6', 'Via Finta', '1', 'Altro: Via Altra, 6'],
  ['VIA FINTA (LOC. PROVA)', 'Via Finta', null, 'Altro: Loc. Prova'],
  ['VIA FINTA 3 c/o Ditta Prova', 'Via Finta', '3', 'Altro: C/O Ditta Prova'],
  ['VIA FINTA, 245 PAL. SX', 'Via Finta', '245', 'Accesso: palazzina SX'],
  ['V.leProva, 10', 'Viale Prova', '10', null],
  ['LUNGOTEVERE DELLE PROVE, 19', 'Lungotevere delle Prove', '19', null],
  ['VIA PROVA-scala B int. 14-5^ p. 183', 'Via Prova', '183', 'Accesso: Piano 5, interno 14, scala B'],
];

describe('pulisciIndirizzo', () => {
  for (const [in_, via, civ, note] of casi) it(in_, () => {
    const p = pulisciIndirizzo(in_);
    expect(p.via).toBe(via);
    expect(p.civico).toBe(civ);
    expect(noteIndirizzo(p)).toBe(note);
  });
  it('civico per la ricerca: primo numero', () => {
    expect(pulisciIndirizzo('VIA PROVA, 20-22').civicoGeo).toBe('20');
    expect(pulisciIndirizzo('VIA PROVA 25/B').civicoGeo).toBe('25/B');
  });
  it('senza iniziali', () => { expect(senzaIniziali('Via G. Rossi')).toBe('Via Rossi'); expect(senzaIniziali('Via G.M. Bianchi')).toBe('Via Bianchi'); });
});

describe('importazione', () => {
  it('CAP con zeri, date, Lazio', () => {
    expect(capTesto(186)).toBe('00186'); expect(capTesto('04100')).toBe('04100'); expect(capTesto('abc')).toBeNull();
    expect(dataIso('01/11/2026')).toBe('2026-11-01');
    expect(inLazio('RM', '00100')).toBe(true); expect(inLazio('MI', '20100')).toBe(false);
    expect(inLazio(null, '00155')).toBe(true); expect(inLazio('LT', '04100')).toBe(true);
  });
  it('colonne per nome, in qualsiasi ordine', () => {
    const m = [
      ['Listato interventi'],
      ['Ubicazione', 'Cliente', 'ID intervento', 'Num/serie', 'CAP', 'Loc. imp.', 'Prov.', 'Tecnici attivi', 'Tot. Comp.', 'Famiglie servizi', 'Del', 'Altro'],
      ['VIA FINTA 1 INT. 2', 'Cliente Prova', 1001, '123/', 186, 'ROMA', 'RM', 'teca', '3', 'ESTINTORE, PORTE', '01/11/2026', 'x'],
      ['VIA FINTA 2', 'Cliente Prova', 1001, '124/', 186, 'ROMA', 'RM', '', '1', '', '01/11/2026', 'x'],
      ['VIA ALTRA 3', 'Cliente Prova', 1002, '125/', '20100', 'MILANO', 'MI', null, null, 'IDRANTI', '01/11/2026', 'x'],
      [null, null, null, null, null, null, null, null, null, null, null, null],
    ];
    const L = leggiMatrice(m);
    expect(L.mancanti).toEqual([]);
    expect(L.righe).toHaveLength(2);
    expect(L.scartate).toHaveLength(1);
    expect(L.mese).toBe('2026-11');
    const a = L.righe[0];
    expect(a).toMatchObject({ id_intervento: '1001', numero: '123', cap: '00186', tecnico_sigla: 'TECA', componenti: 3, famiglie: ['ESTINTORE', 'PORTE'], fuori_lazio: false, note: 'Accesso: interno 2' });
    expect(L.righe[1].fuori_lazio).toBe(true);
  });
  it('segnala colonne mancanti', () => { expect(leggiMatrice([['ID intervento', 'Cliente']]).mancanti.length).toBeGreaterThan(0); });
});

describe('validazione geocodifica', () => {
  const centro = { lat: 41.9, lon: 12.5 };
  const r = (lat: number, lon: number, address: Record<string, string>): Geo => daNominatim({ lat: String(lat), lon: String(lon), address });
  it('CAP uguale → ok', () => { expect(valida(r(41.901, 12.501, { postcode: '00100', city: 'Roma' }), { cap: '00100', comune: 'ROMA' }, centro).ok).toBe(true); });
  it('comune diverso → no', () => { expect(valida(r(45.4, 9.1, { postcode: '20100', city: 'Milano' }), { cap: '00100', comune: 'ROMA' }, centro).ok).toBe(false); });
  it('stesso comune ma lontano dal CAP → no', () => { expect(valida(r(41.8, 12.6, { postcode: '00199', city: 'Roma' }), { cap: '00100', comune: 'ROMA' }, centro).ok).toBe(false); });
  it('stesso comune vicino al CAP → ok', () => { expect(valida(r(41.91, 12.51, { city: 'Roma' }), { cap: '00100', comune: 'ROMA' }, centro).ok).toBe(true); });
  it('senza centro CAP: solo comune → dubbio', () => { const e = valida(r(41.91, 12.51, { city: 'Roma' }), { cap: '00100', comune: 'ROMA' }, null); expect(e.ok && e.dubbio).toBe(true); });
  it('accenti nel comune', () => { expect(valida(r(41.91, 12.51, { town: 'Città Prova' }), { cap: null, comune: 'CITTA PROVA' }, null).ok).toBe(true); });
  it('punto medio della via limitato al CAP', () => {
    // via lunga 20 km in linea retta verso est; il CAP è vicino all'inizio
    const linea: [number, number][] = Array.from({ length: 21 }, (_, i) => [12.5 + i * 0.012, 41.9]);
    const p = puntoMedioVia([daNominatim({ lat: '41.9', lon: '12.62', class: 'highway', geojson: { type: 'LineString', coordinates: linea } })], { lat: 41.9, lon: 12.5 })!;
    expect(distanzaKm(p, { lat: 41.9, lon: 12.5 })).toBeLessThan(3);
    const q = puntoMedioVia([daNominatim({ lat: '41.9', lon: '12.62', class: 'highway', geojson: { type: 'LineString', coordinates: linea } })], null)!;
    expect(q.lon).toBeCloseTo(12.62, 2);
  });
});

describe('suggerimento tecnico', () => {
  const zone = new Map([['00100', 'TECB']]);
  it('per CAP', () => { expect(suggerisci({ cap: '00100', lat: 41.9, lon: 12.5 }, zone, [], new Set(['TECB']))).toMatchObject({ sigla: 'TECB', motivo: 'CAP 00100 → TECB' }); });
  it('per vicinanza', () => {
    const altri = [{ tecnico_sigla: 'TECA', lat: 41.95, lon: 12.5 }, { tecnico_sigla: 'TECE', lat: 41.901, lon: 12.501 }, { tecnico_sigla: 'TECE', lat: 41.903, lon: 12.503 }];
    const s = suggerisci({ cap: '00999', lat: 41.9, lon: 12.5 }, zone, altri, new Set(['TECA', 'TECE']));
    expect(s?.sigla).toBe('TECE'); expect(s?.motivo).toMatch(/più vicino: TECE, \d+,\d km/);
  });
  it('nessun dato', () => { expect(suggerisci({ cap: null, lat: null, lon: null }, zone, [], new Set())).toBeNull(); });
});

describe('fornitori e errori di servizio', () => {
  const casa: Geo = daPhoton({ geometry: { coordinates: [12.5, 41.9] }, properties: { housenumber: '1', street: 'Via Finta', postcode: '00100', city: 'Roma', osm_key: 'building' } });
  it('Photon normalizzato', () => { expect(casa).toMatchObject({ lat: 41.9, lon: 12.5, postcode: '00100', tipo: 'casa', housenumber: '1' }); });
  const giu: Fornitore = { nome: 'Giu', cerca: async () => { throw new ErroreServizio('Giu HTTP 403', 403); } };
  const vuoto: Fornitore = { nome: 'Vuoto', cerca: async () => [] };
  const buono: Fornitore = { nome: 'Buono', cerca: async q => q.tipo === 'indirizzo' ? [casa] : [{ ...casa, tipo: 'altro' }] };
  const cache = { leggi: async () => undefined, scrivi: async () => undefined };
  const riga = { via: 'Via Finta', civico_geo: '1', cap: '00100', comune: 'ROMA', prov: 'RM' };
  it('tutti giù → ErroreServizio (riga non segnata)', async () => { await expect(geocodificaRiga(riga, catena([giu, giu]), cache)).rejects.toBeInstanceOf(ErroreServizio); });
  it('uno giù, l\'altro risponde → esatto', async () => { expect((await geocodificaRiga(riga, catena([giu, buono]), cache))?.geo_qualita).toBe('esatto'); });
  it('risposte vuote → non trovato (null), non errore', async () => { expect(await geocodificaRiga(riga, catena([giu, vuoto]), cache)).toBeNull(); });
});

describe('coordinate nel file', () => {
  it('colonne Lat/Lon o Coordinate', () => {
    const m = [['ID intervento', 'Num/serie', 'Ubicazione', 'CAP', 'Loc. imp.', 'Latitudine', 'Longitudine', 'Coordinate'],
      [1, '1/', 'VIA FINTA 1', '00100', 'ROMA', '41,9', '12,5', null],
      [2, '2/', 'VIA FINTA 2', '00100', 'ROMA', null, null, '41.91, 12.51'],
      [3, '3/', 'VIA FINTA 3', '00100', 'ROMA', 99, 99, null]];
    const L = leggiMatrice(m);
    expect([L.righe[0].lat, L.righe[0].lon]).toEqual([41.9, 12.5]);
    expect([L.righe[1].lat, L.righe[1].lon]).toEqual([41.91, 12.51]);
    expect(L.righe[2].lat).toBeNull();
    expect(coordinateTesto('12.5,41.9')).toEqual([41.9, 12.5]);
  });
});

describe('controllo qualità ed esportazioni', async () => {
  const { fuoriZona } = await import('./controllo');
  const { gpx, kml, csv } = await import('./esporta');
  it('punto fuori dal suo CAP', () => {
    const p = [1, 2, 3, 4].map(id => ({ id, cap: '00100', lat: 41.9 + id * 0.001, lon: 12.5 }));
    p.push({ id: 9, cap: '00100', lat: 42.2, lon: 12.5 });
    const f = fuoriZona(p);
    expect([...f.keys()]).toEqual([9]);
  });
  const punto = { numero: '1', cliente: 'Cliente & Prova', cod_cliente: 'C1', impianto: '1/IMP', via: 'Via Finta', civico: '1', cap: '00100', comune: 'ROMA', prov: 'RM', tipo: 'CONTROLLO', famiglie: ['ESTINTORE'], note: null, tecnico_sigla: 'TECA', componenti: 2, lat: 41.9, lon: 12.5, geo_qualita: 'esatto' };
  it('GPX/KML/CSV', () => {
    expect(gpx([punto], 'Prova')).toContain('<wpt lat="41.900000" lon="12.500000">');
    expect(gpx([punto], 'Prova')).toContain('Cliente &amp; Prova');
    expect(kml([punto], 'Prova')).toContain('<coordinates>12.500000,41.900000,0</coordinates>');
    expect(csv([punto]).split('\r\n')[1]).toContain('41.900000;12.500000');
  });
});
