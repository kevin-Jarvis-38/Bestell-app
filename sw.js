// Hält die App-Dateien offline vor. Nach jeder Änderung an der App die Nummer erhöhen,
// sonst behält das Handy die alte Version.
const CACHE = 'bestellapp-8';
const FILES = ['./', './index.html', './app.js', './aufgaben.js', './style.css', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png',
  './fonts/nunito-latin.woff2'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
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
