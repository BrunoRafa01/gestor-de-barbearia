// Service Worker do Gestor de Barbearia
// Suporte a PWA nativo, carregamento instantaneo em segundo plano e cache resiliente.

const CACHE_NAME = 'barbearia-cache-v1';

const STATIC_ASSETS = [
  '/',
  '/agendar',
  '/css/app.css',
  '/js/agendar.js',
  '/js/app.js',
  '/js/ui.js',
  '/js/api.js',
  '/js/appointments-ui.js',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Aviso ao pre-cachear:', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Requisicoes de API: Network First (sempre busca dados em tempo real)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 2. Arquivos Estaticos (CSS, JS, Fontes, Imagens): Stale While Revalidate
  // Responde imediatamente do cache para velocidade instantanea de app e atualiza em background
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
