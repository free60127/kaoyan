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
const { scopedStudyReviewView, studyBrowseIndex } = await realModule("../lib/study-review-view.ts");
const { restoreStudyReview, selectNewStudyScopes, buildReviewSession, rateStudyReviewCard } = await realModule("../lib/use-study-review.ts");
const { createEmptyProgress } = await realModule("../lib/study-scheduler.ts");
const { cards: raw333, loadKnowledgeCards } = await realModule("../lib/study-data.ts");
const { load825StudyData } = await realModule("../lib/825/study-data.ts");
const knowledge333 = await loadKnowledgeCards();
const catalogs = {
  "333": [...raw333, ...knowledge333].map(card => ({ ...card, section: /^〔(.+?)〕/.exec(card.front)?.[1] })),
  "825": (await load825StudyData()).cards,
};
const now = new Date(2026, 8, 30, 12);
const later = minutes => new Date(now.getTime() + minutes * 60_000);
const scope = (bookId, chapter, section) => ({ bookId, chapters: [chapter], ...(section ? { section } : {}) });

test("location view filters book, chapter and optional section, preserving due/new order and global quota", () => {
  const catalog = [
    { id: "a1", book: "a", chapter: 1, section: "one" },
    { id: "a2", book: "a", chapter: 1, section: "two" },
    { id: "a3", book: "a", chapter: 2, section: "one" },
    { id: "b1", book: "b", chapter: 1, section: "one" },
    { id: "a4", book: "a", chapter: 1, section: "one" },
  ];
  const queue = {
    items: [{ cardId: "b1", kind: "review", dueAt: now.toISOString() }, { cardId: "a2", kind: "learning", dueAt: now.toISOString() }, { cardId: "a3", kind: "review", dueAt: now.toISOString() }, { cardId: "a1", kind: "new", dueAt: null }, { cardId: "a4", kind: "new", dueAt: null }],
    counts: { reviewDue: 3, learningDue: 1, newToday: 2, newAvailable: 99 }, nextDueAt: null, remainingNewLimit: 7,
  };
  const progress = createEmptyProgress(now);
  const before = JSON.stringify({ queue, catalog, progress });
  const chapterView = scopedStudyReviewView(queue, catalog, progress, scope("a", 1), now);
  assert.deepEqual(chapterView.items.map(item => item.cardId), ["a2", "a1", "a4"]);
  assert.deepEqual(chapterView.counts, { reviewDue: 1, learningDue: 1, newToday: 2 });
  assert.deepEqual(scopedStudyReviewView(queue, catalog, progress, scope("a", 1, "one"), now).items.map(item => item.cardId), ["a1", "a4"]);
  assert.deepEqual(scopedStudyReviewView(queue, catalog, progress, scope("b", 1), now).items.map(item => item.cardId), ["b1"]);
  assert.deepEqual(scopedStudyReviewView(queue, catalog, progress, scope("a", 2), now).items.map(item => item.cardId), ["a3"]);
  assert.equal(chapterView.remainingNewLimit, 7);
  assert.equal(JSON.stringify({ queue, catalog, progress }), before);
});

test("empty scoped waiting time comes only from active local cards, never another book, section or paused chapter", () => {
  const catalog = [{ id: "a1", book: "a", chapter: 1, section: "one" }, { id: "a2", book: "a", chapter: 1, section: "two" }, { id: "b1", book: "b", chapter: 1 }];
  let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [scope("a", 1), scope("b", 1)], catalog);
  session = rateStudyReviewCard(session, catalog, "a1", "hard", now);
  session = rateStudyReviewCard(session, catalog, "a2", "again", now);
  session = rateStudyReviewCard(session, catalog, "b1", "again", now);
  const queue = buildReviewSession(catalog, session, now);
  assert.equal(queue.nextDueAt, later(1).toISOString());
  assert.equal(scopedStudyReviewView(queue, catalog, session.progress, scope("a", 1, "one"), now).nextDueAt, later(5).toISOString());
  assert.equal(scopedStudyReviewView(queue, catalog, session.progress, scope("unknown", 1), now).nextDueAt, null);
  session.progress.scopes = [scope("b", 1)];
  assert.equal(scopedStudyReviewView(queue, catalog, session.progress, scope("a", 1), now).nextDueAt, null);
});

test("browse cursor resolves a new location immediately and bounds stale indices", () => {
  assert.equal(studyBrowseIndex({ scopeKey: "a", index: 19 }, "b", 30), 0);
  assert.equal(studyBrowseIndex({ scopeKey: "a", index: 19 }, "a", 2), 1);
  assert.equal(studyBrowseIndex({ scopeKey: "a", index: 19 }, "a", 0), 0);
  assert.equal(studyBrowseIndex({ scopeKey: "a", index: -1 }, "a", 2), 0);
});

for (const [subject, catalog] of Object.entries(catalogs)) {
  test(`${subject} real catalog: chapter/section views stay local and earlier due history survives new selection changes`, () => {
    const first = catalog.find(card => card.section);
    assert.ok(first);
    const other = catalog.find(card => card.book !== first.book);
    assert.ok(other);
    const location = scope(first.book, first.chapter);
    let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [location], catalog);
    const initialHistory = JSON.stringify(session);
    const chapterQueue = buildReviewSession(catalog, session, now, location);
    const view = scopedStudyReviewView(chapterQueue, catalog, session.progress, location, now);
    assert.deepEqual(view.items, chapterQueue.items);
    assert.deepEqual(view.items.map(item => item.cardId), catalog.filter(card => card.book === first.book && card.chapter === first.chapter).slice(0, 20).map(card => card.id));
    const sectionScope = scope(first.book, first.chapter, first.section);
    const sectionQueue = buildReviewSession(catalog, session, now, sectionScope);
    assert.ok(sectionQueue.items.length);
    assert.deepEqual(scopedStudyReviewView(sectionQueue, catalog, session.progress, sectionScope, now).items.map(item => item.cardId), catalog.filter(card => card.book === first.book && card.chapter === first.chapter && card.section === first.section).slice(0, 20).map(card => card.id));
    assert.equal(JSON.stringify(session), initialHistory);
    session = rateStudyReviewCard(session, catalog, first.id, "again", now, sectionScope);
    assert.ok(session);
    const history = structuredClone(session.progress.cards);
    session = selectNewStudyScopes(session, [scope(other.book, other.chapter)], catalog);
    assert.deepEqual(session.progress.cards, history);
    const globalQueue = buildReviewSession(catalog, session, later(1));
    assert.ok(globalQueue.items.some(item => item.cardId === first.id && item.kind === "learning"));
    const previousView = scopedStudyReviewView(buildReviewSession(catalog, session, later(1), sectionScope), catalog, session.progress, sectionScope, later(1));
    assert.deepEqual(previousView.items.map(item => [item.cardId, item.kind]), [[first.id, "learning"]]);
    assert.equal(previousView.remainingNewLimit, 19);
    assert.deepEqual(session.progress.cards, history);
  });
}
