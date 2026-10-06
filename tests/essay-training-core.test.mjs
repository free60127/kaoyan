import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../lib/essay-training.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20", logLevel: "silent" });
const { resolveTrainingEntries, scopedTrainingEntries } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const json = async name => JSON.parse(await readFile(new URL(`../lib/${name}.json`, import.meta.url), "utf8"));
const cards = await json("knowledge-cards");
const essays = await json("essay-questions");
const cardA = { id: "a", book: "principles", chapter: 1, front: "〔第一节 教育的概念〕问题", back: "答案", source: "教材" };
const cardB = { ...cardA, id: "b", front: "〔第三节 教育的起源与发展〕问题" };
const cardC = { ...cardA, id: "c", chapter: 2 };
const fixtureCards = [cardA, cardB, cardC];
const original = { id: "original", category: "教育学原理材料", number: 1, topic: "原题", stem: "完整材料\n（1）问题一？\n（2）问题二？", referenceAnswer: "（1）原答案\n（2）原答案", ocrWarning: "某行待核对", source: "手册PDF第10–11页" };
const base = { id: "entry", book: "principles", chapter: 1, section: "第一节 教育的概念", topic: "训练主题", questionType: "material", origin: "source-question", source: original.source, originalQuestionId: original.id, analysis: "材料对应本节教育概念，按两问展开。", knowledgeCardIds: ["a"] };
const resolve = (entries, originals = [original], notes = fixtureCards) => resolveTrainingEntries(entries, originals, notes);
const adapted = { ...base, id: "adapted", origin: "adapted", originalQuestionId: undefined, stem: "简述教育的概念及其意义。", referenceAnswer: "教育是有目的地培养人的活动，应结合材料说明。" };

test("source references retain the complete original text, answer and OCR warning without mutation", () => {
  const before = structuredClone({ base, original, fixtureCards });
  const [result] = resolve([{ ...base, source: "关联资料页码不等于原题来源" }]);
  assert.equal(result.stem, original.stem);
  assert.equal(result.referenceAnswer, original.referenceAnswer);
  assert.equal(result.ocrWarning, original.ocrWarning);
  assert.equal(result.source, original.source);
  assert.deepEqual({ base, original, fixtureCards }, before);
  assert.notEqual(result.knowledgeCardIds, base.knowledgeCardIds);
  result.knowledgeCardIds.push("unrelated");
  assert.deepEqual(base.knowledgeCardIds, ["a"]);
});

test("original references can connect books while their associated notes stay in the exact scope", () => {
  const crossBook = { ...original, category: "中国教育史论述", stem: "比较洋务教育与明治教育。" };
  const note = { ...cardA, id: "foreign-note", book: "foreign", chapter: 11, front: "〔第二节 明治维新时期的教育〕问题" };
  const entry = { ...base, book: "foreign", chapter: 11, section: "第二节 明治维新时期的教育", knowledgeCardIds: [note.id], analysis: "此中教原题同时比较日本明治教育，与本节关联。" };
  const [result] = resolve([entry], [crossBook], [note]);
  assert.equal(result.originalQuestionId, original.id);
  assert.equal(result.stem, crossBook.stem);
  assert.equal(result.referenceAnswer, crossBook.referenceAnswer);
});

test("original references must exist and cannot overwrite the original text", () => {
  assert.throws(() => resolve([{ ...base, originalQuestionId: undefined }]), /requires originalQuestionId/);
  assert.throws(() => resolve([{ ...base, originalQuestionId: "missing" }]), /missing original question/);
  assert.throws(() => resolve([{ ...base, stem: "改写题干" }]), /preserve original/);
  assert.throws(() => resolve([{ ...base, referenceAnswer: "改写答案" }]), /preserve original/);
  assert.throws(() => resolve([base], [{ ...original, referenceAnswer: " " }]), /original question requires/);
});

test("adapted entries require their own complete question and answer, and do not pose as original references", () => {
  const [result] = resolve([adapted]);
  assert.equal(result.stem, adapted.stem);
  assert.equal(result.referenceAnswer, adapted.referenceAnswer);
  assert.equal(result.ocrWarning, "");
  for (const key of ["stem", "referenceAnswer"]) {
    assert.throws(() => resolve([{ ...adapted, [key]: " " }]), /own complete stem and referenceAnswer/);
  }
  assert.throws(() => resolve([{ ...adapted, originalQuestionId: original.id }]), /must not present an original/);
  assert.throws(() => resolve([{ ...base, origin: "invented" }]), /unsupported origin/);
});

test("duplicate entry, card and original identifiers are rejected", () => {
  assert.throws(() => resolve([base, base]), /duplicate id/);
  assert.throws(() => resolve([base], [original, original]), /Duplicate original question id/);
  assert.throws(() => resolve([base], [original], [cardA, cardA]), /Duplicate knowledge card id/);
  assert.throws(() => resolve([{ ...base, knowledgeCardIds: ["a", "a"] }]), /duplicate knowledge card reference/);
});

