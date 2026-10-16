# Whaze: Community and Evacuation Leading

IoT flood early warning and evacuation guide for Brgy. Narra and Brgy. Yakal, Francisco Homes, CSJDM, Bulacan.

Stack: Vite, React, TypeScript, Tailwind CSS v4, react-leaflet, vite-plugin-pwa.

```
npm install
npm run dev      # local dev
npm test         # SOP 2/3 stats + threshold tests
npm run build    # production build in dist/
```

Deploy: import the repo in Vercel (framework preset Vite). `vercel.json` handles SPA routing.
Firmware: `esp32-firmware/whaze_esp32_sensor.ino`.
