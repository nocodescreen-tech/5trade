/**
 * 5trade — service worker pour le mode hors ligne.
 *
 * Cache les ressources statiques (frontend, CSS, JS) et les réponses
 * de l'API pour permettre l'analyse hors connexion.
 */

const CACHE_NOM = '5trade-v1';
const RESSOURCES = [
  '/',
  '/index.html',
  '/theme.js',
  '/lightweight-charts.js',
  '/reactbits.jsx'
];

// Installation : pré-cache des ressources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NOM)
      .then(cache => cache.addAll(RESSOURCES))
      .then(() => self.skipWaiting())
  );
});

// Activation : nettoyage des anciens caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE_NOM).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Interception des requêtes
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Ne pas intercepter les appels vers les APIs externes (Gemini, DeepSeek, Binance)
  const domainesExternes = [
    'generativelanguage.googleapis.com',
    'api.deepseek.com',
    'api.binance.com',
    'api.derivws.com',
    'html.duckduckgo.com'
  ];

  if (domainesExternes.includes(url.hostname)) return;
  if (request.method !== 'GET') return;

  // Stratégie : réseau d'abord, cache en repli (stale-while-revalidate)
  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache les réponses de l'API pour le mode hors ligne
        if (url.pathname.startsWith('/api/') && response.ok) {
          const copie = response.clone();
          caches.open(CACHE_NOM)
            .then(cache => cache.put(request, copie))
            .catch(() => {});
        }
        // Cache les ressources statiques
        if (request.destination === 'script' || request.destination === 'style' || request.destination === 'document') {
          const copie = response.clone();
          caches.open(CACHE_NOM)
            .then(cache => cache.put(request, copie))
            .catch(() => {});
        }
        return response;
      })
      .catch(() => {
        // Hors ligne : servir depuis le cache
        return caches.match(request)
          .then(cached => {
            if (cached) {
              // Marquer la réponse comme servie depuis le cache
              const headers = new Headers(cached.headers);
              headers.set('X-5trade-Cache', 'offline');
              return new Response(cached.body, {
                status: cached.status,
                statusText: cached.statusText,
                headers
              });
            }
            // Page hors ligne
            if (request.destination === 'document') {
              return caches.match('/')
                .then(page => page || new Response(
                  '<h1>5trade — Hors ligne</h1><p>Impossible de charger la page. Vérifiez votre connexion.</p>',
                  { headers: { 'Content-Type': 'text/html' } }
                ));
            }
            return new Response('Hors ligne', { status: 503 });
          });
      })
  );
});