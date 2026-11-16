// v2: files without a hash in the name are no longer served from the cache first
const CACHE = 'secret-santa-v2';
const STATIC_RE = /\.(?:js|css|png|svg|ico|webp|webmanifest|woff2?)$/i;
// A content hash in the name (main-AB12CD34.js): the file never changes, the cache is enough.
// Anything else (and everything of `ng serve`, where names have no hash) is asked from the
// network first, or a phone keeps showing an old version forever.
const HASHED_RE = /[.-][A-Z0-9]{8}\.(?:js|css|woff2?)$/;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add('/index.html')).catch(() => {}).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/telegram/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(CACHE).then((c) => c.put('/index.html', copy));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  if (HASHED_RE.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((hit) => {
        if (hit) return hit;
        return fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        });
      })
    );
    return;
  }

  if (STATIC_RE.test(url.pathname)) {
    // Network first; the cached copy is only for being offline
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error()))
    );
  }
});
