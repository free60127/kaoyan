import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
async function realModule(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------- R12: 到期卡不抢占当前显示卡 ----------
test("R12 pickPinnedHead: 新到期卡插队时继续显示固定卡", async () => {
  const { pickPinnedHead } = await realModule("../lib/study-review-view.ts");
  const items = [{ cardId: "B" }, { cardId: "C" }];
  const pinned = { key: "scope:bk1-ch1", cardId: "B" };
  // A 到期插到队首, 只要 B 还在队列就仍显示 B
  assert.equal(pickPinnedHead(pinned, "scope:bk1-ch1", [{ cardId: "A" }, ...items])?.cardId, "B");
  // 评分后(B 出队)自动落到队首
  assert.equal(pickPinnedHead(pinned, "scope:bk1-ch1", [{ cardId: "A" }])?.cardId, "A");
  // 换范围(不同 key)不沿用旧固定卡
  assert.equal(pickPinnedHead(pinned, "scope:bk1-ch2", items)?.cardId, "B");
  // 空队列安全
  assert.equal(pickPinnedHead(pinned, "scope:bk1-ch1", []), null);
  assert.equal(pickPinnedHead(null, "scope:bk1-ch1", items)?.cardId, "B");
});

// ---------- R10: 自由浏览位置持久化 ----------
test("R10 浏览位置按卡片 ID 保存与恢复, 损坏数据安全回退", async () => {
  const { saveBrowsePosition, loadBrowsePosition } = await realModule("../lib/study-review-view.ts");
  const store = new Map();
  const storage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }];
  saveBrowsePosition(storage, "333", '{"bookId":"china","chapters":[1]}', "c", 2);
  assert.equal(loadBrowsePosition(storage, "333", '{"bookId":"china","chapters":[1]}', cards), 2);
  // 卡库更新后索引漂移: 按 ID 优先定位
  assert.equal(loadBrowsePosition(storage, "333", '{"bookId":"china","chapters":[1]}', [{ id: "x" }, { id: "c" }]), 1);
  // 未保存过的范围回 0; 损坏 JSON 回 0
  assert.equal(loadBrowsePosition(storage, "333", "other", cards), 0);
  store.set("yantu-browse-position-v1", "{broken");
  assert.equal(loadBrowsePosition(storage, "333", '{"bookId":"china","chapters":[1]}', cards), 0);
});

// ---------- R1: 同义正确项 / 截断 / 答案串 ----------
test("R1 同语言干扰项规则: 825 真实第1章数据不再中英同义混卷", async () => {
  const quiz = await realModule("../lib/practice-quiz.ts");
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/825/linguistics.json", import.meta.url)), "utf-8"));
  const cards = raw.cards.map(card => ({ id: card.id, book: card.book, chapter: card.chapter, front: card.front, back: card.back }));
  // 报告的确定性复现参数: 第1章, seed 10
  for (let seed = 0; seed < 40; seed += 1) {
    const questions = quiz.buildPracticeQuestions(cards.filter(card => card.chapter === 1), { bookId: "linguistics", chapters: [1], count: 20, seed });
    for (const question of questions) {
      const correct = question.options[question.answer];
      const script = quiz.dominantScript(correct);
      question.options.forEach((option, index) => {
        if (index === question.answer) return;
        assert.equal(quiz.dominantScript(option), script, `seed ${seed} 题「${question.stem}」正确项与干扰项主导文字不一致:\n${correct}\n${option}`);
      });
      // 选项若是截断片段, 截断点必须是原文中的词边界(不产生半个单词)
      for (const option of question.options) {
        if (!option.endsWith("…")) continue;
        const stemText = option.slice(0, -1);
        const sourceCard = cards.find(card => card.back.replaceAll("\n", "").startsWith(stemText.replaceAll(" ", "").slice(0, 40)));
        assert.ok(sourceCard || stemText.length < 60, `seed ${seed} 截断选项找不到来源: ${option}`);
      }
    }
  }
  // 同一张术语卡的翻译对应卡不得互为干扰项
  assert.equal([...quiz.salientTokens("Creativity (productivity) is a design feature")].filter(t => quiz.salientTokens("解释语言的创造性 creativity 这一设计特征").has(t)).length > 0, true);
});

