import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { COORDS, type LatLng } from '../lib/geo';
import type { Level } from '../lib/logic';

const LEVEL_COLOR: Record<Level, string> = { SAFE: '#16a34a', WARNING: '#d97706', CRITICAL: '#dc2626' };

function pin(color: string, label: string) {
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="pin"><i style="background:${color}"></i>${label}</div>`,
  });
}

interface LayerProps {
  path: LatLng[];
  color: string;
  origin: LatLng;
  originLabel: string;
  dest: LatLng;
  destLabel: string;
  level: Level;
  waterCm: number;
  onPick: (p: LatLng) => void;
}

/** Imperative Leaflet layers: markers, hazard zone, animated route and a gliding beacon. */
function Layers(p: LayerProps) {
  const map = useMap();
  const group = useRef<L.LayerGroup>(L.layerGroup());
  const raf = useRef(0);
  const pick = useRef(p.onPick);
  pick.current = p.onPick;

  useEffect(() => {
    group.current.addTo(map);
    const onClick = (e: L.LeafletMouseEvent) => pick.current([e.latlng.lat, e.latlng.lng]);
    map.on('click', onClick);
    const fix = window.setTimeout(() => map.invalidateSize(), 150);
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => {
      map.off('click', onClick);
      ro.disconnect();
      clearTimeout(fix);
      group.current.remove();
    };
  }, [map]);

  useEffect(() => {
    const g = group.current;
    g.clearLayers();
    cancelAnimationFrame(raf.current);

    L.circle(COORDS.hazard, {
      radius: 110,
      color: LEVEL_COLOR[p.level],
      weight: 1.5,
      fillColor: LEVEL_COLOR[p.level],
      fillOpacity: 0.22,
      className: 'hazard-zone',
    })
      .bindPopup(`Low-lying creek basin. Depth now ${p.waterCm.toFixed(1)} cm. Routes avoid this area.`)
      .addTo(g);

    L.marker(COORDS.fcpc, { icon: pin('#16a34a', 'FCPC') }).addTo(g);
    L.marker(COORDS.narra, { icon: pin('#1d4ed8', 'Narra Court') }).addTo(g);
    L.marker(COORDS.yakal, { icon: pin('#1d4ed8', 'Yakal Center') }).addTo(g);
    L.marker(p.origin, { icon: pin(LEVEL_COLOR[p.level], `${p.originLabel}`) }).addTo(g);

    L.polyline(p.path, { color: p.color, weight: 11, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    L.polyline(p.path, { color: '#fff', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    L.polyline(p.path, { color: p.color, weight: 4, opacity: 1, className: 'route-flow', lineCap: 'butt' }).addTo(g);

    // Beacon travelling along the real street geometry at constant speed.
    const seg: number[] = [];
    let total = 0;
    for (let i = 0; i < p.path.length - 1; i++) {
      const d = L.latLng(p.path[i]).distanceTo(L.latLng(p.path[i + 1]));
      seg.push(d);
      total += d;
    }
    if (total > 0) {
      const glider = L.marker(p.path[0], {
        interactive: false,
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="glider" style="background:${p.color};color:${p.color}"></div>` }),
      }).addTo(g);
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const dur = 4500;
      let start = 0;
      const step = (ts: number) => {
        if (!start) start = ts;
        const target = reduce ? total : (((ts - start) % dur) / dur) * total;
        let acc = 0;
        for (let i = 0; i < seg.length; i++) {
          if (acc + seg[i] >= target || i === seg.length - 1) {
            const r = seg[i] ? (target - acc) / seg[i] : 0;
            glider.setLatLng([
              p.path[i][0] + (p.path[i + 1][0] - p.path[i][0]) * r,
              p.path[i][1] + (p.path[i + 1][1] - p.path[i][1]) * r,
            ]);
            break;
          }
          acc += seg[i];
        }
        if (!reduce) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    }

    map.fitBounds(L.latLngBounds(p.path), { padding: [40, 40], maxZoom: 18 });
    return () => cancelAnimationFrame(raf.current);
  }, [map, p.path, p.color, p.origin, p.originLabel, p.level, p.waterCm]);

  return null;
}

export default function RouteMap(props: LayerProps) {
  return (
    <MapContainer center={[14.8095, 121.0598]} zoom={16} className="h-full w-full rounded-lg" scrollWheelZoom={false}>
      <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} />
      <Layers {...props} />
    </MapContainer>
  );
}
