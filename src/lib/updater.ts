import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { createStore } from './createStore';

declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT_SHA__: string | undefined;

export interface BuildInfo {
  version: string;
  commitSha: string;
  repoOwner: string;
  repoName: string;
}

export interface UpdateCheckResult {
  available: boolean;
  source: 'release' | 'main-branch';
  currentVersion: string;
  currentCommitSha: string;
  latestVersion: string;
  latestCommitSha: string;
  apkUrl: string;
  releaseUrl: string;
  publishedAt?: string;
  notes: string;
}

export interface DownloadProgress {
  downloadedBytes: number;
  totalBytes: number;
  percent: number;
  phase: 'downloading' | 'installing' | 'completed';
}

export interface AppUpdaterNativePlugin {
  downloadAndInstall(options: { url: string; fileName?: string }): Promise<{
    installed: boolean;
    needsPermission?: boolean;
    filePath?: string;
  }>;
  getAppInfo(): Promise<{
    versionName: string;
    versionCode: number;
    canInstallPackages: boolean;
  }>;
  addListener(
    eventName: 'downloadProgress',
    listenerFunc: (progress: DownloadProgress) => void,
  ): Promise<PluginListenerHandle>;
}

export const AppUpdater = registerPlugin<AppUpdaterNativePlugin>('AppUpdater');

const INSTALLED_STORAGE_KEY = 'whaze.updater.installed.v1';

export interface InstalledStamp {
  version: string;
  commitSha: string;
  installedAt: string;
}

export function getInstalledStamp(): InstalledStamp | null {
  try {
    const raw = localStorage.getItem(INSTALLED_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as InstalledStamp) : null;
  } catch {
    return null;
  }
}

export function saveInstalledStamp(version: string, commitSha: string): void {
  try {
    localStorage.setItem(
      INSTALLED_STORAGE_KEY,
      JSON.stringify({
        version,
        commitSha,
        installedAt: new Date().toISOString(),
      } satisfies InstalledStamp),
    );
  } catch {
    // ignore storage errors
  }
}

export function getCurrentBuildInfo(): BuildInfo {
  const buildVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '2.0.0';
  const buildSha = typeof __APP_COMMIT_SHA__ !== 'undefined' ? __APP_COMMIT_SHA__ : 'ba17e5e';
  const stamp = getInstalledStamp();

  // If localStorage has a newer version or a recorded commit from a recent update on top of the same base version, use it
  const useStamp =
    stamp &&
    (compareSemver(stamp.version, buildVersion) > 0 ||
      (compareSemver(stamp.version, buildVersion) === 0 && Boolean(stamp.commitSha)));

  return {
    version: useStamp ? stamp.version : buildVersion,
    commitSha: useStamp ? stamp.commitSha : buildSha,
    repoOwner: 'Patkik',
    repoName: 'whaze-iot-flood-monitor',
  };
}

/**
 * Compares two semantic version strings (e.g. "v2.1.0" vs "2.0.0").
 * Returns 1 if a > b, -1 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const clean = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => parseInt(n, 10) || 0);

  const pa = clean(a);
  const pb = clean(b);
  const len = Math.max(pa.length, pb.length, 3);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * Checks GitHub for an update:
 * 1. Checks GitHub Releases (/releases/latest) first.
 * 2. Falls back to the main branch (package.json + commits/main) and raw whaze-flood-ews.apk.
 */
