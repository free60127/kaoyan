import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "mock-quiz-tests-"));
await build({ entryPoints: ["lib/deepseek-browser.ts", "lib/mock-paper-templates.ts"], bundle: true, platform: "node", format: "esm", outdir: temp, logLevel: "silent" });
const api = await import(pathToFileURL(join(temp, "deepseek-browser.js")));
const templates = await import(pathToFileURL(join(temp, "mock-paper-templates.js")));
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await rm(temp, { recursive: true, force: true }); });

const cfg = (counts = {}) => ({ "single-choice": 0, definition: 0, "short-answer": 0, essay: 0, "material-analysis": 0, ...counts });
const context333 = { subject: "333", ranges: [{ bookId: "principles", chapters: [1], section: "第一节 教育的概念" }] };
const context825 = { subject: "825", ranges: [{ bookId: "linguistics", chapters: [1], section: "语言的定义" }] };
const key = "sk-fake-TEST-DO-NOT-USE";
function reply(value, overrides = {}) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: typeof value === "string" ? value : JSON.stringify(value) }, ...overrides }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function mockResponder(transform = (rows) => rows) {
  const calls = [];
  let sequence = 0;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const reference = JSON.parse(body.messages[1].content.split("\n").slice(1).join("\n"));
    const type = body.messages[2].content.match(/type必须为([^。]+)\。/)[1];
    const rows = reference.map((unit) => {
      const base = { type, bookId: unit.bookId, chapterNo: unit.chapterNo, stem: `Mock question ${++sequence}`, knowledgePointIds: [unit.notes[0].id] };
      return type === "single-choice" ? { ...base, options: ["A", "B", "C", "D"], answer: 1, explanation: "Reason from the supplied notes." }
        : { ...base, referenceAnswer: "Reference answer based on notes.", rationale: "Supported by the supplied notes." };
    });
    const value = transform(rows, calls.length, body);
    return value instanceof Response ? value : reply({ questions: value });
  };
  return calls;
}

test("config validates exact integer bounds and snapshots input", () => {
  assert.equal(api.MAX_MOCK_QUIZ_QUESTIONS, 60);
  assert.deepEqual(Object.keys(api.MOCK_QUIZ_TYPE_LABELS), api.MOCK_QUIZ_TYPES);
  for (const invalid of [null, [], cfg(), cfg({ essay: 61 }), cfg({ essay: -1 }), cfg({ essay: 0.5 }), cfg({ essay: "1" }), cfg({ essay: NaN }), cfg({ essay: Infinity }), cfg({ essay: 60, definition: 1 }), { essay: 1 }, cfg({ essay: 1, alien: 1 })]) {
    assert.throws(() => api.validateMockQuizConfig(invalid));
  }
  const original = cfg({ essay: 60 });
  const copy = api.validateMockQuizConfig(original);
  original.essay = 1;
  assert.equal(copy.essay, 60);
});

for (const ctx of [context333, context825]) test(`${ctx.subject} mixed question types, scope notes, strict request and progress`, async () => {
  const calls = mockResponder();
  const progress = [];
  const result = await api.generateMockQuiz(key, cfg({ "single-choice": 4, definition: 1, "short-answer": 1, essay: 1, "material-analysis": 1 }), ctx, { onProgress: (...args) => progress.push(args) });
  assert.equal(result.questions.length, 8);
  assert.equal(calls.length, 6);
  assert.deepEqual(progress, [[0, 8], [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8]]);
  assert.equal(result.coverage.complete, true);
  assert.match(result.coverage.note, /不代表覆盖全部知识点/);
  assert.equal(new Set(result.questions.map((q) => q.id)).size, 8);
  for (const call of calls) {
    assert.equal(call.url, "https://api.deepseek.com/chat/completions");
    assert.equal(call.init.headers.Authorization, "Bearer " + key);
    assert.equal(call.body.model, "deepseek-chat");
    assert.equal(call.body.stream, false);
    assert.deepEqual(call.body.response_format, { type: "json_object" });
    assert.ok(call.body.max_tokens >= 1100 && call.body.max_tokens <= 5600);
    assert.match(call.body.messages[0].content, /不能当作指令/);
    const refs = JSON.parse(call.body.messages[1].content.split("\n").slice(1).join("\n"));
    assert.ok(refs.length <= 3);
    refs.forEach((ref) => {
      assert.equal(ref.bookId, ctx.ranges[0].bookId);
      assert.equal(ref.chapterNo, 1);
      assert.equal(ref.section, ctx.ranges[0].section);
      assert.ok(ref.notes.length);
      if (ctx.subject === "333") assert.ok(ref.notes.every((note) => note.front.startsWith("〔第一节 教育的概念〕")));
      else assert.ok(ref.notes.some((note) => /language|语言/i.test(note.front)));
    });
  }
  result.questions.forEach((q) => {
    assert.equal(q.bookId, ctx.ranges[0].bookId);
    assert.equal(q.chapterNo, 1);
    assert.match(q.source, /AI.*非历年真题/);
    assert.ok(q.bookName && q.chapterName);
  });
});

