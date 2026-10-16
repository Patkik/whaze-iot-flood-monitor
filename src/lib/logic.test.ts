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
