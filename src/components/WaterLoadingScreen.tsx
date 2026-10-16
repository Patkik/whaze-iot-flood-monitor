import { useEffect, useState } from 'react';

interface WaterLoadingScreenProps {
  onComplete?: () => void;
  minDurationMs?: number;
}

export default function WaterLoadingScreen({ onComplete, minDurationMs = 2200 }: WaterLoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(true);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, Math.round((elapsed / minDurationMs) * 100));
      setProgress(pct);

      if (pct >= 100) {
        clearInterval(interval);
        setFading(true);
        const timeout = setTimeout(() => {
          setVisible(false);
          onComplete?.();
        }, 500);
        return () => clearTimeout(timeout);
      }
    }, 30);

    return () => clearInterval(interval);
  }, [minDurationMs, onComplete]);

  if (!visible) return null;

  const statusText =
    progress < 25
      ? 'Calibrating JSN-SR04T ultrasonic datum (100.0 cm)...'
      : progress < 55
      ? 'Synchronizing Phase G3 flood telemetry...'
      : progress < 85
      ? 'Tracing safe evacuation foot corridors to FCPC...'
      : 'EWS armed and ready.';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-0 z-50 flex flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-blue-950 via-[#0a2558] to-[#041436] text-white transition-opacity duration-500 ${
        fading ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Background Animated Water Wave Layer */}
      <div className="absolute inset-x-0 bottom-0 pointer-events-none h-64 overflow-hidden opacity-30">
        <svg
          className="water-wave-bg absolute bottom-0 w-[200%] h-48 text-blue-500 fill-current animate-wave-slow"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
        >
          <path d="M0,0 C150,90 350,-40 500,40 C650,120 900,10 1200,40 L1200,120 L0,120 Z" />
        </svg>
        <svg
          className="water-wave-bg absolute bottom-0 w-[200%] h-40 text-blue-400 fill-current animate-wave-fast opacity-60"
          viewBox="0 0 1200 120"
          preserveAspectRatio="none"
        >
          <path d="M0,20 C200,80 400,-10 600,50 C800,110 1000,20 1200,50 L1200,120 L0,120 Z" />
        </svg>
      </div>

      {/* Floating Bubbles */}
      <div className="water-bubble b1" />
      <div className="water-bubble b2" />
      <div className="water-bubble b3" />
      <div className="water-bubble b4" />

      {/* Central Card with Water Ripple and Logo */}
      <div className="relative z-10 flex flex-col items-center max-w-sm px-6 text-center">
        {/* Rippling Water Rings Behind Logo */}
        <div className="relative flex items-center justify-center w-36 h-36 mb-6">
          <div className="water-ripple ring-1" />
          <div className="water-ripple ring-2" />
          <div className="water-ripple ring-3" />

          {/* Logo Container with Circular Liquid Glow */}
          <div className="relative z-10 p-2.5 rounded-full bg-white/10 backdrop-blur-md border border-white/20 shadow-2xl shadow-blue-500/30 animate-water-float">
            <img
              src="/logo.png"
              alt="Whaze Flood Early Warning System"
              className="w-24 h-24 object-contain rounded-full drop-shadow-md"
            />
          </div>
        </div>

        {/* Branding Typography */}
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl bg-clip-text text-transparent bg-gradient-to-r from-blue-200 via-white to-cyan-200">
          Whaze
        </h1>
        <p className="mt-1 text-sm font-medium text-blue-200/90">
          Community &amp; Evacuation Leading
        </p>
        <p className="text-xs text-blue-300/70 mt-0.5">
          Brgy. Narra &amp; Yakal • CSJDM, Bulacan
        </p>

        {/* Liquid Progress Bar */}
        <div className="w-64 mt-8">
          <div className="relative h-3 w-full rounded-full bg-blue-950/80 border border-blue-400/30 overflow-hidden shadow-inner">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-blue-400 to-blue-300 relative transition-all duration-150 ease-out shadow-lg shadow-cyan-500/50"
              style={{ width: `${progress}%` }}
            >
              {/* Shimmer light effect inside the progress fill */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-shimmer" />
            </div>
          </div>

          <div className="flex justify-between items-center mt-2 text-xs font-mono text-blue-300/80">
            <span>{progress}%</span>
            <span>JSN-SR04T IoT</span>
          </div>
        </div>

        {/* Telemetry Readiness Subtitle */}
        <p className="mt-4 text-xs font-mono text-cyan-200/80 min-h-[20px] transition-all">
          {statusText}
        </p>

        {/* Optional Skip button */}
        <button
          type="button"
          onClick={() => {
            setFading(true);
            setTimeout(() => {
              setVisible(false);
              onComplete?.();
            }, 300);
          }}
          className="mt-6 text-[11px] font-medium tracking-wide text-blue-300/60 hover:text-white uppercase transition-colors"
        >
          Tap to enter &rarr;
        </button>
      </div>
    </div>
  );
}
