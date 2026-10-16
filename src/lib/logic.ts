export type Level = 'SAFE' | 'WARNING' | 'CRITICAL';

export const MOUNT_HEIGHT_CM = 100;
export const WARN_CM = 15;
export const CRIT_CM = 30;

export function statusFor(waterCm: number, floatSwitch: boolean): Level {
  if (floatSwitch || waterCm >= CRIT_CM) return 'CRITICAL';
  if (waterCm >= WARN_CM) return 'WARNING';
  return 'SAFE';
}

/** Accuracy (%) = max(0, 100 - |actual - sensor| / actual * 100). Guards actual <= 0. */
export function accuracyPercent(actual: number, sensor: number): number {
  if (!isFinite(actual) || actual <= 0) return 100;
  const err = (Math.abs(actual - sensor) / actual) * 100;
  return Math.max(0, Math.min(100, 100 - err));
}

/** Sample mean and sample standard deviation (n - 1). Safe for empty / single inputs. */
export function meanAndSD(values: number[]) {
  const v = values.filter((x) => isFinite(x));
  const n = v.length;
  if (n === 0) return { mean: 0, sd: 0, n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { mean, sd: 0, n };
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { mean, sd: Math.sqrt(variance), n };
}
