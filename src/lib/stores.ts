import { createStore } from './createStore';
import { MOUNT_HEIGHT_CM, statusFor, type Level } from './logic';

export type ConnectionMode = 'Simulated Mode' | 'ESP32 Live' | 'Offline Cached';

export interface Telemetry {
  waterCm: number;
  floatSwitch: boolean;
  status: Level;
  latencyMs: number;
  mode: ConnectionMode;
  esp32Ip: string;
  muted: boolean;
}

export const telemetry = createStore<Telemetry>('whaze.telemetry.v3', {
  waterCm: 12,
  floatSwitch: false,
  status: 'SAFE',
  latencyMs: 42,
  mode: 'Simulated Mode',
  esp32Ip: '192.168.4.1',
  muted: false,
});

export interface AlertItem {
  id: string;
  level: Level;
  title: string;
  message: string;
  waterCm: number;
  time: string;
}

export const alerts = createStore<AlertItem[]>('whaze.alerts.v3', [
  {
    id: 'seed',
    level: 'SAFE',
    title: 'Sensor node online',
    message: 'ESP32-FCPC-G3 calibrated at a 100 cm datum, Phase G3, Brgy. Yakal.',
    waterCm: 12,
    time: '08:00',
  },
]);

export function pushAlert(level: Level, title: string, message: string, waterCm: number) {
  const item: AlertItem = {
    id: String(Date.now()),
    level,
    title,
    message,
    waterCm,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
  alerts.set((prev) => [item, ...prev].slice(0, 30));
}

const SYNC_TOPIC = 'whaze_flood_ews_telemetry_sync_csjdm';
const SYNC_URL = `https://ntfy.sh/${SYNC_TOPIC}`;
const CLIENT_ID = `whaze-${Math.random().toString(36).slice(2, 10)}`;

interface SyncPayload {
  waterCm: number;
  floatSwitch: boolean;
  mode: ConnectionMode;
  latencyMs?: number;
  ts: number;
  sender: string;
}

let lastAppliedTs = 0;
let publishTimer: ReturnType<typeof setTimeout> | null = null;
let bc: BroadcastChannel | null = null;

function applyIncomingPayload(payload: SyncPayload) {
  if (!payload || typeof payload.waterCm !== 'number') return;
  if (payload.sender === CLIENT_ID) return;
  if (payload.ts && payload.ts <= lastAppliedTs) return;
  if (payload.ts) lastAppliedTs = payload.ts;
  applyReading(payload.waterCm, Boolean(payload.floatSwitch), payload.mode || 'Simulated Mode', payload.latencyMs, true);
}

function broadcastReading(waterCm: number, floatSwitch: boolean, mode: ConnectionMode, latencyMs: number) {
  const ts = Date.now();
  lastAppliedTs = Math.max(lastAppliedTs, ts);
  const payload: SyncPayload = {
    waterCm,
    floatSwitch,
    mode,
    latencyMs,
    ts,
    sender: CLIENT_ID,
  };

  try {
    if (!bc && typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('whaze_telemetry_sync_v1');
    }
    bc?.postMessage(payload);
  } catch {
    // ignore BroadcastChannel errors
  }

  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = setTimeout(() => {
    if (typeof fetch === 'undefined') return;
    fetch(SYNC_URL, {
      method: 'POST',
      body: JSON.stringify(payload),
    }).catch(() => {
      // ignore offline error
    });
  }, 180);
}

/**
 * Starts real-time simulator water depth synchronization across all open Web and Mobile App instances.
 */
export function startTelemetrySync(): () => void {
  if (typeof window === 'undefined') return () => {};

  let stopped = false;
  let es: EventSource | null = null;

  // 1. Same-device cross-tab BroadcastChannel
  try {
    if (!bc && typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('whaze_telemetry_sync_v1');
    }
    if (bc) {
      bc.onmessage = (ev) => {
        if (!stopped && ev?.data) applyIncomingPayload(ev.data as SyncPayload);
      };
    }
  } catch {
    // ignore
  }

  // 2. Fetch latest state from cloud relay on startup & periodic poll fallback
  const pollLatest = async () => {
    if (stopped || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    try {
      const res = await fetch(`${SYNC_URL}/json?poll=1&since=12h`, { cache: 'no-store' });
      if (!res.ok) return;
      const text = await res.text();
      const lines = text.trim().split('\n').filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const evt = JSON.parse(lines[i]);
          if (evt?.event === 'message' && evt.message) {
            const data = JSON.parse(evt.message) as SyncPayload;
            if (typeof data?.waterCm === 'number') {
              applyIncomingPayload(data);
              break;
            }
          }
        } catch {
          // continue
        }
      }
    } catch {
      // ignore offline
    }
  };

  void pollLatest();
  const pollInterval = window.setInterval(pollLatest, 3500);

  // 3. Real-time Server-Sent Events (SSE) stream for instant push across Web <-> Mobile App
  try {
    if (typeof EventSource !== 'undefined') {
      es = new EventSource(`${SYNC_URL}/sse`);
      es.onmessage = (ev) => {
        if (stopped || !ev?.data) return;
        try {
          const parsed = JSON.parse(ev.data);
          const rawMsg = parsed?.message ?? ev.data;
          const data = typeof rawMsg === 'string' ? (JSON.parse(rawMsg) as SyncPayload) : (rawMsg as SyncPayload);
          applyIncomingPayload(data);
        } catch {
          // ignore parse error
        }
      };
    }
  } catch {
    // ignore SSE error
  }

  return () => {
    stopped = true;
    window.clearInterval(pollInterval);
    try {
      es?.close();
    } catch {
      // ignore
    }
  };
}

