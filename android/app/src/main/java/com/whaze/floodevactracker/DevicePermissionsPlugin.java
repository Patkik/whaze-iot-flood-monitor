package com.whaze.floodevactracker;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.ContactsContract;
import androidx.activity.result.ActivityResult;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.List;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(
    name = "DevicePermissions",
    permissions = {
        @Permission(
            alias = "location",
            strings = {
                Manifest.permission.ACCESS_FINE_LOCATION,
                Manifest.permission.ACCESS_COARSE_LOCATION
            }
        ),
        @Permission(
            alias = "contacts",
            strings = {
                Manifest.permission.READ_CONTACTS
            }
        ),
        @Permission(
            alias = "bluetoothModern",
            strings = {
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
            }
        ),
        @Permission(
            alias = "bluetoothLegacy",
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.ACCESS_FINE_LOCATION
            }
        )
    }
)
public class DevicePermissionsPlugin extends Plugin {

    private volatile Location latestLocation = null;
    private LocationListener continuousListener = null;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private String getBtAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetoothModern" : "bluetoothLegacy";
    }

    private String mapPermState(PermissionState state) {
        if (state == PermissionState.GRANTED) return "granted";
        if (state == PermissionState.DENIED) return "denied";
        return "prompt";
    }

    private boolean isGpsHardwareEnabled() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return false;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                if (lm.isLocationEnabled()) return true;
            }
            return lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
        } catch (Exception e) {
            return false;
        }
    }

    private boolean isBluetoothHardwareEnabled() {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            return adapter != null && adapter.isEnabled();
        } catch (Exception e) {
            return false;
        }
    }

    @SuppressLint("MissingPermission")
    private void ensureContinuousLocationUpdates(LocationManager lm) {
        if (continuousListener != null || lm == null) return;
        continuousListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (location != null) {
                    latestLocation = chooseBetterLocation(location, latestLocation);
                }
            }
            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override
            public void onProviderEnabled(String provider) {}
            @Override
            public void onProviderDisabled(String provider) {}
        };

        mainHandler.post(() -> {
            try {
                String[] providers = new String[] {
                    "fused",
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.GPS_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER
                };
                for (String provider : providers) {
                    try {
                        lm.requestLocationUpdates(provider, 2000L, 0f, continuousListener, Looper.getMainLooper());
                    } catch (Exception ignored) {}
                }
                List<String> all = lm.getAllProviders();
                if (all != null) {
                    for (String provider : all) {
                        try {
                            lm.requestLocationUpdates(provider, 2000L, 0f, continuousListener, Looper.getMainLooper());
                        } catch (Exception ignored) {}
                    }
                }
            } catch (Exception ignored) {}
        });
    }

    private Location chooseBetterLocation(Location candidate, Location currentBest) {
        if (candidate == null) return currentBest;
        if (currentBest == null) return candidate;

        long timeDelta = candidate.getTime() - currentBest.getTime();
        boolean isSignificantlyNewer = timeDelta > 60_000L;
        boolean isSignificantlyOlder = timeDelta < -60_000L;
        boolean isNewer = timeDelta > 0;

        if (isSignificantlyNewer) return candidate;
        if (isSignificantlyOlder) return currentBest;

        int accuracyDelta = (int) (candidate.getAccuracy() - currentBest.getAccuracy());
        boolean isMoreAccurate = accuracyDelta < 0;
        boolean isLessAccurate = accuracyDelta > 0;
        boolean isSignificantlyLessAccurate = accuracyDelta > 100;

        if (isMoreAccurate) return candidate;
        if (isNewer && !isLessAccurate) return candidate;
        if (isNewer && !isSignificantlyLessAccurate) return candidate;
        return currentBest;
    }

    @SuppressLint("MissingPermission")
    private Location findBestLastKnownLocation(LocationManager lm) {
        Location best = latestLocation;
        try {
            String[] knownProviders = new String[] {
                "fused",
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            };
            for (String provider : knownProviders) {
                try {
                    Location loc = lm.getLastKnownLocation(provider);
                    best = chooseBetterLocation(loc, best);
                } catch (Exception ignored) {}
            }
            List<String> providers = lm.getAllProviders();
            if (providers != null) {
                for (String provider : providers) {
                    try {
                        Location loc = lm.getLastKnownLocation(provider);
                        best = chooseBetterLocation(loc, best);
                    } catch (Exception ignored) {}
                }
            }
        } catch (Exception ignored) {}
        return best;
    }

    private JSObject locationToJS(Location loc) {
        JSObject ret = new JSObject();
        ret.put("latitude", loc.getLatitude());
        ret.put("longitude", loc.getLongitude());
        ret.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : 15.0);
        ret.put("timestamp", loc.getTime());
        return ret;
    }

    @PluginMethod
    public void checkAllPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("location", mapPermState(getPermissionState("location")));
        ret.put("contacts", mapPermState(getPermissionState("contacts")));
        ret.put("bluetooth", mapPermState(getPermissionState(getBtAlias())));
        ret.put("gpsEnabled", isGpsHardwareEnabled());
        ret.put("bluetoothEnabled", isBluetoothHardwareEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestLocationPermission(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            ensureContinuousLocationUpdates(lm);
            JSObject ret = new JSObject();
            ret.put("location", "granted");
            ret.put("gpsEnabled", isGpsHardwareEnabled());
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("location", call, "locationPermsCallback");
    }

    @PermissionCallback
    private void locationPermsCallback(PluginCall call) {
        PermissionState state = getPermissionState("location");
        if (state == PermissionState.GRANTED) {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            ensureContinuousLocationUpdates(lm);
        }
        JSObject ret = new JSObject();
        ret.put("location", mapPermState(state));
        ret.put("gpsEnabled", isGpsHardwareEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestContactsPermission(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("contacts", "granted");
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("contacts", call, "contactsPermsCallback");
    }

    @PermissionCallback
    private void contactsPermsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("contacts", mapPermState(getPermissionState("contacts")));
        call.resolve(ret);
    }

    @PluginMethod
    public void requestBluetoothPermission(PluginCall call) {
        String alias = getBtAlias();
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("bluetooth", "granted");
            ret.put("bluetoothEnabled", isBluetoothHardwareEnabled());
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias(alias, call, "bluetoothPermsCallback");
    }

    @PermissionCallback
    private void bluetoothPermsCallback(PluginCall call) {
        String alias = getBtAlias();
        JSObject ret = new JSObject();
        ret.put("bluetooth", mapPermState(getPermissionState(alias)));
        ret.put("bluetoothEnabled", isBluetoothHardwareEnabled());
        call.resolve(ret);
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void getCurrentLocation(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission not granted");
            return;
        }
        try {
            final LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) {
                call.reject("LocationManager unavailable");
                return;
            }

            ensureContinuousLocationUpdates(lm);

            Location best = findBestLastKnownLocation(lm);
            if (best != null) {
                latestLocation = best;
                call.resolve(locationToJS(best));
                return;
            }

            if (!isGpsHardwareEnabled()) {
                call.reject("Device Location / GPS service is turned off");
                return;
            }

            // No cached location yet (e.g., user just turned GPS on). Actively request a fresh fix on main looper!
            final AtomicBoolean settled = new AtomicBoolean(false);
            final LocationListener oneShotListener = new LocationListener() {
                @Override
                public void onLocationChanged(Location location) {
                    if (location != null) {
                        latestLocation = chooseBetterLocation(location, latestLocation);
                        if (settled.compareAndSet(false, true)) {
                            try {
                                lm.removeUpdates(this);
                            } catch (Exception ignored) {}
                            call.resolve(locationToJS(location));
                        }
                    }
                }
                @Override
                public void onStatusChanged(String provider, int status, Bundle extras) {}
                @Override
                public void onProviderEnabled(String provider) {}
                @Override
                public void onProviderDisabled(String provider) {}
            };

            mainHandler.post(() -> {
                String[] activeProviders = new String[] {
                    "fused",
                    LocationManager.NETWORK_PROVIDER,
                    LocationManager.GPS_PROVIDER,
                    LocationManager.PASSIVE_PROVIDER
                };
                boolean anyRegistered = false;

                // On Android 11+ (API 30+), also invoke lm.getCurrentLocation() directly for fast Fused/Network wake-up
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    for (String p : activeProviders) {
                        try {
                            lm.getCurrentLocation(
                                p,
                                null,
                                ContextCompat.getMainExecutor(getContext()),
                                location -> {
                                    if (location != null) {
                                        latestLocation = chooseBetterLocation(location, latestLocation);
                                        if (settled.compareAndSet(false, true)) {
                                            try {
                                                lm.removeUpdates(oneShotListener);
                                            } catch (Exception ignored) {}
                                            call.resolve(locationToJS(location));
                                        }
                                    }
                                }
                            );
                            anyRegistered = true;
                        } catch (Exception ignored) {}
                    }
                }

                for (String p : activeProviders) {
                    try {
                        lm.requestLocationUpdates(p, 200L, 0f, oneShotListener, Looper.getMainLooper());
                        anyRegistered = true;
                    } catch (Exception ignored) {}
                }

                List<String> allProviders = lm.getAllProviders();
                if (allProviders != null) {
                    for (String p : allProviders) {
                        try {
                            lm.requestLocationUpdates(p, 200L, 0f, oneShotListener, Looper.getMainLooper());
                            anyRegistered = true;
                        } catch (Exception ignored) {}
                    }
                }

                if (!anyRegistered) {
                    if (settled.compareAndSet(false, true)) {
                        call.reject("No location providers available");
                    }
                    return;
                }

                mainHandler.postDelayed(() -> {
                    if (settled.compareAndSet(false, true)) {
                        try {
                            lm.removeUpdates(oneShotListener);
                        } catch (Exception ignored) {}
                        Location fallback = findBestLastKnownLocation(lm);
                        if (fallback != null) {
                            call.resolve(locationToJS(fallback));
                        } else {
                            call.reject("Acquiring initial GPS fix");
                        }
                    }
                }, 8000L);
            });
        } catch (Exception e) {
            call.reject("Failed to read GPS location: " + e.getMessage());
        }
    }

    @PluginMethod
    public void pickContact(PluginCall call) {
        if (getPermissionState("contacts") != PermissionState.GRANTED) {
            requestPermissionForAlias("contacts", call, "pickContactAfterPermCallback");
            return;
        }
        launchContactPickerIntent(call);
    }

    @PermissionCallback
    private void pickContactAfterPermCallback(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) {
            launchContactPickerIntent(call);
        } else {
            call.reject("Contacts permission denied");
        }
    }

    private void launchContactPickerIntent(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
            startActivityForResult(call, intent, "handlePickedContactResult");
        } catch (Exception e) {
            call.reject("Unable to open Contacts app: " + e.getMessage());
        }
    }

    @ActivityCallback
    private void handlePickedContactResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            call.reject("Contact selection cancelled");
            return;
        }

        Uri contactUri = result.getData().getData();
        if (contactUri == null) {
            call.reject("No contact data returned");
            return;
        }

        String[] projection = new String[] {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        };

        try (Cursor cursor = getContext().getContentResolver().query(contactUri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
                int numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                String name = nameIdx >= 0 ? cursor.getString(nameIdx) : "Emergency Contact";
                String phone = numIdx >= 0 ? cursor.getString(numIdx) : "";
                JSObject ret = new JSObject();
                ret.put("name", name != null ? name : "Emergency Contact");
                ret.put("phone", phone != null ? phone : "");
                call.resolve(ret);
            } else {
                call.reject("Could not read selected contact");
            }
        } catch (Exception e) {
            call.reject("Error reading contact: " + e.getMessage());
        }
    }

    @SuppressLint("MissingPermission")
    @PluginMethod
    public void connectBluetooth(PluginCall call) {
        String alias = getBtAlias();
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            call.reject("Bluetooth permission not granted");
            return;
        }

        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("This device does not have a Bluetooth adapter");
                return;
            }

            if (!adapter.isEnabled()) {
                try {
                    Intent enableBtIntent = new Intent(BluetoothAdapter.ACTION_REQUEST_ENABLE);
                    enableBtIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(enableBtIntent);
                } catch (Exception ignored) {}
                JSObject ret = new JSObject();
                ret.put("connected", false);
                ret.put("deviceName", "");
                ret.put("bluetoothEnabled", false);
                call.resolve(ret);
                return;
            }

            String matchedName = "ESP32-FCPC-G3";
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice dev : bonded) {
                    String n = dev.getName();
                    if (n != null && (n.toUpperCase().contains("ESP32") || n.toUpperCase().contains("WHAZE"))) {
                        matchedName = n;
                        break;
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("connected", true);
            ret.put("deviceName", matchedName);
            ret.put("bluetoothEnabled", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Bluetooth connection error: " + e.getMessage());
        }
    }
}
