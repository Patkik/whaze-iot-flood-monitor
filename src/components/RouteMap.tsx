import { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { COORDS, getFloodZone, type LatLng } from '../lib/geo';
import type { Level } from '../lib/logic';

const LEVEL_COLOR: Record<Level, string> = { SAFE: '#16a34a', WARNING: '#d97706', CRITICAL: '#dc2626' };

function pin(color: string, label: string) {
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="pin"><i style="background:${color}"></i>${label}</div>`,
  });
}

function floodIcon(level: Level, radius: number, isWarningOrHigher: boolean) {
  if (!isWarningOrHigher) {
    return L.divIcon({
      className: '',
      iconSize: [0, 0],
      html: `<div class="flood-center-pin" style="--c:#0284c7;">
        <span class="flood-label" style="background:#0284c7;color:#fff;">Creek Bed (Normal &lt;15cm)</span>
      </div>`,
    });
  }
  const color = LEVEL_COLOR[level];
  return L.divIcon({
    className: '',
    iconSize: [0, 0],
    html: `<div class="flood-center-pin" style="--c:${color};">
      <div class="flood-pulse"></div>
      <span class="flood-label">Creek Flood Basin (${radius}m)</span>
    </div>`,
  });
}

export interface RouteMapProps {
  path: LatLng[];
  color: string;
  origin: LatLng;
  originLabel: string;
  dest: LatLng;
  destLabel: string;
  level: Level;
  waterCm: number;
  floatSwitch?: boolean;
  minClearance: number;
  isDetour: boolean;
  isInsideFlood: boolean;
  onPick: (p: LatLng) => void;
}

/** Imperative Leaflet layers: markers, dynamic flood radius & safety buffer, animated route and glider. */
function Layers(p: RouteMapProps) {
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

    const flood = getFloodZone(p.waterCm, p.floatSwitch);

    if (flood.isWarningOrHigher) {
      // 1. Inundated core flood basin (Radius scales with water level: 115m Warning -> 150m Critical)
      L.circle(flood.center, {
        radius: flood.radius,
        color: LEVEL_COLOR[p.level],
        weight: 2,
        fillColor: LEVEL_COLOR[p.level],
        fillOpacity: p.level === 'CRITICAL' ? 0.35 : 0.22,
        className: 'hazard-zone',
      })
        .bindPopup(
          `<div style="font-family:sans-serif;font-size:12px;line-height:1.4;">
            <strong>${flood.levelLabel}</strong><br/>
            Inundation radius: <b>${flood.radius} m</b><br/>
            Current water depth: <b>${p.waterCm.toFixed(1)} cm</b><br/>
            <span style="color:#15803d;font-weight:600;">✓ Evacuation corridors strictly bypass this radius.</span>
          </div>`,
        )
        .addTo(g);

      // 2. Safety avoidance perimeter ring (No evacuation corridor crosses this ring)
      L.circle(flood.center, {
        radius: flood.avoidRadius,
        color: LEVEL_COLOR[p.level],
        weight: 1.5,
        dashArray: '6, 6',
        fillColor: LEVEL_COLOR[p.level],
        fillOpacity: 0.06,
        className: 'hazard-buffer',
      })
        .bindPopup(
          `<div style="font-family:sans-serif;font-size:12px;line-height:1.4;">
            <strong>Safe Avoidance Perimeter</strong><br/>
            Boundary: <b>${flood.avoidRadius} m</b> (${flood.avoidRadius - flood.radius}m safety clearance buffer).<br/>
            All active routes route along elevated ground outside this line.
          </div>`,
        )
        .addTo(g);
    } else {
      // Normal stream channel (dormant / non-flooded, safe to traverse)
      L.circle(flood.center, {
        radius: 65,
        color: '#0284c7',
        weight: 1.5,
        dashArray: '4, 4',
        fillColor: '#38bdf8',
        fillOpacity: 0.08,
        className: 'normal-stream-zone',
      })
        .bindPopup(
          `<div style="font-family:sans-serif;font-size:12px;line-height:1.4;">
            <strong>Creek Channel (Normal Level)</strong><br/>
            Current water depth: <b>${p.waterCm.toFixed(1)} cm</b> (&lt; 15 cm Safe)<br/>
            <span style="color:#0284c7;">Direct shortest street paths active. Flood radius avoidance engages automatically at Warning levels (≥ 15 cm).</span>
          </div>`,
        )
        .addTo(g);
    }

    // Center pulse beacon in the flood basin
    L.marker(flood.center, { icon: floodIcon(p.level, flood.radius, flood.isWarningOrHigher) }).addTo(g);

    // Shelters and Origin markers
    L.marker(COORDS.fcpc, { icon: pin('#16a34a', 'FCPC') }).addTo(g);
    L.marker(COORDS.narra, { icon: pin('#1d4ed8', 'Narra Court') }).addTo(g);
    L.marker(COORDS.yakal, { icon: pin('#1d4ed8', 'Yakal Center') }).addTo(g);
    L.marker(p.origin, { icon: pin(LEVEL_COLOR[p.level], `${p.originLabel}`) }).addTo(g);

    // 3. Evacuation route layers (casing, base line, animated flow)
    L.polyline(p.path, { color: p.color, weight: 11, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    L.polyline(p.path, { color: '#fff', weight: 6, opacity: 0.9, lineCap: 'round', lineJoin: 'round' }).addTo(g);
    L.polyline(p.path, { color: p.color, weight: 4, opacity: 1, className: 'route-flow', lineCap: 'butt' }).addTo(g);

    // 4. Gliding beacon travelling smoothly along street vertices
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
        icon: L.divIcon({
          className: '',
          iconSize: [0, 0],
          html: `<div class="glider" style="background:${p.color};color:${p.color}"></div>`,
        }),
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

    // Include both the path and the flood zone in bounds so user sees the safe separation
    const bounds = L.latLngBounds(p.path);
    bounds.extend(flood.center);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 18 });
    return () => cancelAnimationFrame(raf.current);
  }, [map, p.path, p.color, p.origin, p.originLabel, p.level, p.waterCm, p.floatSwitch]);

  return null;
}

export default function RouteMap(props: RouteMapProps) {
  const flood = getFloodZone(props.waterCm, props.floatSwitch);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-lg">
      <MapContainer
        center={[14.8095, 121.0598]}
        zoom={16}
        className="h-full w-full rounded-lg"
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution="&copy; OpenStreetMap contributors"
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
        />
        <Layers {...props} />
      </MapContainer>

      {/* Live Safety Clearance Map Overlay Badge */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] max-w-[calc(100%-24px)]">
        {props.isInsideFlood ? (
          <div className="flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-950/90 px-3 py-1.5 text-xs font-semibold text-red-200 shadow-lg backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-red-400 animate-ping" />
            <span>Origin within flood basin ({flood.radius}m). Evacuate outward to safe high ground.</span>
          </div>
        ) : flood.isWarningOrHigher ? (
          <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-card/95 px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-lg backdrop-blur dark:text-amber-300">
            <span className="h-2 w-2 rounded-full bg-amber-500" />
            <span>
              Warning active: Bypassing {flood.radius}m flood radius · Clearance: <b>{props.minClearance}m</b>
            </span>
            {props.isDetour && (
              <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-700 dark:bg-amber-900/60 dark:text-amber-300">
                Bypass Active
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-card/95 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-lg backdrop-blur dark:text-emerald-300">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            <span>
              Normal Water Depth (&lt; 15 cm) · Direct shortest path active (Avoidance on at ≥15 cm)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
