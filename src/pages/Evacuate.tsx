import { useEffect, useState } from 'react';
import RouteMap from '../components/RouteMap';
import { Icon, Section } from '../components/ui';
import { COORDS, SHELTERS, fetchFootRoute, type LatLng } from '../lib/geo';
import { telemetry } from '../lib/stores';

export default function Evacuate() {
  const t = telemetry.use();
  const [shelterId, setShelterId] = useState<(typeof SHELTERS)[number]['id']>('fcpc');
  const [custom, setCustom] = useState<LatLng | null>(null);
  const [customLabel, setCustomLabel] = useState('Custom start');
  const [live, setLive] = useState<{ path: LatLng[]; meters: number; minutes: number; steps: string[] } | null>(null);
  const [note, setNote] = useState('Tap the map to start from your own street.');

  const shelter = SHELTERS.find((s) => s.id === shelterId)!;
  const color = shelter.role === 'Primary' ? '#15803d' : '#1d4ed8';

  // Recompute a street-snapped walk when the start is custom; fall back to baked geometry offline.
  useEffect(() => {
    if (!custom) {
      setLive(null);
      return;
    }
    let cancelled = false;
    fetchFootRoute(custom, shelter.coords)
      .then((r) => !cancelled && (setLive(r), setNote('Route follows streets from your chosen start.')))
      .catch(() => {
        if (cancelled) return;
        setLive(null);
        setNote('Offline: showing the default route from Phase G3.');
      });
    return () => {
      cancelled = true;
    };
  }, [custom, shelter]);

  const path = live?.path ?? shelter.path;
  const distance = live ? `${live.meters} m` : shelter.distance;
  const eta = live ? `${live.minutes} min` : shelter.eta;
  const steps = live?.steps ?? shelter.steps;
  const origin = custom ?? COORDS.node;
  const originLabel = custom ? customLabel : `Node ${t.waterCm.toFixed(1)} cm`;

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
        <p className="text-[13px] text-muted">Shortest walk along real streets to a safe shelter.</p>
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
                onPick={(p) => {
                  setCustomLabel('Custom start');
                  setCustom(p);
                }}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Destination', shelter.short],
              ['Walking', distance],
              ['Time', eta],
            ].map(([k, v]) => (
              <div key={k} className="card !p-3">
                <p className="eyebrow">{k}</p>
                <p className="tnum truncate text-[15px] font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Section
            title="Shelters"
            action={
              <button className="btn-quiet !min-h-9 text-xs" onClick={locate}>
                <Icon name="locate" size={14} /> My location
              </button>
            }
          >
            <div className="space-y-2" role="radiogroup" aria-label="Choose shelter">
              {SHELTERS.map((s) => (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={s.id === shelterId}
                  onClick={() => setShelterId(s.id)}
                  className={`w-full rounded-lg border p-3 text-left ${s.id === shelterId ? 'border-brand bg-brand-tint' : 'border-line hover:bg-bg'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{s.name}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.role === 'Primary' ? 'bg-safe-tint text-safe' : 'bg-bg text-muted'}`}>{s.role}</span>
                  </div>
                  <p className="mt-1 text-[13px] text-muted">{s.note}</p>
                  <p className="tnum mt-1.5 font-mono text-xs text-faint">
                    {s.distance} · {s.eta} · {s.occupancy} sheltered
                  </p>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs text-faint" role="status">{note}</p>
          </Section>

          <Section title="Directions" hint={custom ? undefined : `Via ${shelter.via}`}>
            <ol className="space-y-3">
              {steps.map((s, i) => (
                <li key={i} className="flex gap-3 text-[13px]">
                  <span className="tnum grid h-6 w-6 shrink-0 place-items-center rounded-full bg-bg font-mono text-xs font-semibold text-muted">{i + 1}</span>
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
              <a className="btn-quiet !px-3" href="sms:+639175550101?body=WHAZE%20CHECK-IN%3A%20Walking%20to%20shelter%20via%20Francisco%20Ave." aria-label="Text CDRRMO"><Icon name="chat" /></a>
              <a className="btn-primary !px-3" href="tel:+63448152142" aria-label="Call CDRRMO"><Icon name="phone" /></a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
