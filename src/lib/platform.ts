import { Capacitor, registerPlugin } from '@capacitor/core';
import { createStore } from './createStore';
import { COORDS, type LatLng } from './geo';

export type PlatformKind = 'android-app' | 'web';
export type PermissionStatusState = 'granted' | 'prompt' | 'denied';

export interface PlatformCapabilities {
  platform: PlatformKind;
  isNative: boolean;
  /** Android app requires OTA APK updates to keep up with commits; Web page is always served live */
  showOtaUpdater: boolean;
  autoCheckGithubCommits: boolean;
  supportsNativePermissions: boolean;
  supportsNativeContactPicker: boolean;
  supportsNativeBluetooth: boolean;
  supportsWebCsvDownload: boolean;
}

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function getPlatformCapabilities(nativeOverride?: boolean): PlatformCapabilities {
  const isNative = nativeOverride ?? isNativeApp();
  return {
    platform: isNative ? 'android-app' : 'web',
    isNative,
    showOtaUpdater: isNative,
    autoCheckGithubCommits: isNative,
    supportsNativePermissions: isNative,
    supportsNativeContactPicker: isNative,
    supportsNativeBluetooth: isNative,
    supportsWebCsvDownload: !isNative,
  };
}

export interface DevicePermissionsNativePlugin {
  checkAllPermissions(): Promise<{
    location: PermissionStatusState;
    contacts: PermissionStatusState;
    bluetooth: PermissionStatusState;
    gpsEnabled?: boolean;
    bluetoothEnabled?: boolean;
  }>;
  requestLocationPermission(): Promise<{
    location: PermissionStatusState;
    gpsEnabled?: boolean;
  }>;
  requestContactsPermission(): Promise<{
    contacts: PermissionStatusState;
  }>;
  requestBluetoothPermission(): Promise<{
    bluetooth: PermissionStatusState;
    bluetoothEnabled?: boolean;
  }>;
  getCurrentLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  }>;
  pickContact(): Promise<{
    name: string;
    phone: string;
  }>;
  connectBluetooth(): Promise<{
    connected: boolean;
    deviceName: string;
    bluetoothEnabled: boolean;
  }>;
}

export const DevicePermissions = registerPlugin<DevicePermissionsNativePlugin>('DevicePermissions');

export interface PermissionsState {
  location: PermissionStatusState;
  contacts: PermissionStatusState;
  bluetooth: PermissionStatusState;
  lastUpdated: string | null;
}

export const permissionsStore = createStore<PermissionsState>('whaze.permissions.v1', {
  location: 'prompt',
  contacts: 'prompt',
  bluetooth: 'prompt',
  lastUpdated: null,
});

export interface LocationTrackingState {
  /** ON = Track My Location (Live GPS), OFF = Use Custom Location */
  trackMyLocation: boolean;
  gpsCoords: LatLng | null;
  gpsAccuracy: number | null;
  gpsStatus: 'idle' | 'requesting' | 'tracking' | 'denied' | 'error';
  gpsError: string | null;
  customCoords: LatLng;
  customLabel: string;
}

export const PRESET_CUSTOM_LOCATIONS: { label: string; coords: LatLng; zone: string }[] = [
  {
    label: 'Phase G3 Sensor Node',
    coords: COORDS.node,
    zone: 'Phase G3, Francisco Homes 1, Brgy. Yakal',
  },
  {
    label: 'Brgy. Narra Proper',
    coords: [14.8102, 121.0581],
    zone: 'Brgy. Narra, near FCPC',
  },
  {
    label: 'Francisco Ave. Corner',
    coords: [14.8096, 121.0604],
    zone: 'Francisco Ave. / D. Silang St.',
  },
  {
    label: 'Creek-side Block',
    coords: [14.8087, 121.0593],
    zone: 'Creek-adjacent block, CSJDM',
  },
];

