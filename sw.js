const CACHE_NAME = 'whaze-ews-pwa-v2';
const TILE_CACHE_NAME = 'whaze-map-tiles-v1';

const APP_SHELL = [
  '/',
  '/index.html',
  '/evacuation.html',
  '/emergency.html',
  '/feedback.html',
  '/style.css',
  '/script.js',
  '/manifest.json',
  '/assets/logo.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch((err) => console.warn('[SW] Failed to pre-cache:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== TILE_CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept local ESP32 hardware polling requests
  if (url.pathname.includes('/data') || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(url.hostname)) {
    return;
  }

  // Cache OpenStreetMap tiles for offline evacuation routing
  if (url.hostname.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(TILE_CACHE_NAME).then((cache) =>
        cache.match(request).then((cachedTile) => {
          const networkFetch = fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(request, response.clone());
              }
              return response;
            })
            .catch(() => cachedTile);
          return cachedTile || networkFetch;
        })
      )
    );
    return;
  }

  // Legacy route redirect safety
  if (url.pathname.endsWith('/routes.html')) {
    event.respondWith(
      caches.match('/evacuation.html').then((res) => res || fetch('/evacuation.html'))
    );
    return;
  }

  // Stale-while-revalidate for App Shell
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && (url.origin === self.location.origin || url.hostname.includes('unpkg.com'))) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          if (request.mode === 'navigate') {
            return caches.match(url.pathname) || caches.match('/index.html');
          }
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// Handle notification click events
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/evacuation.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
