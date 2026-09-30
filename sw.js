/* Court Rotation Generator — offline service worker.
   Network-first for app logic (HTML/JS) so updates are never stuck behind
   a stale cache. Cache-first for static assets (CSS/fonts/icons), keyed to
   a version bumped manually whenever static assets change. */

const CACHE_VERSION = 'crg-cache-v1';

const STATIC_EXTENSIONS = /\.(css|svg|png|jpg|jpeg|webp|woff2?|ttf)$/i;

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isNavigation = req.mode === 'navigate';
  const isStaticAsset = STATIC_EXTENSIONS.test(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirst(req));
  } else if (isNavigation || url.pathname.endsWith('.js')) {
    event.respondWith(networkFirst(req));
  }
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const fallback = await cache.match('index.html');
      if (fallback) return fallback;
    }
    throw new Error('Network unavailable and no cache match');
  }
}
