// No clinical or account data is cached. Network-only app: no stale offline reservations.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{let data={};try{data=event.data.json()}catch{}event.waitUntil(self.registration.showNotification('RéservAnesth',{body:data.body||'Une mise à jour vous attend dans l’application.',icon:'./icon-192.png',badge:'./icon-192.png',tag:data.tag||'reservanesth',data:{url:self.registration.scope}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const c of list){if(c.url.startsWith(self.registration.scope)){await c.focus();c.postMessage({type:'refresh'});return}}await self.clients.openWindow(self.registration.scope)})())});
