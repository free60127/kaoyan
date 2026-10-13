import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 政治接入: 多选题型判分/状态机/存储恢复 + 肖1000题库结构校验
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const options = entry => ({
  entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "node20",
});
const state = await import(`data:text/javascript;base64,${Buffer.from((await build(options("../lib/mock-practice-state.ts"))).outputFiles[0].text).toString("base64")}`);
const storage = await import(`data:text/javascript;base64,${Buffer.from((await build(options("../lib/mock-practice-storage.ts"))).outputFiles[0].text).toString("base64")}`);
const choiceBank = await import(`data:text/javascript;base64,${Buffer.from((await build(options("../lib/choice-bank.ts"))).outputFiles[0].text).toString("base64")}`);
const { mockPracticeReducer, mockPracticeScore, initialMockPracticeState, mockMultipleChoiceCorrect } = state;
const { validateMockSavedRecord } = storage;
const { choiceIsCorrect } = choiceBank;

test("choiceIsCorrect: 单选按 answer, 多选全对才对(漏选/错选均错)", () => {
  const single = { answer: 2 };
  assert.equal(choiceIsCorrect(single, 2), true);
  assert.equal(choiceIsCorrect(single, 1), false);
  assert.equal(choiceIsCorrect(single, [2]), false, "单选题不接受数组");
  const multi = { multi: true, answers: [0, 2, 3] };
  assert.equal(choiceIsCorrect(multi, [0, 2, 3]), true);
  assert.equal(choiceIsCorrect(multi, [3, 0, 2]), true, "乱序全对仍算对");
  assert.equal(choiceIsCorrect(multi, [0, 2]), false, "漏选不得分");
  assert.equal(choiceIsCorrect(multi, [0, 1, 2, 3]), false, "多选不得分");
  assert.equal(choiceIsCorrect(multi, [0, 1, 3]), false, "错选不得分");
});

test("reducer: 多选 answers 一次性确认并锁定, 非法输入拒绝", () => {
  const question = { id: "mcq", type: "multiple-choice", answers: [1, 3], options: ["A", "B", "C", "D"], stem: "s", source: "x", knowledgePointIds: ["n"], bookId: "mayuan", chapterNo: 1, bookName: "b", chapterName: "c" };
  const session = { result: { questions: [question], coverage: { requestedUnits: [], coveredUnits: [], uncoveredUnits: [], complete: true, note: "x" } }, snapshot: { subject: "politics", config: { "multiple-choice": 1 }, ranges: [], scopeLabel: "", createdAt: "" }, cursor: 0, mode: "practice", responses: {} };
  let state0 = { ...initialMockPracticeState(), session };
  // 少于 2 项拒绝
  state0 = mockPracticeReducer(state0, { type: "response", id: "mcq", response: { answers: [1] } });
  assert.equal(state0.session.responses.mcq?.answers, undefined);
  // 越界拒绝
  state0 = mockPracticeReducer(state0, { type: "response", id: "mcq", response: { answers: [1, 7] } });
  assert.equal(state0.session.responses.mcq?.answers, undefined);
  // 确认后锁定
  state0 = mockPracticeReducer(state0, { type: "response", id: "mcq", response: { answers: [3, 1] } });
  assert.deepEqual(state0.session.responses.mcq.answers, [1, 3]);
  state0 = mockPracticeReducer(state0, { type: "response", id: "mcq", response: { answers: [0, 1] } });
  assert.deepEqual(state0.session.responses.mcq.answers, [1, 3], "确认后不可改");
  // 单选题不接受 answers
  const singleSession = { ...session, result: { ...session.result, questions: [{ ...question, type: "single-choice", answer: 0 }] } };
  const s2 = mockPracticeReducer({ ...initialMockPracticeState(), session: singleSession }, { type: "response", id: "mcq", response: { answers: [0, 1] } });
  assert.equal(s2.session.responses.mcq?.answers, undefined);
});

