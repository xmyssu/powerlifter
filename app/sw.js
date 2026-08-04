/* ==========================================================================
   sw.js — offline support
   --------------------------------------------------------------------------
   The app is entirely static and its data lives in localStorage, so a simple
   cache-first strategy makes it fully functional with no connection. Bump
   VERSION whenever the assets change.
   ========================================================================== */

const VERSION = 'v10';
const CACHE = `powerlifter-${VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './css/gym.css',
  './js/app.js',
  './js/store.js',
  './js/rpe.js',
  './js/program.js',
  './js/templates.js',
  './js/exercises.js',
  './js/coach.js',
  './js/timer.js',
  './js/ui.js',
  './js/views/onboarding.js',
  './js/views/today.js',
  './js/views/session.js',
  './js/views/progress.js',
  './js/views/coachview.js',
  './js/views/reference.js',
  './js/views/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll rejects wholesale if any single request fails, which would leave
      // us with no cache at all; add individually so one miss is survivable.
      .then((cache) => Promise.all(ASSETS.map((u) => cache.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Navigations: serve the shell so a cold offline launch works.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) {
        // Refresh in the background so the next launch is current.
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }).catch(() => {});
        return hit;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