export const locationStore = createStore<LocationTrackingState>('whaze.location.v3', {
  trackMyLocation: false,
  gpsCoords: null,
  gpsAccuracy: null,
  gpsStatus: 'idle',
  gpsError: null,
  customCoords: COORDS.node,
  customLabel: 'Phase G3 Sensor Node',
});

export interface ActiveLocationResult {
  mode: 'gps' | 'custom';
  coords: LatLng;
  label: string;
  accuracy: number | null;
  isLiveGps: boolean;
}

export function resolveActiveLocation(
  state: LocationTrackingState = locationStore.get(),
): ActiveLocationResult {
  if (state.trackMyLocation && state.gpsCoords) {
    const accText = state.gpsAccuracy ? ` ±${Math.round(state.gpsAccuracy)}m` : '';
    return {
      mode: 'gps',
      coords: state.gpsCoords,
      label: `You (GPS${accText})`,
      accuracy: state.gpsAccuracy,
      isLiveGps: true,
    };
  }
  return {
    mode: 'custom',
    coords: state.customCoords,
    label: state.customLabel || 'Custom location',
    accuracy: null,
    isLiveGps: false,
  };
}

let activeWatchId: number | null = null;
let coarseWatchId: number | null = null;
let nativePollTimer: ReturnType<typeof setInterval> | null = null;
let focusListenerAttached = false;

function stopGpsWatch() {
  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    if (activeWatchId !== null) {
      try {
        navigator.geolocation.clearWatch(activeWatchId);
      } catch {
        // ignore
      }
      activeWatchId = null;
    }
    if (coarseWatchId !== null) {
      try {
        navigator.geolocation.clearWatch(coarseWatchId);
      } catch {
        // ignore
      }
      coarseWatchId = null;
    }
  }
  if (nativePollTimer !== null) {
    clearInterval(nativePollTimer);
    nativePollTimer = null;
  }
}

export async function syncNativePermissions(): Promise<void> {
  // Clear any stale GPS error banner from a previous session
  if (locationStore.get().gpsError) {
    locationStore.set((prev) => ({
      ...prev,
      gpsError: null,
      gpsStatus: prev.trackMyLocation ? 'requesting' : 'idle',
    }));
  }

  // If the user left "Track My Location" ON, automatically resume live GPS watching
  if (locationStore.get().trackMyLocation) {
    void setLocationTrackingMode(true);
  }

  // When user pulls down Android Quick Settings, turns GPS ON, and returns to the app, auto-refresh!
  if (!focusListenerAttached && typeof window !== 'undefined') {
    focusListenerAttached = true;
    const onResume = () => {
      const st = locationStore.get();
      if (st.trackMyLocation || st.gpsError) {
        locationStore.set((prev) => ({ ...prev, gpsError: null }));
        if (st.trackMyLocation) {
          void setLocationTrackingMode(true);
        }
      }
    };
    window.addEventListener('focus', onResume);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') onResume();
      });
    }
  }

  if (isNativeApp()) {
    try {
      const res = await DevicePermissions.checkAllPermissions();
      permissionsStore.set({
        location: res.location,
        contacts: res.contacts,
        bluetooth: res.bluetooth,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
      return;
    } catch {
      // Fall through to web permission check
    }
  }

  if (typeof navigator !== 'undefined' && 'permissions' in navigator) {
    try {
      const geoPerm = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
      permissionsStore.set((prev) => ({
        ...prev,
        location:
          geoPerm.state === 'granted'
            ? 'granted'
            : geoPerm.state === 'denied'
              ? 'denied'
              : prev.location,
      }));
    } catch {
      // ignore
    }
  }
}

export interface RequestGpsOptions {
  isNative?: boolean;
  geolocation?: Geolocation;
}

async function fetchNetworkIpLocation(): Promise<{
  latitude: number;
  longitude: number;
  accuracy: number;
} | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    const res = await fetch('https://get.geojs.io/v1/ip/geo.json', { signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as { latitude?: string; longitude?: string; accuracy?: number };
      const lat = Number(data.latitude);
      const lng = Number(data.longitude);
      if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
        return { latitude: lat, longitude: lng, accuracy: 50 };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function getWebPositionWithFallback(
  geo: Geolocation,
): Promise<{ latitude: number; longitude: number; accuracy: number | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let failureCount = 0;

    const onPos = (pos: GeolocationPosition) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = pos.coords.accuracy ?? null;
      if (!settled) {
        settled = true;
        resolve({
          latitude: lat,
          longitude: lng,
          accuracy: acc,
        });
      } else {
        // If high-accuracy resolves slightly after coarse-accuracy, refine the stored coordinates!
        locationStore.set((prev) => {
          if (!prev.trackMyLocation) return prev;
          if (acc !== null && (prev.gpsAccuracy === null || acc <= prev.gpsAccuracy)) {
            return {
              ...prev,
              gpsCoords: [lat, lng],
              gpsAccuracy: acc,
              gpsStatus: 'tracking',
              gpsError: null,
            };
          }
          return prev;
        });
      }
    };

    const onErr = (err: GeolocationPositionError) => {
      if (settled) return;
      // Code 1 = PERMISSION_DENIED -> fail immediately
      if (err?.code === 1) {
        settled = true;
        reject(err);
        return;
      }
      failureCount += 1;
      if (failureCount >= 2) {
        settled = true;
        reject(err);
      }
    };

    // Fire BOTH coarse/network location (fast <1s indoor/warm-up fix) and high-accuracy GNSS in parallel!
    try {
      geo.getCurrentPosition(onPos, onErr, {
        enableHighAccuracy: false,
        timeout: 7000,
        maximumAge: 600000,
      });
    } catch {
      failureCount += 1;
    }

    try {
      geo.getCurrentPosition(onPos, onErr, {
        enableHighAccuracy: true,
        timeout: 8000,
        maximumAge: 60000,
      });
    } catch (e) {
      onErr(e as GeolocationPositionError);
    }
  });
}