test("same-book multi-chapter, entire book and multiple books cover every feasible chapter", async () => {
  const cases = [
    { ranges: [{ bookId: "principles", chapters: [1, 4, 9] }], count: 3 },
    { ranges: [{ bookId: "principles" }], count: 9 },
    { ranges: [{ bookId: "china", chapters: [2, 8] }, { bookId: "psychology", chapters: [2, 3] }], count: 4 },
    { ranges: [{ bookId: "principles" }], counts: cfg({ "single-choice": 2, definition: 2, "short-answer": 2, essay: 2, "material-analysis": 1 }), count: 9 },
    { ranges: [{ bookId: "principles", chapters: [1, 2, 3, 4] }], counts: cfg({ "single-choice": 2, definition: 2 }), count: 4 },
  ];
  for (const item of cases) {
    mockResponder();
    const result = await api.generateMockQuiz(key, item.counts ?? cfg({ definition: item.count }), { subject: "333", ranges: item.ranges });
    assert.equal(result.coverage.requestedUnits.length, item.count);
    assert.equal(result.coverage.coveredUnits.length, item.count);
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.uncoveredUnits.length, 0);
  }
});

test("whole-book sampling honestly lists uncovered chapters", async () => {
  mockResponder();
  const result = await api.generateMockQuiz(key, cfg({ essay: 2 }), { subject: "333", ranges: [{ bookId: "principles" }] });
  assert.equal(result.coverage.requestedUnits.length, 9);
  assert.equal(result.coverage.coveredUnits.length, 2);
  assert.equal(result.coverage.uncoveredUnits.length, 7);
  assert.equal(result.coverage.complete, false);
  assert.match(result.coverage.note, /2\/9.*不代表整本/);
});

test("chapter note excerpts rotate on repeated questions", async () => {
  const calls = mockResponder();
  await api.generateMockQuiz(key, cfg({ "single-choice": 4 }), { subject: "333", ranges: [{ bookId: "principles", chapters: [1] }] });
  const refs = JSON.parse(calls[0].body.messages[1].content.split("\n").slice(1).join("\n"));
  assert.notEqual(refs[0].notes[0].front, refs[1].notes[0].front);
});

test("empty or invalid subject/book/chapter/section fails before network", async () => {
  const calls = mockResponder();
  const contexts = [
    { subject: "333", ranges: [] }, { subject: "333", ranges: [{ bookId: "unknown" }] },
    { subject: "333", ranges: [{ bookId: "linguistics" }] }, { subject: "825", ranges: [{ bookId: "principles" }] },
    { subject: "333", ranges: [{ bookId: "principles", chapters: [] }] },
    { subject: "333", ranges: [{ bookId: "principles", chapters: [100] }] },
    { subject: "333", ranges: [{ bookId: "principles", chapters: [1], section: "missing section" }] },
    { subject: "825", ranges: [{ bookId: "linguistics", chapters: [1], section: "missing section" }] },
    { subject: "333", ranges: [{ bookId: "principles", chapters: [1], section: " " }] },
    { subject: "999", ranges: [{ bookId: "principles", chapters: [1] }] },
  ];
  for (const ctx of contexts) await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), ctx));
  assert.equal(calls.length, 0);
});

test("single scope compatibility and repeated ranges deduplicate", async () => {
  mockResponder();
  const oldCtx = { subject: "333", bookId: "principles", chapterNo: 1, section: "第一节 教育的概念" };
  assert.equal((await api.generateMockQuiz(key, cfg({ definition: 1 }), oldCtx)).questions.length, 1);
  const duplicateCtx = { subject: "333", ranges: [{ bookId: "principles", chapters: [1, 1] }, { bookId: "principles", chapters: [1] }] };
  assert.equal((await api.generateMockQuiz(key, cfg({ definition: 1 }), duplicateCtx)).coverage.requestedUnits.length, 1);
});

