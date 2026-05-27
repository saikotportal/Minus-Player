// minus — service worker
// Caches the app shell for offline / installed use

const CACHE   = 'minus-v6';
const ASSETS  = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  'https://cdnjs.cloudflare.com/ajax/libs/jsmediatags/3.9.5/jsmediatags.min.js',
  'https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Space+Grotesk:wght@300;400;500&family=Space+Mono:wght@400;700&display=swap',
];

// Install — pre-cache app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => {
      // Cache what we can; Google Fonts may be blocked in some environments
      return Promise.allSettled(
        ASSETS.map(url => cache.add(url).catch(() => {}))
      );
    }).then(() => self.skipWaiting())
  );
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch — cache-first for app shell, network-first for everything else
self.addEventListener('fetch', event => {
  // Skip non-GET and audio blob URLs (local files)
  if (event.request.method !== 'GET') return;
  if (event.request.url.startsWith('blob:')) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache same-origin and Google Fonts
        if (
          response.ok &&
          (event.request.url.startsWith(self.location.origin) ||
           event.request.url.includes('fonts.googleapis') ||
           event.request.url.includes('fonts.gstatic') ||
           event.request.url.includes('cdnjs.cloudflare.com'))
        ) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // fallback to cache if offline
    })
  );
});