/** Apply a water reading (simulated or live), derive status, log transitions, and sync across all connected apps. */
export function applyReading(
  waterCm: number,
  floatSwitch: boolean,
  mode: ConnectionMode,
  latencyMs?: number,
  fromRemoteSync = false,
) {
  const prev = telemetry.get();
  const water = Math.max(0, Math.min(MOUNT_HEIGHT_CM, waterCm));
  const status = statusFor(water, floatSwitch);
  const resolvedLatency = latencyMs ?? Math.floor(38 + (water % 9));
  telemetry.set({
    ...prev,
    waterCm: water,
    floatSwitch,
    status,
    mode,
    latencyMs: resolvedLatency,
  });
  if (status !== prev.status) {
    if (status === 'CRITICAL')
      pushAlert('CRITICAL', 'Critical level: evacuate', `Water at ${water.toFixed(1)} cm${floatSwitch ? ' with float switch closed' : ''}. Go to FCPC.`, water);
    else if (status === 'WARNING')
      pushAlert('WARNING', 'Water rising', `Water at ${water.toFixed(1)} cm. Prepare your go-bag.`, water);
    else pushAlert('SAFE', 'Level back to normal', `Water receded to ${water.toFixed(1)} cm.`, water);
  }
  if (!fromRemoteSync) {
    broadcastReading(water, floatSwitch, mode, resolvedLatency);
  }
}

export interface Trial {
  id: string;
  tier: 'Low' | 'Moderate' | 'Critical';
  actualCm: number;
  sensorCm: number;
  latencyMs: number;
  output: string;
}

export const BASELINE_TRIALS: Trial[] = [
  { id: 'T-01', tier: 'Low', actualCm: 10, sensorCm: 10.2, latencyMs: 39, output: 'GPIO 21 green' },
  { id: 'T-02', tier: 'Low', actualCm: 10, sensorCm: 9.9, latencyMs: 41, output: 'GPIO 21 green' },
  { id: 'T-03', tier: 'Low', actualCm: 12, sensorCm: 12.1, latencyMs: 38, output: 'GPIO 21 green' },
  { id: 'T-04', tier: 'Moderate', actualCm: 20, sensorCm: 20.3, latencyMs: 44, output: 'GPIO 22 yellow' },
  { id: 'T-05', tier: 'Moderate', actualCm: 20, sensorCm: 19.8, latencyMs: 42, output: 'GPIO 22 yellow' },
  { id: 'T-06', tier: 'Moderate', actualCm: 25, sensorCm: 25.2, latencyMs: 45, output: 'GPIO 22 yellow' },
  { id: 'T-07', tier: 'Critical', actualCm: 32, sensorCm: 32.3, latencyMs: 46, output: 'GPIO 23 red + piezo' },
  { id: 'T-08', tier: 'Critical', actualCm: 35, sensorCm: 34.7, latencyMs: 43, output: 'GPIO 23 red + piezo' },
  { id: 'T-09', tier: 'Critical', actualCm: 40, sensorCm: 40.4, latencyMs: 47, output: 'GPIO 23 red + piezo' },
];

export const trials = createStore<Trial[]>('whaze.trials.v3', BASELINE_TRIALS);

export interface SosRecord {
  id: string;
  time: string;
  zone: string;
  household: number;
  priority: string;
  water: string;
  notes: string;
}
export const sosLog = createStore<SosRecord[]>('whaze.sos.v3', []);

export const checklist = createStore<Record<string, boolean>>('whaze.checklist.v3', {});

export interface Report {
  id: string;
  name: string;
  area: string;
  type: string;
  rating: number;
  message: string;
  time: string;
}
export const SEED_REPORTS: Report[] = [
  { id: 's1', name: 'M. Santos', area: 'Brgy. Narra', type: 'SOP 4 System Evaluation', rating: 5, message: 'Alarm triggered within a second of the water reaching the red mark.', time: 'Seeded' },
  { id: 's2', name: 'R. dela Cruz', area: 'Phase G3, Brgy. Yakal', type: 'SOP 4 System Evaluation', rating: 5, message: 'The route to FCPC was clear and easy to follow on my phone.', time: 'Seeded' },
  { id: 's3', name: 'A. Villanueva', area: 'Brgy. Narra', type: 'SOP 4 System Evaluation', rating: 4, message: 'Yellow warning gave us enough time to pack. Wish SMS was automatic.', time: 'Seeded' },
  { id: 's4', name: 'J. Ramos', area: 'Francisco Ave.', type: 'Evacuation Route Status', rating: 5, message: 'Francisco Ave. is passable on foot. Water ankle-deep near the creek only.', time: 'Seeded' },
  { id: 's5', name: 'L. Bautista', area: 'Brgy. Yakal', type: 'SOP 4 System Evaluation', rating: 5, message: 'Easy to read even for my parents.', time: 'Seeded' },
  { id: 's6', name: 'K. Mendoza', area: 'Brgy. Narra', type: 'SOP 4 System Evaluation', rating: 5, message: 'Offline log kept the alerts when our signal dropped.', time: 'Seeded' },
];
export const reports = createStore<Report[]>('whaze.reports.v3', SEED_REPORTS);

export const privacy = createStore<{ accepted: boolean }>('whaze.privacy.v3', { accepted: false });