export async function checkForGithubUpdate(
  build: BuildInfo = getCurrentBuildInfo(),
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const { repoOwner, repoName, version: currentVersion, commitSha: currentCommitSha } = build;
  const fallbackApkUrl = `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/whaze-flood-ews.apk`;
  const headers: HeadersInit = { Accept: 'application/vnd.github+json' };

  // 1. Check latest GitHub Release first
  try {
    const relRes = await fetchImpl(
      `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`,
      { headers, cache: 'no-store' },
    );

    if (relRes.ok) {
      const rel = await relRes.json();
      const rawTag = String(rel.tag_name || rel.name || currentVersion);
      const latestVersion = rawTag.replace(/^v/i, '').trim() || currentVersion;
      const apkAsset = Array.isArray(rel.assets)
        ? rel.assets.find((a: { name?: string; browser_download_url?: string }) =>
            String(a?.name || '')
              .toLowerCase()
              .endsWith('.apk'),
          )
        : undefined;

      const cmp = compareSemver(latestVersion, currentVersion);
      if (cmp > 0) {
        return {
          available: true,
          source: 'release',
          currentVersion,
          currentCommitSha,
          latestVersion,
          latestCommitSha: rawTag,
          apkUrl: apkAsset?.browser_download_url || fallbackApkUrl,
          releaseUrl:
            rel.html_url || `https://github.com/${repoOwner}/${repoName}/releases/latest`,
          publishedAt: rel.published_at,
          notes: String(rel.body || rel.name || `Release ${rawTag}`).trim(),
        };
      }
    }
  } catch {
    // Fall through to main branch check if releases endpoint fails
  }

  // 2. Fallback to main branch package.json + latest commit SHA
  const cacheBuster = `?t=${Date.now()}`;
  const [pkgRes, commitRes] = await Promise.all([
    fetchImpl(
      `https://raw.githubusercontent.com/${repoOwner}/${repoName}/main/package.json${cacheBuster}`,
      { cache: 'no-store' },
    ),
    fetchImpl(`https://api.github.com/repos/${repoOwner}/${repoName}/commits/main`, {
      headers,
      cache: 'no-store',
    }),
  ]);

  let remoteVersion = currentVersion;
  if (pkgRes.ok) {
    try {
      const pkg = await pkgRes.json();
      if (pkg?.version) remoteVersion = String(pkg.version).trim();
    } catch {
      // ignore malformed json
    }
  }

  let latestCommitSha = currentCommitSha;
  let commitMessage = 'Latest build on main branch';
  let publishedAt: string | undefined;
  let releaseUrl = `https://github.com/${repoOwner}/${repoName}`;

  if (commitRes.ok) {
    try {
      const commitData = await commitRes.json();
      if (commitData?.sha) {
        latestCommitSha = String(commitData.sha).slice(0, 7);
      }
      if (commitData?.commit?.message) {
        commitMessage = String(commitData.commit.message).split('\n')[0].trim();
      }
      if (commitData?.commit?.committer?.date) {
        publishedAt = String(commitData.commit.committer.date);
      }
      if (commitData?.html_url) {
        releaseUrl = String(commitData.html_url);
      }
    } catch {
      // ignore commit parse error
    }
  } else if (!pkgRes.ok) {
    throw new Error('Could not reach GitHub to check for updates. Check your internet connection.');
  }

  const isVersionNewer = compareSemver(remoteVersion, currentVersion) > 0;
  const isCommitNewer =
    Boolean(latestCommitSha) &&
    Boolean(currentCommitSha) &&
    !latestCommitSha.startsWith(currentCommitSha.slice(0, 7)) &&
    !currentCommitSha.startsWith(latestCommitSha.slice(0, 7));

  return {
    available: isVersionNewer || isCommitNewer,
    source: 'main-branch',
    currentVersion,
    currentCommitSha,
    latestVersion: remoteVersion,
    latestCommitSha,
    apkUrl: fallbackApkUrl,
    releaseUrl,
    publishedAt,
    notes: commitMessage,
  };
}

export interface DownloadAndInstallOptions {
  apkUrl: string;
  version: string;
  commitSha: string;
  isNative?: boolean;
  onProgress?: (progress: DownloadProgress) => void;
  nativeInstallFn?: (opts: {
    apkUrl: string;
    onProgress: (p: DownloadProgress) => void;
  }) => Promise<{ installed: boolean; method: 'native-apk' | 'web-apk-and-reload' }>;
}

async function defaultNativeInstall({
  apkUrl,
  onProgress,
}: {
  apkUrl: string;
  onProgress: (p: DownloadProgress) => void;
}): Promise<{ installed: boolean; method: 'native-apk' }> {
  let listener: PluginListenerHandle | null = null;
  try {
    listener = await AppUpdater.addListener('downloadProgress', (prog) => {
      onProgress(prog);
    });
    const cacheBustUrl = apkUrl.includes('?')
      ? `${apkUrl}&t=${Date.now()}`
      : `${apkUrl}?t=${Date.now()}`;
    await AppUpdater.downloadAndInstall({
      url: cacheBustUrl,
      fileName: 'whaze-flood-ews.apk',
    });
    return { installed: true, method: 'native-apk' };
  } finally {
    if (listener) {
      await listener.remove();
    }
  }
}

