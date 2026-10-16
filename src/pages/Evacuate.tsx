import { useEffect, useState } from 'react';
import RouteMap from '../components/RouteMap';
import { Icon, Section } from '../components/ui';
import {
  COORDS,
  SHELTERS,
  fetchFootRoute,
  getFloodZone,
  getShelterRoute,
  haversineMeters,
  minDistanceToPath,
  type LatLng,
  type RouteResult,
} from '../lib/geo';
import { telemetry } from '../lib/stores';

export default function Evacuate() {
  const t = telemetry.use();
  const [shelterId, setShelterId] = useState<(typeof SHELTERS)[number]['id']>('fcpc');
  const [custom, setCustom] = useState<LatLng | null>(null);
  const [customLabel, setCustomLabel] = useState('Custom start');
  const [avoidFloods, setAvoidFloods] = useState(true);
  const [live, setLive] = useState<RouteResult | null>(null);
  const [note, setNote] = useState('Tap anywhere on the map to calculate a route from your own street.');

  const shelter = SHELTERS.find((s) => s.id === shelterId)!;
  const color = shelter.role === 'Primary' ? '#15803d' : '#1d4ed8';
  const flood = getFloodZone(t.waterCm, t.floatSwitch);
  const baseRoute = getShelterRoute(shelter, flood.isWarningOrHigher);

  const origin = custom ?? COORDS.node;
  const originLabel = custom ? customLabel : `Node ${t.waterCm.toFixed(1)} cm`;

  // Compute a live street-snapped walk adhering to flood avoidance; fall back to verified dry geometry offline.
  useEffect(() => {
    let cancelled = false;
    fetchFootRoute(origin, shelter.coords, t.waterCm, avoidFloods, t.floatSwitch)
      .then((r) => {
        if (cancelled) return;
        setLive(r);
        if (r.isInsideFlood) {
          setNote('Warning: Starting point is within the active flood zone. Outward escape corridor generated.');
        } else if (r.isDetour) {
          setNote(`Flood avoidance active: Detoured around the ${flood.radius} m flood radius.`);
        } else if (flood.isWarningOrHigher) {
          setNote(`Safe route active: Maintains ${r.minClearance} m clearance from flooded creek.`);
        } else {
          setNote('Direct shortest route active. Flood avoidance is on standby (< 15 cm normal depth).');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setLive(null);
        setNote('Offline mode: displaying pre-verified corridor.');
      });

    return () => {
      cancelled = true;
    };
  }, [origin, shelter, t.waterCm, avoidFloods, t.floatSwitch, flood.isWarningOrHigher, flood.radius]);

  const path = live?.path ?? baseRoute.path;
  const distance = live ? `${live.meters} m` : baseRoute.distance;
  const eta = live ? `${live.minutes} min` : baseRoute.eta;
  const steps = live?.steps ?? baseRoute.steps;
  const clearance = live
    ? live.minClearance
    : Math.round(minDistanceToPath(flood.center, baseRoute.path));
  const isInsideFlood = flood.isWarningOrHigher
    ? (live ? live.isInsideFlood : haversineMeters(origin, flood.center) < flood.radius)
    : false;
  const isDetour = live ? live.isDetour : false;

  function locate() {
    if (!navigator.geolocation) return setNote('Location is unavailable. Using Phase G3.');
    setNote('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setCustomLabel('You');
        setCustom([p.coords.latitude, p.coords.longitude]);
      },
      () => {
        setCustom(null);
        setNote('Location permission denied. Routing from Phase G3, Brgy. Yakal.');
      },
      { timeout: 5000 },
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold sm:text-2xl">Evacuation route</h1>
        <p className="text-[13px] text-muted">
          Shortest walk along real streets, avoiding flood hazard zones when water reaches warning levels.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <div className="card !p-2">
            <div className="h-[52vh] min-h-[320px] lg:h-[560px]">
              <RouteMap
                path={path}
                color={color}
                origin={origin}
                originLabel={originLabel}
                dest={shelter.coords}
                destLabel={shelter.short}
                level={t.status}
                waterCm={t.waterCm}
                minClearance={clearance}
                isDetour={isDetour}
                isInsideFlood={isInsideFlood}
                onPick={(p) => {
                  setCustomLabel('Custom start');
                  setCustom(p);
                }}
              />
            </div>
          </div>

          {/* Key telemetry stats including Flood Clearance */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="card !p-3">
              <p className="eyebrow">Destination</p>
              <p className="tnum truncate text-[15px] font-semibold">{shelter.short}</p>
            </div>
            <div className="card !p-3">
              <p className="eyebrow">Walking</p>
              <p className="tnum truncate text-[15px] font-semibold">{distance}</p>
            </div>
            <div className="card !p-3">
              <p className="eyebrow">Time</p>
              <p className="tnum truncate text-[15px] font-semibold">{eta}</p>
            </div>
            <div className="card !p-3">
              <p className="eyebrow">Flood Clearance</p>
              <p
                className={`tnum truncate text-[15px] font-semibold ${
                  isInsideFlood
                    ? 'text-danger'
                    : flood.isWarningOrHigher
                    ? 'text-safe'
                    : 'text-ink'
                }`}
              >
                {isInsideFlood
                  ? 'Inside basin'
                  : flood.isWarningOrHigher
                  ? `${clearance} m clear`
                  : 'Normal (< 15 cm)'}
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Flood Avoidance Radius Control */}
          <div className="card flex items-center justify-between gap-3 !p-3.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                  avoidFloods && flood.isWarningOrHigher
                    ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    : avoidFloods
                    ? 'bg-safe-tint text-safe'
                    : 'bg-bg text-muted'
                }`}
              >
                <Icon name="check" size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">Avoid Flooded Area Radius</p>
                <p className="text-xs text-muted truncate">
                  {!avoidFloods
                    ? 'Avoidance disabled (unconstrained direct path)'
                    : flood.isWarningOrHigher
                    ? `ACTIVE (≥ 15 cm): Bypassing ${flood.radius}m ${flood.levelLabel}`
                    : 'Standby (activates automatically at Warning level ≥ 15 cm)'}
                </p>
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center shrink-0">
              <input
                type="checkbox"
                checked={avoidFloods}
                onChange={(e) => setAvoidFloods(e.target.checked)}
                className="peer sr-only"
              />
              <div className="peer h-6 w-11 rounded-full bg-line peer-checked:bg-brand peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
            </label>
          </div>

          <Section
            title="Shelters"
            action={
              <button className="btn-quiet !min-h-9 text-xs" onClick={locate}>
                <Icon name="locate" size={14} /> My location
              </button>
            }
          >
            <div className="space-y-2" role="radiogroup" aria-label="Choose shelter">
              {SHELTERS.map((s) => {
                const sRoute = getShelterRoute(s, flood.isWarningOrHigher);
                return (
                  <button
                    key={s.id}
                    role="radio"
                    aria-checked={s.id === shelterId}
                    onClick={() => setShelterId(s.id)}
                    className={`w-full rounded-lg border p-3 text-left ${
                      s.id === shelterId
                        ? 'border-brand bg-brand-tint'
                        : 'border-line hover:bg-bg'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          s.role === 'Primary' ? 'bg-safe-tint text-safe' : 'bg-bg text-muted'
                        }`}
                      >
                        {s.role}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] text-muted">{s.note}</p>
                    <p className="tnum mt-1.5 font-mono text-xs text-faint">
                      {sRoute.distance} · {sRoute.eta} · {s.occupancy} sheltered
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-faint" role="status">
              {note}
            </p>
          </Section>

          <Section
            title="Directions"
            hint={
              isInsideFlood
                ? 'Emergency Escape Route'
                : isDetour
                ? 'Flood-Safe Bypass Active'
                : flood.isWarningOrHigher
                ? `High ground corridor via ${baseRoute.via}`
                : `Direct shortest path via ${baseRoute.via}`
            }
          >
            {isInsideFlood && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-2.5 text-xs text-red-700 dark:text-red-300">
                <strong>Safety Alert:</strong> Your location is within the active flood radius. Follow the
                outward path immediately to reach high ground.
              </div>
            )}
            {isDetour && !isInsideFlood && (
              <div className="mb-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-xs text-emerald-800 dark:text-emerald-300">
                <strong>Flood Bypass Applied:</strong> Route has been redirected along elevated
                subdivision ridges to completely steer clear of the flooded basin.
              </div>
            )}
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg font-mono text-xs font-semibold text-muted">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-ink">{s}</span>
                </li>
              ))}
            </ol>
          </Section>

          <div className="card flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold">Need help on the way?</p>
              <p className="text-[13px] text-muted">CSJDM CDRRMO, (044) 815-2142</p>
            </div>
            <div className="flex gap-2">
              <a
                className="btn-quiet !px-3"
                href="sms:+639175550101?body=WHAZE%20CHECK-IN%3A%20Walking%20to%20shelter%20via%20Francisco%20Ave."
                aria-label="Text CDRRMO"
              >
                <Icon name="chat" />
              </a>
              <a className="btn-primary !px-3" href="tel:+63448152142" aria-label="Call CDRRMO">
                <Icon name="phone" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