test("score: 多选全对计 1 分, 漏选不得分但计入已答", () => {
  const question = { id: "mcq", type: "multiple-choice", answers: [0, 2], options: ["A", "B", "C", "D"], stem: "s", source: "x", knowledgePointIds: ["n"], bookId: "b", chapterNo: 1, bookName: "b", chapterName: "c" };
  const session = { result: { questions: [question], coverage: { requestedUnits: [], coveredUnits: [], uncoveredUnits: [], complete: true, note: "x" } }, snapshot: { subject: "politics", config: {}, ranges: [], scopeLabel: "", createdAt: "" }, cursor: 0, mode: "practice", responses: {} };
  const answered = { ...session, responses: { mcq: { answers: [0, 2] } } };
  assert.deepEqual(mockPracticeScore(answered), { right: 1, answered: 1, written: 0, choiceTotal: 1, openTotal: 0 });
  const missed = { ...session, responses: { mcq: { answers: [0] } } };
  assert.deepEqual(mockPracticeScore(missed), { right: 0, answered: 1, written: 0, choiceTotal: 1, openTotal: 0 });
  assert.equal(mockMultipleChoiceCorrect({ answers: [2, 0] }, { answers: [0, 2] }), true);
});

test("storage: 多选题与作答、true-false 的 choice 都能往返恢复", () => {
  const books = [{ id: "mayuan", name: "马克思主义基本原理", chapters: [{ title: "c1", sections: [] }] }];
  const multi = { id: "q1", type: "multiple-choice", stem: "多选题干", source: "s", knowledgePointIds: ["n1"], bookId: "mayuan", chapterNo: 1, bookName: "马克思主义基本原理", chapterName: "c1", options: ["A", "B", "C", "D"], answers: [0, 1, 3], explanation: "e" };
  const tf = { id: "q2", type: "true-false", stem: "判断题干", source: "s", knowledgePointIds: ["n1"], bookId: "mayuan", chapterNo: 1, bookName: "马克思主义基本原理", chapterName: "c1", options: ["True", "False"], answer: 1, explanation: "e" };
  const record = {
    version: 1, subject: "politics",
    settings: { counts: { "single-choice": "0", "multiple-choice": "1", "true-false": "1", "fill-blank": "0", definition: "0", "short-answer": "0", essay: "0", "material-analysis": "0" }, selection: { mayuan: [1] } },
    session: {
      snapshot: { subject: "politics", config: { "single-choice": 0, "multiple-choice": 1, "true-false": 1, "fill-blank": 0, definition: 0, "short-answer": 0, essay: 0, "material-analysis": 0 }, ranges: [{ bookId: "mayuan", chapters: [1] }], scopeLabel: "x", createdAt: "t" },
      result: { questions: [multi, tf], coverage: { requestedUnits: [{ bookId: "mayuan", chapterNo: 1, bookName: "马克思主义基本原理", chapterName: "c1" }], coveredUnits: [{ bookId: "mayuan", chapterNo: 1, bookName: "马克思主义基本原理", chapterName: "c1" }], uncoveredUnits: [], complete: true, note: "x" } },
      cursor: 0, mode: "practice",
      responses: { q1: { answers: [3, 0, 1] }, q2: { choice: 1 } },
    },
  };
  const restored = validateMockSavedRecord(JSON.parse(JSON.stringify(record)), "politics", books);
  assert.equal(restored.session.responses.q1.answers.join(","), "0,1,3");
  assert.equal(restored.session.responses.q2.choice, 1, "判断题作答可恢复(既有 bug 已修)");
  // 多选越界答案拒绝整卷
  const broken = JSON.parse(JSON.stringify(record));
  broken.session.responses.q1.answers = [0, 1, 9];
  assert.throws(() => validateMockSavedRecord(broken, "politics", books));
});

test("肖1000政治题库: 结构完整(数量/五科/多选比例/答案合法)且 333 题库不受影响", async () => {
  const bank = await choiceBank.loadPoliticsChoiceBank();
  assert.ok(bank.length > 800, `肖1000 选择题应 >800, got ${bank.length}`);
  const ids = new Set(bank.map(row => row.id));
  assert.equal(ids.size, bank.length, "题 id 唯一");
  const books = new Set(bank.map(row => row.book));
  for (const book of ["mayuan", "maozhongte", "xinsixiang", "shigang", "sixiu"]) {
    assert.ok(books.has(book), `缺书目 ${book}`);
  }
  for (const row of bank) {
    assert.equal(row.options.length, 4, `${row.id} 选项须 4 项`);
    assert.ok(row.stem.length >= 8, `${row.id} 题干过短`);
    if (row.multi) {
      assert.ok(Array.isArray(row.answers) && row.answers.length >= 2 && row.answers.length <= 4, `${row.id} 多选答案数`);
      assert.ok(row.answers.every(a => Number.isInteger(a) && a >= 0 && a <= 3), `${row.id} 答案越界`);
      assert.ok(new Set(row.answers).size === row.answers.length, `${row.id} 答案重复`);
    } else {
      assert.ok(Number.isInteger(row.answer) && row.answer >= 0 && row.answer <= 3, `${row.id} 单选答案越界`);
    }
  }
  const multiRatio = bank.filter(row => row.multi).length / bank.length;
  assert.ok(multiRatio > 0.3 && multiRatio < 0.7, `多选比例异常: ${multiRatio.toFixed(2)}`);
  // 333 题库照常加载且无多选字段污染
  const bank333 = await choiceBank.loadChoiceBank();
  assert.ok(bank333.length > 1400);
  assert.ok(!bank333.some(row => row.multi), "333 题库不应有多选题");
});

