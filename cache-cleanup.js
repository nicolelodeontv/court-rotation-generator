/* Remove any legacy service worker/cache from older builds.
   This project is intentionally a static app without an offline service worker.
   Keeping this cleanup makes upgrades safe for visitors who used an older build
   that may have registered a service worker before it was removed. */
(()=>{
  if(!('serviceWorker' in navigator)) return;
  const cleanup=async()=>{
    try{
      const registrations=await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r=>r.unregister()));
    }catch{}
    try{
      if('caches' in window){
        const keys=await caches.keys();
        await Promise.all(keys.map(k=>caches.delete(k)));
      }
    }catch{}
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',cleanup,{once:true});
  else cleanup();
})();