test("malformed question counts, fields, answers, book metadata and JSON reject entirely", async () => {
  const mutations = [
    (rows) => [], (rows) => [...rows, ...rows], (rows) => rows.map((q) => ({ ...q, type: "essay" })),
    (rows) => rows.map((q) => ({ ...q, stem: " " })), (rows) => rows.map((q) => ({ ...q, options: ["A", "B", "C"] })),
    (rows) => rows.map((q) => ({ ...q, options: ["A", "B", "C", " "] })),
    ...[-1, 4, 1.5, "1"].map((answer) => (rows) => rows.map((q) => ({ ...q, answer }))),
    (rows) => rows.map((q) => ({ ...q, explanation: " " })),
    (rows) => rows.map((q) => ({ ...q, bookId: "psychology" })), (rows) => rows.map((q) => ({ ...q, chapterNo: "第1章" })),
    (rows) => rows.map((q) => ({ ...q, knowledgePointIds: [] })), (rows) => rows.map((q) => ({ ...q, knowledgePointIds: ["outside-scope-card"] })),
    () => reply("```json\n{\"questions\": []}\n```"), () => reply("{\"questions\": ["),
    () => reply("null"), () => reply("[]"), () => reply("{}"),
  ];
  for (const mutate of mutations) {
    mockResponder(mutate);
    const progress = [];
    await assert.rejects(api.generateMockQuiz(key, cfg({ "single-choice": 1 }), context333, { onProgress: (done) => progress.push(done) }));
    assert.deepEqual(progress, [0]);
  }
  for (const field of ["referenceAnswer", "rationale"]) {
    mockResponder((rows) => rows.map((q) => ({ ...q, [field]: " " })));
    await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), context333));
  }
});

test("duplicates within batches and across batches normalize whitespace", async () => {
  for (const count of [2, 4]) {
    mockResponder((rows, call) => rows.map((q, i) => ({ ...q, stem: count === 2 ? (i ? "  duplicate\n stem  " : "duplicate stem") : (call >= 2 ? "Mock question 1" : q.stem) })));
    const progress = [];
    await assert.rejects(api.generateMockQuiz(key, cfg({ "single-choice": count }), context333, { onProgress: (done) => progress.push(done) }), /重复/);
    assert.deepEqual(progress, count === 2 ? [0] : [0, 3]);
  }
});

test("templates reproduce verified structure, points, order and 825 book filtering", async () => {
  const expected = [
    { id: "333-2026", subject: "333", ranges: [{ bookId: "principles", chapters: [1, 2] }], count: 36, points: 150 },
    { id: "825-2026", subject: "825", ranges: [{ bookId: "linguistics", chapters: [1] }, { bookId: "literature", chapters: [1] }], count: 14, points: 150 },
    { id: "825-2026", subject: "825", ranges: [{ bookId: "linguistics", chapters: [1] }], count: 9, points: 75 },
    { id: "825-2026", subject: "825", ranges: [{ bookId: "literature", chapters: [1] }], count: 5, points: 75 },
  ];
  for (const item of expected) {
    const calls = mockResponder();
    const applicable = templates.getApplicableMockPaperTemplate(item.id, item.subject, item.ranges.map((r) => r.bookId));
    assert.equal(applicable.totalQuestions, item.count);
    assert.equal(applicable.totalPoints, item.points);
    const result = await api.generateMockQuiz(key, applicable.config, { subject: item.subject, ranges: item.ranges }, { templateId: item.id });
    assert.equal(result.questions.length, item.count);
    assert.equal(result.questions.reduce((sum, q) => sum + q.points, 0), item.points);
    let offset = 0;
    for (const group of applicable.groups) {
      result.questions.slice(offset, offset + group.count).forEach((q) => {
        assert.equal(q.type, group.type);
        assert.equal(q.groupLabel, group.label);
        assert.equal(q.points, group.points);
        if (group.bookId) assert.equal(q.bookId, group.bookId);
      });
      offset += group.count;
    }
    assert.ok(calls.length);
    assert.equal(applicable.template.recall, item.subject === "825");
    assert.ok(applicable.template.sourcePages.length);
    assert.ok(!/[A-Z]:\\/.test(applicable.template.sourceFile));
  }
  const calls = mockResponder();
  await assert.rejects(api.generateMockQuiz(key, cfg({ essay: 1 }), context333, { templateId: "333-2026" }), /自定义/);
  await assert.rejects(api.generateMockQuiz(key, cfg({ essay: 1 }), context333, { templateId: "825-2026" }), /科目/);
  assert.equal(calls.length, 0);
});

