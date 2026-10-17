let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (typeof window === 'undefined') return;
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (C) ctx = new C();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

let criticalAudio: HTMLAudioElement | null = null;
let isCriticalActive = false;

export function getCriticalAudio(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!criticalAudio) {
    criticalAudio = new Audio('/critical-alarm.mp3');
    criticalAudio.loop = true;
    criticalAudio.volume = 0.9;
  }
  return criticalAudio;
}

export function playCriticalMusic(): () => void {
  isCriticalActive = true;
  unlockAudio();
  const audio = getCriticalAudio();
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch(() => {});
  }
  return () => {
    stopCriticalMusic();
  };
}

export function stopCriticalMusic() {
  isCriticalActive = false;
  if (criticalAudio) {
    try {
      criticalAudio.pause();
      criticalAudio.currentTime = 0;
    } catch {
      // ignore audio state error
    }
  }
}

/** Browsers block audio before a gesture; unlock on the first interaction. */
export function bindAudioUnlock() {
  if (typeof window === 'undefined') return;
  const onInteraction = () => {
    unlockAudio();
    if (criticalAudio && isCriticalActive && criticalAudio.paused) {
      criticalAudio.play().catch(() => {});
    }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) =>
    window.addEventListener(e, onInteraction, { passive: true }),
  );
}

export function beep(freq = 2700, ms = 180, type: OscillatorType = 'square', volume = 0.08) {
  unlockAudio();
  if (!ctx || ctx.state !== 'running') return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + ms / 1000);
}

/** Alternating 880/1320 Hz siren. Returns a stop function. */
export function startSiren(): () => void {
  unlockAudio();
  let high = false;
  const tick = () => {
    beep(high ? 1320 : 880, 480, 'sawtooth', 0.12);
    high = !high;
  };
  tick();
  const id = window.setInterval(tick, 500);
  return () => window.clearInterval(id);
}
