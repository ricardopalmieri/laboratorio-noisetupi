const CACHE = "nt-sampler-v2.8.0-core-280";
const CORE = ["./","index.html","styles.css?v=280","app.js?v=280","assets/noisetupi-logo.png","assets/app-icon.png","assets/pause.svg","fonts/ibm-plex-sans-latin.woff2","manifest.webmanifest","js/effects-processor.js?v=250","js/advanced-fx-processor.js?v=250","js/pad-performance-processor.js?v=260"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
    return response;
  }).catch(() => caches.match(event.request).then(cached => cached || caches.match("index.html"))));
});
