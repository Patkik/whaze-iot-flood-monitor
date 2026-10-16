export type LatLng = [number, number];

export const COORDS = {
  node: [14.80828, 121.05862] as LatLng, // Sunga Residence, Phase G3, Brgy. Yakal
  fcpc: [14.81062, 121.06133] as LatLng, // First City Providential College
  narra: [14.81136, 121.05965] as LatLng, // Brgy. Narra covered court
  yakal: [14.80693, 121.06084] as LatLng, // Brgy. Yakal evacuation center
  hazard: [14.8089, 121.0572] as LatLng,
};

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
  path: LatLng[]; // OSRM foot geometry (street-snapped), used offline
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
    distance: '438 m',
    eta: '5 min',
    via: 'Phase G3 collector, Francisco Ave.',
    coords: COORDS.fcpc,
    path: [
      [14.80828, 121.05862], [14.80835, 121.05844], [14.80858, 121.05853], [14.80893, 121.05866],
      [14.80921, 121.05881], [14.80987, 121.05998], [14.81062, 121.06133],
    ],
    steps: [
      'Leave Phase G3 and walk 21 m west to the paved street corner.',
      'Turn right onto the Phase G3 collector (115 m), heading north-east, away from the creek.',
      'Continue onto Francisco Ave. (302 m) toward Brgy. Narra.',
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
    distance: '474 m',
    eta: '6 min',
    via: 'Phase G3 collector, Francisco Ave. North',
    coords: COORDS.narra,
    path: [
      [14.80828, 121.05862], [14.80835, 121.05844], [14.80858, 121.05853], [14.80893, 121.05866],
      [14.80921, 121.05881], [14.80987, 121.05998], [14.81016, 121.05981], [14.81051, 121.05962],
      [14.81068, 121.05995], [14.81135, 121.05966], [14.81136, 121.05965],
    ],
    steps: [
      'Leave Phase G3, turn right onto the collector street (249 m).',
      'Turn left at the junction (81 m) heading north toward Francisco Ave.',
      'Turn right onto Francisco Ave. (41 m), then left (82 m) to the covered court.',
    ],
  },
  {
    id: 'yakal',
    name: 'Brgy. Yakal Evacuation Center',
    short: 'Yakal Center',
    note: 'Francisco Homes 1. Elevated barangay shelter.',
    role: 'Secondary',
    occupancy: '54 / 200',
    distance: '595 m',
    eta: '7 min',
    via: 'Phase F/G subdivision streets',
    coords: COORDS.yakal,
    path: [
      [14.80828, 121.05862], [14.80835, 121.05844], [14.8081, 121.05834], [14.80789, 121.05826],
      [14.80763, 121.05816], [14.80743, 121.05808], [14.80694, 121.05802], [14.80686, 121.05818],
      [14.80681, 121.0583], [14.80674, 121.05846], [14.80658, 121.05881], [14.80652, 121.05893],
      [14.80618, 121.05927], [14.80597, 121.05952], [14.80608, 121.05962], [14.80619, 121.05974],
      [14.8063, 121.05984], [14.80639, 121.05993], [14.8065, 121.06003], [14.80658, 121.06011],
      [14.80669, 121.0602], [14.80685, 121.06035], [14.80699, 121.06048], [14.80711, 121.0606],
      [14.80715, 121.06064], [14.80696, 121.06087], [14.80693, 121.06084],
    ],
    steps: [
      'Leave Phase G3, walk 21 m west and turn left heading south (164 m).',
      'Turn left at the subdivision corner (196 m), continuing south-east.',
      'Turn left onto the eastern collector (178 m) toward the barangay hall.',
      'Turn right (36 m) to arrive at the Yakal Evacuation Center.',
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

export async function fetchFootRoute(from: LatLng, to: LatLng) {
  const url = `https://router.project-osrm.org/route/v1/foot/${from[1]},${from[0]};${to[1]},${to[0]}?overview=full&geometries=geojson&steps=true`;
  const res = await fetch(url);
  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) throw new Error('no route');
  return {
    path: r.geometry.coordinates.map((c: number[]) => [c[1], c[0]] as LatLng),
    meters: Math.round(r.distance as number),
    minutes: Math.max(1, Math.round((r.distance as number) / 80)),
    steps: (r.legs[0].steps as { distance: number; name: string; maneuver: { type: string } }[]).map((s) =>
      s.maneuver.type === 'arrive'
        ? 'Arrive at the destination.'
        : `Follow ${s.name || 'the street'} for ${Math.round(s.distance)} m.`,
    ),
  };
}
