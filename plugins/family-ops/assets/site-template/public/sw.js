// Private records and pages are network-only. No private response enters CacheStorage.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Family Ops · Offline</title><body style="background:#f8f7f2;color:#35513c;font:18px/1.7 system-ui;padding:10vh 24px;max-width:520px;margin:auto"><h1 style="font:42px Georgia">A little pause.</h1><p>You’re offline. Your saved plans are safe on the server. Reconnect to open your workspace and save changes.</p><button onclick="location.reload()" style="font:inherit;padding:12px 20px;background:#35513c;color:white;border:0;border-radius:10px">Try again</button></body></html>',{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});
