export type LatLng = [number, number];

export const COORDS = {
  node: [14.80828, 121.05882] as LatLng, // Sunga Residence, Phase G3, Brgy. Yakal (Sensor Node)
  fcpc: [14.81062, 121.06133] as LatLng, // First City Providential College
  narra: [14.81136, 121.05965] as LatLng, // Brgy. Narra covered court
  yakal: [14.80693, 121.06084] as LatLng, // Brgy. Yakal evacuation center
  hazard: [14.8089, 121.0572] as LatLng, // Low-lying creek flood basin (West of Phase G3)
};

export interface FloodInfo {
  center: LatLng;
  radius: number; // Inundated core radius in meters (active only at warning/critical levels)
  avoidRadius: number; // Core + safety buffer to keep routes completely dry
  isWarningOrHigher: boolean; // True when reaching warning levels (>= 15 cm or float switch)
  levelLabel: string;
}

/**
 * Returns dynamic flood inundation radius based on water depth telemetry.
 * Only activates flood radius avoidance when reaching WARNING (>= 15 cm) or CRITICAL (>= 30 cm) levels!
 * When water depth is below 15 cm (Normal / Safe), flood avoidance is standby (direct paths allowed).
 */
export function getFloodZone(waterCm: number, isFloatSwitch = false): FloodInfo {
  const isWarningOrHigher = waterCm >= 15 || isFloatSwitch;

  if (!isWarningOrHigher) {
    return {
      center: COORDS.hazard,
      radius: 0,
      avoidRadius: 0,
      isWarningOrHigher: false,
      levelLabel: 'Normal Stream Bed (< 15 cm)',
    };
  }

  const isCritical = waterCm >= 30 || isFloatSwitch;
  const radius = isCritical ? 150 : 115;
  const safetyBuffer = 20; // 20m safety clearance buffer
  const levelLabel = isCritical ? 'Critical Inundation Basin (≥ 30 cm)' : 'Warning Flood Overflow (≥ 15 cm)';

  return {
    center: COORDS.hazard,
    radius,
    avoidRadius: radius + safetyBuffer,
    isWarningOrHigher: true,
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

/** Total polyline length in meters */
export function pathLengthMeters(path: LatLng[]): number {
  let total = 0;
  for (let i = 0; i < path.length - 1; i++) {
    total += haversineMeters(path[i], path[i + 1]);
  }
  return Math.round(total);
}

/**
 * Projects any infringing segments of a walking path outward along the elevated eastern ridge
 * so the route strictly clears `avoidRadius` around `center` during Warning and Critical floods.
 */
export function deflectPathAroundFloodZone(
  path: LatLng[],
  center: LatLng,
  avoidRadius: number,
): LatLng[] {
  if (path.length < 2 || avoidRadius <= 0) return path;

  // 1. Densify segments (~18m spacing) so straight chords cannot slice through the flood circle
  const dense: LatLng[] = [path[0]];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const segLen = haversineMeters(a, b);
    const steps = Math.max(1, Math.ceil(segLen / 18));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      dense.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }

  const targetRadius = avoidRadius + 10; // extra margin outside dashed avoidance ring

  // 2. Push any intermediate vertex closer than targetRadius outward toward the eastern high ground
  return dense.map((pt, idx) => {
    if (idx === 0 || idx === dense.length - 1) return pt;
    const dist = haversineMeters(center, pt);
    if (dist >= targetRadius) return pt;

    let dLat = pt[0] - center[0];
    let dLng = pt[1] - center[1];
    // Steer eastward toward high ground in Phase G3 / Francisco Ave.
    if (dLng < 0.0003) {
      dLng = Math.abs(dLng) + 0.0005;
    }
    const curDist = Math.max(1, haversineMeters(center, [center[0] + dLat, center[1] + dLng]));
    const scale = targetRadius / curDist;
    return [
      Number((center[0] + dLat * scale).toFixed(6)),
      Number((center[1] + dLng * scale).toFixed(6)),
    ] as LatLng;
  });
}

export interface Shelter {
  id: 'fcpc' | 'narra' | 'yakal';
  name: string;
  short: string;
  note: string;
  role: 'Primary' | 'Secondary';
  occupancy: string;
  coords: LatLng;
  // Direct shortest route used when water is normal (< 15 cm)
  direct: {
    path: LatLng[];
    distance: string;
    eta: string;
    via: string;
    steps: string[];
  };
  // Flood avoidance bypass route used when water reaches warning or critical levels (>= 15 cm)
  avoid: {
    path: LatLng[];
    distance: string;
    eta: string;
    via: string;
    steps: string[];
  };
}

export const SHELTERS: Shelter[] = [
  {
    id: 'fcpc',
    name: 'First City Providential College',
    short: 'FCPC',
    note: 'Francisco Ave., Brgy. Narra. Multi-storey campus with a triage desk.',
    role: 'Primary',
    occupancy: '142 / 650',
    coords: COORDS.fcpc,
    direct: {
      distance: '438 m',
      eta: '5 min',
      via: 'Phase G3 lower collector, Francisco Ave.',
      path: [
        [14.80828, 121.05882],
        [14.80835, 121.05825],
        [14.80865, 121.05818],
        [14.80895, 121.05835],
        [14.80928, 121.05875],
        [14.80987, 121.05998],
        [14.81062, 121.06133],
      ],
      steps: [
        'Leave Phase G3 and walk west to the lower collector corner.',
        'Turn right onto the Phase G3 collector (115 m), heading north-east.',
        'Continue onto Francisco Ave. (302 m) toward Brgy. Narra.',
        'Enter the FCPC gate on your right and check in at the ground-floor triage desk.',
      ],
    },
    avoid: {
      distance: '465 m',
      eta: '6 min',
      via: 'Phase G3 eastern high-ground ridge, Francisco Ave.',
      path: [
        [14.80828, 121.05882],
        [14.80848, 121.05918],
        [14.80885, 121.05938],
        [14.80932, 121.05952],
        [14.80987, 121.05998],
        [14.81062, 121.06133],
      ],
      steps: [
        '🛡️ Flood Avoidance Active: Bypassing flooded creek basin via eastern high ground.',
        'Leave Phase G3 heading east along the elevated subdivision ridge street.',
        'Follow the upper collector north-east, staying > 180 m clear of the creek basin.',
        'Turn onto Francisco Ave. (302 m) on high ground toward Brgy. Narra.',
        'Enter the FCPC gate on your right and check in at the ground-floor triage desk.',
      ],
    },
  },
  {
    id: 'narra',
    name: 'Brgy. Narra Covered Court',
    short: 'Narra Court',
    note: 'Francisco Ave. North. Barangay DRRM command post and relief staging.',
    role: 'Secondary',
    occupancy: '68 / 250',
    coords: COORDS.narra,
    direct: {
      distance: '474 m',
      eta: '6 min',
      via: 'Phase G3 lower collector, Francisco Ave. North',
      path: [
        [14.80828, 121.05882],
        [14.80835, 121.05825],
        [14.80865, 121.05818],
        [14.80895, 121.05835],
        [14.80928, 121.05875],
        [14.80987, 121.05998],
        [14.81016, 121.05981],
        [14.81051, 121.05962],
        [14.81068, 121.05995],
        [14.81136, 121.05965],
      ],
      steps: [
        'Leave Phase G3, turn right onto the lower collector street (249 m).',
        'Turn left at the junction (81 m) heading north toward Francisco Ave.',
        'Turn right onto Francisco Ave. (41 m), then left (82 m) to the covered court.',
      ],
    },
    avoid: {
      distance: '495 m',
      eta: '6 min',
      via: 'Phase G3 eastern high-ground ridge, Francisco Ave. North',
      path: [
        [14.80828, 121.05882],
        [14.80848, 121.05918],
        [14.80885, 121.05938],
        [14.80932, 121.05952],
        [14.80987, 121.05998],
        [14.81016, 121.05981],
        [14.81051, 121.05962],
        [14.81068, 121.05995],
        [14.81136, 121.05965],
      ],
      steps: [
        '🛡️ Flood Avoidance Active: Bypassing flooded creek basin via eastern high ground.',
        'Leave Phase G3 heading east along the elevated residential ridge (240 m).',
        'Follow the high-ground corridor away from the creek basin toward Francisco Ave.',
        'Turn onto Francisco Ave. North (82 m) to reach the Narra covered court command post.',
      ],
    },
  },
  {
    id: 'yakal',
    name: 'Brgy. Yakal Evacuation Center',
    short: 'Yakal Center',
    note: 'Francisco Homes 1. Elevated barangay shelter.',
    role: 'Secondary',
    occupancy: '54 / 200',
    coords: COORDS.yakal,
    direct: {
      distance: '595 m',
      eta: '7 min',
      via: 'Phase F/G lower subdivision streets',
      path: [
        [14.80828, 121.05882],
        [14.80835, 121.05825],
        [14.80810, 121.05818],
        [14.80789, 121.05822],
        [14.80743, 121.05808],
        [14.80694, 121.05802],
        [14.80674, 121.05846],
        [14.80652, 121.05893],
        [14.80618, 121.05927],
        [14.80597, 121.05952],
        [14.80639, 121.05993],
        [14.80685, 121.06035],
        [14.80715, 121.06064],
        [14.80693, 121.06084],
      ],
      steps: [
        'Leave Phase G3, walk west and turn left heading south (164 m).',
        'Turn left at the subdivision corner (196 m), continuing south-east.',
        'Turn left onto the eastern collector (178 m) toward the barangay hall.',
        'Turn right (36 m) to arrive at the Yakal Evacuation Center.',
      ],
    },
    avoid: {
      distance: '615 m',
      eta: '8 min',
      via: 'Phase F/G elevated eastern ridge',
      path: [
        [14.80828, 121.05882],
        [14.80805, 121.05912],
        [14.80755, 121.05918],
        [14.80695, 121.05915],
        [14.80652, 121.05910],
        [14.80618, 121.05927],
        [14.80597, 121.05952],
        [14.80639, 121.05993],
        [14.80685, 121.06035],
        [14.80715, 121.06064],
        [14.80693, 121.06084],
      ],
      steps: [
        '🛡️ Flood Avoidance Active: Bypassing flooded creek basin via eastern high ground.',
        'Leave Phase G3 heading south-east along the upper subdivision ridge street (190 m).',
        'Follow the eastern collector loop, maintaining > 180 m clearance above the creek.',
        'Continue along the paved subdivision avenue (185 m) directly to the Yakal Evacuation Center.',
      ],
    },
  },
];

/** Selects direct or flood-avoiding route configuration depending on warning level */
export function getShelterRoute(shelter: Shelter, isWarningOrHigher: boolean) {
  return isWarningOrHigher ? shelter.avoid : shelter.direct;
}

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
  isWarningOrHigher: boolean;
}

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/foot';
const OSRM_TIMEOUT_MS = 6000;

