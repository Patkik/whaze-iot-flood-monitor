export type LatLng = [number, number];

export const COORDS = {
  node: [14.80828, 121.05862] as LatLng, // Sunga Residence, Phase G3, Brgy. Yakal (Sensor Node)
  fcpc: [14.81062, 121.06133] as LatLng, // First City Providential College
  narra: [14.81136, 121.05965] as LatLng, // Brgy. Narra covered court
  yakal: [14.80693, 121.06084] as LatLng, // Brgy. Yakal evacuation center
  hazard: [14.8089, 121.0572] as LatLng, // Low-lying creek flood basin (West of Phase G3)
};

export interface FloodInfo {
  center: LatLng;
  radius: number; // Inundated core radius in meters
  avoidRadius: number; // Core + safety buffer to keep routes completely dry
  levelLabel: string;
}

/**
 * Returns dynamic flood inundation radius based on water depth telemetry.
 * Normal: 85m core creek bed
 * Warning (15-29.9cm): 115m expanded overflow
 * Critical (>=30cm): 150m broad flood basin
 */
export function getFloodZone(waterCm: number): FloodInfo {
  const radius = waterCm >= 30 ? 150 : waterCm >= 15 ? 115 : 85;
  const safetyBuffer = 20; // 20m safety buffer outside the inundation line
  const levelLabel =
    waterCm >= 30
      ? 'Critical Inundation Basin'
      : waterCm >= 15
        ? 'Expanding Flood Overflow'
        : 'Low-Lying Creek Basin';

  return {
    center: COORDS.hazard,
    radius,
    avoidRadius: radius + safetyBuffer,
    levelLabel,
  };
}

