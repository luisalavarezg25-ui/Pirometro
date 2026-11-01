// Caché sencilla para que la app abra sin conexión en el taller.
var CACHE = 'pirometro-v3';
var ARCHIVOS = ['./', 'index.html', 'app.js', 'capturas.js', 'motor-color.js', 'tabla-color-temperatura.json', 'manifest.webmanifest', 'icono.svg', 'icono-192.png', 'icono-512.png', 'icono-maskable-512.png'];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ARCHIVOS); })); self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); }));
  self.clients.claim();
});
// Red primero (para recibir tablas y versiones nuevas) y caché si no hay conexión.
self.addEventListener('fetch', function (e) {
  e.respondWith(fetch(e.request).then(function (r) {
    var copia = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, copia); }); return r;
  }).catch(function () { return caches.match(e.request); }));
});
