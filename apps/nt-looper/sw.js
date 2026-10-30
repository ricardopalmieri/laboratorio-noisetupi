const CACHE = 'nt-looper-v210-20260831';
const FILES = [
  './', './index.html', './css/style.css', './manifest.webmanifest',
  './js/app.js', './js/audio-engine.js', './js/effects.js', './js/effects-processor.js', './js/advanced-fx-processor.js',
  './js/transport-processor.js',
  './js/master-recorder-processor.js',
  './js/session-files.js', './js/templates.js', './js/sampler.js',
  './js/looper-processor.js', './js/midi.js', './js/keyboard.js', './js/ui.js', './js/waveform.js',
  './FX-AUDIT.md',
  './assets/img/logo-simple.png', './assets/img/logo-noisetupi.png',
  './assets/fonts/ibm-plex-sans-latin-400-normal-CDDApCn2.woff2',
  './assets/fonts/ibm-plex-sans-latin-500-normal-6ng42L7E.woff2',
  './assets/fonts/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match('./index.html'))));
});
