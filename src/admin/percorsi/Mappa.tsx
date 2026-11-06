import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
/** Colore brand dai token (Leaflet vuole un colore reale, non var()). */
const brand = () => getComputedStyle(document.documentElement).getPropertyValue('--brand').trim() || undefined;

export interface Segnaposto { id: string; lat: number; lon: number; etichetta: string; numero?: number; sede?: boolean }

/** Mappa del percorso (Leaflet + tessere OpenStreetMap). Clic = punto scelto; segnaposto trascinabili. */
export default function Mappa({ punti, linea, scelto, onClic, onSposta }: {
  punti: Segnaposto[]; linea: [number, number][] | null; scelto?: { lat: number; lon: number } | null;
  onClic?: (lat: number, lon: number) => void; onSposta?: (id: string, lat: number, lon: number) => void;
}) {
  const div = useRef<HTMLDivElement>(null);
  const mappa = useRef<L.Map | null>(null);
  const strato = useRef<L.LayerGroup | null>(null);
  const cb = useRef({ onClic, onSposta }); cb.current = { onClic, onSposta };
  const inquadrato = useRef('');
  useEffect(() => {
    if (!div.current || mappa.current) return;
    const m = L.map(div.current, { scrollWheelZoom: false }).setView([41.9, 12.5], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    m.on('click', e => cb.current.onClic?.(e.latlng.lat, e.latlng.lng));
    mappa.current = m; strato.current = L.layerGroup().addTo(m);
    return () => { m.remove(); mappa.current = null; };
  }, []);
  useEffect(() => {
    const m = mappa.current, s = strato.current; if (!m || !s) return;
    s.clearLayers();
    const ll: [number, number][] = [];
    for (const p of punti) {
      const icon = L.divIcon({ className: 'perc-pin' + (p.sede ? ' sede' : ''), html: p.sede ? 'S' : String(p.numero ?? ''), iconSize: [30, 30], iconAnchor: [15, 15] });
      const mk = L.marker([p.lat, p.lon], { icon, title: p.etichetta, draggable: true }).bindTooltip(p.etichetta).addTo(s);
      mk.on('dragend', () => { const q = mk.getLatLng(); cb.current.onSposta?.(p.id, q.lat, q.lng); });
      ll.push([p.lat, p.lon]);
    }
    if (scelto) L.circleMarker([scelto.lat, scelto.lon], { radius: 9, color: brand(), weight: 3, fillOpacity: .2 }).addTo(s);
    if (linea?.length) L.polyline(linea, { color: brand(), weight: 4, opacity: .8 }).addTo(s);
    // reinquadra solo quando cambia l'insieme dei punti (non a ogni trascinamento o clic)
    const chiave = punti.map(p => p.id).join(',') + (linea?.length ? '+l' : '');
    if (chiave !== inquadrato.current && ll.length) {
      inquadrato.current = chiave;
      const b = L.latLngBounds(linea?.length ? linea : ll);
      if (ll.length === 1 && !linea?.length) m.setView(ll[0], 14); else m.fitBounds(b, { padding: [30, 30], maxZoom: 15 });
    }
  }, [punti, linea, scelto]);
  return <div ref={div} className="perc-mappa" />;
}
