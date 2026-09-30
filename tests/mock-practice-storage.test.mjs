import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const entryPoints = ["mock-practice-storage", "mock-practice-state"].map((name) => fileURLToPath(new URL(`../lib/${name}.ts`, import.meta.url)));
const output = await build({ entryPoints, outdir: "unused", bundle: true, write: false, platform: "node", format: "esm", target: "node20" });
const modules = await Promise.all(output.outputFiles.map((file) => import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`)));
const storageApi = modules.find((module) => module.readMockPractice), stateApi = modules.find((module) => module.mockPracticeReducer);
const { readMockPractice: read, writeMockPractice: write, mockStorageKey: key, MAX_MOCK_RECORD_CHARS: max } = storageApi;
const { mockPracticeReducer: reduce, mockPracticeScore: score, initialMockPracticeState: initial } = stateApi;
const books = [{ id: "linguistics", name: "语言学", chapters: [{ title: "one", sections: ["section"] }, { title: "two", sections: [] }] }, { id: "literature", name: "文学", chapters: [{ title: "lit", sections: [] }] }];
const config = { "single-choice": 1, definition: 0, "short-answer": 0, essay: 1, "material-analysis": 0 };
const unit = { bookId: "linguistics", chapterNo: 1, bookName: "语言学", chapterName: "one" };
function fixture(subject = "825") {
  return { version: 1, subject, settings: { counts: Object.fromEntries(Object.entries(config).map(([type, count]) => [type, String(count)])), selection: { linguistics: [1] } }, session: {
    snapshot: { subject, config: { ...config }, ranges: [{ bookId: "linguistics", chapters: [1] }], scopeLabel: "语言学第1章", createdAt: "2026/9/30 20:00:00" },
    result: { questions: [{ ...unit, id: "mc", type: "single-choice", stem: "Choice", options: ["A", "B", "C", "D"], answer: 1, explanation: "AI", source: "AI模拟题", knowledgePointIds: ["note"] }, { ...unit, id: "open", type: "essay", stem: "Write", referenceAnswer: "AI answer", rationale: "Based on notes", source: "AI模拟题", knowledgePointIds: ["note"] }], coverage: { requestedUnits: [{ ...unit }], coveredUnits: [{ ...unit }], uncoveredUnits: [], complete: true, note: "Sample" } },
    cursor: 1, mode: "paper", responses: { mc: { choice: 1, revealed: true }, open: { text: "My answer", revealed: false } },
  } };
}
function memory() {
  const records = new Map();
  return { records, getItem: (key) => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
}
test("reload restores settings, complete paper, answers, reveal state, cursor, mode and computed score", () => {
  const storage = memory(), record = fixture();
  assert.deepEqual(write(storage, record, books), { ok: true });
  const restored = read(storage, "825", books);
  assert.equal(restored.status, "loaded");
  assert.deepEqual(restored.record, record);
  const state = reduce(initial(), { type: "restore", session: restored.record.session });
  assert.equal(state.pending, false);
  assert.equal(state.session.cursor, 1);
  assert.equal(state.session.mode, "paper");
  assert.deepEqual(score(state.session), { right: 1, answered: 1, written: 1, choiceTotal: 1, openTotal: 1 });
  assert.equal(reduce(state, { type: "response", id: "mc", response: { choice: 0 } }).session.responses.mc.choice, 1);
});
test("subject keys are independent and mismatched subjects cannot restore", () => {
  const storage = memory(), a = fixture("333"), b = fixture("825");
  a.session.responses.open.text = "333 only";
  assert.equal(write(storage, a, books).ok, true);
  assert.equal(write(storage, b, books).ok, true);
  assert.equal(read(storage, "333", books).record.session.responses.open.text, "333 only");
  assert.equal(read(storage, "825", books).record.session.responses.open.text, "My answer");
  storage.setItem(key("333"), JSON.stringify(b));
  assert.equal(read(storage, "333", books).status, "error");
});
test("settings and cleared sessions survive reload; bounded invalid numeric drafts remain editable", () => {
  const storage = memory(), record = fixture(); record.session = null;
  record.settings.counts.essay = "";
  record.settings.sectionScope = { bookId: "linguistics", chapter: 1, name: "section" };
  assert.equal(write(storage, record, books).ok, true);
  assert.deepEqual(read(storage, "825", books).record, record);
});
test("no credentials or unexpected fields are serialized at any schema level", () => {
  const storage = memory(), record = fixture();
  record.apiKey = "sk-DO-NOT-SAVE";
  record.settings.apiKey = "sk-DO-NOT-SAVE";
  record.session.snapshot.apiKey = "sk-DO-NOT-SAVE";
  record.session.result.questions[0].apiKey = "sk-DO-NOT-SAVE";
  record.session.responses.mc.apiKey = "sk-DO-NOT-SAVE";
  assert.equal(write(storage, record, books).ok, true);
  assert.doesNotMatch(storage.getItem(key("825")), /apiKey|sk-DO-NOT-SAVE/);
});
test("malformed and incompatible records never throw or write during load", () => {
  const storage = memory();
  for (const value of ["{bad", "null", "[]", JSON.stringify({ ...fixture(), version: 0 }), "x".repeat(max + 1)]) {
    storage.setItem(key("825"), value);
    assert.equal(read(storage, "825", books).status, "error");
    assert.equal(storage.getItem(key("825")), value, "a failed read must not overwrite a record");
  }
  const empty = memory();
  assert.deepEqual(read(empty, "825", books), { status: "empty" });
  assert.equal(empty.records.size, 0);
});
test("malformed settings, scope, questions, scoring and coverage are rejected", () => {
  const mutations = [
    (r) => r.settings.counts.essay = 1,
    (r) => r.settings.counts.essay = "1".repeat(33),
    (r) => r.settings.selection = { unknown: [1] },
    (r) => r.settings.selection.linguistics = [1, 1],
    (r) => r.settings.selection.linguistics = [3],
    (r) => r.settings.sectionScope = { bookId: "linguistics", chapter: 1, name: "unknown" },
    (r) => r.settings.templateId = "333-2026",
    (r) => r.session.snapshot.config.essay = -1,
    (r) => r.session.snapshot.config.essay = 1.5,
    (r) => r.session.snapshot.config.essay = 60,
    (r) => r.session.snapshot.ranges[0].chapters = [0],
    (r) => r.session.snapshot.ranges[0].section = "unknown",
    (r) => r.session.snapshot.subject = "333",
    (r) => r.session.snapshot.templateId = "825-2026",
    (r) => r.session.cursor = -1,
    (r) => r.session.cursor = 2,
    (r) => r.session.mode = "unknown",
    (r) => r.session.result.questions[1].id = "mc",
    (r) => r.session.result.questions[0].id = "__proto__",
    (r) => r.session.result.questions[0].answer = 4,
    (r) => r.session.result.questions[0].options = ["A", "B"],
    (r) => r.session.result.questions[0].stem = "",
    (r) => r.session.result.questions[0].type = "unknown",
    (r) => r.session.result.questions[0].bookId = "literature",
    (r) => r.session.result.questions[0].knowledgePointIds = [],
    (r) => r.session.responses.mc.choice = 1.5,
    (r) => r.session.responses.mc.text = "choice cannot have prose",
    (r) => r.session.responses.mc.revealed = "true",
    (r) => r.session.responses.open.choice = 1,
    (r) => r.session.responses.open.text = "x".repeat(20001),
    (r) => r.session.responses.unknown = { choice: 0 },
    (r) => r.session.result.coverage.complete = false,
    (r) => r.session.result.coverage.requestedUnits = [],
    (r) => r.session.result.coverage.coveredUnits = [],
    (r) => r.session.result.coverage.uncoveredUnits = [{ ...unit }],
  ];
  for (const mutate of mutations) {
    const record = fixture(), storage = memory(); mutate(record);
    storage.setItem(key("825"), JSON.stringify(record));
    assert.equal(read(storage, "825", books).status, "error", String(mutate));
  }
});
test("60 questions are accepted, 61 and oversized records cannot replace a previous save", () => {
  const storage = memory(), record = fixture();
  assert.equal(write(storage, record, books).ok, true);
  const original = storage.getItem(key("825"));
  const large = fixture(); large.session.snapshot.config = { ...config, "single-choice": 0, essay: 60 };
  large.session.result.questions = Array.from({ length: 60 }, (_, index) => ({ ...large.session.result.questions[1], id: `open-${index}` }));
  large.session.responses = {};
  assert.equal(write(storage, large, books).ok, true);
  large.session.result.questions.push({ ...large.session.result.questions[0], id: "extra" });
  const saved60 = storage.getItem(key("825"));
  assert.equal(write(storage, large, books).ok, false);
  assert.equal(storage.getItem(key("825")), saved60);
  large.session.result.questions.pop();
  large.session.result.questions.forEach((question) => question.referenceAnswer = "x".repeat(20000));
  const oversized = write(storage, large, books);
  assert.equal(oversized.ok, false);
  assert.match(oversized.message, /大小上限/);
  assert.equal(storage.getItem(key("825")), saved60);
  assert.notEqual(saved60, original);
});
test("quota and denied storage failures are reported without a saved claim", () => {
  const denied = { getItem() { throw new Error("denied"); }, setItem() { throw new DOMException("full", "QuotaExceededError"); } };
  assert.equal(read(denied, "825", books).status, "error");
  const failed = write(denied, fixture(), books);
  assert.equal(failed.ok, false);
  assert.match(failed.message, /尚未保存/);
});
