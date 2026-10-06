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
  // 新版本 Service Worker 接管: 若用户有进行中的活动(答题/语音/AI 请求/未保存)只提示, 否则刷新一次立即生效
  let refreshedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshedForUpdate) return;
    refreshedForUpdate = true;
    if (document.visibilityState !== "visible") return;
    const busy = document.querySelector(".mock-progress, .speech-input-controls [class*=listening], .ai-result ~ * , [data-busy=true]");
    const typing = document.activeElement instanceof HTMLTextAreaElement || document.activeElement instanceof HTMLInputElement;
    if (busy || typing) {
      const banner = document.createElement("div");
      banner.className = "sw-update-banner";
      banner.setAttribute("role", "status");
      banner.textContent = "网站已更新到新版本。完成当前操作后刷新页面即可应用；不会丢失当前作答。";
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 15000);
      return;
    }
    window.location.reload();
  });
}
