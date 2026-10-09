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
const { restoreStudyReview, serializeStudyReview, selectNewStudyScopes, pauseStudyScope, buildReviewSession, rateStudyReviewCard, studyReviewKey } = await realModule("../lib/use-study-review.ts");
const { applyRating } = await realModule("../lib/study-scheduler.ts");
const now = new Date(2026, 8, 30, 12);
const later = minutes => new Date(now.getTime() + minutes * 60_000);
const catalog = [
  { id: "a1", book: "a", chapter: 1, section: "one" },
  { id: "a2", book: "a", chapter: 1, section: "two" },
  { id: "a3", book: "a", chapter: 2, section: "one" },
  { id: "b1", book: "b", chapter: 1, section: "one" },
];
const scope = (bookId, chapter, section) => ({ bookId, chapters: [chapter], ...(section ? { section } : {}) });
const rate = (session, id, grade, instant = now) => ({ ...session, progress: applyRating(session.progress, id, grade, instant) });

test("fresh session requires explicit scope; first chapter includes only its eligible new cards", () => {
  let session = restoreStudyReview(null, catalog, now);
  assert.deepEqual(buildReviewSession(catalog, session, now).items, []);
  assert.equal(session.progress.dailyNewLimit, 20);
  session = selectNewStudyScopes(session, [scope("a", 1)], catalog);
  assert.deepEqual(buildReviewSession(catalog, session, now).items.map(item => [item.cardId, item.kind]), [["a1", "new"], ["a2", "new"]]);
  session = rate(session, "a1", "again");
  const before = buildReviewSession(catalog, session, later(0.99));
  assert.equal(before.counts.reviewDue, 0);
  assert.deepEqual(before.items.map(item => item.cardId), ["a2"]);
  assert.deepEqual(buildReviewSession(catalog, session, later(1)).items.map(item => [item.cardId, item.kind]), [["a1", "learning"], ["a2", "new"]]);
});

test("changing new selection to chapter two retains chapter one due cards and admits chapter two for future review", () => {
  let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [scope("a", 1)], catalog);
  session = rate(session, "a1", "again");
  const history = structuredClone(session.progress.cards);
  session = selectNewStudyScopes(session, [scope("a", 2)], catalog);
  assert.deepEqual(session.progress.cards, history);
  assert.deepEqual(buildReviewSession(catalog, session, later(1)).items.map(item => [item.cardId, item.kind]), [["a1", "learning"], ["a3", "new"]]);
  session = rate(session, "a3", "good", later(1));
  assert.ok(session.progress.scopes.some(value => value.bookId === "a" && value.chapters.includes(2)));
  assert.equal(buildReviewSession(catalog, session, later(1)).counts.newToday, 0);
  assert.ok(buildReviewSession(catalog, session, later(1441)).items.some(item => item.cardId === "a3" && item.kind === "review"));
});

test("pausing preserves history, removes pending cards, and rejoining resumes their original schedule", () => {
  let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [scope("a", 1), scope("b", 1)], catalog);
  session = rate(session, "a1", "hard");
  const history = structuredClone(session.progress.cards);
  session = pauseStudyScope(session, scope("a", 1));
  assert.deepEqual(session.progress.cards, history);
  assert.deepEqual(buildReviewSession(catalog, session, later(5)).items.map(item => item.cardId), ["b1"]);
  session = selectNewStudyScopes(session, [scope("a", 1, "one")], catalog);
  assert.deepEqual(buildReviewSession(catalog, session, later(5)).items.map(item => [item.cardId, item.kind]), [["a1", "learning"]]);
});

test("reload preserves future dates, selected sections, active ranges, daily quota, and separate subject keys", () => {
  let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [scope("a", 1, "one"), scope("b", 1)], catalog);
  session.progress.dailyNewLimit = 1;
  session = rate(session, "a1", "easy");
  const serialized = serializeStudyReview(session);
  const restored = restoreStudyReview(serialized, catalog, now);
  assert.deepEqual(restored, session);
  assert.equal(buildReviewSession(catalog, restored, now).items.length, 0);
  assert.equal(buildReviewSession(catalog, restored, now).remainingNewLimit, 0);
  assert.equal(restored.progress.cards.a1.dueAt, new Date(2026, 9, 4, 6, 30).toISOString());
  assert.equal(buildReviewSession(catalog, restored, later(1440)).counts.newToday, 1);
  assert.equal(studyReviewKey("333"), "yantu-srs-v1-333");
  assert.equal(studyReviewKey("825"), "yantu-srs-v1-825");
});