async function webDownloadAndReinstall({
  apkUrl,
  onProgress,
}: {
  apkUrl: string;
  onProgress: (p: DownloadProgress) => void;
}): Promise<{ installed: boolean; method: 'web-apk-and-reload' }> {
  const cacheBustUrl = apkUrl.includes('?')
    ? `${apkUrl}&t=${Date.now()}`
    : `${apkUrl}?t=${Date.now()}`;

  onProgress({ downloadedBytes: 0, totalBytes: 0, percent: 5, phase: 'downloading' });

  const response = await fetch(cacheBustUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to download update package (HTTP ${response.status})`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        const pct =
          contentLength > 0
            ? Math.min(99, Math.round((received / contentLength) * 100))
            : Math.min(95, Math.round(15 + (received / (4.5 * 1024 * 1024)) * 80));
        onProgress({
          downloadedBytes: received,
          totalBytes: contentLength || received,
          percent: pct,
          phase: 'downloading',
        });
      }
    }
  } else {
    const buf = new Uint8Array(await response.arrayBuffer());
    chunks.push(buf);
    received = buf.byteLength;
  }

  onProgress({
    downloadedBytes: received,
    totalBytes: contentLength || received,
    percent: 100,
    phase: 'installing',
  });

  // Trigger browser APK download so Android browser users can tap to reinstall
  const blob = new Blob(chunks as BlobPart[], {
    type: 'application/vnd.android.package-archive',
  });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = 'whaze-flood-ews.apk';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);

  // Also refresh PWA service worker & caches so web assets update immediately
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.update()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.includes('osm-tiles')).map((k) => caches.delete(k)),
      );
    }
  } catch {
    // ignore SW cleanup errors
  }

  onProgress({
    downloadedBytes: received,
    totalBytes: contentLength || received,
    percent: 100,
    phase: 'completed',
  });

  return { installed: true, method: 'web-apk-and-reload' };
}

/**
 * Downloads the latest APK from GitHub with live progress reporting and triggers reinstallation.
 */
export async function downloadAndReinstallUpdate(
  options: DownloadAndInstallOptions,
): Promise<{ installed: boolean; method: 'native-apk' | 'web-apk-and-reload' }> {
  const isNative = options.isNative ?? Capacitor.isNativePlatform();
  const onProgress = options.onProgress ?? (() => {});

  const result = isNative
    ? await (options.nativeInstallFn ?? defaultNativeInstall)({
        apkUrl: options.apkUrl,
        onProgress,
      })
    : await webDownloadAndReinstall({
        apkUrl: options.apkUrl,
        onProgress,
      });

  saveInstalledStamp(options.version, options.commitSha);
  return result;
}

export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'downloading' | 'installing' | 'completed' | 'error';
  modalOpen: boolean;
  bannerDismissed: boolean;
  result: UpdateCheckResult | null;
  progress: DownloadProgress | null;
  error: string | null;
  lastCheckedAt: string | null;
}

export const updaterStore = createStore<UpdaterState>('whaze.updater.state.v1', {
  status: 'idle',
  modalOpen: false,
  bannerDismissed: false,
  result: null,
  progress: null,
  error: null,
  lastCheckedAt: null,
});

export async function runUpdateCheck(opts?: { openModal?: boolean }): Promise<UpdateCheckResult | null> {
  const prev = updaterStore.get();
  updaterStore.set({
    ...prev,
    status: 'checking',
    modalOpen: opts?.openModal ?? prev.modalOpen,
    error: null,
  });

  try {
    const res = await checkForGithubUpdate();
    updaterStore.set({
      ...updaterStore.get(),
      status: res.available ? 'available' : 'up-to-date',
      bannerDismissed: res.available ? false : updaterStore.get().bannerDismissed,
      result: res,
      error: null,
      lastCheckedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
    return res;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to check GitHub for updates.';
    updaterStore.set({
      ...updaterStore.get(),
      status: 'error',
      error: message,
    });
    return null;
  }
}

export async function startSystemUpdate(): Promise<void> {
  const state = updaterStore.get();
  const build = getCurrentBuildInfo();
  const target = state.result ?? {
    available: true,
    source: 'main-branch' as const,
    currentVersion: build.version,
    currentCommitSha: build.commitSha,
    latestVersion: build.version,
    latestCommitSha: build.commitSha,
    apkUrl: `https://raw.githubusercontent.com/${build.repoOwner}/${build.repoName}/main/whaze-flood-ews.apk`,
    releaseUrl: `https://github.com/${build.repoOwner}/${build.repoName}`,
    notes: 'Reinstalling latest package from GitHub',
  };

  updaterStore.set({
    ...state,
    status: 'downloading',
    modalOpen: true,
    error: null,
    progress: { downloadedBytes: 0, totalBytes: 0, percent: 0, phase: 'downloading' },
  });

  try {
    await downloadAndReinstallUpdate({
      apkUrl: target.apkUrl,
      version: target.latestVersion,
      commitSha: target.latestCommitSha,
      onProgress: (progress) => {
        updaterStore.set({
          ...updaterStore.get(),
          status:
            progress.phase === 'installing'
              ? 'installing'
              : progress.phase === 'completed'
                ? 'completed'
                : 'downloading',
          progress,
        });
      },
    });

    updaterStore.set({
      ...updaterStore.get(),
      status: 'completed',
      result: {
        ...target,
        available: false,
        currentVersion: target.latestVersion,
        currentCommitSha: target.latestCommitSha,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update download failed. Please try again.';
    updaterStore.set({
      ...updaterStore.get(),
      status: 'error',
      error: message,
    });
  }
}
