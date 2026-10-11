/** 测试专用渲染入口: 与 react/react-dom 打进同一 bundle, 避免 React 双实例。 */
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RichTextView } from "../../app/components/RichTextView";

const roots: Root[] = [];
export function mountRichTextView(props: Record<string, unknown>, container: HTMLElement) {
  const root = createRoot(container);
  root.render(createElement(RichTextView, props as never));
  roots.push(root);
}
export function unmountAll() {
  for (const root of roots) { try { root.unmount(); } catch { /* ignore */ } }
  roots.length = 0;
}
