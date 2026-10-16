import { describe, expect, it } from 'vitest';
import { accuracyPercent, meanAndSD, statusFor } from './logic';

describe('statusFor', () => {
  it('maps thresholds', () => {
    expect(statusFor(10, false)).toBe('SAFE');
    expect(statusFor(15, false)).toBe('WARNING');
    expect(statusFor(29.9, false)).toBe('WARNING');
    expect(statusFor(30, false)).toBe('CRITICAL');
  });
  it('float switch forces critical', () => expect(statusFor(5, true)).toBe('CRITICAL'));
});

describe('accuracyPercent', () => {
  it('guards zero and negative actual', () => {
    expect(accuracyPercent(0, 0)).toBe(100);
    expect(accuracyPercent(-5, 10)).toBe(100);
  });
  it('computes and floors at 0', () => {
    expect(accuracyPercent(10, 10.2)).toBeCloseTo(98, 5);
    expect(accuracyPercent(10, 40)).toBe(0);
  });
});

describe('meanAndSD', () => {
  it('handles empty and single', () => {
    expect(meanAndSD([])).toEqual({ mean: 0, sd: 0, n: 0 });
    expect(meanAndSD([25])).toEqual({ mean: 25, sd: 0, n: 1 });
  });
  it('uses sample SD', () => {
    const r = meanAndSD([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(r.mean).toBe(5);
    expect(r.sd).toBeCloseTo(2.138, 3);
  });
});

describe('Flood Zone and Route Avoidance', () => {
  it('activates flood radius only when reaching warning levels (>= 15 cm or float switch)', async () => {
    const { getFloodZone } = await import('./geo');
    // Normal water conditions (< 15 cm): Avoidance inactive / standby
    const safeZone = getFloodZone(10);
    expect(safeZone.isWarningOrHigher).toBe(false);
    expect(safeZone.radius).toBe(0);
    expect(safeZone.avoidRadius).toBe(0);

    // Warning level (>= 15 cm and < 30 cm): 115m radius active
    const warningZone = getFloodZone(15);
    expect(warningZone.isWarningOrHigher).toBe(true);
    expect(warningZone.radius).toBe(115);
    expect(warningZone.avoidRadius).toBe(135);

    // Critical level (>= 30 cm): 150m radius active
    const criticalZone = getFloodZone(35);
    expect(criticalZone.isWarningOrHigher).toBe(true);
    expect(criticalZone.radius).toBe(150);
    expect(criticalZone.avoidRadius).toBe(170);

    // Float switch triggered forces critical flood radius
    const floatZone = getFloodZone(5, true);
    expect(floatZone.isWarningOrHigher).toBe(true);
    expect(floatZone.radius).toBe(150);
  });

  it('provides direct routes during safe levels and high-ground bypass routes during warning levels', async () => {
    const { SHELTERS, COORDS, minDistanceToPath, getShelterRoute, getFloodZone } = await import('./geo');
    const criticalFlood = getFloodZone(35); // 150m radius

    for (const s of SHELTERS) {
      // Safe mode: Direct route is available
      const direct = getShelterRoute(s, false);
      expect(direct.path.length).toBeGreaterThan(0);
      expect(direct.distance).toBeDefined();

      // Warning/Critical mode: High-ground bypass route strictly clears the 150m flood zone
      const avoid = getShelterRoute(s, true);
      const clearance = minDistanceToPath(COORDS.hazard, avoid.path);
      expect(clearance).toBeGreaterThan(criticalFlood.radius);
    }
  });
});

