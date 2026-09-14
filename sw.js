const CACHE='crg-clean-v5';
const ASSETS=['./','./index.html','./styles.css?v=crg43','./features.css?v=crg43','./live-ui.css?v=crg5','./scheduler.js?v=crg43','./player-ui.js?v=crg43','./app.js?v=crg43','./live-display.js?v=crg5','./features.js?v=crg43','./favicon.svg','./manifest.webmanifest'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});return res}).catch(()=>caches.match('./index.html'))))});
