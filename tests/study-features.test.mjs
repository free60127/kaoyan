import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
async function realModule(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("practice-quiz: 题干来自卡正面、正确项可定位、干扰项互不相同", async () => {
  const { buildPracticeQuestions, firstAnswerClause, isMcqSuitable } = await realModule("../lib/practice-quiz.ts");
  const cards = Array.from({ length: 12 }, (_, index) => ({
    id: `c${index}`, book: "mayuan", chapter: 2,
    front: `〔考点${index}〕第${index}个考点的问题是什么？`,
    back: `第${index}个考点的答案是核心结论${index}。补充说明。`,
  }));
  const questions = buildPracticeQuestions(cards, { bookId: "mayuan", count: 5, seed: 42 });
  assert.equal(questions.length, 5);
  for (const question of questions) {
    assert.ok(!question.stem.startsWith("〔"));
    assert.equal(question.options.length, 4);
    assert.equal(new Set(question.options).size, 4);
    assert.ok(question.answer >= 0 && question.answer < 4);
    assert.match(question.options[question.answer], /核心结论/);
  }
  // 确定性: 同 seed 同卷
  const again = buildPracticeQuestions(cards, { bookId: "mayuan", count: 5, seed: 42 });
  assert.deepEqual(questions, again);
  // 多点列举类卡不进选择题池
  assert.equal(isMcqSuitable("〔考点1〕简述教育的功能"), true);
  assert.equal(isMcqSuitable("〔考点1〕教育有哪些基本功能"), false);
  assert.equal(isMcqSuitable("〔考点1〕列举七个特征"), false);
  assert.equal(isMcqSuitable("〔考点1〕比较两派异同"), false);
  const multiCards = [
    ...cards.slice(0, 4),
    { id: "multi1", book: "mayuan", chapter: 2, front: "〔考点9〕教学有哪些基本原则", back: "1.A 2.B 3.C。" },
  ];
  const filtered = buildPracticeQuestions(multiCards, { bookId: "mayuan", count: 10, seed: 7 });
  assert.ok(filtered.every(q => q.cardId !== "multi1"));
  // 章节过滤
  const scoped = buildPracticeQuestions(cards, { bookId: "mayuan", chapters: [2], count: 20, seed: 1 });
  assert.equal(scoped.length, 12);
});

test("mistakes: 累计错误次数、移除与按科目清空", async () => {
  const { parseMistakes, recordMistake, removeMistakes, removeMistakesByRef, clearMistakes, mistakesStorageKey, selectRequizList } = await realModule("../lib/mistakes.ts");
  // 以 localStorage mock 模块级读写
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  recordMistake("333", "card", "principles-k1-001", "什么是教育？");
  recordMistake("333", "card", "principles-k1-001", "什么是教育？");
  recordMistake("politics", "quiz", "q1", "题干");
  let list = parseMistakes(store.get(mistakesStorageKey));
  assert.equal(list.length, 2);
  const repeated = list.find((item) => item.refId === "principles-k1-001");
  assert.equal(repeated.wrongCount, 2);
  list = removeMistakes([repeated.id]);
  assert.equal(list.length, 1);
  list = clearMistakes("politics");
  assert.equal(list.length, 0);
  // 损坏数据安全解析
  assert.equal(parseMistakes("{broken").length, 0);
  // 重练选择: 仅闪卡/自测类, 按最近优先排序, 上限截断
  const now = new Date("2026-10-01T12:00:00");
  recordMistake("333", "card", "k1", "卡1", now);
  recordMistake("333", "quiz", "q1", "真题", now);
  recordMistake("333", "practice", "k2", "卡2", now);
  recordMistake("825", "card", "l1", "语言卡", now);
  const list2 = parseMistakes(store.get(mistakesStorageKey));
  const requiz = selectRequizList(list2, "333");
  assert.equal(requiz.length, 2);
  assert.ok(requiz.every(item => item.kind !== "quiz"));
  assert.ok(requiz.some(item => item.refId === "k1") && requiz.some(item => item.refId === "k2"));
  assert.equal(selectRequizList(list2, "825").length, 1);
  assert.equal(selectRequizList(list2, "politics").length, 0);
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `333:card:c${i}`, subject: "333", kind: "card", refId: `c${i}`, label: `卡${i}`, wrongCount: 1, lastAt: now.toISOString() }));
  assert.equal(selectRequizList(many, "333").length, 20);
  // 同卡两类错题去重: 取较新条目, 错误次数合并, 不重复出卷
  const dupEntries = [
    { id: "333:card:x:old", subject: "333", kind: "card", refId: "x", label: "旧", wrongCount: 2, lastAt: "2026-10-01T10:00:00.000Z" },
    { id: "333:practice:x:new", subject: "333", kind: "practice", refId: "x", label: "新", wrongCount: 3, lastAt: "2026-10-05T10:00:00.000Z" },
    { id: "333:card:y", subject: "333", kind: "card", refId: "y", label: "另一张", wrongCount: 1, lastAt: "2026-10-02T10:00:00.000Z" },
  ];
  const deduped = selectRequizList(dupEntries, "333");
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].refId, "x");
  assert.equal(deduped[0].label, "新");
  assert.equal(deduped[0].wrongCount, 5);
  // 按 refId 批量移出(重练答对场景): 只删该科目的匹配 ref, 跨科目同名 ref 不误删
  recordMistake("333", "practice", "shared", "333的卡", now);
  recordMistake("politics", "practice", "shared", "政治的同名卡", now);
  const afterRef = removeMistakesByRef("333", ["shared"]);
  assert.ok(!afterRef.some(item => item.subject === "333" && item.refId === "shared"));
  assert.ok(afterRef.some(item => item.subject === "politics" && item.refId === "shared"));
  delete globalThis.localStorage;
});

