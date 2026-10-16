import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.whaze.floodevactracker',
  appName: 'Whaze Flood EWS',
  webDir: 'dist',
  android: {
    allowMixedContent: true
  }
};

export default config;