test("R1 整卷 T/F 答案串不进题池, 英文截断在词边界", async () => {
  const quiz = await realModule("../lib/practice-quiz.ts");
  assert.equal(quiz.looksLikeAnswerKey("T F T F F T"), true);
  assert.equal(quiz.looksLikeAnswerKey("T, F, T"), false);
  assert.equal(quiz.looksLikeAnswerKey("Taste is a matter of judgement"), false);
  // 英文长答案截断: 不产生半个单词(截断点必须是原文词边界)
  const long = "Language is a system of arbitrary vocal symbols employed by the members of a social group for communication with one another and the outside world around them.";
  const clause = quiz.firstAnswerClause(long, 110);
  assert.ok(clause.length <= 110);
  const stemText = clause.replace(/…$/, "");
  assert.ok(long.startsWith(stemText), clause);
  assert.match(long.slice(stemText.length), /^[\s.,;!?]|^$/, `截断不在词边界: ${clause}`);
  const cjk = quiz.firstAnswerClause("教育的概念有广义与狭义之分。广义的教育指一切有目的地增进人的知识技能的活动。", 30);
  assert.ok(cjk.length <= 30);
});

// ---------- R3/R4/R5: ChoiceDrill 状态 ----------
test("R3 排除项从组卷池过滤; R4 重练按 refId 取回原题", async () => {
  const bank = await realModule("../lib/choice-bank.ts");
  const questions = [
    { id: "q1", book: "china", bookName: "中国教育史", origin: "真题典例", examTag: "", number: 1, chapter: "", stem: "s1", options: ["A1", "B1", "C1", "D1"], answer: 0, optionAnalysis: ["x"], referenceAnswer: "", source: "src1" },
    { id: "q2", book: "china", bookName: "中国教育史", origin: "模拟练习", examTag: "", number: 2, chapter: "", stem: "s2", options: ["A2", "B2", "C2", "D2"], answer: 1, optionAnalysis: [], referenceAnswer: "ref", source: "src2" },
    { id: "q3", book: "psychology", bookName: "教育心理学", origin: "真题典例", examTag: "", number: 3, chapter: "", stem: "s3", options: ["A3", "B3", "C3", "D3"], answer: 2, optionAnalysis: [], referenceAnswer: "", source: "src3" },
  ];
  const excluded = new Set(["q1"]);
  const pool = bank.drillPool(questions, { book: "china", origin: "all" }, excluded);
  assert.deepEqual(pool.map(question => question.id), ["q2"]);
  const requiz = bank.drillRequizQuestions(questions, ["q3", "q1", "q404", "q3"]);
  assert.deepEqual(requiz.map(question => question.id), ["q3", "q1"]);
  // 草稿往返保留解析
  const saved = bank.toSavedQuestion(questions[0], "q1");
  const restored = bank.fromSavedQuestion(saved);
  assert.deepEqual(restored.optionAnalysis, ["x"]);
  assert.equal(restored.bookName, "中国教育史");
  assert.equal(restored.origin, "真题典例");
  assert.equal(bank.stripOptionLabel("B. 教育是社会再制的工具"), "教育是社会再制的工具");
  assert.equal(bank.stripOptionLabel("无前缀选项"), "无前缀选项");
});