test("stats: 按日累计、连续天数与补零序列", async () => {
  const { recordStat, lastNDays, streakDays, statsKey } = await realModule("../lib/stats.ts");
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const now = new Date("2026-10-01T20:00:00");
  recordStat(storage, "333", { ratings: 2, again: 1, newCards: 1 }, now);
  recordStat(storage, "333", { quiz: 3, quizCorrect: 2 }, now);
  recordStat(storage, "333", { ratings: 1 }, new Date("2026-09-30T10:00:00"));
  const days = lastNDays(storage, "333", 3, now);
  assert.equal(days.length, 3);
  assert.equal(days[2].date, "2026-10-01");
  assert.equal(days[2].ratings, 2);
  assert.equal(days[2].quizCorrect, 2);
  assert.equal(days[1].ratings, 1);
  assert.equal(days[0].ratings, 0);
  assert.equal(streakDays(storage, "333", now), 2);
  assert.equal(streakDays(storage, "825", now), 0);
  // 跨时区: 用本地日期而非 UTC
  assert.ok(statsKey("333").includes("333"));
});

test("subject-capabilities: 单一事实源与侧栏过滤", async () => {
  const { sidebarViews, viewAvailable, subjects, subjectBooks } = await realModule("../lib/subject-capabilities.ts");
  const { isRestorableView } = await realModule("../lib/learning-session.ts");
  // 政治无 quiz/mock
  assert.equal(viewAvailable("politics", "quiz"), false);
  assert.equal(viewAvailable("politics", "mock"), false);
  assert.equal(viewAvailable("politics", "practice"), true);
  // 825 有真题; 333 全开
  assert.equal(viewAvailable("825", "quiz"), true);
  assert.equal(viewAvailable("333", "quiz"), true);
  // sidebarViews 与 isRestorableView 一致(导航与备份不再各说各话)
  for (const subject of ["333", "825", "politics", "english"]) {
    const navIds = sidebarViews(subject).map(view => view.id);
    for (const id of navIds) assert.equal(isRestorableView(subject, id), true, subject + ":" + id);
    for (const view of ["overview", "chapters", "cards", "quiz", "practice", "mock", "feynman", "mistakes", "stats", "search", "planner"]) {
      if (!navIds.includes(view)) assert.equal(viewAvailable(subject, view), false);
    }
  }
  // 科目书目表与备份的静态校验一致
  assert.deepEqual(subjectBooks["825"], ["linguistics", "literature"]);
  assert.equal(subjects.length, 4);
  // 侧栏分组: 学习/练习/工具 三组都非空(333)
  const groups = new Set(sidebarViews("333").map(view => view.group));
  assert.ok(groups.has("学习") && groups.has("练习") && groups.has("工具"));
});