test("practice-draft: 多选作答经保存/恢复后题型与已选答案完整保留(B02/B06)", async () => {
  const { build } = require("esbuild");
  const { fileURLToPath } = await import("node:url");
  const compiledDraft = await build({ entryPoints: [fileURLToPath(new URL("../lib/practice-draft.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  const compiledBank = await build({ entryPoints: [fileURLToPath(new URL("../lib/choice-bank.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  const draft = { ...await import(`data:text/javascript;base64,${Buffer.from(compiledDraft.outputFiles[0].text).toString("base64")}`), ...await import(`data:text/javascript;base64,${Buffer.from(compiledBank.outputFiles[0].text).toString("base64")}`) };
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const saved = draft.savePracticeRound({
    subject: "politics", mode: "practice",
    meta: { bookId: "mayuan", bookName: "", chapter: 1, scope: "chapter", drill: { book: "all", origin: "all", count: 20 } },
    questions: [draft.toSavedQuestion({ id: "xiao-mayuan-m1", book: "mayuan", bookName: "马克思主义基本原理", origin: "肖秀荣1000题", examTag: "", number: 1, chapter: "第一章", stem: "多选题干", options: ["A", "B", "C", "D"], answer: 0, multi: true, answers: [1, 2], optionAnalysis: ["A正确。"], referenceAnswer: "", source: "s" }, "xiao-mayuan-m1")],
    index: 0, choice: -1, right: 1, wrongIds: [],
    answers: { 0: [1, 2] },
  });
  assert.equal(saved, true, "100 题内可保存(B06)");
  const restored = draft.loadPracticeRound("politics", "practice");
  assert.ok(restored, "刷新后可恢复");
  const question = draft.fromSavedQuestion(restored.questions[0]);
  assert.equal(question.multi, true, "题型保留(B02)");
  assert.deepEqual(question.answers, [1, 2]);
  assert.deepEqual(restored.answers["0"], [1, 2], "已选答案保留");
});

test("shuffleOptions: 乱序后逐项解析的字母链同步映射, 答案与解析一致(B03)", async () => {
  const { build } = require("esbuild");
  const { fileURLToPath } = await import("node:url");
  const compiled = await build({ entryPoints: [fileURLToPath(new URL("../lib/choice-bank.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  const bank = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
  const q = { id: "t", book: "mayuan", bookName: "b", origin: "o", examTag: "", number: 1, chapter: "", stem: "题干", options: ["甲", "乙", "丙", "丁"], answer: 1, answers: [1, 2, 3], multi: true, optionAnalysis: ["简析 A、B、C正确。D错误。", "B说法不准确。"], referenceAnswer: "", source: "s" };
  const out = bank.shuffleQuestionOptions(q, () => 0.42);
  // 新选项 [丙,甲,丁,乙]: 原乙丙丁 → 新 A/C/D
  assert.deepEqual(out.answers, [0, 2, 3]);
  assert.equal(out.optionAnalysis[0], "简析 B、D、A正确。C错误。");
  assert.equal(out.optionAnalysis[1], "D说法不准确。");
  // 解析重映射是纯函数级(每档乱序种子一致), 英文正文不含中文判定词不被误伤
  const en = bank.shuffleQuestionOptions({ ...q, optionAnalysis: ["Phonetics studies speech sounds. B is correct."] }, () => 0.42);
  assert.ok(en.optionAnalysis[0].includes("Phonetics studies speech sounds."));
});
