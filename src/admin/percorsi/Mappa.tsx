import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export interface Segnaposto { lat: number; lon: number; etichetta: string; sede?: boolean }

/** Mappa del percorso (Leaflet + tessere OpenStreetMap). Caricata solo quando serve. */
export default function Mappa({ punti, linea }: { punti: Segnaposto[]; linea: [number, number][] | null }) {
  const div = useRef<HTMLDivElement>(null);
  const mappa = useRef<L.Map | null>(null);
  const strato = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!div.current || mappa.current) return;
    const m = L.map(div.current, { scrollWheelZoom: false }).setView([41.9, 12.5], 11);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(m);
    mappa.current = m; strato.current = L.layerGroup().addTo(m);
    return () => { m.remove(); mappa.current = null; };
  }, []);
  useEffect(() => {
    const m = mappa.current, s = strato.current; if (!m || !s) return;
    s.clearLayers();
    const ll: L.LatLngExpression[] = [];
    punti.forEach((p, i) => {
      const icon = L.divIcon({ className: 'perc-pin' + (p.sede ? ' sede' : ''), html: p.sede ? 'S' : String(i), iconSize: [28, 28], iconAnchor: [14, 14] });
      L.marker([p.lat, p.lon], { icon, title: p.etichetta }).bindTooltip(p.etichetta).addTo(s);
      ll.push([p.lat, p.lon]);
    });
    if (linea?.length) L.polyline(linea, { color: '#C8102E', weight: 4, opacity: .8 }).addTo(s);
    if (ll.length) m.fitBounds(L.latLngBounds(linea?.length ? linea : ll), { padding: [30, 30], maxZoom: 15 });
  }, [punti, linea]);
  return <div ref={div} className="perc-mappa" />;
}
