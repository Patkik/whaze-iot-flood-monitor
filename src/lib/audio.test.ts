import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest';

class MockAudio {
  src: string;
  loop = false;
  volume = 1;
  currentTime = 0;
  paused = true;
  constructor(src?: string) {
    this.src = src || '';
  }
  play = vi.fn().mockImplementation(() => {
    this.paused = false;
    return Promise.resolve();
  });
  pause = vi.fn().mockImplementation(() => {
    this.paused = true;
  });
}

const originalAudio = globalThis.Audio;
globalThis.Audio = MockAudio as unknown as typeof Audio;

import { playCriticalMusic, stopCriticalMusic, getCriticalAudio } from './audio';

describe('Critical alarm music', () => {
  afterAll(() => {
    globalThis.Audio = originalAudio;
  });

  beforeEach(() => {
    stopCriticalMusic();
  });

  it('creates audio element configured for loop and correct source', () => {
    const audio = getCriticalAudio();
    expect(audio).toBeDefined();
    expect(audio?.loop).toBe(true);
    expect(audio?.src).toContain('critical-alarm.mp3');
  });

  it('plays critical music and returns a stop function', () => {
    const audio = getCriticalAudio();
    const stop = playCriticalMusic();
    expect(typeof stop).toBe('function');
    expect(audio?.play).toHaveBeenCalled();

    stop();
    expect(audio?.pause).toHaveBeenCalled();
  });
});
