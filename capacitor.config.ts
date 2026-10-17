import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.whaze.floodevactracker',
  appName: 'Whaze Flood EWS',
  webDir: 'dist',
  android: {
    allowMixedContent: true
  },
  plugins: {
    SystemBars: {
      // Android 15+ forces edge-to-edge. "css" injects --safe-area-inset-* variables so the
      // header can pad below the status bar / camera cutout even on older WebViews (< 140)
      // where env(safe-area-inset-*) reports 0.
      insetsHandling: 'css'
    }
  }
};

export default config;
