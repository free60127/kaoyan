/* 研途离线缓存 v2:
 * - 页面(HTML) network-first: 部署后刷新立即拿新页面, 避免旧页面引用已删除的旧哈希资源导致白屏
 * - 带哈希的静态资源(/assets/*, 图标, manifest) cache-first: 内容寻址永不变化
 * - 其余同源 GET stale-while-revalidate; 不代理跨源(DeepSeek API)与非 GET */
const CACHE_VERSION = "yantu-v2";
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

  // 页面导航: 网络优先, 失败(离线)才回缓存, 再失败回退缓存首页
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(request).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(request, { ignoreSearch: true }) || await caches.match("./");
        return cached || new Response("离线且无缓存", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }),
    );
    return;
  }

  // 静态资源: 哈希寻址, 缓存优先 + 后台更新
  const immutable = url.pathname.includes("/assets/") || url.pathname.includes("/icons/") || url.pathname.endsWith(".webmanifest");
  event.respondWith(
    caches.open(CACHE_VERSION).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: !immutable });
      const network = fetch(request).then((response) => {
        if (response && response.status === 200 && response.type === "basic") cache.put(request, response.clone());
        return response;
      }).catch(() => undefined);
      if (cached && immutable) return cached;
      if (cached) { event.waitUntil(network); return cached; }
      const fresh = await network;
      return fresh || new Response("离线", { status: 503 });
    }),
  );
});
