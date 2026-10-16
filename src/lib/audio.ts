let ctx: AudioContext | null = null;

export function unlockAudio() {
  if (!ctx) {
    const C = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (C) ctx = new C();
  }
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

/** Browsers block audio before a gesture; unlock on the first interaction. */
export function bindAudioUnlock() {
  const once = () => {
    unlockAudio();
    ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.removeEventListener(e, once));
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) => window.addEventListener(e, once, { passive: true }));
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
