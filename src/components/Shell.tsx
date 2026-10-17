import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link } from 'react-router-dom';
import { Icon, LevelBadge } from './ui';
import { alerts, telemetry } from '../lib/stores';
import { playCriticalMusic, stopCriticalMusic } from '../lib/audio';
import WaterLoadingScreen from './WaterLoadingScreen';
import { UpdateBanner, UpdateModal } from './UpdateModal';
import { getCurrentBuildInfo, runUpdateCheck, updaterStore } from '../lib/updater';
import {
  getPlatformCapabilities,
  locationStore,
  startGpsWatch,
  syncNativePermissions,
} from '../lib/platform';

const NAV = [
  { to: '/', label: 'Monitor', icon: 'pulse' },
  { to: '/evacuate', label: 'Evacuate', icon: 'map' },
  { to: '/emergency', label: 'Emergency', icon: 'shield' },
  { to: '/reports', label: 'Reports', icon: 'chat' },
] as const;

function ModePill() {
  const t = telemetry.use();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  const mode = !online && t.mode === 'Simulated Mode' ? 'Offline Cached' : t.mode;
  const dot = mode === 'ESP32 Live' ? 'bg-safe' : mode === 'Offline Cached' ? 'bg-faint' : 'bg-amber-500';
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-muted">
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {mode}
    </span>
  );
}

function AlertsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = alerts.use();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="Alert log">
      <div className="flex h-full w-full max-w-sm flex-col bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h2 className="text-[15px] font-semibold">Alert log</h2>
            <p className="text-xs text-faint">Stored on this device, works offline</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-quiet !min-h-9 !px-3 text-xs" onClick={() => alerts.set([])}>Clear</button>
            <button className="btn-quiet !min-h-9 !px-2.5" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
          </div>
        </div>
        <ul className="flex-1 space-y-2 overflow-y-auto p-4">
          {list.length === 0 && <li className="py-10 text-center text-sm text-faint">No alerts recorded.</li>}
          {list.map((a) => (
            <li key={a.id} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between gap-2">
                <LevelBadge level={a.level} />
                <span className="tnum font-mono text-xs text-faint">{a.time}</span>
              </div>
              <p className="mt-2 text-sm font-semibold">{a.title}</p>
              <p className="text-[13px] text-muted">{a.message}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Shell() {
  const t = telemetry.use();
  const list = alerts.use();
  const u = updaterStore.use();
  const build = getCurrentBuildInfo();
  const caps = getPlatformCapabilities();
  const [open, setOpen] = useState(false);
  const [showSplash, setShowSplash] = useState(() => !sessionStorage.getItem('whaze_water_splash_seen'));

  // Sync permissions and only auto-check GitHub APK updates on the Android mobile app.
  useEffect(() => {
    void syncNativePermissions();
    if (locationStore.get().trackMyLocation) {
      startGpsWatch();
    }
    if (caps.autoCheckGithubCommits && navigator.onLine) {
      void runUpdateCheck({ openModal: false });
    }
  }, [caps.autoCheckGithubCommits]);

  // Critical alert music when status is CRITICAL and not muted.
  useEffect(() => {
    if (t.status !== 'CRITICAL' || t.muted) {
      stopCriticalMusic();
      return;
    }
    const stop = playCriticalMusic();
    return () => {
      stop();
    };
  }, [t.status, t.muted]);

  const openUpdater = () => {
    if (!caps.showOtaUpdater) return;
    if (u.status === 'idle' || u.status === 'error') {
      void runUpdateCheck({ openModal: true });
    } else {
      updaterStore.set({ ...u, modalOpen: true });
    }
  };

  return (
    <div className="min-h-screen lg:pl-60">
      {/* Water-inspired splash/loading screen */}
      {showSplash && (
        <WaterLoadingScreen
          minDurationMs={2000}
          onComplete={() => {
            sessionStorage.setItem('whaze_water_splash_seen', '1');
            setShowSplash(false);
          }}
        />
      )}

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-line bg-surface p-4 lg:flex">
        <Link to="/" className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="Whaze" className="h-10 w-10 object-contain drop-shadow-sm" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold">Whaze</div>
            <div className="text-xs text-faint">Flood early warning</div>
          </div>
        </Link>
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium ${isActive ? 'bg-brand-tint text-brand' : 'text-muted hover:bg-bg'}`
              }
            >
              <Icon name={n.icon} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-2 text-xs text-faint">
          {caps.showOtaUpdater ? (
            <button
              type="button"
              onClick={openUpdater}
              className="flex w-full items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-left text-xs font-medium text-ink hover:border-brand"
            >
              <span className="flex items-center gap-2">
                <Icon name="download" size={14} className="text-brand" />
                <span>System update</span>
              </span>
              <span className="tnum font-mono text-[11px] text-faint">
                {u.status === 'available' ? (
                  <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    New
                  </span>
                ) : (
                  `v${build.version}`
                )}
              </span>
            </button>
          ) : (
            <div className="flex w-full items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-xs text-muted">
              <span className="flex items-center gap-2 font-medium text-ink">
                <Icon name="globe" size={14} className="text-brand" />
                <span>Web Live</span>
              </span>
              <span className="tnum font-mono text-[11px] text-faint">v{build.version}</span>
            </div>
          )}
          <ModePill />
          <p>Brgy. Narra and Brgy. Yakal, Francisco Homes, CSJDM, Bulacan</p>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:px-8">
        <Link to="/" className="flex items-center gap-2 lg:hidden">
          <img src="/logo.png" alt="Whaze" className="h-8 w-8 object-contain drop-shadow-sm" />
          <span className="text-[15px] font-semibold">Whaze</span>
        </Link>
        <div className="hidden text-sm text-muted lg:block">Brgy. Narra and Yakal, CSJDM</div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:block lg:hidden"><ModePill /></span>
          {caps.showOtaUpdater ? (
            <button
              className="btn-quiet relative !min-h-10 !px-2.5 text-xs"
              onClick={openUpdater}
              aria-label="Check for GitHub system updates"
            >
              <Icon name="download" size={16} />
              <span className="hidden sm:inline">Update</span>
              {u.status === 'available' && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-brand ring-2 ring-surface" />
              )}
            </button>
          ) : (
            <span className="hidden items-center gap-1.5 rounded-full border border-line bg-bg px-2.5 py-1 text-[11px] font-medium text-muted sm:inline-flex">
              <Icon name="globe" size={13} className="text-brand" />
              Web v{build.version}
            </span>
          )}
          <button className="btn-quiet relative !min-h-10 !px-2.5" onClick={() => setOpen(true)} aria-label={`Open alert log, ${list.length} entries`}>
            <Icon name="bell" />
            {list.length > 0 && (
              <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-brand px-1 text-[11px] font-semibold text-white">
                {list.length}
              </span>
            )}
          </button>
        </div>
      </header>

      {caps.showOtaUpdater && <UpdateBanner />}

      {t.status === 'CRITICAL' && (
        <div role="alert" className="sticky top-14 z-20 border-b border-red-200 bg-crit-tint">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <p className="text-sm font-semibold text-crit">
              Critical water level: <span className="tnum font-mono">{t.waterCm.toFixed(1)} cm</span>. Evacuate now.
            </p>
            <Link to="/evacuate" className="btn-danger !min-h-10 w-full sm:w-auto">View safe route to FCPC</Link>
          </div>
        </div>
      )}

      <main className="mx-auto w-full max-w-6xl px-4 pt-5 pb-28 lg:px-8 lg:pb-12">
        <Outlet />
      </main>

      {/* Mobile bottom tabs */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Primary">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-brand' : 'text-faint'}`
            }
          >
            <Icon name={n.icon} size={20} />
            {n.label}
          </NavLink>
        ))}
      </nav>

      <AlertsDrawer open={open} onClose={() => setOpen(false)} />
      {caps.showOtaUpdater && <UpdateModal />}
    </div>
  );
}
