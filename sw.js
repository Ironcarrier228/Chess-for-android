/* Офлайн-кэш: приложение работает без интернета после первого запуска. */
const VERSION = 'gambit-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/app.js',
  './src/board-ui.js',
  './src/coach.js',
  './src/engine/core.js',
  './src/engine/eval.js',
  './src/engine/search.js',
  './src/engine/zobrist.js',
  './src/engine/rng.js',
  './vendor/chess.js',
  './assets/pieces/wK.png', './assets/pieces/wQ.png', './assets/pieces/wR.png',
  './assets/pieces/wB.png', './assets/pieces/wN.png', './assets/pieces/wP.png',
  './assets/pieces/bK.png', './assets/pieces/bQ.png', './assets/pieces/bR.png',
  './assets/pieces/bB.png', './assets/pieces/bN.png', './assets/pieces/bP.png',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // обновляем в фоне
        fetch(req).then((res) => {
          if (res && res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
