package com.whaze.floodevactracker;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {

    private File pendingApkFile = null;

    @PluginMethod
    public void getAppInfo(PluginCall call) {
        try {
            PackageInfo pInfo = getContext()
                .getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);
            JSObject ret = new JSObject();
            ret.put("versionName", pInfo.versionName);
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? pInfo.getLongVersionCode()
                : pInfo.versionCode;
            ret.put("versionCode", versionCode);
            boolean canInstall = Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                || getContext().getPackageManager().canRequestPackageInstalls();
            ret.put("canInstallPackages", canInstall);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to read app info: " + e.getMessage());
        }
    }

    @PluginMethod
    public void downloadAndInstall(final PluginCall call) {
        final String urlStr = call.getString("url");
        final String fileName = call.getString("fileName", "whaze-flood-ews.apk");

        if (urlStr == null || urlStr.trim().isEmpty()) {
            call.reject("Download URL is required");
            return;
        }

        new Thread(() -> {
            HttpURLConnection connection = null;
            InputStream input = null;
            FileOutputStream output = null;
            try {
                File updateDir = new File(getContext().getCacheDir(), "updates");
                if (!updateDir.exists()) {
                    updateDir.mkdirs();
                }
                final File apkFile = new File(updateDir, fileName);
                if (apkFile.exists()) {
                    apkFile.delete();
                }

                URL url = new URL(urlStr);
                connection = (HttpURLConnection) url.openConnection();
                connection.setInstanceFollowRedirects(true);
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(30000);
                connection.setRequestProperty("User-Agent", "Whaze-Flood-EWS-Android-Updater/2.0");
                connection.connect();

                int responseCode = connection.getResponseCode();
                // Handle cross-protocol or GitHub raw redirects manually if needed
                int redirects = 0;
                while ((responseCode == HttpURLConnection.HTTP_MOVED_TEMP
                        || responseCode == HttpURLConnection.HTTP_MOVED_PERM
                        || responseCode == HttpURLConnection.HTTP_SEE_OTHER
                        || responseCode == 307
                        || responseCode == 308) && redirects < 5) {
                    String location = connection.getHeaderField("Location");
                    connection.disconnect();
                    url = new URL(location);
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(15000);
                    connection.setReadTimeout(30000);
                    connection.setRequestProperty("User-Agent", "Whaze-Flood-EWS-Android-Updater/2.0");
                    connection.connect();
                    responseCode = connection.getResponseCode();
                    redirects++;
                }

                if (responseCode != HttpURLConnection.HTTP_OK) {
                    call.reject("GitHub server returned HTTP " + responseCode);
                    return;
                }

                long totalBytes = connection.getContentLengthLong();
                input = new BufferedInputStream(connection.getInputStream());
                output = new FileOutputStream(apkFile);

                byte[] buffer = new byte[16 * 1024];
                long downloadedBytes = 0;
                int count;
                long lastEmit = 0;

                emitProgress(0, totalBytes > 0 ? totalBytes : 0, 2, "downloading");

                while ((count = input.read(buffer)) != -1) {
                    output.write(buffer, 0, count);
                    downloadedBytes += count;
                    long now = System.currentTimeMillis();
                    if (now - lastEmit >= 80) {
                        int percent = totalBytes > 0
                            ? (int) Math.min(99, (downloadedBytes * 100L) / totalBytes)
                            : (int) Math.min(95, 10 + (downloadedBytes / (50 * 1024)));
                        emitProgress(downloadedBytes, totalBytes > 0 ? totalBytes : downloadedBytes, percent, "downloading");
                        lastEmit = now;
                    }
                }
                output.flush();
                output.close();
                output = null;
                input.close();
                input = null;

                if (!isValidApkFile(apkFile)) {
                    apkFile.delete();
                    call.reject("Downloaded file is not a valid Android APK package.");
                    return;
                }

                emitProgress(downloadedBytes, downloadedBytes, 100, "installing");

                getActivity().runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                                && !getContext().getPackageManager().canRequestPackageInstalls()) {
                            pendingApkFile = apkFile;
                            Intent settingsIntent = new Intent(
                                Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName())
                            );
                            settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                            getContext().startActivity(settingsIntent);

                            JSObject ret = new JSObject();
                            ret.put("installed", true);
                            ret.put("needsPermission", true);
                            ret.put("filePath", apkFile.getAbsolutePath());
                            call.resolve(ret);
                            return;
                        }

                        launchPackageInstaller(apkFile);
                        emitProgress(apkFile.length(), apkFile.length(), 100, "completed");

                        JSObject ret = new JSObject();
                        ret.put("installed", true);
                        ret.put("needsPermission", false);
                        ret.put("filePath", apkFile.getAbsolutePath());
                        call.resolve(ret);
                    } catch (Exception e) {
                        call.reject("Failed to launch Android package installer: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                call.reject("Download error: " + e.getMessage());
            } finally {
                try {
                    if (output != null) output.close();
                    if (input != null) input.close();
                    if (connection != null) connection.disconnect();
                } catch (Exception ignored) {}
            }
        }).start();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (pendingApkFile != null && pendingApkFile.exists()) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O
                    || getContext().getPackageManager().canRequestPackageInstalls()) {
                File toInstall = pendingApkFile;
                pendingApkFile = null;
                try {
                    launchPackageInstaller(toInstall);
                    emitProgress(toInstall.length(), toInstall.length(), 100, "completed");
                } catch (Exception ignored) {}
            }
        }
    }

    private void launchPackageInstaller(File apkFile) {
        Intent intent = new Intent(Intent.ACTION_VIEW);
        Uri apkUri;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            String authority = getContext().getPackageName() + ".fileprovider";
            apkUri = FileProvider.getUriForFile(getContext(), authority, apkFile);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else {
            apkUri = Uri.fromFile(apkFile);
            intent.setDataAndType(apkUri, "application/vnd.android.package-archive");
        }
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }

    private boolean isValidApkFile(File file) {
        if (file == null || !file.exists() || file.length() < 1024) {
            return false;
        }
        try (FileInputStream fis = new FileInputStream(file)) {
            byte[] magic = new byte[4];
            if (fis.read(magic) != 4) return false;
            // ZIP/APK magic header: PK\x03\x04
            return magic[0] == 0x50 && magic[1] == 0x4B && magic[2] == 0x03 && magic[3] == 0x04;
        } catch (Exception e) {
            return false;
        }
    }

    private void emitProgress(long downloadedBytes, long totalBytes, int percent, String phase) {
        JSObject data = new JSObject();
        data.put("downloadedBytes", downloadedBytes);
        data.put("totalBytes", totalBytes);
        data.put("percent", percent);
        data.put("phase", phase);
        notifyListeners("downloadProgress", data);
    }
}
