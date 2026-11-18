/**
 * Service Worker TypeScript estrito: limpa caches legados e garante carregamento sempre atualizado.
 * Sem referências a bundles legados em /vendor/gsap/.
 */

declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then((clients) => {
        clients.forEach((client) => {
          void client.navigate(client.url);
        });
      })
  );
});

export {};