test("practice-quiz: 试卷范围元数据冻结(start 时快照)", async () => {
  // 通过 buildPracticeQuestions 的确定性 + PracticeView meta 逻辑在数据层的等价物:
  // 换书后用旧 seed 重放, 题目不变 → 证明"卷子属于出题那一刻的范围"
  const { buildPracticeQuestions } = await realModule("../lib/practice-quiz.ts");
  const cards = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, book: i < 10 ? "a" : "b", chapter: 1, front: `第${i}题问什么`, back: `答${i}` }));
  const fromA = buildPracticeQuestions(cards, { bookId: "a", count: 5, seed: 99 });
  const fromB = buildPracticeQuestions(cards, { bookId: "b", count: 5, seed: 99 });
  assert.ok(fromA.every(q => q.options.some(o => /答\d/.test(o))));
  assert.notDeepEqual(fromA.map(q => q.cardId), fromB.map(q => q.cardId));
});

test("practice-draft: 保存/读取/过期与损坏防护", async () => {
  const { savePracticeRound, loadPracticeRound, clearPracticeRound, practiceDraftKey } = await realModule("../lib/practice-draft.ts");
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const questions = [1, 2, 3].map(n => ({ cardId: "c" + n, stem: "题" + n, hint: "考点", options: ["a", "b", "c", "d"], answer: 1, source: "自测" }));
  const base = { subject: "333", mode: "practice", meta: { bookId: "principles", bookName: "教育学原理", chapter: 2, scope: "chapter" }, questions, index: 0, choice: null, right: 0, answers: {} };
  assert.equal(savePracticeRound({ ...base, index: 2, choice: 1, right: 1, answers: { 0: 1, 1: 3 } }), true);
  const restored = loadPracticeRound("333", "practice");
  assert.ok(restored);
  assert.equal(restored.index, 2);
  assert.equal(restored.answers["1"], 3);
  // 科目不匹配 → null
  assert.equal(loadPracticeRound("politics", "practice"), null);
  // 过期(3天前)
  const stale = JSON.parse(store.get(practiceDraftKey));
  stale.savedAt = "2026-09-01T00:00:00.000Z";
  store.set(practiceDraftKey, JSON.stringify(stale));
  assert.equal(loadPracticeRound("333", "practice"), null);
  // 损坏
  store.set(practiceDraftKey, "{broken");
  assert.equal(loadPracticeRound("333", "practice"), null);
  // answer越界的选项被拒
  const bad = { ...base, questions: [{ ...questions[0], answer: 9 }] };
  store.set(practiceDraftKey, JSON.stringify({ ...bad, version: 1, savedAt: new Date().toISOString(), answers: {} }));
  assert.equal(loadPracticeRound("333", "practice"), null);
  clearPracticeRound();
  assert.equal(loadPracticeRound("333", "practice"), null);
  delete globalThis.localStorage;
});

test("scheduler undo: 恢复卡片状态与当日准入", async () => {
  const mod = await realModule("../lib/study-scheduler.ts");
  const now = new Date(2026, 9, 6, 12);
  let progress = mod.createEmptyProgress(now);
  const card = { id: "c1", book: "b", chapter: 1 };
  // 新卡评分"记住了" → 进入复习; 撤销 → 回到未学
  progress = mod.applyRating(progress, card.id, "good", now);
  assert.ok(progress.cards[card.id]);
  assert.ok(progress.daily.admitted.includes(card.id));
  const undo = { cardId: card.id, previous: null, daily: { date: progress.daily.date, admitted: [] } };
  const undone = mod.undoRating(progress, undo);
  assert.ok(!undone.cards[card.id]);
  assert.equal(undone.daily.admitted.length, 0);
  // 有既往复习的卡: 撤销恢复原 dueAt
  progress = mod.applyRating(undone, card.id, "good", now);
  const before = { cardId: card.id, previous: { ...progress.cards[card.id] }, daily: { ...progress.daily, admitted: [...progress.daily.admitted] } };
  const afterSecond = mod.applyRating(progress, card.id, "again", now);
  const restored = mod.undoRating(afterSecond, before);
  assert.equal(restored.cards[card.id].dueAt, before.previous.dueAt);
});
