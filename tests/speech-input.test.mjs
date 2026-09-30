import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle the production TypeScript in memory; no generated files or microphone use.
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../lib/speech-input.ts", import.meta.url))],
  bundle: true, platform: "node", format: "esm", write: false,
});
const { createSpeechInputSession, appendSpeechText, getSpeechErrorMessage } =
  await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);

class Clock {
  now = 0;
  nextId = 0;
  tasks = new Map();
  setTimeout = (callback, milliseconds) => {
    const id = ++this.nextId;
    this.tasks.set(id, { callback, at: this.now + milliseconds });
    return id;
  };
  clearTimeout = (id) => this.tasks.delete(id);
  tick(milliseconds) {
    const end = this.now + milliseconds;
    while (true) {
      const next = [...this.tasks].filter(([, task]) => task.at <= end)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, task] = next;
      this.tasks.delete(id);
      this.now = task.at;
      task.callback();
    }
    this.now = end;
  }
}

function result(text, isFinal = false) {
  return { 0: { transcript: text }, isFinal };
}

function harness(options = {}) {
  const clock = new Clock();
  const instances = [];
  const statuses = [], finals = [], interims = [], errors = [];
  class Recognition {
    startCalls = 0;
    stopCalls = 0;
    abortCalls = 0;
    onstart = null;
    onresult = null;
    onend = null;
    onerror = null;
    constructor() { instances.push(this); }
    start() { this.startCalls++; }
    stop() { this.stopCalls++; }
    abort() { this.abortCalls++; }
    emitStart() { this.onstart?.(); }
    emitResult(results, resultIndex = 0) { this.onresult?.({ results, resultIndex }); }
    emitEnd() { this.onend?.(); }
    emitError(error) { this.onerror?.({ error, message: "private browser diagnostic" }); }
  }
  const session = createSpeechInputSession({
    recognitionConstructor: Recognition, timers: clock, isSecureContext: true,
    onStatus: (status) => statuses.push(status),
    onFinal: (delta, transcript) => finals.push({ delta, transcript }),
    onInterim: (text) => interims.push(text),
    onError: (error) => errors.push(error),
    ...options,
  });
  return { session, clock, instances, statuses, finals, interims, errors };
}

test("start waits for onstart and configures language, continuous and interim results", () => {
  const h = harness();
  assert.equal(h.session.start(), true);
  assert.equal(h.session.getStatus(), "starting");
  assert.deepEqual(h.statuses, ["starting"]);
  const r = h.instances[0];
  assert.equal(r.lang, "zh-CN");
  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  r.emitStart();
  assert.deepEqual(h.statuses, ["starting", "listening"]);
  h.session.dispose();
  assert.equal(h.clock.tasks.size, 0);
});

test("interim updates independently; final commits once per index and respects resultIndex", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  r.emitResult([result("教育")]);
  r.emitResult([result("教育学")]);
  assert.deepEqual(h.finals, []);
  r.emitResult([result("教育学", true)]);
  r.emitResult([result("教育学", true)]);
  r.emitResult([result("教育学", true), result("的研究")], 1);
  r.emitResult([result("教育学", true), result("的研究对象", true)], 1);
  r.emitResult([result("教育学", true), result("的研究对象", true)]);
  assert.deepEqual(h.finals, [
    { delta: "教育学", transcript: "教育学" },
    { delta: "的研究对象", transcript: "教育学的研究对象" },
  ]);
  assert.deepEqual(h.interims, ["教育", "教育学", "", "的研究", ""]);
  h.session.dispose();
});

test("identical words at different final indices are retained", () => {
  const h = harness({ language: "en-US" });
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  r.emitResult([result("very", true), result("very", true), result("good", true)]);
  assert.deepEqual(h.finals, [{ delta: "very very good", transcript: "very very good" }]);
  h.session.dispose();
});

test("changed resultIndex keeps earlier interim segments and removes retracted segments", () => {
  const h = harness({ language: "en-US" });
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  r.emitResult([result("hello"), result("world")]);
  r.emitResult([result("hello"), result("there")], 1);
  r.emitResult([result("hello")], 1);
  r.emitResult([], 0);
  assert.deepEqual(h.interims, ["hello world", "hello there", "hello", ""]);
  assert.deepEqual(h.finals, []);
  h.session.dispose();
});

