import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 债3: RichTextView 渲染回归——无样式段必须是裸文本节点（.flash-card span 的来源行样式
// 三次回归事故的守卫），带样式段必须是 span.rich-seg。
const require = createRequire(import.meta.url);
const { build } = require("esbuild");

// happy-dom 环境先于 react-dom 加载
const { Window } = await import("happy-dom");
const window = new Window({ url: "http://localhost/" });
const define = (name, value) => {
  try { Object.defineProperty(globalThis, name, { configurable: true, get: () => value }); }
  catch { globalThis[name] = value; }
};
define("window", window);
define("document", window.document);
for (const name of ["Element", "HTMLElement", "Node", "Text", "MutationObserver", "getComputedStyle"]) define(name, window[name]);
define("requestAnimationFrame", callback => setTimeout(() => callback(Date.now()), 0));
define("cancelAnimationFrame", id => clearTimeout(id));

// react + react-dom + RichTextView 打进同一 bundle: 单一 React 实例
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("support/rich-render-entry.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "browser", target: "node20",
  jsx: "automatic", minify: false,
});
const renderer = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

const document = window.document;

async function renderView(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  renderer.mountRichTextView(props, container);
  await new Promise(resolve => setTimeout(resolve, 30));
  return container;
}

test.after(() => renderer.unmountAll());

test("plain text renders as bare text nodes with no wrapping span", async () => {
  const container = await renderView({ text: "普通的黑色正文，没有任何标记。" });
  const spans = container.querySelectorAll("span");
  assert.equal(spans.length, 0, `unstyled text must not be wrapped, got ${container.innerHTML}`);
  assert.match(container.textContent, /普通的黑色正文，没有任何标记。/);
});

test("textbook markers render as span.rich-seg with the marker class", async () => {
  const container = await renderView({ text: "前文 ⟦g|绿色重点内容⟧ 后文" });
  const span = container.querySelector("span.rich-seg");
  assert.ok(span, "styled segment must be a span.rich-seg");
  assert.ok(span.className.includes("hl-g") || span.className.includes("g"), `textbook class missing: ${span.className}`);
  assert.equal(span.textContent, "绿色重点内容");
  // 前后文是裸文本节点, 不是 span
  const spans = [...container.querySelectorAll("span")];
  assert.equal(spans.length, 1, `only the styled segment may be a span, got ${spans.length}: ${container.innerHTML}`);
  assert.ok([...container.childNodes].some(node => node.nodeType === 3 && node.textContent === "前文 "));
});

test("mixed segments: bare text stays bare, styled text becomes spans", async () => {
  const container = await renderView({ text: "甲 ⟦r|红色⟧ 乙 ⟦y|黄色⟧ 丙 ⟦b|黑体⟧ 丁" });
  const spans = [...container.querySelectorAll("span")];
  assert.equal(spans.length, 3, `3 styled segments, got ${spans.length}: ${container.innerHTML}`);
  const bare = [...container.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent);
  assert.ok(bare.some(text => text.includes("甲 ")));
  assert.ok(bare.some(text => text.includes(" 乙 ")));
  assert.ok(bare.some(text => text.includes(" 丁")));
  const classes = spans.map(span => span.className).join("|");
  assert.ok(classes.includes("hl-r"), classes);
  assert.ok(classes.includes("hl-y"), classes);
  // 教材黑体标记渲染为 hl-b(教材标记类), 不是个人加粗 rich-b
  assert.ok(classes.includes("hl-b"), classes);
});

test("personal runs: color/highlight/bold/underline classes and styles", async () => {
  const text = "统一文本段落";
  const container = await renderView({
    text,
    runs: [
      { start: 0, end: 2, kind: "color", value: "#cf3b2e" },
      { start: 2, end: 4, kind: "hl", value: "#ffe98a" },
      { start: 4, end: 5, kind: "b" },
      { start: 5, end: 6, kind: "u" },
    ],
  });
  const spans = [...container.querySelectorAll("span.rich-seg")];
  assert.equal(spans.length, 4, `4 runs -> 4 spans, got ${spans.length}: ${container.innerHTML}`);
  assert.equal(spans[0].style.color, "#cf3b2e"); // happy-dom 保留原始值
  assert.equal(spans[1].style.backgroundColor, "#ffe98a");
  assert.ok(spans[2].className.includes("rich-b"));
  assert.ok(spans[3].className.includes("rich-u"));
});

test("renderTextbook=false leaves textbook markers as bare text", async () => {
  const container = await renderView({ text: "前 ⟦g|绿色⟧ 后", renderTextbook: false });
  assert.equal(container.querySelectorAll("span").length, 0, `no spans expected: ${container.innerHTML}`);
  assert.ok(container.textContent.includes("绿色"));
});
