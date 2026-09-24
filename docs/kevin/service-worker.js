/* Réseau d'abord, cache en secours (hors ligne). Seuls les fichiers du site
   passent ici : les appels à Supabase (autre origine) ne sont jamais mis en cache. */
const CACHE='buro-v6';
const ASSETS=['./','./index.html','./assets/styles.css?v=1','./assets/config.js?v=1','./assets/supabase.js?v=1','./assets/donnees.js?v=1','./assets/app.js?v=1','./manifest.webmanifest','./icon.svg'];
self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).catch(()=>{}));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin) return;
  event.respondWith(fetch(req).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(req,copy));}
    return response;
  }).catch(()=>caches.match(req)));
});
