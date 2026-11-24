// Service Worker: App-Shell offline verfügbar, Daten immer live vom Server
const CACHE = 'tj-v7';
const SHELL = ['./', 'index.html', 'app.js', 'config.js', 'manifest.webmanifest',
  'supabase.js', 'chart.umd.min.js', 'icon-192.png', 'apple-touch-icon.png',
  'inter.woff2', 'jbmono.woff2'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // Supabase-Requests nie cachen
  // Network-first: immer die neueste Version, offline aus dem Cache
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request).then(r => r || caches.match('index.html'))));
});
