import { useEffect, useState } from 'react';
import RouteMap from '../components/RouteMap';
import { Icon, Section } from '../components/ui';
import {
  SHELTERS,
  fetchFootRoute,
  getFloodZone,
  getShelterRoute,
  haversineMeters,
  minDistanceToPath,
  type RouteResult,
} from '../lib/geo';
import {
  PRESET_CUSTOM_LOCATIONS,
  locationStore,
  permissionsStore,
  requestGpsPermission,
  resolveActiveLocation,
  setCustomLocation,
  setLocationTrackingMode,
} from '../lib/platform';
import { telemetry } from '../lib/stores';

export default function Evacuate() {
  const t = telemetry.use();
  const loc = locationStore.use();
  const perms = permissionsStore.use();
  const [shelterId, setShelterId] = useState<(typeof SHELTERS)[number]['id']>('fcpc');
  const [avoidFloods, setAvoidFloods] = useState(true);
  const [live, setLive] = useState<RouteResult | null>(null);
  const [note, setNote] = useState('Toggle "Track my location" for live GPS or tap the map for a custom start.');

  const shelter = SHELTERS.find((s) => s.id === shelterId)!;
  const color = shelter.role === 'Primary' ? '#15803d' : '#1d4ed8';
  const flood = getFloodZone(t.waterCm, t.floatSwitch);
  const baseRoute = getShelterRoute(shelter, flood.isWarningOrHigher);

  const activeLoc = resolveActiveLocation(loc);
  const origin = activeLoc.coords;
  const originLabel = activeLoc.isLiveGps
    ? activeLoc.label
    : loc.customLabel === 'Phase G3 Sensor Node'
      ? `Node ${t.waterCm.toFixed(1)} cm`
      : loc.customLabel;

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
  }, [
    origin[0],
    origin[1],
    shelter,
    t.waterCm,
    avoidFloods,
    t.floatSwitch,
    flood.isWarningOrHigher,
    flood.radius,
  ]);

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

  async function handleToggleGps(checked: boolean) {
    if (checked) {
      setNote('Requesting GPS permission and acquiring live position…');
      const ok = await setLocationTrackingMode(true);
      if (ok) {
        setNote('Live GPS tracking enabled. Route updates automatically as you move.');
      } else {
        setNote('GPS permission denied or unavailable. Using custom location instead.');
      }
    } else {
      await setLocationTrackingMode(false);
      setNote(`Switched to Custom Location (${loc.customLabel}). Tap anywhere on the map to move your pin.`);
    }
  }

  async function handleRequestGpsOnly() {
    setNote('Requesting Location GPS permission…');
    const ok = await requestGpsPermission();
    if (ok) {
      await setLocationTrackingMode(true);
      setNote('GPS permission granted! Tracking your live location.');
    } else {
      setNote('Could not obtain GPS permission. You can still use Custom Location.');
    }
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
                  setCustomLocation(p, 'Custom map pin');
                  setNote(
                    `Custom pin placed at ${p[0].toFixed(4)}, ${p[1].toFixed(4)} (Track my location turned OFF).`,
                  );
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
          {/* Location GPS Tracking vs Custom Location Switch */}
          <div className="card space-y-3 !p-3.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                    loc.trackMyLocation
                      ? 'bg-brand-tint text-brand'
                      : 'bg-bg text-muted'
                  }`}
                >
                  <Icon name={loc.trackMyLocation ? 'locate' : 'pin'} size={16} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold truncate">
                      {loc.trackMyLocation ? 'Track My Location (Live GPS)' : 'Use Custom Location'}
                    </p>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        perms.location === 'granted'
                          ? 'bg-safe-tint text-safe'
                          : perms.location === 'denied'
                          ? 'bg-crit-tint text-crit'
                          : 'bg-bg text-muted'
                      }`}
                    >
                      GPS {perms.location === 'granted' ? 'Granted' : perms.location === 'denied' ? 'Denied' : 'Permission'}
                    </span>
                  </div>
                  <p className="text-xs text-muted truncate">
                    {loc.trackMyLocation
                      ? loc.gpsCoords
                        ? `Live GPS: ${loc.gpsCoords[0].toFixed(5)}, ${loc.gpsCoords[1].toFixed(5)}${
                            loc.gpsAccuracy ? ` (±${Math.round(loc.gpsAccuracy)}m)` : ''
                          }`
                        : 'Acquiring GPS satellite signal…'
                      : `Active pin: ${loc.customLabel} (${loc.customCoords[0].toFixed(4)}, ${loc.customCoords[1].toFixed(4)})`}
                  </p>
                </div>
              </div>
              <label
                className="relative inline-flex cursor-pointer items-center shrink-0"
                aria-label="Toggle Track My Location or Use Custom Location"
              >
                <input
                  type="checkbox"
                  checked={loc.trackMyLocation}
                  onChange={(e) => void handleToggleGps(e.target.checked)}
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-line peer-checked:bg-brand peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
              </label>
            </div>

            {loc.gpsError && (
              <p className="rounded-lg bg-crit-tint px-2.5 py-1.5 text-xs text-crit" role="alert">
                {loc.gpsError}
              </p>
            )}

            {/* Mode-specific controls: GPS actions when ON, Preset custom pins when OFF */}
            {loc.trackMyLocation ? (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-2.5 text-xs">
                <span className="text-muted">
                  Following your real-time GPS coordinates. Tap map to switch to custom pin.
                </span>
                <button
                  type="button"
                  className="btn-quiet !min-h-8 shrink-0 !px-2.5 text-xs"
                  onClick={() => void handleRequestGpsOnly()}
                >
                  <Icon name="refresh" size={13} /> Refresh GPS
                </button>
              </div>
            ) : (
              <div className="space-y-2 border-t border-line pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-muted">
                    Tap map to drop pin or choose a preset starting point:
                  </span>
                  {perms.location !== 'granted' && (
                    <button
                      type="button"
                      className="btn-quiet !min-h-7 !px-2 text-[11px]"
                      onClick={() => void handleRequestGpsOnly()}
                    >
                      <Icon name="locate" size={12} /> Grant GPS Permission
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {PRESET_CUSTOM_LOCATIONS.map((preset) => {
                    const isSelected =
                      !loc.trackMyLocation && loc.customLabel === preset.label;
                    return (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setCustomLocation(preset.coords, preset.label);
                          setNote(`Custom location set to ${preset.label}.`);
                        }}
                        className={`rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition-colors ${
                          isSelected
                            ? 'border-brand bg-brand-tint text-brand'
                            : 'border-line bg-bg text-ink hover:border-brand/50'
                        }`}
                      >
                        <span className="block truncate">{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

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
              <button
                className="btn-quiet !min-h-9 text-xs"
                onClick={() => void handleToggleGps(!loc.trackMyLocation)}
              >
                <Icon name={loc.trackMyLocation ? 'pin' : 'locate'} size={14} />{' '}
                {loc.trackMyLocation ? 'Switch to Custom' : 'Track My Location'}
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