test("legacy migration preserves future review history without enrolling unrated library cards as today's new", () => {
  const legacy = { a1: { due: "2026-10-04", interval: 4, ease: 2.6, reps: 3 }, orphan: { due: "2026-10-09", interval: 9, ease: 2.5, reps: 7 } };
  const original = JSON.stringify(legacy);
  const migrated = restoreStudyReview(null, catalog, now, original);
  assert.equal(migrated.progress.cards.a1.reps, 3);
  assert.equal(migrated.progress.cards.orphan.reps, 7);
  assert.equal(buildReviewSession(catalog, migrated, now).counts.reviewDue, 0);
  assert.equal(buildReviewSession(catalog, migrated, now).counts.newToday, 0);
  assert.deepEqual(migrated.newScopes, []);
  assert.equal(JSON.stringify(legacy), original);
  const reload = restoreStudyReview(serializeStudyReview(migrated), catalog, now, { a1: { due: "2020-01-01" } });
  assert.equal(reload.progress.cards.a1.dueAt, migrated.progress.cards.a1.dueAt);
});

test("whole chapter selection supersedes overlapping section ranges without duplicated queue cards", () => {
  let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [scope("a", 1, "one")], catalog);
  session = selectNewStudyScopes(session, [...session.newScopes, scope("a", 1)], catalog);
  assert.deepEqual(session.newScopes, [scope("a", 1)]);
  assert.deepEqual(session.progress.scopes, [scope("a", 1)]);
  assert.deepEqual(buildReviewSession(catalog, session, now).items.map(item => item.cardId), ["a1", "a2"]);
  session = selectNewStudyScopes(session, [], catalog);
  assert.equal(session.progress.scopes.length, 1);
  assert.equal(buildReviewSession(catalog, session, now).counts.newToday, 0);
});

test("each selected book can start scoped new cards while all modes share one 20-card admission limit", () => {
  const many = ["a", "b"].flatMap(book => Array.from({ length: 25 }, (_, index) => ({ id: `${book}${index}`, book, chapter: 1 })));
  let session = selectNewStudyScopes(restoreStudyReview(null, many, now), [scope("a", 1), scope("b", 1)], many);
  assert.equal(buildReviewSession(many, session, now).items.length, 20);
  assert.ok(buildReviewSession(many, session, now).items.every(item => item.cardId.startsWith("a")));
  assert.equal(buildReviewSession(many, session, now, scope("b", 1)).items.length, 20);
  session = rateStudyReviewCard(session, many, "b0", "good", now, scope("b", 1));
  assert.ok(session);
  assert.deepEqual(session.progress.daily.admitted, ["b0"]);
  assert.equal(buildReviewSession(many, session, now, scope("a", 1)).items.length, 19);
  assert.equal(buildReviewSession(many, session, now, scope("b", 1)).items.length, 19);
  assert.equal(buildReviewSession(many, session, now).remainingNewLimit, 19);
  for (let index = 0; index < 19; index += 1) {
    session = rateStudyReviewCard(session, many, `a${index}`, "good", now, scope("a", 1));
    assert.ok(session);
  }
  for (const location of [undefined, scope("a", 1), scope("b", 1)]) {
    assert.equal(buildReviewSession(many, session, now, location).remainingNewLimit, 0);
    assert.equal(buildReviewSession(many, session, now, location).items.length, 0);
  }
  assert.equal(rateStudyReviewCard(session, many, "b1", "good", now, scope("b", 1)), null);
  assert.equal(Object.keys(session.progress.cards).length, 20);
  assert.deepEqual(restoreStudyReview(serializeStudyReview(session), many, now), session);
});

test("scoped rating validates current eligibility without enrolling unselected cards or advancing future cards", () => {
  let session = selectNewStudyScopes(restoreStudyReview(null, catalog, now), [scope("a", 1, "one")], catalog);
  const original = JSON.stringify(session);
  assert.equal(rateStudyReviewCard(session, catalog, "b1", "good", now, scope("b", 1)), null);
  assert.equal(rateStudyReviewCard(session, catalog, "a2", "good", now, scope("a", 1)), null);
  assert.equal(rateStudyReviewCard(session, catalog, "a1", "good", now, scope("b", 1)), null);
  assert.equal(JSON.stringify(session), original);
  session = rateStudyReviewCard(session, catalog, "a1", "hard", now, scope("a", 1, "one"));
  assert.ok(session);
  assert.equal(rateStudyReviewCard(session, catalog, "a1", "good", later(4), scope("a", 1)), null);
  session = selectNewStudyScopes(session, [scope("b", 1)], catalog);
  const dueQueue = buildReviewSession(catalog, session, later(5), scope("a", 1));
  assert.deepEqual(dueQueue.items.map(item => [item.cardId, item.kind]), [["a1", "learning"]]);
  const rated = rateStudyReviewCard(session, catalog, "a1", "good", later(5), scope("a", 1));
  assert.ok(rated);
  assert.equal(rated.progress.cards.a1.firstStudiedAt, session.progress.cards.a1.firstStudiedAt);
  assert.deepEqual(rated.progress.daily.admitted, ["a1"]);
});