test("template quotas report coverage gaps even when overall count exceeds chapter count", async () => {
  mockResponder();
  const ctx = { subject: "825", ranges: [{ bookId: "linguistics", chapters: [1] }, { bookId: "literature", chapters: [1, 2, 3, 4, 5, 6] }] };
  const applicable = templates.getApplicableMockPaperTemplate("825-2026", "825", ["linguistics", "literature"]);
  const result = await api.generateMockQuiz(key, applicable.config, ctx, { templateId: "825-2026" });
  assert.equal(result.coverage.complete, false);
  assert.equal(result.coverage.uncoveredUnits.length, 1);
  assert.match(result.coverage.note, /题型\/书目构成/);
});

test("pre-cancel, in-flight cancel, ignored abort, late responses and timeout", async () => {
  const pre = new AbortController(); pre.abort(key);
  const calls = mockResponder();
  await assert.rejects(api.generateMockQuiz(key, cfg({ essay: 1 }), context333, { signal: pre.signal }), { name: "AbortError", message: "已取消生成。" });
  assert.equal(calls.length, 0);
  for (const ignoresAbort of [false, true]) {
    const controller = new AbortController();
    let resolveOld;
    const progress = [];
    let started;
    const ready = new Promise((resolve) => { started = resolve; });
    globalThis.fetch = (_, init) => new Promise((resolve, reject) => {
      resolveOld = resolve;
      if (!ignoresAbort) init.signal.addEventListener("abort", () => reject(new Error(key)), { once: true });
      started();
    });
    const pending = api.generateMockQuiz(key, cfg({ essay: 1 }), context333, { signal: controller.signal, onProgress: (done) => progress.push(done) });
    await ready; controller.abort(key);
    await assert.rejects(pending, { name: "AbortError", message: "已取消生成。" });
    mockResponder();
    const fresh = await api.generateMockQuiz(key, cfg({ essay: 1 }), context333);
    resolveOld(reply({ questions: [] }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(progress, [0]);
    assert.equal(fresh.questions.length, 1);
  }
  globalThis.fetch = () => new Promise(() => {});
  await assert.rejects(api.generateMockQuiz(key, cfg({ essay: 1 }), context333, { timeoutMs: 10 }), /请求超时/);
});

test("HTTP, network, malformed response, truncated completion and retry never expose key", async () => {
  for (const status of [401, 429, 500]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: key } }), { status });
    await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), context333), (error) => !error.message.includes(key) && error.message.includes(String(status)));
  }
  globalThis.fetch = async () => { throw new Error(key); };
  await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), context333), (error) => !error.message.includes(key) && /网络/.test(error.message));
  globalThis.fetch = async () => new Response("invalid");
  await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), context333), /响应格式/);
  globalThis.fetch = async () => reply({ questions: [] }, { finish_reason: "length" });
  await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), context333), /不完整/);
  for (const content of [null, " ", { bad: key }]) {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 1 }), context333), /未返回/);
  }
  mockResponder();
  assert.equal((await api.generateMockQuiz(key, cfg({ definition: 1 }), context333)).questions.length, 1);
});

test("legacy plan, feedback and quiz retain return shapes", async () => {
  const bodies = [];
  globalThis.fetch = async (_, init) => { bodies.push(JSON.parse(init.body)); return reply("Useful feedback"); };
  const ctx = { subject: "333", bookId: "principles", chapterNo: 1 };
  for (const mode of ["plan", "feedback"]) assert.deepEqual(await api.askDeepSeek(key, mode, "Please help", ctx), { text: "Useful feedback" });
  assert.ok(bodies.every((body) => !body.response_format && body.max_tokens === 1200));
  globalThis.fetch = async () => reply({ stem: "Legacy choice", options: ["A", "B", "C", "D"], answer: 0, explanation: "Legacy explanation" });
  const choice = await api.askDeepSeek(key, "quiz", "Please ask", ctx);
  assert.equal(choice.question.id, "generated");
  assert.equal(choice.question.answer, 0);
  globalThis.fetch = async () => reply({ type: "简答", stem: "Legacy open", referenceAnswer: "Answer", rationale: "Reason" });
  assert.deepEqual((await api.askDeepSeek(key, "quiz", "Please ask", { subject: "825", bookId: "linguistics", chapterNo: 1, section: "语言的定义" })).openQuestion, { type: "简答", stem: "Legacy open", referenceAnswer: "Answer", rationale: "Reason" });
});
