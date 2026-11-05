// No clinical or account data is cached. Network-only app: no stale offline reservations.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate'&&new URL(event.request.url).origin===self.location.origin)event.respondWith(fetch(event.request,{cache:'no-store'}))});
async function updateUnreadBadge(data){
 if(!['available','opened','admin_booking'].includes(data.kind))return;
 try{
  if(!self.navigator?.setAppBadge)return;
  const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const visible=clients.filter(c=>c.url.startsWith(self.registration.scope)&&c.visibilityState==='visible');
  if(visible.length){if(self.navigator.clearAppBadge)await self.navigator.clearAppBadge();for(const c of visible)c.postMessage({type:'refresh'});return}
  // One means there is an unseen update, not the number of rooms or bookings.
  await self.navigator.setAppBadge(1);
 }catch{/* Badge failure must never prevent the visible notification. */}
}
self.addEventListener('push',event=>{let data={};try{data=event.data.json()}catch{}event.waitUntil(Promise.all([self.registration.showNotification('RéservAnesth',{body:data.body||'Une mise à jour vous attend dans l’application.',icon:'./icon-192.png',badge:'./icon-192.png',tag:data.tag||'reservanesth',data:{url:self.registration.scope}}),updateUnreadBadge(data)]))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil((async()=>{const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});for(const c of list){if(c.url.startsWith(self.registration.scope)){await c.focus();c.postMessage({type:'refresh'});return}}await self.clients.openWindow(self.registration.scope)})())});
