import { describe, expect, it, vi } from 'vitest';
import {
  compareSemver,
  checkForGithubUpdate,
  downloadAndReinstallUpdate,
  type BuildInfo,
} from './updater';

describe('compareSemver', () => {
  it('compares major, minor, and patch versions accurately', () => {
    expect(compareSemver('2.0.0', '2.0.0')).toBe(0);
    expect(compareSemver('v2.1.0', '2.0.0')).toBe(1);
    expect(compareSemver('2.0.1', 'v2.0.0')).toBe(1);
    expect(compareSemver('1.9.9', '2.0.0')).toBe(-1);
    expect(compareSemver('3.0.0-beta.1', '2.5.0')).toBe(1);
  });
});

describe('checkForGithubUpdate', () => {
  const currentBuild: BuildInfo = {
    version: '2.0.0',
    commitSha: 'ba17e5e',
    repoOwner: 'Patkik',
    repoName: 'whaze-iot-flood-monitor',
  };

  it('detects a newer GitHub Release and extracts its APK asset URL', async () => {
    const mockFetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        tag_name: 'v2.1.0',
        name: 'Whaze v2.1.0',
        body: 'Improved flood telemetry and auto-updater.',
        published_at: '2026-10-17T14:00:00Z',
        html_url: 'https://github.com/Patkik/whaze-iot-flood-monitor/releases/tag/v2.1.0',
        assets: [
          {
            name: 'whaze-flood-ews.apk',
            browser_download_url:
              'https://github.com/Patkik/whaze-iot-flood-monitor/releases/download/v2.1.0/whaze-flood-ews.apk',
            size: 4500000,
          },
        ],
      }),
    });

    const info = await checkForGithubUpdate(currentBuild, mockFetch as unknown as typeof fetch);

    expect(info.available).toBe(true);
    expect(info.source).toBe('release');
    expect(info.latestVersion).toBe('2.1.0');
    expect(info.apkUrl).toBe(
      'https://github.com/Patkik/whaze-iot-flood-monitor/releases/download/v2.1.0/whaze-flood-ews.apk',
    );
    expect(info.notes).toContain('Improved flood telemetry');
  });

  it('falls back to main branch package.json + commit SHA when no GitHub Release exists', async () => {
    const mockFetch = vi
      .fn()
      // 1. /releases/latest returns 404
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      })
      // 2. raw package.json on main
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ version: '2.0.0' }),
      })
      // 3. /commits/main returns a newer commit SHA
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sha: '99f88a77b66c55d44e33f22a11b00c99d88e77f6',
          html_url: 'https://github.com/Patkik/whaze-iot-flood-monitor/commit/99f88a7',
          commit: {
            message: 'feat(apk): rebuild latest Android package',
            committer: { date: '2026-10-17T15:00:00Z' },
          },
        }),
      });

    const info = await checkForGithubUpdate(currentBuild, mockFetch as unknown as typeof fetch);

    expect(info.available).toBe(true);
    expect(info.source).toBe('main-branch');
    expect(info.latestCommitSha).toBe('99f88a7');
    expect(info.apkUrl).toBe(
      'https://raw.githubusercontent.com/Patkik/whaze-iot-flood-monitor/main/whaze-flood-ews.apk',
    );
    expect(info.notes).toBe('feat(apk): rebuild latest Android package');
  });

  it('reports up-to-date when main branch version and commit SHA match current build', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ message: 'Not Found' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ version: '2.0.0' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'ba17e5e6d887ae39bb30856b2f9d309ae63dc218',
          html_url: 'https://github.com/Patkik/whaze-iot-flood-monitor/commit/ba17e5e',
          commit: {
            message: 'feat(routing): activate flood radius avoidance conditionally at warning levels',
            committer: { date: '2026-10-17T12:00:00Z' },
          },
        }),
      });

    const info = await checkForGithubUpdate(currentBuild, mockFetch as unknown as typeof fetch);

    expect(info.available).toBe(false);
    expect(info.latestVersion).toBe('2.0.0');
    expect(info.latestCommitSha).toBe('ba17e5e');
  });
});

describe('downloadAndReinstallUpdate', () => {
  it('invokes native Capacitor installer when running on Android native platform', async () => {
    const progressEvents: number[] = [];
    const nativeInstaller = vi.fn().mockImplementation(async ({ onProgress }) => {
      onProgress({ downloadedBytes: 2500000, totalBytes: 5000000, percent: 50, phase: 'downloading' });
      onProgress({ downloadedBytes: 5000000, totalBytes: 5000000, percent: 100, phase: 'installing' });
      return { installed: true, method: 'native-apk' as const };
    });

    const res = await downloadAndReinstallUpdate({
      apkUrl: 'https://raw.githubusercontent.com/Patkik/whaze-iot-flood-monitor/main/whaze-flood-ews.apk',
      version: '2.1.0',
      commitSha: '99f88a7',
      isNative: true,
      nativeInstallFn: nativeInstaller,
      onProgress: (p) => progressEvents.push(p.percent),
    });

    expect(nativeInstaller).toHaveBeenCalledTimes(1);
    expect(progressEvents).toEqual([50, 100]);
    expect(res.method).toBe('native-apk');
  });
});