interface OsrmRoute {
  distance: number;
  geometry: { coordinates: number[][] };
  legs: { steps: { distance: number; name: string; maneuver: { type: string } }[] }[];
}

const osrmCache = new Map<string, Promise<OsrmRoute | null>>();

function roundCoord(p: LatLng): LatLng {
  return [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
}

export function clearRouteCache() {
  osrmCache.clear();
}

async function osrmRoute(
  points: LatLng[],
  fetchImpl: typeof fetch = fetch,
): Promise<OsrmRoute | null> {
  const coords = points.map((p) => `${p[1]},${p[0]}`).join(';');
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson&steps=true`;
  const cached = osrmCache.get(url);
  if (cached) return cached;

  const task = (async () => {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), OSRM_TIMEOUT_MS) : null;
    try {
      const res = await fetchImpl(url, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) return null;
      const data = await res.json();
      return (data?.routes?.[0] as OsrmRoute) ?? null;
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  })();

  osrmCache.set(url, task);
  const result = await task;
  if (!result) osrmCache.delete(url);
  return result;
}

const toPath = (r: OsrmRoute): LatLng[] => r.geometry.coordinates.map((c) => [c[1], c[0]] as LatLng);

/**
 * Fetch a street-snapped foot route with guaranteed flood-radius rerouting on both Web and Mobile.
 * - Below Warning level (< 15 cm): uses the direct shortest walking route.
 * - At Warning (15–29.9 cm, 115m radius) or Critical (>= 30 cm / float switch, 150m radius):
 *   automatically reroutes around the eastern high-ground corridor outside `flood.avoidRadius`.
 */
export async function fetchFootRoute(
  fromRaw: LatLng,
  toRaw: LatLng,
  waterCm = 12,
  userAvoidToggle = true,
  isFloatSwitch = false,
  fetchImpl: typeof fetch = fetch,
): Promise<RouteResult> {
  const from = roundCoord(fromRaw);
  const to = roundCoord(toRaw);
  const flood = getFloodZone(waterCm, isFloatSwitch);
  const shouldAvoid = userAvoidToggle && flood.isWarningOrHigher;

  const matchedShelter = SHELTERS.find((s) => haversineMeters(toRaw, s.coords) < 35);
  const isNearDefaultNode = haversineMeters(fromRaw, COORDS.node) < 35;

  // For the Phase G3 sensor node to a known shelter, use our verified street corridors
  // so mobile & web behave identically and never suffer from OSRM rate-limiting or west-snapping.
  if (isNearDefaultNode && matchedShelter) {
    if (!shouldAvoid) {
      const dPath = matchedShelter.direct.path;
      const meters = pathLengthMeters(dPath) || 438;
      return {
        path: dPath,
        meters,
        minutes: Math.max(1, Math.round(meters / 80)),
        minClearance: Math.round(minDistanceToPath(flood.center, dPath)),
        isDetour: false,
        isInsideFlood: false,
        isWarningOrHigher: flood.isWarningOrHigher,
        steps: matchedShelter.direct.steps,
      };
    } else {
      const aPath = deflectPathAroundFloodZone(
        matchedShelter.avoid.path,
        flood.center,
        flood.avoidRadius,
      );
      const meters = pathLengthMeters(aPath) || 465;
      return {
        path: aPath,
        meters,
        minutes: Math.max(1, Math.round(meters / 80)),
        minClearance: Math.round(minDistanceToPath(flood.center, aPath)),
        isDetour: true,
        isInsideFlood: false,
        isWarningOrHigher: true,
        steps: [
          `🛡️ Flood Avoidance Active: Bypassing ${flood.levelLabel} (${flood.radius} m radius).`,
          ...matchedShelter.avoid.steps.slice(1),
        ],
      };
    }
  }

  // Custom pin or Live GPS origin: query OSRM with graceful fallback
  const distFromStartToFlood = haversineMeters(fromRaw, flood.center);
  const isInsideFlood = flood.isWarningOrHigher && distFromStartToFlood < flood.radius;

  const directRoute = await osrmRoute([from, to], fetchImpl);
  const basePath: LatLng[] = directRoute
    ? toPath(directRoute)
    : matchedShelter
      ? [fromRaw, ...(shouldAvoid ? matchedShelter.avoid.path.slice(1) : matchedShelter.direct.path.slice(1))]
      : [fromRaw, toRaw];

  const baseSteps: string[] = directRoute
    ? parseSteps(directRoute.legs[0].steps)
    : matchedShelter
      ? (shouldAvoid ? matchedShelter.avoid.steps : matchedShelter.direct.steps)
      : ['Proceed along the elevated street corridor toward the evacuation shelter.'];

  const directClearance = minDistanceToPath(flood.center, basePath);

  if (!shouldAvoid) {
    const meters = directRoute ? Math.round(directRoute.distance) : pathLengthMeters(basePath);
    return {
      path: basePath,
      meters,
      minutes: Math.max(1, Math.round(meters / 80)),
      minClearance: Math.round(directClearance),
      isDetour: false,
      isInsideFlood: false,
      isWarningOrHigher: flood.isWarningOrHigher,
      steps: baseSteps,
    };
  }

  if (isInsideFlood) {
    const meters = directRoute ? Math.round(directRoute.distance) : pathLengthMeters(basePath);
    return {
      path: basePath,
      meters,
      minutes: Math.max(1, Math.round(meters / 80)),
      minClearance: Math.round(directClearance),
      isDetour: false,
      isInsideFlood: true,
      isWarningOrHigher: true,
      steps: [
        `⚠️ CAUTION: Your location is inside the active ${flood.radius} m flood radius.`,
        'Move immediately away from the low-lying creek toward higher ground on Francisco Ave.',
        ...baseSteps,
      ],
    };
  }

  if (directClearance >= flood.avoidRadius) {
    const meters = directRoute ? Math.round(directRoute.distance) : pathLengthMeters(basePath);
    return {
      path: basePath,
      meters,
      minutes: Math.max(1, Math.round(meters / 80)),
      minClearance: Math.round(directClearance),
      isDetour: false,
      isInsideFlood: false,
      isWarningOrHigher: true,
      steps: baseSteps,
    };
  }

  // Try an eastern high-ground waypoint via OSRM first, then guarantee clearance via geometric deflection
  const eastWaypoint: LatLng = [14.80885, 121.05955];
  const detourRoute = await osrmRoute([from, eastWaypoint, to], fetchImpl);
  const candidatePath = detourRoute ? toPath(detourRoute) : basePath;
  const safePath = deflectPathAroundFloodZone(candidatePath, flood.center, flood.avoidRadius);
  const safeMeters = pathLengthMeters(safePath);
  const safeClearance = Math.round(minDistanceToPath(flood.center, safePath));
  const rawSteps = detourRoute
    ? parseSteps([...(detourRoute.legs[0]?.steps || []), ...(detourRoute.legs[1]?.steps || [])])
    : baseSteps;

  return {
    path: safePath,
    meters: safeMeters,
    minutes: Math.max(1, Math.round(safeMeters / 80)),
    minClearance: safeClearance,
    isDetour: true,
    isInsideFlood: false,
    isWarningOrHigher: true,
    steps: [
      `🛡️ Flood Avoidance Active: Warning level reached (≥ 15 cm). Bypassing ${flood.levelLabel} (${flood.radius} m radius).`,
      ...rawSteps,
    ],
  };
}

function parseSteps(steps: { distance: number; name: string; maneuver: { type: string } }[]): string[] {
  return steps.map((s) =>
    s.maneuver.type === 'arrive'
      ? 'Arrive safely at the designated evacuation shelter.'
      : `Follow ${s.name || 'residential street'} for ${Math.round(s.distance)} m.`,
  );
}
