import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const books = ["principles", "china", "foreign", "psychology"];
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const cards = await json("../lib/knowledge-cards.json");
const essays = await json("../lib/essay-questions.json");
const entries = (await Promise.all(books.map(book => json(`../lib/essay-training/${book}.json`)))).flat();
const bundled = await build({ entryPoints: [fileURLToPath(new URL("../lib/essay-training.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20", logLevel: "silent" });
const { resolveTrainingEntries, scopedTrainingEntries } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const resolved = resolveTrainingEntries(entries, essays, cards);
const groupKey = row => JSON.stringify([row.book, row.chapter, row.section ?? row.front.match(/^〔([^〕]+)〕/)?.[1]]);
const expected = new Map(cards.map(card => [groupKey(card), card]));

test("all four books, 43 chapters and every actual knowledge section have scoped big-question training", () => {
  assert.equal(expected.size, 161, "corrected actual card sections, including named 考点 groups");
  assert.equal(new Set(cards.map(card => `${card.book}:${card.chapter}`)).size, 43);
  assert.equal(new Set(entries.map(row => row.id)).size, entries.length);
  const covered = new Set(entries.map(groupKey));
  assert.deepEqual([...covered].sort(), [...expected.keys()].sort(), "no missing or invented section");
  for (const [key, card] of expected) {
    const section = card.front.match(/^〔([^〕]+)〕/)[1];
    const scoped = scopedTrainingEntries(resolved, { book: card.book, chapter: card.chapter, section });
    assert.ok(scoped.length, key);
    assert.ok(scoped.every(row => groupKey(row) === key), "selected section never receives another book's material");
  }
});

test("all source questions retain complete original material, subquestions, answers and pending OCR warnings", () => {
  const byId = new Map(essays.map(row => [row.id, row]));
  for (const row of resolved.filter(row => row.origin === "source-question")) {
    const original = byId.get(row.originalQuestionId);
    assert.equal(row.stem, original.stem, row.id);
    assert.equal(row.referenceAnswer, original.referenceAnswer, row.id);
    assert.equal(row.source, original.source, row.id);
    assert.equal(row.ocrWarning, original.ocrWarning, row.id);
  }
  assert.ok(resolved.some(row => row.ocrWarning), "unresolved source warnings must not disappear during association");
  const expectedOriginals = essays.filter(row => !/教研|教育研究/.test(row.category + row.source) && !(row.category === "丹丹中秋国庆卷" && row.number <= 30));
  assert.equal(expectedOriginals.length, 96);
  assert.deepEqual([...new Set(resolved.filter(row => row.origin === "source-question").map(row => row.originalQuestionId))].sort(), expectedOriginals.map(row => row.id).sort(), "all 84 handbook originals, six mother-class originals and six Dandan open questions are available in relevant sections");
});

test("adapted questions are explicitly distinguished and tied to actual section notes and PDF sources", () => {
  for (const row of entries.filter(row => row.origin === "adapted")) {
    assert.match(row.source, /资料改编/, row.id);
    assert.match(row.source, /PDF|第.*页/, row.id);
    assert.ok(row.stem.trim().length >= 20, `${row.id}: a complete question is required`);
    assert.ok(row.referenceAnswer.trim().length >= 100, `${row.id}: a substantive answer is required`);
    assert.ok(row.analysis.trim().length >= 30, `${row.id}: separate reasoning is required`);
    assert.ok(row.knowledgeCardIds.length > 0 && row.knowledgeCardIds.length <= 6, row.id);
    assert.equal(row.originalQuestionId, undefined, "authored material cannot impersonate an original source");
  }
});