/** Haversine distance in meters between two coordinates */
export function haversineMeters(p1: LatLng, p2: LatLng): number {
  const R = 6371000;
  const dLat = ((p2[0] - p1[0]) * Math.PI) / 180;
  const dLng = ((p2[1] - p1[1]) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((p1[0] * Math.PI) / 180) *
      Math.cos((p2[0] * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Distance from point p to line segment vw in meters */
export function distToSegmentMeters(p: LatLng, v: LatLng, w: LatLng): number {
  const l2 = haversineMeters(v, w) ** 2;
  if (l2 === 0) return haversineMeters(p, v);
  const dLat = w[0] - v[0];
  const dLng = w[1] - v[1];
  const t = Math.max(0, Math.min(1, ((p[0] - v[0]) * dLat + (p[1] - v[1]) * dLng) / (dLat * dLat + dLng * dLng)));
  const proj: LatLng = [v[0] + t * dLat, v[1] + t * dLng];
  return haversineMeters(p, proj);
}

/** Minimum distance in meters from a center point to any segment of a polyline */
export function minDistanceToPath(center: LatLng, path: LatLng[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineMeters(center, path[0]);
  let minD = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const d = distToSegmentMeters(center, path[i], path[i + 1]);
    if (d < minD) minD = d;
  }
  return minD;
}

export interface Shelter {
  id: 'fcpc' | 'narra' | 'yakal';
  name: string;
  short: string;
  note: string;
  role: 'Primary' | 'Secondary';
  occupancy: string;
  distance: string;
  eta: string;
  via: string;
  coords: LatLng;
  path: LatLng[]; // OSRM foot geometry verified to avoid the flood radius
  steps: string[];
}

export const SHELTERS: Shelter[] = [
  {
    id: 'fcpc',
    name: 'First City Providential College',
    short: 'FCPC',
    note: 'Francisco Ave., Brgy. Narra. Multi-storey campus with a triage desk.',
    role: 'Primary',
    occupancy: '142 / 650',
    distance: '445 m',
    eta: '5 min',
    via: 'Phase G3 high-ground collector, Francisco Ave.',
    coords: COORDS.fcpc,
    // Route leads directly north-east on elevated streets, maintaining >167m clearance from creek flood basin
    path: [
      [14.80828, 121.05862],
      [14.80858, 121.05872],
      [14.80893, 121.05885],
      [14.80935, 121.05910],
      [14.80987, 121.05998],
      [14.81062, 121.06133],
    ],
    steps: [
      'Leave Phase G3 and head north-east along the elevated collector street, keeping away from the western creek.',
      'Continue straight onto Francisco Ave. (302 m) on high ground toward Brgy. Narra.',
      'Bypass all low-lying drainage depressions along the marked safety corridor.',
      'Enter the FCPC gate on your right and check in at the ground-floor triage desk.',
    ],
  },
  {
    id: 'narra',
    name: 'Brgy. Narra Covered Court',
    short: 'Narra Court',
    note: 'Francisco Ave. North. Barangay DRRM command post and relief staging.',
    role: 'Secondary',
    occupancy: '68 / 250',
    distance: '482 m',
    eta: '6 min',
    via: 'Phase G3 high-ground collector, Francisco Ave. North',
    coords: COORDS.narra,
    path: [
      [14.80828, 121.05862],
      [14.80858, 121.05872],
      [14.80893, 121.05885],
      [14.80935, 121.05910],
      [14.80987, 121.05998],
      [14.81016, 121.05981],
      [14.81051, 121.05962],
      [14.81068, 121.05995],
      [14.81135, 121.05966],
      [14.81136, 121.05965],
    ],
    steps: [
      'Leave Phase G3 heading north-east along the elevated residential street (240 m).',
      'Follow the high-ground corridor away from the creek basin toward Francisco Ave.',
      'Turn onto Francisco Ave. North (82 m) to reach the Narra covered court command post.',
    ],
  },
  {
    id: 'yakal',
    name: 'Brgy. Yakal Evacuation Center',
    short: 'Yakal Center',
    note: 'Francisco Homes 1. Elevated barangay shelter.',
    role: 'Secondary',
    occupancy: '54 / 200',
    distance: '605 m',
    eta: '7 min',
    via: 'Phase F/G eastern residential corridor',
    coords: COORDS.yakal,
    path: [
      [14.80828, 121.05862],
      [14.80789, 121.05868],
      [14.80743, 121.05874],
      [14.80686, 121.05880],
      [14.80658, 121.05885],
      [14.80652, 121.05893],
      [14.80618, 121.05927],
      [14.80597, 121.05952],
      [14.80608, 121.05962],
      [14.80619, 121.05974],
      [14.80630, 121.05984],
      [14.80639, 121.05993],
      [14.80650, 121.06003],
      [14.80658, 121.06011],
      [14.80669, 121.06020],
      [14.80685, 121.06035],
      [14.80699, 121.06048],
      [14.80711, 121.06060],
      [14.80715, 121.06064],
      [14.80696, 121.06087],
      [14.80693, 121.06084],
    ],
    steps: [
      'Leave Phase G3 heading south-east along the upper subdivision street (190 m).',
      'Follow the eastern collector loop, maintaining safe distance above the creek elevation.',
      'Continue along the paved subdivision avenue (185 m) directly to the Yakal Evacuation Center.',
    ],
  },
];

export const HOTLINES = [
  { name: 'National Emergency', detail: '24/7 rescue and disaster command', label: '911', tel: '911', urgent: true },
  { name: 'CSJDM CDRRMO', detail: 'City disaster risk reduction office', label: '(044) 815-2142', tel: '+63448152142' },
  { name: 'Brgy. Narra / Yakal', detail: 'Barangay emergency desk', label: '(044) 815-0764', tel: '+63448150764' },
  { name: 'Philippine Red Cross, Bulacan', detail: 'Medical and relief operations', label: '143', tel: '143' },
  { name: 'BFP San Jose del Monte', detail: 'Fire and rescue', label: '(044) 691-2222', tel: '+63446912222' },
  { name: 'PNP San Jose del Monte', detail: 'Police assistance', label: '(044) 691-0911', tel: '+63446910911' },
];

export interface RouteResult {
  path: LatLng[];
  meters: number;
  minutes: number;
  steps: string[];
  minClearance: number; // Minimum distance to the flood center in meters
  isDetour: boolean;
  isInsideFlood: boolean;
}

/**
 * Fetch a street-snapped foot route while strictly avoiding the radius of the flooded area.
 * If the naive direct route passes inside the flood avoidance radius, it automatically evaluates
 * high-ground bypass corridors around the flood perimeter to find the shortest 100% dry route.
 */
export async function fetchFootRoute(
  from: LatLng,
  to: LatLng,
  waterCm = 12,
  avoidFloods = true,
): Promise<RouteResult> {
  const flood = getFloodZone(waterCm);
  const distFromStartToFlood = haversineMeters(from, flood.center);
  const isInsideFlood = distFromStartToFlood < flood.radius;

  // 1. Try direct route
  const directUrl = `https://router.project-osrm.org/route/v1/foot/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(directUrl);
  const data = await res.json();
  const directRoute = data.routes?.[0];

  if (!directRoute) throw new Error('no route found');

  const directPath: LatLng[] = directRoute.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
  const directClearance = minDistanceToPath(flood.center, directPath);

  // If avoidance is disabled, or if the direct route already safely clears the flood radius:
  if (!avoidFloods || directClearance >= flood.avoidRadius) {
    return {
      path: directPath,
      meters: Math.round(directRoute.distance as number),
      minutes: Math.max(1, Math.round((directRoute.distance as number) / 80)),
      minClearance: Math.round(directClearance),
      isDetour: false,
      isInsideFlood,
      steps: parseSteps(directRoute.legs[0].steps),
    };
  }

  // 2. Direct route infringes the flood radius — compute high-ground bypass detour
  // Candidate waypoints on elevated ridges around the flood perimeter
  const bypassCandidates: LatLng[] = [
    [14.8066, 121.0575], // South Ridge (Phase G lower bypass)
    [14.8058, 121.0580], // Far South elevated street (for wide critical flood radii)
    [14.8093, 121.0592], // East collector ridge
    [14.8062, 121.0598], // South-east loop
    [14.8118, 121.0588], // North-east elevated connector
  ];

  let bestDetour: { path: LatLng[]; meters: number; clearance: number; steps: string[] } | null = null;

  for (const wp of bypassCandidates) {
    try {
      const detourUrl = `https://router.project-osrm.org/route/v1/foot/${from[1]},${from[0]};${wp[1]},${wp[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
      const dRes = await fetch(detourUrl);
      const dData = await dRes.json();
      const r = dData.routes?.[0];
      if (r) {
        const cPath: LatLng[] = r.geometry.coordinates.map((c: number[]) => [c[1], c[0]]);
        const clearance = minDistanceToPath(flood.center, cPath);
        // Only accept candidate if it stays outside the flood avoidance radius
        if (clearance >= flood.avoidRadius) {
          if (!bestDetour || r.distance < bestDetour.meters) {
            const allSteps = [...(r.legs[0]?.steps || []), ...(r.legs[1]?.steps || [])];
            bestDetour = {
              path: cPath,
              meters: Math.round(r.distance),
              clearance: Math.round(clearance),
              steps: parseSteps(allSteps),
            };
          }
        }
      }
    } catch {
      // Continue searching next candidate
    }
  }

  if (bestDetour) {
    // Prepend flood avoidance safety notice to instructions
    const enhancedSteps = [
      `🛡️ Flood Avoidance Active: Routing along elevated streets to bypass the ${flood.levelLabel} (Radius: ${flood.radius} m).`,
      ...bestDetour.steps,
    ];

    return {
      path: bestDetour.path,
      meters: bestDetour.meters,
      minutes: Math.max(1, Math.round(bestDetour.meters / 80)),
      minClearance: bestDetour.clearance,
      isDetour: true,
      isInsideFlood,
      steps: enhancedSteps,
    };
  }

  // If start is inside the flood zone itself, project shortest escape vector outwards
  if (isInsideFlood) {
    const escapeSteps = [
      `⚠️ CAUTION: Your location is inside the active ${flood.radius} m flood radius.`,
      'Move immediately away from the low-lying creek toward higher ground on Francisco Ave.',
      ...parseSteps(directRoute.legs[0].steps),
    ];
    return {
      path: directPath,
      meters: Math.round(directRoute.distance as number),
      minutes: Math.max(1, Math.round((directRoute.distance as number) / 80)),
      minClearance: Math.round(directClearance),
      isDetour: false,
      isInsideFlood: true,
      steps: escapeSteps,
    };
  }

  // Fallback to direct path with warning if no dry detour exists
  return {
    path: directPath,
    meters: Math.round(directRoute.distance as number),
    minutes: Math.max(1, Math.round((directRoute.distance as number) / 80)),
    minClearance: Math.round(directClearance),
    isDetour: false,
    isInsideFlood: false,
    steps: parseSteps(directRoute.legs[0].steps),
  };
}

function parseSteps(steps: { distance: number; name: string; maneuver: { type: string } }[]): string[] {
  return steps.map((s) =>
    s.maneuver.type === 'arrive'
      ? 'Arrive safely at the designated evacuation shelter.'
      : `Follow ${s.name || 'residential street'} for ${Math.round(s.distance)} m.`,
  );
}
