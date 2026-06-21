// sw.js - Manually-versioned cache

// IMPORTANT: bump CACHE_VERSION whenever any cached asset below (html/css/js) changes.
// The previous scheme generated VERSION from new Date() at runtime, but the sw.js *bytes*
// never changed between deploys — so the browser (which detects SW updates by byte-comparing
// sw.js) never re-installed and kept serving stale CSS/JS. A static, manually-bumped string
// changes the file bytes, which is what actually triggers the update → re-cache → activate flow.
const VERSION = '2026-06-21-j2-panel-tabs';
const CACHE_NAME = `finance-tracker-${VERSION}`;

console.log('🚀 Service Worker Loading - Auto Version:', VERSION);
console.log('🚀 Cache Name:', CACHE_NAME);

const urlsToCache = [
  './', // This will map to your base directory (e.g., /repository-name/)
  './index.html',
  './style.css',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './js/state.js',
  './js/main.js',
  './js/utils.js',
  './js/theme.js',
  './js/calculations.js',
  './js/uiDashboard.js',
  './js/uiSettings.js',
  './js/events.js'
];
 
// Install event: Cache files and force activation
self.addEventListener('install', event => {
  console.log('🔧 [Service Worker] Installing version:', VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 [Service Worker] Caching app shell');
        return cache.addAll(urlsToCache.map(url => new Request(url, { cache: 'reload' })));
      })
      .then(() => {
        console.log('⚡ [Service Worker] Skip waiting - Force new version');
        return self.skipWaiting();
      })
      .catch(error => {
        console.error('❌ [Service Worker] Install failed:', error);
      })
  );
});

// Activate event: Clean old caches and take control
self.addEventListener('activate', event => {
  console.log('🟢 [Service Worker] Activating version:', VERSION);
  event.waitUntil(
    caches.keys().then(cacheNames => {
      console.log('🗑️ [Service Worker] All caches:', cacheNames);
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME && cacheName.startsWith('finance-tracker-')) {
            console.log('🗑️ [Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('👑 [Service Worker] Taking control of all clients');
      return self.clients.claim();
    }).then(() => {
      console.log('📢 [Service Worker] Notifying ALL clients of update');
      return self.clients.matchAll({ includeUncontrolled: true }).then(clients => {
        console.log('📢 [Service Worker] Found', clients.length, 'clients to notify');
        clients.forEach(client => {
          console.log('📤 [Service Worker] Sending update message to client');
          client.postMessage({
            type: 'SHOW_UPDATE_NOTIFICATION',
            version: VERSION,
            timestamp: new Date().toISOString()
          });
        });
      });
    })
  );
});

// Fetch event: Network-first for HTML, cache-first for all other assets
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          // A reachable-but-dead host (e.g. a removed GitHub Pages site) returns a
          // real 404 response, which does NOT reject fetch(). Treat any non-OK
          // response as a failure so we fall back to the cached app shell.
          if (!response || !response.ok) {
            return caches.match('./index.html').then(cached => cached || response);
          }
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).catch(() =>
          new Response('Offline — check your connection.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
          })
        );
      })
  );
});

// Listen for messages from the main thread
self.addEventListener('message', event => {
  console.log('📨 [Service Worker] Received message:', event.data);
  if (event.data && event.data.action === 'skipWaiting') {
    console.log('⚡ [Service Worker] Skip waiting requested');
    self.skipWaiting();
  }
});