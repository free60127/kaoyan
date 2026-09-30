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
    navigator.serviceWorker.register("sw.js").catch(() => { /* 注册失败不影响网页使用 */ });
  });
}