test("scope and note references use exact existing book, chapter and front-prefix section", () => {
  for (const bad of [
    { book: "research" }, { chapter: 0 }, { chapter: 1.5 }, { chapter: 99 },
    { section: " 第一节 教育的概念" }, { section: "〔第一节 教育的概念〕" },
    { knowledgeCardIds: [] }, { knowledgeCardIds: ["missing"] },
    { knowledgeCardIds: ["b"] }, { knowledgeCardIds: ["c"] },
  ]) assert.throws(() => resolve([{ ...base, ...bad }]), /scope|knowledgeCard|knowledge card/);
  for (const key of ["id", "topic", "source", "analysis"]) {
    assert.throws(() => resolve([{ ...base, [key]: " " }]), /required/);
  }
});

test("choice questions and education research references cannot enter 333 training", () => {
  assert.throws(() => resolve([{ ...base, questionType: "choice" }]), /unsupported question type/);
  assert.throws(() => resolve([{ ...adapted, source: "教研母题" }]), /education research/);
  for (const bad of [{ category: "母题·教育研究(扩展)" }, { source: "教研母题PDF1页" }, { category: "单项选择题" }, { options: ["A", "B"] }]) {
    assert.throws(() => resolve([base], [{ ...original, ...bad }]), /choice\/education research/);
  }
  const dandanChoice = essays.find(row => row.category === "丹丹中秋国庆卷" && row.number === 1);
  assert.ok(dandanChoice);
  assert.throws(() => resolve([{ ...base, originalQuestionId: dandanChoice.id }], essays), /choice\/education research/);
});

test("chapter deduplication preserves adapted questions; section filtering preserves its own original reference", () => {
  const sectionB = { ...base, id: "section-b", section: "第三节 教育的起源与发展", knowledgeCardIds: ["b"] };
  const chapter2 = { ...base, id: "chapter-2", chapter: 2, knowledgeCardIds: ["c"] };
  const rows = resolve([base, sectionB, adapted, { ...adapted, id: "adapted-2" }, chapter2]);
  assert.deepEqual(scopedTrainingEntries(rows, { book: "principles", chapter: 1 }).map(row => row.id), ["entry", "adapted", "adapted-2"]);
  assert.deepEqual(scopedTrainingEntries(rows, { book: "principles", chapter: 1, section: sectionB.section }).map(row => row.id), ["section-b"]);
  assert.deepEqual(scopedTrainingEntries(rows, { book: "principles", chapter: 2 }).map(row => row.id), ["chapter-2"]);
  assert.deepEqual(scopedTrainingEntries(rows, { book: "china", chapter: 1 }), []);
  assert.deepEqual(scopedTrainingEntries(rows, { book: "principles", chapter: 1, section: "不存在" }), []);
  assert.deepEqual(scopedTrainingEntries(rows, { book: "principles", chapter: 1, section: "" }), []);
  assert.equal(rows.length, 5);
});

test("verified handbook question 24 keeps its stable id, answer and restored original stem", () => {
  const original = essays.find(row => row.id === "hb-zhongjiao-24");
  assert.equal(original.stem, "24.论述陶行知的“生活教育”理论和陈鹤琴的“活教育”理论及二者的共同特点。");
  assert.equal(original.ocrWarning, "");
  assert.match(original.referenceAnswer, /（3）二者的共同点/);
  assert.match(original.source, /PDF第55页/);
  assert.ok(essays.some(row => row.ocrWarning), "other pending OCR warnings must remain");
});

test("verified notes restore actual section, add five-education integration and distinguish Bloom versions", () => {
  for (const id of ["principles-k1-043", "principles-k1-044", "principles-k1-045"]) {
    assert.ok(cards.find(card => card.id === id).front.startsWith("〔第三节 教育的起源与发展〕"));
  }
  const five = cards.find(card => card.id === "principles-k4-039");
  assert.match(five.back, /融合不是.*简单叠加/);
  assert.match(five.back, /同一教育活动/);
  assert.match(five.source, /64–65页/);
  const bloom = cards.find(card => card.id === "principles-k6-048");
  assert.match(bloom.back, /修订版.*记忆、理解、应用、分析、评价、创造/);
  assert.match(bloom.back, /原版.*知识、领会、运用、分析、综合、评价/);
  assert.match(bloom.source, /161–162页/);
  assert.match(bloom.back, /知觉、定势、模仿、操作、准确、连贯、习惯化/, "psychomotor content was not rewritten without a verified source");
});

test("original card and essay ids retain their complete order; supplemental notes clearly name their actual sources", () => {
  const hashIds = rows => createHash("sha256").update(JSON.stringify(rows.map(row => row.id))).digest("hex");
  const oldCards = cards.filter(card => !card.id.startsWith("principles-extra-"));
  assert.equal(oldCards.length, 1685);
  assert.equal(hashIds(oldCards), "44023d56dfd24e56bdf232a4168aea3d2859166c424921605473589c56a9d02c");
  assert.equal(essays.length, 129);
  assert.equal(hashIds(essays), "b7e632f80fa352a398c83bc3e86b9755c0ed77cda345cd09fdd2a8babc01bef9");
  const extras = cards.filter(card => card.id.startsWith("principles-extra-"));
  assert.equal(extras.length, 4);
  assert.equal(new Set(cards.map(card => card.id)).size, cards.length);
  for (const card of extras) {
    assert.match(card.source, /补充资料/);
    assert.match(card.source, /高效答题手册|母题班课件/);
    assert.doesNotMatch(card.source, /应试解析/);
  }
});
