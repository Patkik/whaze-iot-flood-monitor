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

export const locationStore = createStore<LocationTrackingState>('whaze.location.v1', {
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
let nativePollTimer: ReturnType<typeof setInterval> | null = null;

function stopGpsWatch() {
  if (activeWatchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      navigator.geolocation.clearWatch(activeWatchId);
    } catch {
      // ignore
    }
    activeWatchId = null;
  }
  if (nativePollTimer !== null) {
    clearInterval(nativePollTimer);
    nativePollTimer = null;
  }
}

export async function syncNativePermissions(): Promise<void> {
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

      // Try native Android GPS fetch first for immediate fix
      try {
        const loc = await DevicePermissions.getCurrentLocation();
        locationStore.set((prev) => ({
          ...prev,
          gpsCoords: [loc.latitude, loc.longitude],
          gpsAccuracy: loc.accuracy ?? 10,
          gpsStatus: 'tracking',
          gpsError: null,
        }));
        return true;
      } catch {
        // Fallback to WebView geolocation below
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

  return new Promise<boolean>((resolve) => {
    geo.getCurrentPosition(
      (pos) => {
        permissionsStore.set((prev) => ({
          ...prev,
          location: 'granted',
          lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));
        locationStore.set((prev) => ({
          ...prev,
          gpsCoords: [pos.coords.latitude, pos.coords.longitude],
          gpsAccuracy: pos.coords.accuracy ?? null,
          gpsStatus: 'tracking',
          gpsError: null,
        }));
        resolve(true);
      },
      (err) => {
        const denied = err?.code === 1;
        permissionsStore.set((prev) => ({
          ...prev,
          location: denied ? 'denied' : prev.location,
          lastUpdated: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        }));
        locationStore.set((prev) => ({
          ...prev,
          gpsStatus: denied ? 'denied' : 'error',
          gpsError: denied
            ? 'Location GPS permission denied. Allow location access or switch to Custom Location.'
            : 'Unable to acquire GPS signal. Check that device Location / GPS is turned on.',
        }));
        resolve(false);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 5000 },
    );
  });
}

export function startGpsWatch(): void {
  stopGpsWatch();

  if (isNativeApp()) {
    // Poll native Android LocationManager periodically in addition to WebView watchPosition
    nativePollTimer = setInterval(async () => {
      if (!locationStore.get().trackMyLocation) return;
      try {
        const loc = await DevicePermissions.getCurrentLocation();
        locationStore.set((prev) => ({
          ...prev,
          gpsCoords: [loc.latitude, loc.longitude],
          gpsAccuracy: loc.accuracy ?? prev.gpsAccuracy,
          gpsStatus: 'tracking',
          gpsError: null,
        }));
      } catch {
        // ignore poll error if watchPosition is active
      }
    }, 5000);
  }

  if (typeof navigator !== 'undefined' && navigator.geolocation) {
    try {
      activeWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          permissionsStore.set((prev) => ({ ...prev, location: 'granted' }));
          locationStore.set((prev) => ({
            ...prev,
            gpsCoords: [pos.coords.latitude, pos.coords.longitude],
            gpsAccuracy: pos.coords.accuracy ?? null,
            gpsStatus: 'tracking',
            gpsError: null,
          }));
        },
        (err) => {
          if (err?.code === 1) {
            permissionsStore.set((prev) => ({ ...prev, location: 'denied' }));
            locationStore.set((prev) => ({
              ...prev,
              gpsStatus: 'denied',
              gpsError: 'Location permission denied. Using custom location.',
            }));
          }
        },
        { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
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
    // Keep trackMyLocation false if permission was denied so user sees the reason and stays on custom location
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
