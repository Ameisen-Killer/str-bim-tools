// Service worker : l'appli s'ouvre sans réseau (cache), mise à jour en arrière-plan.
const CACHE='controle-armature-v12';
const FILES=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./icon-180.png',
  './vendor/jspdf-2.5.1.umd.min.js','./vendor/jszip-3.10.1.min.js','./vendor/xlsx-0.18.5.full.min.js',
  '/assets/polices/polices.css'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method==='GET'&&u.hostname==='cdn.jsdelivr.net'){ // bibliothèque Whisper : en cache pour le hors-ligne
    e.respondWith(caches.open(CACHE).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok)c.put(e.request,r.clone());return r;}))));return;}
  if(e.request.method!=='GET'||u.origin!==location.origin)return; // Graph / login Microsoft : jamais en cache
  e.respondWith(caches.match(e.request,{ignoreSearch:true}).then(hit=>{
    const net=fetch(e.request).then(r=>{if(r.ok)caches.open(CACHE).then(c=>c.put(e.request,r.clone()));return r;}).catch(()=>hit);
    return hit||net;
  }));
});
