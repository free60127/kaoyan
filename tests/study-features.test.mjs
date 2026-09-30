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
  const { buildPracticeQuestions, firstAnswerClause } = await realModule("../lib/practice-quiz.ts");
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
  // 章节过滤
  const scoped = buildPracticeQuestions(cards, { bookId: "mayuan", chapters: [2], count: 20, seed: 1 });
  assert.equal(scoped.length, 12);
  // 首句抽取: 分号/句号截断 + 📌行剔除
  assert.equal(firstAnswerClause("答案句。第二句。\n📌 该书标注：易考"), "答案句");
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