test("stop accepts trailing final results until onend, then clears callbacks and timers", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  r.emitResult([result("最后")]);
  h.session.stop();
  h.session.stop();
  assert.equal(r.stopCalls, 1);
  assert.equal(h.session.getStatus(), "stopping");
  r.emitResult([result("最后一句", true)]);
  r.emitEnd();
  assert.deepEqual(h.finals, [{ delta: "最后一句", transcript: "最后一句" }]);
  assert.deepEqual(h.statuses, ["starting", "listening", "stopping", "idle"]);
  assert.equal(h.clock.tasks.size, 0);
  assert.equal(r.onresult, null);
  assert.equal(r.abortCalls, 0);
  assert.deepEqual(h.errors, []);
});

test("dispose rejects queued events and does not update a departed UI", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  r.emitResult([result("暂时文字")]);
  const stale = { start: r.onstart, result: r.onresult, end: r.onend, error: r.onerror };
  const before = { statuses: [...h.statuses], interims: [...h.interims] };
  h.session.dispose();
  h.session.dispose();
  stale.start();
  stale.result({ results: [result("旧章节答案", true)], resultIndex: 0 });
  stale.error({ error: "network" });
  stale.end();
  h.clock.tick(60000);
  assert.deepEqual(h.finals, []);
  assert.deepEqual(h.errors, []);
  assert.deepEqual(h.statuses, before.statuses);
  assert.deepEqual(h.interims, before.interims);
  assert.equal(h.session.start(), false);
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(h.clock.tasks.size, 0);
  assert.equal(r.abortCalls, 1);
});

test("repeat start never creates a second instance until the old run ends", () => {
  const h = harness();
  h.session.start();
  assert.equal(h.session.start(), false);
  const first = h.instances[0];
  first.emitStart();
  assert.equal(h.session.start(), false);
  h.session.stop();
  assert.equal(h.session.start(), false);
  const staleResult = first.onresult;
  first.emitEnd();
  assert.equal(h.session.start(), true);
  const second = h.instances[1];
  second.emitStart();
  staleResult({ results: [result("stale", true)], resultIndex: 0 });
  second.emitResult([result("new", true)]);
  assert.deepEqual(h.finals, [{ delta: "new", transcript: "new" }]);
  assert.equal(h.instances.length, 2);
  h.session.dispose();
});

test("start exceptions clear timers and never expose exception.message", () => {
  for (const [name, expected] of [
    ["Error", "start-failed"], ["NotAllowedError", "not-allowed"],
    ["SecurityError", "not-allowed"], ["NotReadableError", "audio-capture"],
    ["NetworkError", "network"], ["NotSupportedError", "unsupported"], ["AbortError", "aborted"],
  ]) {
    const h = harness();
    // Change the prototype before start; the real controller still constructs its instance.
    const makeThrow = function () { const error = new Error("private path/key detail"); error.name = name; throw error; };
    h.session.start();
    const r = h.instances[0];
    r.emitEnd();
    Object.getPrototypeOf(r).start = makeThrow;
    h.errors.length = 0;
    assert.equal(h.session.start(), false);
    assert.equal(h.session.getStatus(), "idle");
    assert.equal(h.errors[0].code, expected);
    assert.ok(!h.errors[0].message.includes("private"));
    assert.equal(h.clock.tasks.size, 0);
    assert.equal(h.instances[1].abortCalls, 1);
  }
});

test("constructor exception returns a helpful error without a partial run", () => {
  const h = harness({ recognitionConstructor: class { constructor() { throw new Error("secret"); } } });
  assert.equal(h.session.start(), false);
  assert.equal(h.errors[0].code, "start-failed");
  assert.equal(h.clock.tasks.size, 0);
  assert.deepEqual(h.statuses, []);
});

test("unsupported and insecure contexts fail before touching the microphone API", () => {
  const unsupported = harness({ recognitionConstructor: null });
  assert.equal(unsupported.session.start(), false);
  assert.equal(unsupported.errors[0].code, "unsupported");
  const insecure = harness({ isSecureContext: false });
  assert.equal(insecure.session.start(), false);
  assert.equal(insecure.errors[0].code, "insecure-context");
  assert.equal(insecure.instances.length, 0);
  assert.equal(insecure.clock.tasks.size, 0);
});

