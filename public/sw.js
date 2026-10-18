// Service worker: solo notifiche push (nessuna cache dei dati)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Molajoni · Flotta', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Molajoni · Flotta', {
    body: d.body || '', icon: (d.url || '/').indexOf('/t') === 0 ? '/icon-tecnico-192.png' : '/icon-gestione-192.png', badge: '/icon-tecnico-192.png', tag: d.tag, data: { url: d.url || '/' },
    requireInteraction: !!d.urgente, vibrate: d.urgente ? [300, 120, 300, 120, 600] : [150],
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) { if ('focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
