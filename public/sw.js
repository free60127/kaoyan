/* 研途离线缓存: 静态资源 stale-while-revalidate, 不代理 DeepSeek API(跨源)与 Vite 开发服务。 */
const CACHE_VERSION = "yantu-v1";
const PRECACHE = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: url.pathname.endsWith("/") });
      const network = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") cache.put(request, response.clone());
        return response;
      }).catch(() => undefined);
      if (cached) { event.waitUntil(network); return cached; }
      const fresh = await network;
      if (fresh) return fresh;
      const fallback = await cache.match("./");
      return fallback || new Response("离线且无缓存", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }),
  );
});
