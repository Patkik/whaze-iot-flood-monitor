import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Collapsible, Icon, LevelBadge, Section } from '../components/ui';
import { MOUNT_HEIGHT_CM, CRIT_CM, WARN_CM, accuracyPercent, meanAndSD, type Level } from '../lib/logic';
import {
  connectBluetoothEsp32,
  getPlatformCapabilities,
  locationStore,
  permissionsStore,
  requestBluetoothPermission,
  requestContactsPermission,
  requestGpsPermission,
  setLocationTrackingMode,
} from '../lib/platform';
import { BASELINE_TRIALS, applyReading, telemetry, trials, type Trial } from '../lib/stores';

const COPY: Record<Level, { title: string; body: string; tone: string; bar: string }> = {
  SAFE: { title: 'Water level is normal', body: 'Below 15 cm. The sensor keeps measuring every second.', tone: 'text-safe', bar: 'bg-safe' },
  WARNING: { title: 'Water is rising', body: '15 to 29.9 cm. Pack your go-bag and watch the channel.', tone: 'text-warn', bar: 'bg-amber-500' },
  CRITICAL: { title: 'Critical level. Evacuate.', body: 'At or above 30 cm, or the float switch has closed. Go to FCPC now.', tone: 'text-crit', bar: 'bg-crit' },
};

const STAGES: { level: Level; label: string; range: string }[] = [
  { level: 'SAFE', label: 'Normal', range: '< 15 cm' },
  { level: 'WARNING', label: 'Rising', range: '15 – 29.9 cm' },
  { level: 'CRITICAL', label: 'Evacuate', range: '≥ 30 cm' },
];
const ORDER: Level[] = ['SAFE', 'WARNING', 'CRITICAL'];

function Stages({ level }: { level: Level }) {
  const idx = ORDER.indexOf(level);
  const active = ['bg-safe', 'bg-amber-500', 'bg-crit'][idx];
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Warning stages">
      {STAGES.map((s, i) => (
        <li key={s.level}>
          <div className={`h-1.5 rounded-full ${i <= idx ? active : 'bg-line'}`} />
          <p className={`mt-2 text-[13px] font-semibold ${i === idx ? 'text-ink' : 'text-faint'}`}>{s.label}</p>
          <p className="tnum font-mono text-xs text-faint">{s.range}</p>
        </li>
      ))}
    </ol>
  );
}

function Leds({ level }: { level: Level }) {
  const leds = [
    { l: 'SAFE' as Level, name: 'GPIO 21', on: 'bg-green-500' },
    { l: 'WARNING' as Level, name: 'GPIO 22', on: 'bg-amber-400' },
    { l: 'CRITICAL' as Level, name: 'GPIO 23', on: 'bg-red-500' },
  ];
  return (
    <div className="flex flex-wrap gap-4" aria-label="Hardware LED twin">
      {leds.map((d) => (
        <span key={d.name} className="flex items-center gap-2 text-xs text-muted">
          <span className={`h-3 w-3 rounded-full ${level === d.l ? d.on : 'bg-line'}`} />
          <span className="font-mono">{d.name}</span>
        </span>
      ))}
    </div>
  );
}

