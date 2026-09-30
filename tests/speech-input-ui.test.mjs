import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../lib/speech-input-ui.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { createSpeechInputUi, speechStatusText } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
);
const result = (text, isFinal = false) => ({ 0: { transcript: text }, isFinal });

function harness({ language = "zh-CN", initialAnswer = "", queuedUpdates = false, unsupported = false } = {}) {
  const keys = ["SpeechRecognition", "webkitSpeechRecognition", "isSecureContext"];
  const saved = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const instances = [], states = [], updates = [];
  let answer = initialAnswer;
  class Recognition {
    onstart = null; onend = null; onerror = null; onresult = null;
    stopCalls = 0; abortCalls = 0;
    constructor() { instances.push(this); }
    start() {}
    stop() { this.stopCalls++; }
    abort() { this.abortCalls++; }
    startEvent() { this.onstart?.(); }
    resultsEvent(results, resultIndex = 0) { this.onresult?.({ results, resultIndex }); }
    errorEvent(error) { this.onerror?.({ error }); }
    endEvent() { this.onend?.(); }
  }
  Object.defineProperty(globalThis, "SpeechRecognition", { configurable: true, value: unsupported ? undefined : Recognition });
  Object.defineProperty(globalThis, "webkitSpeechRecognition", { configurable: true, value: undefined });
  Object.defineProperty(globalThis, "isSecureContext", { configurable: true, value: true });
  const ui = createSpeechInputUi({
    language,
    setAnswer: (update) => { updates.push(update); if (!queuedUpdates) answer = update(answer); },
    onChange: (state) => states.push(state),
  });
  return {
    ui, instances, states, updates,
    get answer() { return answer; },
    get state() { return states.at(-1); },
    type(text) { answer = text; },
    flush() { for (const update of updates.splice(0)) answer = update(answer); },
    cleanup() {
      ui.dispose();
      keys.forEach((key, index) => {
        if (saved[index]) Object.defineProperty(globalThis, key, saved[index]);
        else delete globalThis[key];
      });
    },
  };
}

test("UI waits for actual start and keeps changing interim text out of the editable answer", () => {
  const h = harness({ initialAnswer: "手动内容：" });
  try {
    assert.equal(h.ui.start(), true);
    assert.equal(h.state.status, "starting");
    assert.match(speechStatusText[h.state.status], /等待浏览器/);
    const r = h.instances[0];
    r.startEvent();
    assert.equal(h.state.status, "listening");
    r.resultsEvent([result("教育")]);
    r.resultsEvent([result("教育学")]);
    assert.equal(h.state.interim, "教育学");
    assert.equal(h.answer, "手动内容：");
    assert.equal(h.updates.length, 0);
  } finally { h.cleanup(); }
});

test("confirmed deltas append to current manual text without duplicating repeated final indices", () => {
  const h = harness({ initialAnswer: "我理解的是：" });
  try {
    h.ui.start(); const r = h.instances[0]; r.startEvent();
    r.resultsEvent([result("教育学")]);
    h.type("我手动修改为：");
    r.resultsEvent([result("教育学", true)]);
    r.resultsEvent([result("教育学", true)]);
    assert.equal(h.answer, "我手动修改为：教育学");
    assert.equal(h.state.interim, "");
    h.type(h.answer + "\n补充：");
    r.resultsEvent([result("教育学", true), result("研究教育现象", true)], 1);
    assert.equal(h.answer, "我手动修改为：教育学\n补充：研究教育现象");
    assert.equal(h.updates.length, 2);
  } finally { h.cleanup(); }
});

test("functional updates use latest text when React queues updates, including English spacing", () => {
  const h = harness({ language: "en-US", queuedUpdates: true, initialAnswer: "Initial" });
  try {
    h.ui.start(); const r = h.instances[0]; r.startEvent();
    assert.equal(r.lang, "en-US");
    r.resultsEvent([result("first", true)]);
    h.type("Edited manually");
    r.resultsEvent([result("first", true), result("second", true)], 1);
    h.flush();
    assert.equal(h.answer, "Edited manually first second");
  } finally { h.cleanup(); }
});

