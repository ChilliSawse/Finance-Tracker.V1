// sw.js - Automatic Timestamp Versioning

// Pure automatic versioning - generates new version every time you deploy!
const VERSION = new Date().toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
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

// Fetch event: Serve cached content with network fallback
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request).catch(error => {
          console.error('[Service Worker] Fetch failed:', error);
        });
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