function Simulator() {
  const t = telemetry.use();
  return (
    <Section title="Simulator" hint="Drive the readings to test every threshold, no hardware needed.">
      <label htmlFor="depth" className="label">
        Flood depth: <span className="tnum font-mono text-ink">{t.waterCm.toFixed(1)} cm</span>
      </label>
      <input
        id="depth"
        type="range"
        min={0}
        max={MOUNT_HEIGHT_CM}
        step={0.5}
        value={t.waterCm}
        onChange={(e) => applyReading(parseFloat(e.target.value), t.floatSwitch, 'Simulated Mode')}
        className="h-11 w-full accent-brand"
      />
      <div className="mt-2 grid grid-cols-3 gap-2">
        {[
          { l: 'Normal 12', w: 12, f: false },
          { l: 'Rising 22', w: 22, f: false },
          { l: 'Critical 36', w: 36, f: true },
        ].map((p) => (
          <button key={p.l} className="btn-quiet !px-2 text-[13px]" onClick={() => applyReading(p.w, p.f, 'Simulated Mode')}>
            {p.l}
          </button>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-brand" checked={t.floatSwitch} onChange={(e) => applyReading(t.waterCm, e.target.checked, 'Simulated Mode')} />
          Float switch closed (forces critical)
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input type="checkbox" className="h-5 w-5 accent-brand" checked={t.muted} onChange={(e) => telemetry.set({ ...t, muted: e.target.checked })} />
          Mute critical alarm audio
        </label>
      </div>
    </Section>
  );
}

function Connection() {
  const t = telemetry.use();
  const perms = permissionsStore.use();
  const [ip, setIp] = useState(t.esp32Ip);
  const [msg, setMsg] = useState('Using the simulator. Connect a node via Wi-Fi IP or Bluetooth.');

  async function poll() {
    const host = ip.trim().replace(/^https?:\/\//, '');
    telemetry.set({ ...t, esp32Ip: host });
    setMsg(`Connecting to ${host}…`);
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 2500);
      const res = await fetch(`http://${host}/data`, { signal: ctl.signal });
      clearTimeout(timer);
      const d = await res.json();
      applyReading(Number(d.waterLevelCm ?? 12), Boolean(d.floatSwitch), 'ESP32 Live', Number(d.responseTimeMs ?? 40));
      setMsg(`Connected to ${host}. Showing live readings.`);
    } catch {
      applyReading(telemetry.get().waterCm, telemetry.get().floatSwitch, navigator.onLine ? 'Simulated Mode' : 'Offline Cached');
      setMsg(
        location.protocol === 'https:'
          ? 'This page is on HTTPS, so the browser blocks plain-HTTP nodes. Use Bluetooth or the simulator, or open the app over local HTTP.'
          : `Could not reach ${host}. Check that you are on the same Wi-Fi.`,
      );
    }
  }

  async function ble() {
    setMsg('Checking Bluetooth permission and scanning for ESP32 sensor…');
    const res = await connectBluetoothEsp32();
    if (res.connected) {
      telemetry.set({ ...telemetry.get(), mode: 'ESP32 Live' });
    }
    setMsg(res.message);
  }

  return (
    <Collapsible
      title="Sensor connection"
      meta={`ESP32 · BT ${perms.bluetooth === 'granted' ? 'Granted' : 'Ready'}`}
    >
      <div className="mb-3 flex items-center justify-between gap-2 rounded-lg bg-bg px-3 py-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-ink">
          <Icon name="bluetooth" size={14} className="text-brand" />
          Bluetooth Permission:
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              perms.bluetooth === 'granted'
                ? 'bg-safe-tint text-safe'
                : perms.bluetooth === 'denied'
                ? 'bg-crit-tint text-crit'
                : 'bg-surface text-muted'
            }`}
          >
            {perms.bluetooth === 'granted' ? 'Granted' : perms.bluetooth === 'denied' ? 'Denied' : 'Needs Permission'}
          </span>
        </span>
        {perms.bluetooth !== 'granted' && (
          <button
            type="button"
            className="btn-quiet !min-h-7 !px-2.5 text-[11px]"
            onClick={async () => {
              const ok = await requestBluetoothPermission();
              setMsg(
                ok
                  ? 'Bluetooth permission granted! Tap Bluetooth to pair with ESP32.'
                  : 'Bluetooth permission not granted.',
              );
            }}
          >
            Grant Permission
          </button>
        )}
      </div>

      <label htmlFor="ip" className="label">ESP32 address</label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input id="ip" className="field font-mono" value={ip} onChange={(e) => setIp(e.target.value)} inputMode="decimal" />
        <button className="btn-primary" onClick={poll}>Connect</button>
        <button className="btn-quiet" onClick={ble}>
          <Icon name="bluetooth" size={15} /> Bluetooth
        </button>
      </div>
      <p className="mt-3 text-[13px] text-muted" role="status">{msg}</p>
    </Collapsible>
  );
}

function PermissionsAndPlatformCard() {
  const perms = permissionsStore.use();
  const loc = locationStore.use();
  const caps = getPlatformCapabilities();
  const [statusNote, setStatusNote] = useState('');

  const badgeClass = (state: 'granted' | 'prompt' | 'denied') =>
    state === 'granted'
      ? 'bg-safe-tint text-safe border-green-200'
      : state === 'denied'
      ? 'bg-crit-tint text-crit border-red-200'
      : 'bg-bg text-muted border-line';

  const badgeText = (state: 'granted' | 'prompt' | 'denied') =>
    state === 'granted' ? 'Granted' : state === 'denied' ? 'Denied' : 'Request';

  return (
    <Section
      title="Permissions & platform"
      hint={
        caps.isNative
          ? 'Android App Mode: Uses native OS permissions (GPS, Contacts, Bluetooth) & GitHub OTA APK updates.'
          : 'Web Browser Mode: Always up to date via web hosting; uses browser Geolocation, Contacts & Web Bluetooth.'
      }
      action={
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] font-semibold text-ink">
          <Icon name={caps.isNative ? 'smartphone' : 'globe'} size={13} className="text-brand" />
          {caps.isNative ? 'Android App' : 'Web Page'}
        </span>
      }
    >
      <div className="space-y-2.5">
        {/* 1. Location GPS & On/Off Tracking Switch */}
        <div className="rounded-lg border border-line p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="locate" size={16} className="text-brand shrink-0" />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">Location GPS & Tracking</p>
                <p className="text-[11px] text-muted truncate">
                  {loc.trackMyLocation
                    ? loc.gpsCoords
                      ? `Tracking Live GPS (${loc.gpsCoords[0].toFixed(4)}, ${loc.gpsCoords[1].toFixed(4)})`
                      : 'Acquiring live GPS fix…'
                    : `Using Custom Location (${loc.customLabel})`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={async () => {
                  const ok = await requestGpsPermission();
                  setStatusNote(
                    ok
                      ? 'Location GPS permission granted.'
                      : 'Location GPS permission denied or unavailable.',
                  );
                }}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${badgeClass(perms.location)}`}
              >
                {badgeText(perms.location)}
              </button>
              <label
                className="relative inline-flex cursor-pointer items-center"
                title="Toggle Track My Location (ON) or Custom Location (OFF)"
              >
                <input
                  type="checkbox"
                  checked={loc.trackMyLocation}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    const ok = await setLocationTrackingMode(next);
                    setStatusNote(
                      next
                        ? ok
                          ? 'Switched to Track My Location (Live GPS).'
                          : 'GPS unavailable; staying on Custom Location.'
                        : 'Switched to Use Custom Location.',
                    );
                  }}
                  className="peer sr-only"
                />
                <div className="peer h-5 w-9 rounded-full bg-line peer-checked:bg-brand peer-focus:outline-none after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-white"></div>
              </label>
            </div>
          </div>
        </div>

        {/* 2. Contacts Permission */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line p-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="users" size={16} className="text-brand shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink">Contacts Permission</p>
              <p className="text-[11px] text-muted truncate">
                For importing household & family SOS numbers
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const ok = await requestContactsPermission();
              setStatusNote(
                ok ? 'Contacts permission granted.' : 'Contacts permission denied.',
              );
            }}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badgeClass(perms.contacts)}`}
          >
            {badgeText(perms.contacts)}
          </button>
        </div>

        {/* 3. Bluetooth Permission */}
        <div className="flex items-center justify-between gap-2 rounded-lg border border-line p-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon name="bluetooth" size={16} className="text-brand shrink-0" />
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink">Bluetooth Permission</p>
              <p className="text-[11px] text-muted truncate">
                For pairing directly with the ESP32 flood sensor
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={async () => {
              const ok = await requestBluetoothPermission();
              setStatusNote(
                ok
                  ? 'Bluetooth permission granted.'
                  : 'Bluetooth permission denied or unsupported in this browser.',
              );
            }}
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${badgeClass(perms.bluetooth)}`}
          >
            {badgeText(perms.bluetooth)}
          </button>
        </div>

        {statusNote && (
          <p className="rounded-lg bg-bg px-3 py-2 text-xs text-muted" role="status">
            {statusNote}
          </p>
        )}
      </div>
    </Section>
  );
}