test("stop stays active until end and accepts the last confirmed text once", () => {
  const h = harness();
  try {
    h.ui.start(); const r = h.instances[0]; r.startEvent();
    r.resultsEvent([result("最后")]);
    h.ui.stop();
    assert.equal(h.state.status, "stopping");
    assert.equal(h.ui.start(), false);
    assert.equal(r.stopCalls, 1);
    r.resultsEvent([result("最后一句", true)]);
    r.endEvent();
    assert.equal(h.state.status, "idle");
    assert.equal(h.state.interim, "");
    assert.equal(h.answer, "最后一句");
    assert.equal(h.instances.length, 1);
  } finally { h.cleanup(); }
});

test("native failures show actionable Chinese messages, clear interim and allow explicit retry", () => {
  for (const [code, explanation] of [
    ["network", /检查网络.*系统听写/], ["not-allowed", /麦克风权限.*系统听写/],
    ["audio-capture", /检查麦克风/], ["no-speech", /输入音量/],
  ]) {
    const h = harness({ initialAnswer: "已写内容" });
    try {
      h.ui.start(); const r = h.instances[0]; r.startEvent();
      r.resultsEvent([result("临时内容")]);
      r.errorEvent(code);
      assert.equal(h.state.status, "idle");
      assert.equal(h.state.interim, "");
      assert.equal(h.state.error.code, code);
      assert.match(h.state.error.message, explanation);
      assert.equal(h.answer, "已写内容");
      assert.equal(h.instances.length, 1);
      h.ui.start();
      assert.equal(h.state.error, null);
      assert.equal(h.state.status, "starting");
      assert.equal(h.instances.length, 2);
    } finally { h.cleanup(); }
  }
});

test("unsupported recognition displays the system dictation or typing fallback while staying idle", () => {
  const h = harness({ unsupported: true });
  try {
    assert.equal(h.ui.start(), false);
    assert.equal(h.state.status, "idle");
    assert.equal(h.state.error.code, "unsupported");
    assert.match(h.state.error.message, /系统听写.*直接输入/);
    assert.equal(h.instances.length, 0);
  } finally { h.cleanup(); }
});

test("scope disposal rejects saved callbacks and pending answer updates from the departed scope", () => {
  const h = harness({ queuedUpdates: true, initialAnswer: "旧章节" });
  try {
    h.ui.start(); const r = h.instances[0]; r.startEvent();
    r.resultsEvent([result("旧结果", true), result("旧临时结果")]);
    const saved = { result: r.onresult, start: r.onstart, error: r.onerror, end: r.onend };
    const count = h.states.length;
    h.ui.dispose();
    h.type("新章节手动文字");
    h.flush();
    saved.result({ resultIndex: 0, results: [result("滞后结果", true)] });
    saved.start(); saved.error({ error: "network" }); saved.end();
    h.ui.stop();
    assert.equal(h.ui.start(), false);
    assert.equal(h.answer, "新章节手动文字");
    assert.equal(h.states.length, count);
    assert.equal(r.abortCalls, 1);
    assert.equal(r.onresult, null);
  } finally { h.cleanup(); }
});

test("a new language or scope has a fresh session and cannot receive an old session's result", () => {
  const old = harness();
  let stale;
  try {
    old.ui.start(); old.instances[0].startEvent();
    stale = old.instances[0].onresult;
    old.ui.dispose();
  } finally { old.cleanup(); }
  const next = harness({ language: "en-US", initialAnswer: "New scope" });
  try {
    next.ui.start(); const r = next.instances[0]; r.startEvent();
    stale({ resultIndex: 0, results: [result("旧章节", true)] });
    r.resultsEvent([result("answer", true)]);
    assert.equal(next.answer, "New scope answer");
    assert.equal(next.state.error, null);
  } finally { next.cleanup(); }
});
