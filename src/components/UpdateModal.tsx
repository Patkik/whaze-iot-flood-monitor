import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { Icon } from './ui';
import {
  getCurrentBuildInfo,
  runUpdateCheck,
  startSystemUpdate,
  updaterStore,
} from '../lib/updater';

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0.0 MB';
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function UpdateBanner() {
  const u = updaterStore.use();

  if (u.status !== 'available' || u.bannerDismissed || !u.result) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="System update available"
      className="border-b border-blue-200 bg-brand-tint/80"
    >
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <div className="flex items-center gap-2.5 text-[13px]">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand text-white">
            <Icon name="download" size={13} />
          </span>
          <div>
            <span className="font-semibold text-ink">
              Update available ({u.result.latestVersion} · {u.result.latestCommitSha})
            </span>
            <span className="ml-2 text-muted">{u.result.notes}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-primary !min-h-8 !px-3 text-xs"
            onClick={() => void startSystemUpdate()}
          >
            <Icon name="download" size={14} /> Update & reinstall
          </button>
          <button
            className="btn-quiet !min-h-8 !px-2.5 text-xs"
            onClick={() => updaterStore.set({ ...u, modalOpen: true })}
          >
            Details
          </button>
          <button
            className="btn-quiet !min-h-8 !px-2 text-xs"
            onClick={() => updaterStore.set({ ...u, bannerDismissed: true })}
            aria-label="Dismiss update banner"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function UpdateModal() {
  const u = updaterStore.use();
  const build = getCurrentBuildInfo();
  const isNative = Capacitor.isNativePlatform();
  const isBusy = u.status === 'downloading' || u.status === 'installing';

  useEffect(() => {
    if (!u.modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isBusy) {
        updaterStore.set({ ...updaterStore.get(), modalOpen: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [u.modalOpen, isBusy]);

  if (!u.modalOpen) return null;

  const close = () => {
    if (isBusy) return;
    updaterStore.set({ ...u, modalOpen: false });
  };

  const res = u.result;
  const pct = u.progress?.percent ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-ink/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-modal-title"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">GitHub OTA Updater</p>
            <h2 id="update-modal-title" className="mt-1 text-lg font-semibold text-ink">
              System Update & Reinstall
            </h2>
          </div>
          <button
            className="btn-quiet !min-h-9 !px-2.5"
            onClick={close}
            disabled={isBusy}
            aria-label="Close update dialog"
          >
            <Icon name="close" size={16} />
          </button>
        </div>

        {/* Version comparison card */}
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-bg p-3 text-xs">
          <div>
            <p className="eyebrow">Installed build</p>
            <p className="tnum mt-1 font-mono text-sm font-semibold text-ink">
              v{res?.currentVersion ?? build.version}
            </p>
            <p className="tnum font-mono text-[11px] text-faint">
              SHA {res?.currentCommitSha ?? build.commitSha}
            </p>
          </div>
          <div>
            <p className="eyebrow">
              {res?.source === 'release' ? 'GitHub Release' : 'GitHub main'}
            </p>
            <p className="tnum mt-1 font-mono text-sm font-semibold text-brand">
              {u.status === 'checking'
                ? 'Checking…'
                : `v${res?.latestVersion ?? build.version}`}
            </p>
            <p className="tnum font-mono text-[11px] text-faint">
              {u.status === 'checking'
                ? 'Fetching metadata'
                : `SHA ${res?.latestCommitSha ?? build.commitSha}`}
            </p>
          </div>
        </div>

        {/* Status & release notes */}
        <div className="mt-3 space-y-2 text-[13px]">
          {u.status === 'checking' && (
            <div className="flex items-center gap-2 rounded-lg border border-line px-3 py-2.5 text-muted">
              <Icon name="refresh" size={16} className="animate-spin text-brand" />
              <span>Checking Patkik/whaze-iot-flood-monitor on GitHub…</span>
            </div>
          )}

          {u.status === 'available' && res && (
            <div className="rounded-lg border border-blue-200 bg-brand-tint/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-brand">New update available</span>
                <span className="rounded-full bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">
                  {res.source === 'release' ? 'Release APK' : 'Main branch APK'}
                </span>
              </div>
              <p className="mt-1 text-muted">{res.notes}</p>
            </div>
          )}

          {u.status === 'up-to-date' && res && (
            <div className="rounded-lg border border-green-200 bg-safe-tint p-3">
              <div className="flex items-center gap-2 font-semibold text-safe">
                <Icon name="check" size={16} />
                <span>You are on the latest version</span>
              </div>
              <p className="mt-1 text-xs text-muted">
                Latest commit: <span className="font-mono">{res.latestCommitSha}</span> — {res.notes}
              </p>
            </div>
          )}

          {(u.status === 'downloading' || u.status === 'installing' || u.status === 'completed') && (
            <div className="space-y-2 rounded-lg border border-line p-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="text-ink">
                  {u.status === 'downloading'
                    ? 'Downloading APK from GitHub…'
                    : u.status === 'installing'
                      ? isNative
                        ? 'Launching Android package installer…'
                        : 'Preparing package & refreshing cache…'
                      : isNative
                        ? 'Android installer launched — confirm reinstall prompt'
                        : 'Update downloaded & app cache refreshed'}
                </span>
                <span className="tnum font-mono font-semibold text-brand">{pct}%</span>
              </div>
              <div
                className="h-2.5 w-full overflow-hidden rounded-full bg-line"
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200"
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>
              {u.progress && u.progress.downloadedBytes > 0 && (
                <p className="tnum font-mono text-[11px] text-faint">
                  {formatBytes(u.progress.downloadedBytes)}
                  {u.progress.totalBytes > 0 ? ` / ${formatBytes(u.progress.totalBytes)}` : ''}
                </p>
              )}
            </div>
          )}

          {u.status === 'error' && (
            <div className="rounded-lg border border-red-200 bg-crit-tint p-3 text-crit" role="alert">
              <p className="font-semibold">Update failed</p>
              <p className="mt-0.5 text-xs">{u.error}</p>
            </div>
          )}
        </div>

        {/* Footer metadata + actions */}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-[11px] text-faint">
            {u.lastCheckedAt ? `Checked at ${u.lastCheckedAt}` : 'Source: GitHub main / Releases'}
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-quiet !min-h-10 text-xs"
              disabled={isBusy || u.status === 'checking'}
              onClick={() => void runUpdateCheck({ openModal: true })}
            >
              <Icon name="refresh" size={14} /> Check again
            </button>

            {u.status === 'completed' && !isNative ? (
              <button
                className="btn-primary !min-h-10 text-xs"
                onClick={() => window.location.reload()}
              >
                <Icon name="refresh" size={14} /> Reload app now
              </button>
            ) : (
              <button
                className="btn-primary !min-h-10 text-xs"
                disabled={isBusy || u.status === 'checking'}
                onClick={() => void startSystemUpdate()}
              >
                <Icon name="download" size={14} />{' '}
                {u.status === 'available' ? 'Update & Reinstall' : 'Download & Reinstall APK'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
