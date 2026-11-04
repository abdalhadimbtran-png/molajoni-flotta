import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet.markercluster';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { coloreTecnico, type Intervento } from './tipi';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

function popup(i: Intervento): string {
  const r = (k: string, v: unknown) => (v == null || v === '' ? '' : `<div><b>${k}:</b> ${esc(v)}</div>`);
  return `<div class="int-pop"><div class="int-pop-h">N. ${esc(i.numero)} · ${esc(i.tecnico_sigla ?? 'senza tecnico')}</div>`
    + r('Cliente', i.cliente) + r('Cod. cli.', i.cod_cliente) + r('Impianto', i.impianto)
    + r('Indirizzo', [i.via, i.civico].filter(Boolean).join(' ') + ` – ${i.cap ?? ''} ${i.comune ?? ''}`)
    + r('Componenti', i.componenti) + r('Famiglie', i.famiglie.join(', ')) + r('Tipo', i.tipo) + r('Note', i.note)
    + r('Posizione', `${i.geo_qualita ?? '—'}${i.geo_dubbio ? ' (da verificare)' : ''}`) + `</div>`;
}

/** Mappa di tutti gli interventi con raggruppamento; colore = tecnico, forma = qualità della posizione. */
export default function MappaInterventi({ interventi, trascinabile, onSposta, onScegli, alta = false }: {
  interventi: Intervento[]; trascinabile?: number | null; onSposta?: (id: number, lat: number, lon: number) => void;
  onScegli?: (id: number) => void; alta?: boolean;
}) {
  const div = useRef<HTMLDivElement>(null);
  const mappa = useRef<L.Map | null>(null);
  const gruppo = useRef<L.MarkerClusterGroup | null>(null);
  const cb = useRef({ onSposta, onScegli }); cb.current = { onSposta, onScegli };
  const inquadrato = useRef('');
  useEffect(() => {
    if (!div.current || mappa.current) return;
    const m = L.map(div.current, { scrollWheelZoom: true }).setView([41.9, 12.5], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    mappa.current = m;
    gruppo.current = L.markerClusterGroup({ maxClusterRadius: 45, disableClusteringAtZoom: 17, showCoverageOnHover: false }).addTo(m);
    return () => { m.remove(); mappa.current = null; };
  }, []);
  useEffect(() => {
    const m = mappa.current, g = gruppo.current; if (!m || !g) return;
    g.clearLayers();
    const ll: [number, number][] = [];
    for (const i of interventi) {
      if (i.lat == null || i.lon == null) continue;
      const q = i.geo_dubbio && i.geo_qualita !== 'manuale' ? 'dubbio' : i.geo_qualita ?? 'dubbio';
      const icon = L.divIcon({ className: `int-pin q-${q}${trascinabile === i.id ? ' scelto' : ''}`, html: `<span style="--c:${coloreTecnico(i.tecnico_sigla)}">${i.geo_qualita === 'centro_cap' || i.geo_qualita === 'centro_comune' ? '?' : ''}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
      const mk = L.marker([i.lat, i.lon], { icon, draggable: trascinabile === i.id, title: `N. ${i.numero ?? ''}` }).bindPopup(popup(i));
      mk.on('click', () => cb.current.onScegli?.(i.id));
      mk.on('dragend', () => { const p = mk.getLatLng(); cb.current.onSposta?.(i.id, p.lat, p.lng); });
      g.addLayer(mk); ll.push([i.lat, i.lon]);
    }
    const chiave = interventi.map(i => i.id).join(',');
    if (chiave !== inquadrato.current && ll.length) { inquadrato.current = chiave; m.fitBounds(L.latLngBounds(ll), { padding: [30, 30], maxZoom: 15 }); }
  }, [interventi, trascinabile]);
  useEffect(() => {
    const m = mappa.current; if (!m || trascinabile == null) return;
    const i = interventi.find(x => x.id === trascinabile);
    if (i?.lat != null && i.lon != null) m.setView([i.lat, i.lon], 17);
  }, [trascinabile]); // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={div} className={`perc-mappa int-mappa${alta ? ' alta' : ''}`} />;
}
