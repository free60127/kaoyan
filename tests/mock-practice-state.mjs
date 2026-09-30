import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const output = await build({ entryPoints: [fileURLToPath(new URL("../lib/mock-practice-state.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", target: "node20" });
const { initialMockCounts, initialMockPracticeState, mockPracticeReducer: reduce, mockPracticeScore: score, parseMockCounts, mockRangesFromSelection, snapshotMockSettings, countsToStrings } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const books = [{ id: "linguistics", name: "语言学", chapters: [{ title: "one", sections: ["section"] }, { title: "two", sections: [] }] }, { id: "literature", name: "文学", chapters: [{ title: "lit", sections: [] }] }];
const base = { bookId: "linguistics", chapterNo: 1, bookName: "语言学", chapterName: "one", source: "AI 模拟题", knowledgePointIds: ["note"] };
const result = { questions: [{ ...base, id: "mc", type: "single-choice", stem: "MC?", options: ["A", "B", "C", "D"], answer: 1, explanation: "AI" }, { ...base, id: "open", type: "essay", stem: "Write", referenceAnswer: "AI reference", rationale: "notes" }], coverage: { requestedUnits: [], coveredUnits: [], uncoveredUnits: [], complete: true, note: "Sample" } };
const snapshot = snapshotMockSettings("825", initialMockCounts("825"), [{ bookId: "linguistics", chapters: [1] }], "语言学第1章");
const loaded = () => reduce(initialMockPracticeState(), { type: "success", result, snapshot });

test("small custom defaults have all five editable types and five questions for both subjects", () => {
  for (const subject of ["333", "825"]) {
    const counts = parseMockCounts(initialMockCounts(subject));
    assert.equal(Object.keys(counts).length, 5);
    assert.equal(Object.values(counts).reduce((sum, count) => sum + count, 0), 5);
  }
});
test("UI numeric input rejects blank, decimal, negative and excess totals rather than coercing them", () => {
  for (const value of ["", " ", "1.5", "-1", "1e1", "61"]) assert.throws(() => parseMockCounts({ ...initialMockCounts("333"), essay: value }));
  assert.throws(() => parseMockCounts(countsToStrings({ "single-choice": 0, definition: 0, "short-answer": 0, essay: 0, "material-analysis": 0 })));
  assert.throws(() => parseMockCounts({ ...initialMockCounts("333"), essay: "60" }));
});
test("scope selection orders chapters, preserves multiple books and snapshots exact independent ranges", () => {
  const selection = { linguistics: [2, 1], literature: [1] };
  const ranges = mockRangesFromSelection(books, selection);
  assert.deepEqual(ranges, [{ bookId: "linguistics", chapters: [1, 2] }, { bookId: "literature", chapters: [1] }]);
  const saved = snapshotMockSettings("825", initialMockCounts("825"), ranges, "all");
  ranges[0].chapters.pop(); selection.literature.pop();
  assert.deepEqual(saved.ranges, [{ bookId: "linguistics", chapters: [1, 2] }, { bookId: "literature", chapters: [1] }]);
  assert.deepEqual(mockRangesFromSelection(books, { linguistics: [1] }, { bookId: "linguistics", chapter: 1, name: "section" }), [{ bookId: "linguistics", chapters: [1], section: "section" }]);
});
test("real composition snapshots accept full and book-filtered 825, reject edited preset counts", () => {
  const paper333 = snapshotMockSettings("333", countsToStrings({ "single-choice": 30, definition: 0, "short-answer": 0, essay: 2, "material-analysis": 4 }), [{ bookId: "principles", chapters: [1, 2] }], "333", "333-2026");
  assert.equal(Object.values(paper333.config).reduce((sum, count) => sum + count, 0), 36);
  const full = { "single-choice": 0, definition: 5, "short-answer": 9, essay: 0, "material-analysis": 0 };
  const ling = { ...full, "short-answer": 4 };
  const lit = { ...full, definition: 0, "short-answer": 5 };
  for (const [ids, counts] of [[["linguistics", "literature"], full], [["linguistics"], ling], [["literature"], lit]]) {
    assert.equal(snapshotMockSettings("825", countsToStrings(counts), ids.map((bookId) => ({ bookId, chapters: [1] })), "preset", "825-2026").templateId, "825-2026");
  }
  assert.throws(() => snapshotMockSettings("825", countsToStrings(full), [{ bookId: "linguistics", chapters: [1] }], "edited", "825-2026"));
});
test("preview reveal before and after MC choice changes no score and leaves submitted choice frozen", () => {
  let state = loaded();
  state = reduce(state, { type: "response", id: "mc", response: { revealed: true } });
  assert.equal(state.session.responses.mc.revealed, true);
  assert.equal(score(state.session).answered, 0);
  state = reduce(state, { type: "response", id: "mc", response: { choice: 1 } });
  assert.equal(score(state.session).right, 1);
  state = reduce(state, { type: "response", id: "mc", response: { revealed: false } });
  assert.equal(state.session.responses.mc.revealed, false);
  assert.equal(score(state.session).answered, 1);
  assert.equal(score(state.session).right, 1);
  state = reduce(state, { type: "response", id: "mc", response: { choice: 0 } });
  assert.equal(state.session.responses.mc.choice, 1);
});
test("per-question navigation and whole-paper mode preserve answers, cursor and separate open count", () => {
  let state = reduce(loaded(), { type: "response", id: "mc", response: { choice: 0 } });
  state = reduce(state, { type: "cursor", cursor: 1 });
  state = reduce(state, { type: "response", id: "open", response: { text: "My independent answer", revealed: true } });
  state = reduce(state, { type: "mode", mode: "paper" });
  state = reduce(state, { type: "mode", mode: "practice" });
  assert.equal(state.session.cursor, 1);
  state = reduce(state, { type: "cursor", cursor: 0 });
  assert.deepEqual(state.session.responses.open, { text: "My independent answer", revealed: true });
  assert.deepEqual(score(state.session), { right: 0, answered: 1, written: 1, choiceTotal: 1, openTotal: 1 });
  assert.equal(reduce(state, { type: "cursor", cursor: -3 }).session.cursor, 0);
  assert.equal(reduce(state, { type: "cursor", cursor: 100 }).session.cursor, 1);
});
test("cancel, hide and failed regeneration preserve the previously completed paper and every response", () => {
  let state = reduce(loaded(), { type: "response", id: "open", response: { text: "Retain", revealed: true } });
  state = reduce(state, { type: "cursor", cursor: 1 });
  const saved = state.session;
  for (const error of ["已取消生成", "离开页面", "生成失败"]) {
    state = reduce(state, { type: "start", total: 5 });
    state = reduce(state, { type: "progress", done: 2, total: 5 });
    assert.strictEqual(state.session, saved);
    state = reduce(state, { type: "stop", error });
    assert.strictEqual(state.session, saved);
    assert.equal(state.pending, false);
  }
});
test("successful replacement and explicit clear are the only operations that discard completed responses", () => {
  let state = reduce(loaded(), { type: "response", id: "open", response: { text: "old" } });
  state = reduce(state, { type: "success", result, snapshot });
  assert.deepEqual(state.session.responses, {});
  assert.equal(state.session.cursor, 0);
  assert.deepEqual(reduce(state, { type: "clear" }), initialMockPracticeState());
});
test("subject sessions remain isolated through switching, hidden cancellation and independent navigation", () => {
  const sessions = { "333": loaded(), "825": loaded() };
  sessions["333"] = reduce(sessions["333"], { type: "response", id: "mc", response: { choice: 1 } });
  const saved333 = sessions["333"].session;
  sessions["825"] = reduce(sessions["825"], { type: "response", id: "open", response: { text: "825" } });
  sessions["825"] = reduce(sessions["825"], { type: "cursor", cursor: 1 });
  sessions["333"] = reduce(sessions["333"], { type: "stop" });
  assert.strictEqual(sessions["333"].session, saved333);
  assert.equal(score(sessions["333"].session).right, 1);
  assert.equal(score(sessions["825"].session).answered, 0);
  assert.equal(sessions["825"].session.cursor, 1);
  assert.equal(sessions["333"].session.responses.open, undefined);
});
