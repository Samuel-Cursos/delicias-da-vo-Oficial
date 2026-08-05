const CACHE_NAME = "delicias-da-vo-v5-1-carrinho-corrigido";

const ARQUIVOS_CACHE = [
  "/",
  "/index.html",
  "/manifest.json",
  "/css/site.css",
  "/js/storefront/site.js",
  "/js/services/partyProductService.js",
  "/js/services/financeService.js",
  "/js/services/centralOrderService.js",
  "/js/services/backupService.js",
  "/assets/logo-delicias-da-vo.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icon-maskable-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ARQUIVOS_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (url.origin !== location.origin) return;

  event.respondWith(
    fetch(req)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
        return response;
      })
      .catch(() => caches.match(req))
  );
});
