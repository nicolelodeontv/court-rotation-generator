/* Service-worker retirement / cache kill switch.
   Older versions of this app used /sw.js as an offline cache-first worker.
   Keep this file at the same URL so existing registrations can update and
   retire themselves instead of continuing to serve stale application files. */
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      try { await client.navigate(client.url); } catch {}
    }
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  // Never cache application responses. Always ask the network for the latest file.
  event.respondWith(fetch(event.request, { cache: 'no-store' }));
});
