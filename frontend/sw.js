/**
 * 5trade — service worker : notifications push uniquement.
 *
 * Volontairement SANS gestionnaire « fetch » : un worker qui intercepte le
 * réseau a déjà cassé le rechargement de la page (v1/v2 supprimés et purgés
 * ci-dessous). Celui-ci ne fait que deux choses :
 *   1. purger les anciens caches au premier démarrage,
 *   2. afficher les notifications push et ouvrir l'app au clic.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  event.waitUntil(
    self.registration.showNotification(d.title || '5trade', {
      body: d.body || '',
      icon: d.icon || '/logo.svg',
      badge: d.badge || '/logo.svg',
      data: d.data || {}
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(clients.openWindow(url));
});
