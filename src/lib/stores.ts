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

/** Apply a water reading (simulated or live), derive status and log transitions. */
export function applyReading(waterCm: number, floatSwitch: boolean, mode: ConnectionMode, latencyMs?: number) {
  const prev = telemetry.get();
  const water = Math.max(0, Math.min(MOUNT_HEIGHT_CM, waterCm));
  const status = statusFor(water, floatSwitch);
  telemetry.set({
    ...prev,
    waterCm: water,
    floatSwitch,
    status,
    mode,
    latencyMs: latencyMs ?? Math.floor(38 + (water % 9)),
  });
  if (status !== prev.status) {
    if (status === 'CRITICAL')
      pushAlert('CRITICAL', 'Critical level: evacuate', `Water at ${water.toFixed(1)} cm${floatSwitch ? ' with float switch closed' : ''}. Go to FCPC.`, water);
    else if (status === 'WARNING')
      pushAlert('WARNING', 'Water rising', `Water at ${water.toFixed(1)} cm. Prepare your go-bag.`, water);
    else pushAlert('SAFE', 'Level back to normal', `Water receded to ${water.toFixed(1)} cm.`, water);
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
