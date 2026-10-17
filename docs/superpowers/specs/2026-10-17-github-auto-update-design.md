# GitHub Auto-Update & Reinstall Subsystem Design

**Date:** 2026-10-17
**Repository:** `Patkik/whaze-iot-flood-monitor`
**App ID:** `com.whaze.floodevactracker`

## 1. Overview
Provides an in-app system update feature that checks GitHub (`Patkik/whaze-iot-flood-monitor`) for newer releases or main-branch builds, downloads the update with real-time byte/percentage progress, and automatically triggers app reinstallation once downloading completes.

## 2. Update Detection (`src/lib/updater.ts`)
1. **Current Build Metadata:**
   - Current semantic version (`APP_VERSION`, e.g., `2.0.0` from `package.json`) and build commit SHA (`APP_COMMIT_SHA`) are injected via Vite `define` in `vite.config.ts` (with runtime overrides stored in `localStorage` under `whaze.updater.installed` after an update completes so re-checks recognize the newly installed version/commit).
2. **Resolution Strategy (`checkForGithubUpdate`):**
   - **Step 1 — GitHub Releases API:** `GET https://api.github.com/repos/Patkik/whaze-iot-flood-monitor/releases/latest`
     - Extracts `tag_name` (normalized semver), `name`, `body` (release notes), `published_at`, and looks for an `.apk` asset in `assets[]` (falling back to `https://raw.githubusercontent.com/Patkik/whaze-iot-flood-monitor/main/whaze-flood-ews.apk` if no `.apk` asset is attached).
     - Marks `available = true` if `compareSemver(releaseVersion, currentVersion) > 0`.
   - **Step 2 — Main Branch Fallback:** If `/releases/latest` returns 404 (no releases published yet) or is not newer, queries:
     - `GET https://raw.githubusercontent.com/Patkik/whaze-iot-flood-monitor/main/package.json`
     - `GET https://api.github.com/repos/Patkik/whaze-iot-flood-monitor/commits/main`
     - Marks `available = true` if `compareSemver(remotePkg.version, currentVersion) > 0` OR if `latestCommit.sha` differs from the installed commit SHA (when commit SHA tracking is active).
     - Uses `https://raw.githubusercontent.com/Patkik/whaze-iot-flood-monitor/main/whaze-flood-ews.apk` as the APK download URL.

## 3. Download & Automatic Reinstallation (`downloadAndReinstallUpdate`)
- **Native Android (`Capacitor.isNativePlatform() === true`):**
  - Calls custom Capacitor plugin `AppUpdater.downloadAndInstall({ url, fileName: 'whaze-flood-ews.apk' })`.
  - Streams the APK over HTTPS on a background thread into `new File(getContext().getCacheDir(), "updates/whaze-flood-ews.apk")`.
  - Emits `downloadProgress` events (`{ downloadedBytes, totalBytes, percent, phase }`) every ~100ms to the React UI.
  - Verifies the downloaded file exists, is non-empty, and starts with ZIP/APK magic bytes (`PK\x03\x04`).
  - Checks `PackageManager.canRequestPackageInstalls()` on Android 8.0+ (API 26+):
    - If not yet granted, saves the pending APK file reference, opens `Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES` for `package:com.whaze.floodevactracker`, and automatically launches the package installer inside `handleOnResume()` as soon as the user returns.
    - Launches `Intent.ACTION_VIEW` with `FileProvider.getUriForFile(...)`, MIME type `application/vnd.android.package-archive`, `FLAG_GRANT_READ_URI_PERMISSION`, and `FLAG_ACTIVITY_NEW_TASK`.
- **Web / PWA Fallback (`Capacitor.isNativePlatform() === false`):**
  - Streams the APK from GitHub via `fetch()` + `ReadableStream` to report real-time byte progress (`0% – 100%`).
  - Triggers browser download of `whaze-flood-ews.apk` so Android mobile browser users can immediately tap/open to reinstall the APK.
  - Unregisters/updates the PWA Service Worker and caches, persists the installed version/commit stamp, and reloads the web application.

## 4. UI Components (`src/components/UpdateModal.tsx` & `src/components/Shell.tsx`)
- **Auto-Check on Startup:** Runs once on mount when `navigator.onLine` is true.
- **Top Bar & Sidebar Controls:** Adds a "System update" button in `Shell.tsx` (with an indicator badge when an update is available).
- **Interactive Update Banner & Modal:**
  - Displays current version/commit vs. remote GitHub version/commit, release notes / commit summary, and source (`GitHub Release` or `GitHub main branch`).
  - Provides **Update & Reinstall** action (plus **Reinstall latest APK** option even when already on the latest version, so users can force-reinstall anytime).
  - Shows a live progress bar (`0% – 100%`), transfer size (`MB / MB`), and clear status messages (`Checking GitHub…`, `Downloading update…`, `Launching Android installer…`, `Error` with retry).