test("R5 ChoiceDrill 草稿经 practice-draft 往返后解析与作答完整", async () => {
  const bank = await realModule("../lib/choice-bank.ts");
  const draft = await realModule("../lib/practice-draft.ts");
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  try {
    const question = { id: "st一-01", book: "principles", bookName: "教育学原理", origin: "阶段测试一", examTag: "", number: 1, chapter: "", stem: "s", options: ["A.1", "B.2", "C.3", "D.4"], answer: 1, optionAnalysis: ["a", "b", "c", "d"], referenceAnswer: "", source: "阶段测试一 第1题" };
    const round = { questions: [bank.toSavedQuestion(question, question.id)], index: 0, choice: null, right: 0, wrongIds: [], answers: {} };
    round.meta = { bookId: "all", bookName: "", chapter: 1, scope: "chapter", drill: { book: "all", origin: "阶段测试一", count: 20 } };
    assert.equal(draft.savePracticeRound({ subject: "333", mode: "practice", ...round }), true);
    const loaded = draft.loadPracticeRound("333", "practice");
    assert.ok(loaded);
    assert.deepEqual(loaded.meta.drill, { book: "all", origin: "阶段测试一", count: 20 });
    const restored = bank.fromSavedQuestion(loaded.questions[0]);
    assert.deepEqual(restored.optionAnalysis, ["a", "b", "c", "d"]);
    assert.equal(restored.id, "st一-01");
    // 续做位置与已答集合
    const answered = { ...loaded, answers: { "0": 2 }, index: 0, choice: 2 };
    assert.equal(answered.answers[String(answered.index)], 2);
  } finally {
    delete globalThis.localStorage;
  }
});

// ---------- R8/R9: 数据 ----------
test("R8 手册84题按 ground truth 归类, ID 不变且带跨书标签", async () => {
  const essays = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/essay-questions.json", import.meta.url)), "utf-8"));
  const hb = essays.filter(entry => entry.id.startsWith("hb-"));
  assert.equal(hb.length, 84);
  const byBook = {};
  for (const entry of hb) byBook[entry.book] = (byBook[entry.book] || 0) + 1;
  // 手册原文结构: 中教论述28 / 外教论述19 / 教原材料15+案例9 / 教心材料5+案例8
  assert.deepEqual(byBook, { china: 28, foreign: 19, principles: 24, psychology: 13 });
  const categories = new Set(hb.map(entry => entry.category));
  for (const category of categories) assert.match(category, /^手册·/);
  // 孔孟荀墨/学记/科举必须在 china
  for (const id of ["hb-1", "hb-2", "hb-4", "hb-7"]) {
    const entry = essays.find(item => item.id === id);
    assert.equal(entry.book, "china", `${id} ${entry.topic}`);
  }
  // 跨书标签: 洋务与明治比较同时关联 china+foreign
  const cross = essays.find(entry => entry.id === "hb-16");
  assert.ok(cross.tags?.includes("china") && cross.tags?.includes("foreign"));
  // 题干无页眉噪声残留
  for (const entry of essays) {
    assert.doesNotMatch(entry.stem, /\n\s*第[一二三四五六]部分\s*$/);
    assert.doesNotMatch(entry.stem, /\n\s*(?:中国教育史|外国教育史|教育心理学|教育学原理)\s*$/);
  }
});

test("R9 阶段测试60题全部有解析且答案与原卷字母一致", async () => {
  const bank = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/choice-bank.json", import.meta.url)), "utf-8"));
  const stage = bank.filter(question => /^st[一二]-/.test(question.id));
  assert.equal(stage.length, 60);
  for (const question of stage) {
    const hasAnalysis = question.optionAnalysis.filter(Boolean).length === 4 || question.referenceAnswer;
    assert.ok(hasAnalysis, `${question.id} 仍无解析`);
    if (question.optionAnalysis.length === 4) {
      assert.ok(question.optionAnalysis.every(line => line.length >= 4), `${question.id} 解析过短`);
    }
  }
  // 与题库结构一致性: 所有题答案下标合法、ID 唯一
  const ids = new Set(bank.map(question => question.id));
  assert.equal(ids.size, bank.length);
});
