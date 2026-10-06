import React from "react";
import { createRoot } from "react-dom/client";
import Home from "../app/page";
import "../app/globals.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode><Home /></React.StrictMode>,
);

// PWA: 仅生产构建注册离线缓存; 开发模式直连 Vite, 不经过 Service Worker。
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => { /* 注册失败不影响网页使用 */ });
  });
  // 新版本 Service Worker 接管后刷新一次, 让部署的更新立即生效(只刷一次, 不打断输入)
  let refreshedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshedForUpdate) return;
    refreshedForUpdate = true;
    if (document.visibilityState === "visible") window.location.reload();
  });
}