function trialTier(sensor: number): Trial['tier'] {
  return sensor >= CRIT_CM ? 'Critical' : sensor >= WARN_CM ? 'Moderate' : 'Low';
}

function Calibration() {
  const rows = trials.use();
  const t = telemetry.use();
  const caps = getPlatformCapabilities();
  const [actual, setActual] = useState('12.0');
  const [sensor, setSensor] = useState('12.1');
  const [exportMsg, setExportMsg] = useState('');

  const acc = meanAndSD(rows.map((r) => accuracyPercent(r.actualCm, r.sensorCm)));
  const tiers = (['Low', 'Moderate', 'Critical'] as const).map((tier) => ({
    tier,
    ...meanAndSD(rows.filter((r) => r.tier === tier).map((r) => r.sensorCm)),
  }));

  function add() {
    const a = parseFloat(actual);
    const s = parseFloat(sensor);
    if (!isFinite(a) || !isFinite(s) || a < 0 || s < 0) return;
    const tier = trialTier(s);
    trials.set((prev) => [
      ...prev,
      {
        id: `T-${String(prev.length + 1).padStart(2, '0')}`,
        tier,
        actualCm: a,
        sensorCm: s,
        latencyMs: Math.floor(38 + Math.random() * 9),
        output: tier === 'Critical' ? 'GPIO 23 red + piezo' : tier === 'Moderate' ? 'GPIO 22 yellow' : 'GPIO 21 green',
      },
    ]);
  }

  async function csv() {
    const head = 'Trial,Tier,Actual_cm,Sensor_cm,Error_cm,Accuracy_pct,Latency_ms,Output';
    const body = rows.map((r) =>
      [r.id, r.tier, r.actualCm, r.sensorCm, Math.abs(r.actualCm - r.sensorCm).toFixed(2), accuracyPercent(r.actualCm, r.sensorCm).toFixed(2), r.latencyMs, `"${r.output}"`].join(','),
    );
    const csvText = [head, ...body].join('\n');

    if (caps.isNative && typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Whaze Sensor Trials CSV',
          text: csvText,
        });
        setExportMsg('Shared CSV data via Android share sheet.');
        return;
      } catch {
        // Fallback to clipboard or download
      }
    }

    try {
      const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'whaze_sensor_trials.csv';
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg('Downloaded whaze_sensor_trials.csv.');
    } catch {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(csvText);
        setExportMsg('Copied CSV data to clipboard.');
      }
    }
  }

  return (
    <Collapsible title="Sensor trials and calibration" meta="SOP 2 and 3">
      <p className="mb-4 text-[13px] text-muted">
        Accuracy % = max(0, 100 − |actual − sensor| ÷ actual × 100). Standard deviation uses n − 1.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-lg bg-bg p-3">
          <p className="eyebrow">Mean accuracy</p>
          <p className="tnum text-lg font-semibold text-safe">{acc.mean.toFixed(2)}%</p>
          <p className="tnum font-mono text-xs text-faint">SD ±{acc.sd.toFixed(2)} (n={acc.n})</p>
        </div>
        {tiers.map((x) => (
          <div key={x.tier} className="rounded-lg bg-bg p-3">
            <p className="eyebrow">{x.tier} tier</p>
            <p className="tnum text-lg font-semibold">{x.mean.toFixed(2)} cm</p>
            <p className="tnum font-mono text-xs text-faint">SD ±{x.sd.toFixed(2)} (n={x.n})</p>
          </div>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <div>
          <label className="label" htmlFor="act">Actual (cm)</label>
          <input id="act" className="field font-mono" type="number" step="0.1" min="0" value={actual} onChange={(e) => setActual(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="sen">Sensor (cm)</label>
          <input id="sen" className="field font-mono" type="number" step="0.1" min="0" value={sensor} onChange={(e) => setSensor(e.target.value)} />
        </div>
        <button
          className="btn-quiet self-end"
          onClick={() => {
            setActual(t.waterCm.toFixed(1));
            setSensor((t.waterCm + (Math.random() * 0.4 - 0.2)).toFixed(1));
          }}
        >
          Use simulator
        </button>
        <button className="btn-primary self-end" onClick={add}>Log trial</button>
      </div>

      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{exportMsg}</span>
        <div className="flex gap-2">
          <button className="btn-quiet !min-h-9 text-xs" onClick={() => trials.set(BASELINE_TRIALS)}>Reset</button>
          <button className="btn-quiet !min-h-9 text-xs" onClick={() => void csv()}>
            <Icon name="download" size={14} /> {caps.isNative ? 'Share / Export CSV' : 'Download CSV'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[520px] text-left text-[13px]">
          <thead className="bg-bg text-xs text-muted">
            <tr>{['Trial', 'Tier', 'Actual', 'Sensor', 'Accuracy', 'Latency', 'Output'].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody className="tnum divide-y divide-line font-mono">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.id}</td>
                <td className="px-3 py-2 font-sans">{r.tier}</td>
                <td className="px-3 py-2">{r.actualCm.toFixed(1)}</td>
                <td className="px-3 py-2">{r.sensorCm.toFixed(1)}</td>
                <td className="px-3 py-2">{accuracyPercent(r.actualCm, r.sensorCm).toFixed(2)}%</td>
                <td className="px-3 py-2">{r.latencyMs} ms</td>
                <td className="px-3 py-2 font-sans">{r.output}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Collapsible>
  );
}

export default function Monitor() {
  const t = telemetry.use();
  const c = COPY[t.status];
  const pct = Math.max(1, Math.min(100, (t.waterCm / MOUNT_HEIGHT_CM) * 100));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
      <div className="space-y-4">
        <section className="card">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="eyebrow">Sunga Residence, Phase G3</p>
              <h1 className={`mt-1 text-xl font-semibold sm:text-2xl ${c.tone}`}>{c.title}</h1>
              <p className="mt-1 max-w-prose text-[13px] text-muted">{c.body}</p>
            </div>
            <LevelBadge level={t.status} />
          </div>

          <div className="mt-5 flex items-end gap-6">
            <div>
              <p className="eyebrow">Water depth</p>
              <p className="tnum font-mono text-5xl leading-none font-semibold sm:text-6xl">
                {t.waterCm.toFixed(1)}
                <span className="ml-1 text-xl text-faint">cm</span>
              </p>
            </div>
            <dl className="mb-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted">
              <dt>Sensor distance</dt>
              <dd className="tnum font-mono text-ink">{(MOUNT_HEIGHT_CM - t.waterCm).toFixed(1)} cm</dd>
              <dt>Response time</dt>
              <dd className="tnum font-mono text-ink">{t.latencyMs} ms</dd>
            </dl>
          </div>

          <div className="relative mt-5 h-3 rounded-full bg-line" role="img" aria-label={`Water at ${t.waterCm.toFixed(1)} of 100 centimetres`}>
            <div className={`h-full rounded-full transition-[width] duration-300 ${c.bar}`} style={{ width: `${pct}%` }} />
            <span className="absolute inset-y-[-3px] w-0.5 bg-ink/40" style={{ left: `${WARN_CM}%` }} />
            <span className="absolute inset-y-[-3px] w-0.5 bg-ink/40" style={{ left: `${CRIT_CM}%` }} />
          </div>
          <div className="tnum relative mt-1 h-4 font-mono text-[11px] text-faint">
            <span className="absolute left-0">0</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${WARN_CM}%` }}>15</span>
            <span className="absolute -translate-x-1/2" style={{ left: `${CRIT_CM}%` }}>30</span>
            <span className="absolute right-0">100 cm</span>
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <Stages level={t.status} />
          </div>
          <div className="mt-4"><Leds level={t.status} /></div>
        </section>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link to="/evacuate" className="card flex items-center gap-3 hover:border-brand">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-tint text-brand"><Icon name="map" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">Evacuation route</span>
              <span className="block text-[13px] text-muted">FCPC, 438 m, about 5 min on foot</span>
            </span>
          </Link>
          <Link to="/emergency" className="card flex items-center gap-3 hover:border-brand">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-crit-tint text-crit"><Icon name="shield" /></span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">SOS and hotlines</span>
              <span className="block text-[13px] text-muted">One-tap broadcast and calls</span>
            </span>
          </Link>
        </div>
      </div>

      <div className="space-y-4">
        <Simulator />
        <PermissionsAndPlatformCard />
        <Connection />
        <Calibration />
      </div>
    </div>
  );
}
