/**
 * Service Worker TypeScript estrito (PWA Shell Offline + Network-First para navegacao).
 * Nunca armazena respostas de /api/* para preservar dados em tempo real e seguranca.
 */

declare const self: ServiceWorkerGlobalScope;

const SHELL_CACHE = 'gb-shell-v20261123';
const SHELL_ASSETS: readonly string[] = [
  '/',
  '/agendar',
  '/css/app.css',
  '/manifest.json',
];

self.addEventListener('install', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll([...SHELL_ASSETS]))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== SHELL_CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event: FetchEvent) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  // Navegacao HTML: Network-First com fallback para shell em cache quando offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const fallbackPath = url.pathname.startsWith('/agendar') || url.pathname.startsWith('/b/')
            ? '/agendar'
            : '/';
          const shell = await caches.match(fallbackPath);
          return shell ?? new Response('Offline — conecte-se para sincronizar.', { status: 503 });
        })
    );
    return;
  }

  // Assets estaticos (/css, /js, /img, /manifest.json): Stale-While-Revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached ?? networkFetch.then((res) => res ?? new Response('', { status: 504 }));
    })
  );
});

export {};
