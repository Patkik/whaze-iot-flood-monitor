import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  getPlatformCapabilities,
  locationStore,
  permissionsStore,
  setLocationTrackingMode,
  setCustomLocation,
  resolveActiveLocation,
  requestGpsPermission,
  requestContactsPermission,
  requestBluetoothPermission,
  addEmergencyContact,
  removeEmergencyContact,
  emergencyContactsStore,
} from './platform';
import { COORDS } from './geo';

describe('Platform Separation (Mobile App vs Web Page)', () => {
  it('enables OTA APK updater and native hardware bridges only on Android native app', () => {
    const androidCaps = getPlatformCapabilities(true);
    expect(androidCaps.platform).toBe('android-app');
    expect(androidCaps.showOtaUpdater).toBe(true);
    expect(androidCaps.autoCheckGithubCommits).toBe(true);
    expect(androidCaps.supportsNativePermissions).toBe(true);

    const webCaps = getPlatformCapabilities(false);
    expect(webCaps.platform).toBe('web');
    expect(webCaps.showOtaUpdater).toBe(false);
    expect(webCaps.autoCheckGithubCommits).toBe(false);
    expect(webCaps.supportsNativePermissions).toBe(false);
  });
});

describe('Location GPS Tracking vs Custom Location Switch', () => {
  beforeEach(() => {
    locationStore.set({
      trackMyLocation: false,
      gpsCoords: null,
      gpsAccuracy: null,
      gpsStatus: 'idle',
      gpsError: null,
      customCoords: COORDS.node,
      customLabel: 'Phase G3 Sensor Node',
    });
  });

  it('uses custom location when Track My Location switch is OFF', () => {
    setCustomLocation([14.8091, 121.0602], 'Custom street pin');
    const active = resolveActiveLocation(locationStore.get());
    expect(active.mode).toBe('custom');
    expect(active.coords).toEqual([14.8091, 121.0602]);
    expect(active.label).toBe('Custom street pin');
  });

  it('switches to live GPS coordinates when Track My Location switch is ON and GPS fix is available', () => {
    locationStore.set({
      ...locationStore.get(),
      trackMyLocation: true,
      gpsCoords: [14.8105, 121.0588],
      gpsAccuracy: 12,
      gpsStatus: 'tracking',
    });

    const active = resolveActiveLocation(locationStore.get());
    expect(active.mode).toBe('gps');
    expect(active.coords).toEqual([14.8105, 121.0588]);
    expect(active.label).toContain('GPS');
  });

  it('toggles between Track My Location (ON) and Custom Location (OFF)', () => {
    setLocationTrackingMode(false);
    expect(locationStore.get().trackMyLocation).toBe(false);
    expect(locationStore.get().gpsStatus).toBe('idle');
  });
});

describe('Permissions (Location GPS, Contacts, Bluetooth)', () => {
  beforeEach(() => {
    permissionsStore.set({
      location: 'prompt',
      contacts: 'prompt',
      bluetooth: 'prompt',
      lastUpdated: null,
    });
    emergencyContactsStore.set([]);
  });

  it('requests GPS permission using web geolocation provider when on web', async () => {
    const mockGetPos = vi.fn((success: PositionCallback) => {
      success({
        coords: {
          latitude: 14.8089,
          longitude: 121.0595,
          accuracy: 8,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
          toJSON: () => ({}),
        },
        timestamp: Date.now(),
        toJSON: () => ({}),
      });
    });

    const granted = await requestGpsPermission({
      isNative: false,
      geolocation: {
        getCurrentPosition: mockGetPos,
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      } as unknown as Geolocation,
    });

    expect(granted).toBe(true);
    expect(permissionsStore.get().location).toBe('granted');
    expect(locationStore.get().gpsCoords).toEqual([14.8089, 121.0595]);
  });

  it('acquires location via coarse/network provider when high-accuracy GNSS times out after turning GPS on', async () => {
    const mockGetPos = vi.fn(
      (success: PositionCallback, error?: PositionErrorCallback, options?: PositionOptions) => {
        if (options?.enableHighAccuracy) {
          // Simulate cold-start satellite timeout (code 3 = TIMEOUT)
          error?.({
            code: 3,
            message: 'Timeout expired',
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          });
        } else {
          // Coarse / Network location responds immediately when GPS is turned ON
          success({
            coords: {
              latitude: 14.8085,
              longitude: 121.0589,
              accuracy: 15,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          });
        }
      },
    );

    const granted = await requestGpsPermission({
      isNative: false,
      geolocation: {
        getCurrentPosition: mockGetPos,
        watchPosition: vi.fn(() => 1),
        clearWatch: vi.fn(),
      } as unknown as Geolocation,
    });

    expect(granted).toBe(true);
    expect(permissionsStore.get().location).toBe('granted');
    expect(locationStore.get().gpsCoords).toEqual([14.8085, 121.0589]);
    expect(locationStore.get().gpsError).toBeNull();
  });

  it('requests Contacts permission and manages emergency contacts', async () => {
    const granted = await requestContactsPermission({ isNative: false });
    expect(granted).toBe(true);
    expect(permissionsStore.get().contacts).toBe('granted');

    addEmergencyContact({ name: 'Elena Santos', phone: '+639171234567', relation: 'Family' });
    expect(emergencyContactsStore.get()).toHaveLength(1);
    expect(emergencyContactsStore.get()[0].name).toBe('Elena Santos');

    removeEmergencyContact(emergencyContactsStore.get()[0].id);
    expect(emergencyContactsStore.get()).toHaveLength(0);
  });

  it('requests Bluetooth permission cleanly', async () => {
    const granted = await requestBluetoothPermission({
      isNative: false,
      bluetoothApi: {
        getAvailability: vi.fn().mockResolvedValue(true),
      },
    });
    expect(granted).toBe(true);
    expect(permissionsStore.get().bluetooth).toBe('granted');
  });
});

