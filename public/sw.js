/* 研途离线缓存 v3:
 * - 页面(HTML) network-first: 部署后刷新立即拿新页面; 缓存仅作离线兜底, 且只兜底页面导航
 * - 带哈希的静态资源(/assets/*, 图标, manifest) cache-first: 内容寻址永不变化; 缺失时返回 404, 绝不回退首页 HTML
 * - 只清理本项目(yantu-*)缓存, 不碰同域其他项目的缓存
 * - 其余同源 GET stale-while-revalidate; 不代理跨源(DeepSeek API)与非 GET */
const CACHE_VERSION = "yantu-v3";
const PRECACHE = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("yantu-") && key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航: 网络优先; 离线才回缓存页面; 都没有给 503 提示(不把 HTML 当其他资源返回)
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
        return cached || new Response("当前离线，且尚未缓存此页面。恢复网络后刷新即可。", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
      }),
    );
    return;
  }

  // 静态资源: 哈希寻址 cache-first; 其余 stale-while-revalidate; 失败如实返回 503/404
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
      return fresh || new Response("资源不可用：当前离线且未缓存。", { status: 503 });
    }),
  );
});
