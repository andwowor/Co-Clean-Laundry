/* Service worker Co Clean Laundry — agar dashboard bisa di-install (PWA). */
var CACHE = 'ccl-v1';
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/logo.svg?v=2',
  'assets/icon-192.png',
  'assets/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // Navigasi halaman: utamakan jaringan, fallback ke shell saat offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(function () {
        return caches.match('index.html').then(function (r) { return r || caches.match('./'); });
      })
    );
    return;
  }

  // Aset statis (logo/ikon): cache dulu, lalu jaringan. Sisanya biarkan normal
  // (cache-busting app.js/config.js & JSONP ke Apps Script tetap berjalan).
  e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
});