test("browser discovery supports the standard API and webkit fallback and uses browser security", () => {
  const keys = ["SpeechRecognition", "webkitSpeechRecognition", "isSecureContext"];
  const saved = keys.map((key) => Object.getOwnPropertyDescriptor(globalThis, key));
  const makeConstructor = () => {
    const h = harness();
    h.session.start();
    const Constructor = h.instances[0].constructor;
    h.session.dispose();
    return { h, Constructor };
  };
  const standard = makeConstructor(), prefixed = makeConstructor();
  try {
    Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
    Object.defineProperty(globalThis, "SpeechRecognition", { value: standard.Constructor, configurable: true });
    Object.defineProperty(globalThis, "webkitSpeechRecognition", { value: prefixed.Constructor, configurable: true });
    const session = createSpeechInputSession({ timers: new Clock() });
    session.start();
    assert.equal(standard.h.instances.length, 2);
    assert.equal(prefixed.h.instances.length, 1);
    session.dispose();
    delete globalThis.SpeechRecognition;
    const fallback = createSpeechInputSession({ timers: new Clock() });
    fallback.start();
    assert.equal(prefixed.h.instances.length, 2);
    fallback.dispose();
    Object.defineProperty(globalThis, "isSecureContext", { value: false, configurable: true });
    const errors = [];
    const insecure = createSpeechInputSession({ onError: (error) => errors.push(error) });
    assert.equal(insecure.start(), false);
    assert.equal(errors[0].code, "insecure-context");
    assert.equal(prefixed.h.instances.length, 2);
  } finally {
    keys.forEach((key, index) => {
      if (saved[index]) Object.defineProperty(globalThis, key, saved[index]);
      else delete globalThis[key];
    });
  }
});

test("native error codes have distinct safe messages and end the run without onend", () => {
  const codes = ["not-allowed", "service-not-allowed", "audio-capture", "network", "no-speech", "aborted", "language-not-supported"];
  assert.equal(new Set(codes.map(getSpeechErrorMessage)).size, codes.length);
  for (const code of [...codes, "unexpected-browser-error"]) {
    const h = harness();
    h.session.start();
    const r = h.instances[0];
    r.emitStart();
    r.emitError(code);
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0].code, codes.includes(code) ? code : "unknown");
    assert.ok(!h.errors[0].message.includes("private browser diagnostic"));
    assert.equal(h.session.getStatus(), "idle");
    assert.equal(h.clock.tasks.size, 0);
    assert.equal(r.abortCalls, 1);
  }
  assert.equal(getSpeechErrorMessage("constructor"), getSpeechErrorMessage("unknown"));
});

test("intentional stop abort error is quiet, unexpected abort explains the interruption", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  h.session.stop();
  r.emitError("aborted");
  assert.deepEqual(h.errors, []);
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(h.clock.tasks.size, 0);
});

test("12-second start watchdog aborts a silent service and ignores its late events", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  const staleStart = r.onstart;
  h.clock.tick(11999);
  assert.equal(h.session.getStatus(), "starting");
  h.clock.tick(1);
  assert.equal(h.errors[0].code, "start-timeout");
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(r.abortCalls, 1);
  staleStart();
  h.clock.tick(60000);
  assert.equal(h.errors.length, 1);
  assert.equal(h.instances.length, 1);
  assert.equal(h.clock.tasks.size, 0);
});

test("30 seconds without text stops recognition; stop timeout aborts without a second error", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  h.clock.tick(11000);
  r.emitStart();
  h.clock.tick(29999);
  assert.equal(h.session.getStatus(), "listening");
  h.clock.tick(1);
  assert.equal(h.errors[0].code, "no-result-timeout");
  assert.equal(h.session.getStatus(), "stopping");
  assert.equal(r.stopCalls, 1);
  h.clock.tick(3000);
  assert.equal(r.abortCalls, 1);
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(h.errors.length, 1);
  assert.equal(h.clock.tasks.size, 0);
  assert.equal(h.instances.length, 1);
});

test("nonempty results reset the inactivity watchdog; empty results do not", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  h.clock.tick(29000);
  r.emitResult([result("hello")]);
  h.clock.tick(29000);
  assert.equal(h.session.getStatus(), "listening");
  r.emitResult([result("   ")]);
  h.clock.tick(1000);
  assert.equal(h.errors[0].code, "no-result-timeout");
  r.emitResult([result("hello world", true)]);
  r.emitEnd();
  assert.deepEqual(h.finals, [{ delta: "hello world", transcript: "hello world" }]);
  assert.equal(h.clock.tasks.size, 0);
});

