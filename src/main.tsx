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
  // 新版本 Service Worker 接管: 一律显示横幅, 由用户手动刷新(自动 reload 会打断复习/丢失翻面状态)
  let announced = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (announced || document.visibilityState !== "visible") return;
    announced = true;
    const banner = document.createElement("div");
    banner.className = "sw-update-banner";
    banner.setAttribute("role", "status");
    banner.append("网站已更新，当前页面继续可用，不会再自动刷新。");
    const action = document.createElement("button");
    action.textContent = "刷新应用新版";
    action.addEventListener("click", () => window.location.reload());
    banner.appendChild(action);
    const dismiss = document.createElement("button");
    dismiss.textContent = "稍后";
    dismiss.addEventListener("click", () => banner.remove());
    banner.appendChild(dismiss);
    document.body.appendChild(banner);
  });
}