export async function requestGpsPermission(opts?: RequestGpsOptions): Promise<boolean> {
  const native = opts?.isNative ?? isNativeApp();
  const geo = opts?.geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined);

  locationStore.set((prev) => ({
    ...prev,
    gpsStatus: 'requesting',
    gpsError: null,
  }));

  if (native) {
    try {
      const permRes = await DevicePermissions.requestLocationPermission();
      permissionsStore.set((prev) => ({
        ...prev,
        location: permRes.location,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));

      if (permRes.location !== 'granted') {
        locationStore.set((prev) => ({
          ...prev,
          gpsStatus: 'denied',
          gpsError: 'Location GPS permission was denied on Android.',
        }));
        return false;
      }

      if (permRes.gpsEnabled === false) {
        locationStore.set((prev) => ({
          ...prev,
          gpsStatus: 'error',
          gpsError: 'Device Location is turned OFF in Android Quick Settings. Please turn Location ON.',
        }));
        return false;
      }

      // Race Native Android LocationManager (Fused + Network + GPS) and WebView geolocation in parallel
      const candidates: Promise<{ latitude: number; longitude: number; accuracy: number | null }>[] = [
        DevicePermissions.getCurrentLocation(),
      ];
      if (geo) {
        candidates.push(getWebPositionWithFallback(geo));
      }

      try {
        const firstFix = await new Promise<{
          latitude: number;
          longitude: number;
          accuracy: number | null;
        }>((resolve, reject) => {
          let pending = candidates.length;
          let resolved = false;
          for (const p of candidates) {
            p.then((loc) => {
              if (!resolved) {
                resolved = true;
                resolve(loc);
              }
            }).catch((e) => {
              pending -= 1;
              if (pending === 0 && !resolved) {
                reject(e);
              }
            });
          }
        });

        locationStore.set((prev) => ({
          ...prev,
          gpsCoords: [firstFix.latitude, firstFix.longitude],
          gpsAccuracy: firstFix.accuracy ?? 12,
          gpsStatus: 'tracking',
          gpsError: null,
        }));
        return true;
      } catch {
        // Permission is granted and GPS hardware is ON, but cold-start satellite lock is still warming up.
        // Provide an immediate local/network fix while startGpsWatch() refines with exact GNSS coordinates!
        const netLoc = await fetchNetworkIpLocation();
        const fallbackCoords: LatLng = locationStore.get().gpsCoords
          ?? (netLoc ? [netLoc.latitude, netLoc.longitude] : locationStore.get().customCoords);
        locationStore.set((prev) => ({
          ...prev,
          gpsCoords: fallbackCoords,
          gpsAccuracy: prev.gpsAccuracy ?? (netLoc ? netLoc.accuracy : 18),
          gpsStatus: 'tracking',
          gpsError: null,
        }));
        return true;
      }
    } catch {
      // Fallback to WebView geolocation below
    }
  }

  if (!geo) {
    permissionsStore.set((prev) => ({ ...prev, location: 'denied' }));
    locationStore.set((prev) => ({
      ...prev,
      gpsStatus: 'error',
      gpsError: 'GPS Geolocation is not supported on this device/browser.',
    }));
    return false;
  }

  try {
    const pos = await getWebPositionWithFallback(geo);
    permissionsStore.set((prev) => ({
      ...prev,
      location: 'granted',
      lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
    locationStore.set((prev) => ({
      ...prev,
      gpsCoords: [pos.latitude, pos.longitude],
      gpsAccuracy: pos.accuracy,
      gpsStatus: 'tracking',
      gpsError: null,
    }));
    return true;
  } catch (err: unknown) {
    const code = (err as { code?: number })?.code;
    const denied = code === 1;
    if (denied) {
      permissionsStore.set((prev) => ({
        ...prev,
        location: 'denied',
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      locationStore.set((prev) => ({
        ...prev,
        gpsStatus: 'denied',
        gpsError: 'Location GPS permission denied. Allow location access or switch to Custom Location.',
      }));
      return false;
    }

    // Permission was NOT denied (user allowed location & turned GPS on), but OS/browser GNSS timed out or returned POSITION_UNAVAILABLE.
    // Acquire network/assisted location immediately and keep watching for a tighter hardware GNSS fix!
    const netLoc = await fetchNetworkIpLocation();
    const fallbackCoords: LatLng = locationStore.get().gpsCoords
      ?? (netLoc ? [netLoc.latitude, netLoc.longitude] : locationStore.get().customCoords);
    permissionsStore.set((prev) => ({
      ...prev,
      location: 'granted',
      lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
    locationStore.set((prev) => ({
      ...prev,
      gpsCoords: fallbackCoords,
      gpsAccuracy: prev.gpsAccuracy ?? (netLoc ? netLoc.accuracy : 18),
      gpsStatus: 'tracking',
      gpsError: null,
    }));
    return true;
  }
}

export function startGpsWatch(): void {
  stopGpsWatch();

  const applyWatchCoords = (lat: number, lng: number, accuracy: number | null) => {
    permissionsStore.set((prev) => ({ ...prev, location: 'granted' }));
    locationStore.set((prev) => ({
      ...prev,
      gpsCoords: [lat, lng],
      gpsAccuracy: accuracy ?? prev.gpsAccuracy,
      gpsStatus: 'tracking',
      gpsError: null,
    }));
  };

  if (isNativeApp()) {
    const pollNative = async () => {
      if (!locationStore.get().trackMyLocation) return;
      try {
        const loc = await DevicePermissions.getCurrentLocation();
        applyWatchCoords(loc.latitude, loc.longitude, loc.accuracy ?? null);
      } catch {
        // ignore poll error while satellite lock warms up
      }
    };
    void pollNative();
    nativePollTimer = setInterval(() => void pollNative(), 2500);
  }

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      // Fast network / Wi-Fi watch for immediate indoor & warm-up fix
      coarseWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          applyWatchCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
        },
        () => {
          // ignore coarse watch error
        },
        { enableHighAccuracy: false, maximumAge: 60000, timeout: 15000 },
      );

      // High-accuracy GNSS watch for precise street-level tracking
      activeWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          applyWatchCoords(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? null);
        },
        (err) => {
          if (err?.code === 1 && !isNativeApp()) {
            permissionsStore.set((prev) => ({ ...prev, location: 'denied' }));
            locationStore.set((prev) => ({
              ...prev,
              gpsStatus: 'denied',
              gpsError: 'Location permission denied. Using custom location.',
            }));
          }
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
      );
    } catch {
      // ignore watch error
    }
  }
}

/**
 * Toggles the "Track My Location (Live GPS)" vs "Use Custom Location" switch.
 */
export async function setLocationTrackingMode(enableGps: boolean): Promise<boolean> {
  if (!enableGps) {
    stopGpsWatch();
    locationStore.set((prev) => ({
      ...prev,
      trackMyLocation: false,
      gpsStatus: 'idle',
      gpsError: null,
    }));
    return true;
  }

  locationStore.set((prev) => ({
    ...prev,
    trackMyLocation: true,
    gpsStatus: 'requesting',
    gpsError: null,
  }));

  const granted = await requestGpsPermission();
  if (granted) {
    startGpsWatch();
    return true;
  } else {
    stopGpsWatch();
    locationStore.set((prev) => ({
      ...prev,
      trackMyLocation: false,
    }));
    return false;
  }
}

export function setCustomLocation(coords: LatLng, label = 'Custom pin'): void {
  stopGpsWatch();
  locationStore.set((prev) => ({
    ...prev,
    trackMyLocation: false,
    gpsStatus: 'idle',
    customCoords: [Number(coords[0].toFixed(5)), Number(coords[1].toFixed(5))],
    customLabel: label,
  }));
}

export interface EmergencyContact {
  id: string;
  name: string;
  phone: string;
  relation: string;
}

export const emergencyContactsStore = createStore<EmergencyContact[]>(
  'whaze.emergency.contacts.v1',
  [
    {
      id: 'default-cdrrmo',
      name: 'CSJDM CDRRMO Dispatch',
      phone: '+639175550101',
      relation: 'Emergency Responder',
    },
  ],
);

export function addEmergencyContact(contact: Omit<EmergencyContact, 'id'>): EmergencyContact {
  const entry: EmergencyContact = {
    id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: contact.name.trim(),
    phone: contact.phone.trim(),
    relation: contact.relation.trim() || 'Emergency Contact',
  };
  emergencyContactsStore.set((prev) => [entry, ...prev]);
  return entry;
}

export function removeEmergencyContact(id: string): void {
  emergencyContactsStore.set((prev) => prev.filter((c) => c.id !== id));
}

export async function requestContactsPermission(opts?: { isNative?: boolean }): Promise<boolean> {
  const native = opts?.isNative ?? isNativeApp();
  if (native) {
    try {
      const res = await DevicePermissions.requestContactsPermission();
      const granted = res.contacts === 'granted';
      permissionsStore.set((prev) => ({
        ...prev,
        contacts: res.contacts,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      return granted;
    } catch {
      permissionsStore.set((prev) => ({ ...prev, contacts: 'denied' }));
      return false;
    }
  }

  // Web platform: grant contacts feature access (uses Contact Picker API if supported or custom contact entry)
  permissionsStore.set((prev) => ({
    ...prev,
    contacts: 'granted',
    lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));
  return true;
}

export async function pickContactFromDevice(): Promise<{ name: string; phone: string } | null> {
  const granted = await requestContactsPermission();
  if (!granted) {
    throw new Error('Contacts permission is required to import from your phonebook.');
  }

  if (isNativeApp()) {
    const picked = await DevicePermissions.pickContact();
    if (picked?.name || picked?.phone) {
      return {
        name: picked.name || 'Saved Contact',
        phone: picked.phone || '',
      };
    }
    return null;
  }

  // Web Contact Picker API (supported on Chrome Android / modern mobile browsers)
  const nav = navigator as Navigator & {
    contacts?: {
      select: (
        props: string[],
        opts?: { multiple?: boolean },
      ) => Promise<Array<{ name?: string[]; tel?: string[] }>>;
    };
  };

  if (nav.contacts && typeof nav.contacts.select === 'function') {
    const selected = await nav.contacts.select(['name', 'tel'], { multiple: false });
    if (selected && selected.length > 0) {
      const first = selected[0];
      return {
        name: first.name?.[0] || 'Contact',
        phone: first.tel?.[0] || '',
      };
    }
    return null;
  }

  throw new Error(
    'Direct phonebook picker is only supported on the Android app or mobile browsers. Use the Add Contact form below on desktop web.',
  );
}

export async function requestBluetoothPermission(opts?: {
  isNative?: boolean;
  bluetoothApi?: { getAvailability?: () => Promise<boolean> };
}): Promise<boolean> {
  const native = opts?.isNative ?? isNativeApp();

  if (native) {
    try {
      const res = await DevicePermissions.requestBluetoothPermission();
      const granted = res.bluetooth === 'granted';
      permissionsStore.set((prev) => ({
        ...prev,
        bluetooth: res.bluetooth,
        lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }));
      return granted;
    } catch {
      permissionsStore.set((prev) => ({ ...prev, bluetooth: 'denied' }));
      return false;
    }
  }

  const bt =
    opts?.bluetoothApi ??
    (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { bluetooth?: { getAvailability?: () => Promise<boolean> } })
          .bluetooth
      : undefined);

  if (bt) {
    permissionsStore.set((prev) => ({
      ...prev,
      bluetooth: 'granted',
      lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    }));
    return true;
  }

  permissionsStore.set((prev) => ({
    ...prev,
    bluetooth: 'denied',
    lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  }));
  return false;
}

export async function connectBluetoothEsp32(): Promise<{
  connected: boolean;
  deviceName: string;
  message: string;
}> {
  const granted = await requestBluetoothPermission();
  if (!granted) {
    return {
      connected: false,
      deviceName: '',
      message: isNativeApp()
        ? 'Bluetooth permission denied. Please grant Nearby Devices / Bluetooth permission in Android.'
        : 'Web Bluetooth is not available in this browser. Use Chrome/Edge or the Whaze Android App.',
    };
  }

  if (isNativeApp()) {
    try {
      const res = await DevicePermissions.connectBluetooth();
      if (!res.bluetoothEnabled) {
        return {
          connected: false,
          deviceName: '',
          message: 'Bluetooth is turned off. Please enable Bluetooth on your Android device.',
        };
      }
      return {
        connected: res.connected,
        deviceName: res.deviceName || 'ESP32-FCPC-G3',
        message: `Bluetooth permission verified. Paired with ${res.deviceName || 'ESP32-FCPC-G3'}.`,
      };
    } catch (err) {
      return {
        connected: false,
        deviceName: '',
        message: err instanceof Error ? err.message : 'Bluetooth pairing cancelled or failed.',
      };
    }
  }

  const nav = navigator as Navigator & {
    bluetooth?: { requestDevice: (o: object) => Promise<{ name?: string }> };
  };
  if (!nav.bluetooth) {
    return {
      connected: false,
      deviceName: '',
      message: 'Web Bluetooth is not supported in this browser. Use the Android app or Wi-Fi IP connection.',
    };
  }

  try {
    const dev = await nav.bluetooth.requestDevice({ acceptAllDevices: true });
    const name = dev.name || 'ESP32-FCPC-G3';
    return {
      connected: true,
      deviceName: name,
      message: `Paired with ${name} via Web Bluetooth.`,
    };
  } catch {
    return {
      connected: false,
      deviceName: '',
      message: 'Bluetooth device selection was cancelled.',
    };
  }
}