test("stop during start cancels the start watchdog and rejects a late onstart", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  h.session.stop();
  r.emitStart();
  assert.equal(h.session.getStatus(), "stopping");
  r.emitEnd();
  h.clock.tick(60000);
  assert.deepEqual(h.errors, []);
  assert.equal(h.clock.tasks.size, 0);
});

test("stop without onend has a bounded fallback; stop throwing also releases the run", () => {
  const h = harness();
  h.session.start();
  const r = h.instances[0];
  r.emitStart();
  h.session.stop();
  h.clock.tick(2999);
  assert.equal(h.session.getStatus(), "stopping");
  h.clock.tick(1);
  assert.equal(h.errors[0].code, "stop-timeout");
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(h.clock.tasks.size, 0);
  h.session.start();
  const next = h.instances[1];
  next.stop = () => { throw new Error("private detail"); };
  h.session.stop();
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(h.clock.tasks.size, 0);
  assert.equal(next.abortCalls, 1);
});

test("spontaneous end without text explains silence; successful end does not restart", () => {
  const h = harness();
  h.session.start();
  h.instances[0].emitEnd();
  assert.equal(h.errors[0].code, "no-speech");
  assert.equal(h.session.getStatus(), "idle");
  assert.equal(h.clock.tasks.size, 0);
  h.session.start();
  h.instances[1].emitStart();
  h.instances[1].emitResult([result("有文字", true)]);
  h.instances[1].emitEnd();
  h.clock.tick(60000);
  assert.equal(h.errors.length, 1);
  assert.equal(h.instances.length, 2);
});

test("callbacks can dispose during start or final delivery without resurrecting timers", () => {
  let session;
  const starting = harness({ onStatus: (status) => { if (status === "starting") session.dispose(); } });
  session = starting.session;
  assert.equal(session.start(), false);
  assert.equal(starting.instances[0].startCalls, 0);
  assert.equal(starting.clock.tasks.size, 0);
  const final = harness({ onFinal: () => session.dispose() });
  session = final.session;
  session.start();
  final.instances[0].emitStart();
  final.instances[0].emitResult([result("完成", true), result("旧临时文字")]);
  assert.deepEqual(final.interims, []);
  assert.equal(final.clock.tasks.size, 0);
  assert.equal(session.getStatus(), "idle");
});

test("a stop requested by the starting callback does not later start the microphone API", () => {
  let session;
  const h = harness({ onStatus: (status) => { if (status === "starting") session.stop(); } });
  session = h.session;
  assert.equal(session.start(), false);
  assert.equal(h.instances[0].startCalls, 0);
  assert.equal(h.instances[0].stopCalls, 1);
  assert.equal(session.getStatus(), "stopping");
  h.instances[0].emitEnd();
  assert.equal(h.clock.tasks.size, 0);
});

test("English and Chinese appends preserve word boundaries and punctuation", () => {
  assert.equal(appendSpeechText("教育", "学", "zh-CN"), "教育学");
  assert.equal(appendSpeechText("hello", "world", "en-US"), "hello world");
  assert.equal(appendSpeechText("Hello.", "Next sentence", "en-US"), "Hello. Next sentence");
  assert.equal(appendSpeechText("hello", ", world", "en-US"), "hello, world");
  assert.equal(appendSpeechText("(", "hello", "en-US"), "(hello");
  assert.equal(appendSpeechText("教育。", "下一句", "zh-CN"), "教育。下一句");
  assert.equal(appendSpeechText("English", "words", "zh-CN"), "English words");
  assert.equal(appendSpeechText("第一段\n", "第二段", "zh-CN"), "第一段\n第二段");
  assert.equal(appendSpeechText("hello  ", "world", "en-US"), "hello  world");
  assert.equal(appendSpeechText("  保留原文  ", "   "), "  保留原文  ");
});

test("configured English language is forwarded exactly", () => {
  const h = harness({ language: "en-US" });
  h.session.start();
  const r = h.instances[0];
  assert.equal(r.lang, "en-US");
  r.emitStart();
  r.emitResult([result("First", true)]);
  r.emitResult([result("First", true), result("second", true)], 1);
  assert.deepEqual(h.finals.at(-1), { delta: "second", transcript: "First second" });
  h.session.dispose();
});
