// Hält die App-Dateien offline vor. Nach jeder Änderung an der App die Nummer erhöhen,
// sonst behält das Handy die alte Version.
const CACHE = 'bestellapp-11';
const FILES = ['./', './index.html', './app.js', './aufgaben.js', './style.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-192.png', './icons/icon-maskable-512.png',
  './fonts/nunito-latin.woff2'];

// cache: 'reload' umgeht den Browser-Zwischenspeicher. GitHub Pages erlaubt 10 Minuten Zwischenspeichern;
// ohne das landeten kurz nach einem Update noch die alten Dateien im neuen Offline-Speicher.
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
