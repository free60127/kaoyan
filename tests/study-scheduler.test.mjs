import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Compile the real TypeScript module in memory; no generated files or user storage.
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../lib/study-scheduler.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "node20",
});
const scheduler = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const { createEmptyProgress, normalizeStoredProgress, normalizeStudyScopes, migrateLegacyReviews, buildStudyQueue, previewSchedule, applyRating, localStudyDate } = scheduler;
const now = new Date(2026, 8, 30, 12, 0, 0);
const advance = minutes => new Date(now.getTime() + minutes * 60_000);
const catalog = [
  { id: "a1", book: "a", chapter: 1, section: "one" },
  { id: "a2", book: "a", chapter: 1, section: "two" },
  { id: "a3", book: "a", chapter: 2, section: "one" },
  { id: "b1", book: "b", chapter: 1, section: "one" },
];
const active = (dailyNewLimit = 20) => ({ ...createEmptyProgress(now, dailyNewLimit), scopes: [{ bookId: "a", chapters: [1] }] });

test("a fresh subject has no scopes, due cards, or automatic library admission", () => {
  const empty = createEmptyProgress(now);
  assert.deepEqual(buildStudyQueue(catalog, empty, now).counts, { reviewDue: 0, learningDue: 0, newAvailable: 0, newToday: 0 });
  const queue = buildStudyQueue(catalog, active(), now);
  assert.equal(queue.counts.reviewDue, 0);
  assert.equal(queue.counts.newAvailable, 2);
  assert.deepEqual(queue.items.map(item => item.cardId), ["a1", "a2"]);
  assert.ok(queue.items.every(item => item.kind === "new"));
});

test("scope and current filters restrict books, chapters, and sections", () => {
  const scopes = normalizeStudyScopes([
    { bookId: "a", chapters: [1, 1, 2, 99, -1, "1"], section: "one" },
    { bookId: "missing", chapters: [1] },
    { bookId: "a", chapters: [1], section: "missing" },
    { bookId: "a", chapters: [1], section: 42 },
  ], catalog);
  assert.deepEqual(scopes, [{ bookId: "a", chapters: [1, 2], section: "one" }]);
  const progress = { ...active(), scopes };
  assert.deepEqual(buildStudyQueue(catalog, progress, now).items.map(item => item.cardId), ["a1", "a3"]);
  assert.deepEqual(buildStudyQueue(catalog, progress, now, { bookId: "a", chapters: [2] }).items.map(item => item.cardId), ["a3"]);
  assert.equal(buildStudyQueue(catalog, progress, now, { bookId: "b", chapters: [1] }).items.length, 0);
  assert.equal(buildStudyQueue(catalog, progress, now, { bookId: "a", chapters: [1], section: "two" }).items.length, 0);
});

test("daily quota counts first ratings once and resets at local midnight", () => {
  let progress = active(1);
  assert.equal(buildStudyQueue(catalog, progress, now).counts.newToday, 1);
  progress = applyRating(progress, "a1", "again", now);
  progress = applyRating(progress, "a1", "good", advance(1));
  const queue = buildStudyQueue(catalog, progress, advance(1));
  assert.equal(queue.counts.newAvailable, 1);
  assert.equal(queue.counts.newToday, 0);
  assert.equal(queue.remainingNewLimit, 0);
  assert.deepEqual(progress.daily.admitted, ["a1"]);
  const tomorrow = new Date(2026, 9, 1, 0, 0, 0);
  assert.equal(buildStudyQueue(catalog, progress, tomorrow).counts.newToday, 1);
  assert.equal(buildStudyQueue(catalog, active(0), now).items.length, 0);
  assert.equal(createEmptyProgress(now, 200).dailyNewLimit, 200);
  assert.equal(createEmptyProgress(now, 201).dailyNewLimit, 20);
  assert.equal(createEmptyProgress(now, NaN).dailyNewLimit, 20);
});

test("ratings remove a card until its exact due boundary; again is never immediate", () => {
  const original = active();
  const progress = applyRating(original, "a1", "again", now);
  assert.equal(Object.keys(original.cards).length, 0);
  assert.equal(buildStudyQueue(catalog, progress, now).counts.reviewDue, 0);
  assert.deepEqual(buildStudyQueue(catalog, progress, now).items.map(item => item.cardId), ["a2"]);
  assert.equal(buildStudyQueue(catalog, progress, advance(1 - 1 / 60_000)).counts.reviewDue, 0);
  const due = buildStudyQueue(catalog, progress, advance(1));
  assert.equal(due.counts.reviewDue, 1);
  assert.equal(due.counts.learningDue, 1);
  assert.equal(due.items[0].cardId, "a1");
  assert.equal(due.items[0].kind, "learning");
  assert.equal(buildStudyQueue(catalog, progress, now).nextDueAt, advance(1).toISOString());
});

test("all four first-rating previews give different concrete times and match applied schedules", () => {
  const grades = ["again", "hard", "good", "easy"];
  assert.deepEqual(grades.map(grade => previewSchedule(undefined, grade, now).delayMinutes), [1, 5, 1440, 5760]);
  for (const grade of grades) {
    const preview = previewSchedule(undefined, grade, now);
    const progress = applyRating(active(), "a1", grade, now);
    assert.equal(progress.cards.a1.dueAt, preview.dueAt);
    assert.equal(progress.cards.a1.intervalDays, preview.delayDays);
    assert.equal(progress.cards.a1.firstStudiedAt, now.toISOString());
    assert.equal(progress.cards.a1.lastReviewedAt, now.toISOString());
  }
});

test("due cards precede new cards and sort by due time; future cards stay excluded", () => {
  let progress = { ...active(), scopes: [{ bookId: "a", chapters: [1, 2] }, { bookId: "b", chapters: [1] }] };
  progress = applyRating(progress, "a1", "hard", now);
  progress = applyRating(progress, "a2", "again", now);
  progress = applyRating(progress, "a3", "good", now);
  const queue = buildStudyQueue(catalog, progress, advance(5));
  assert.deepEqual(queue.items.map(item => item.cardId), ["a2", "a1", "b1"]);
  assert.equal(queue.nextDueAt, new Date(2026, 9, 1, 6, 30).toISOString());
  assert.equal(queue.counts.reviewDue, 2);
  assert.equal(queue.counts.newToday, 1);
  assert.equal(buildStudyQueue(catalog, { ...progress, scopes: [] }, advance(5)).counts.reviewDue, 0);
});

test("mature review intervals grow differently and relearning preserves first study and lapse history", () => {
  const mature = { ...previewSchedule(undefined, "good", now), intervalDays: 10, reps: 5, ease: 2.5 };
  assert.deepEqual(["again", "hard", "good", "easy"].map(grade => previewSchedule(mature, grade, now).delayDays), [1 / 1440, 12, 25, 32.5]);
  const failed = previewSchedule(mature, "again", now);
  assert.equal(failed.stage, "relearning");
  assert.equal(failed.lapses, 1);
  assert.equal(failed.ease, 2.3);
  assert.equal(failed.reps, 5);
  const recovered = previewSchedule(failed, "good", advance(1));
  assert.equal(recovered.stage, "review");
  assert.ok(recovered.intervalDays >= 1);
  assert.equal(recovered.firstStudiedAt, mature.firstStudiedAt);
  assert.equal(recovered.lapses, 1);
  const first = previewSchedule(undefined, "good", now);
  assert.equal(previewSchedule(first, "good", advance(1440)).intervalDays, 3);
  assert.equal(previewSchedule({ ...mature, intervalDays: 36500 }, "easy", now).intervalDays, 36500);
});

test("legacy future dates open at local 06:30, zero reps are learned, scopes infer only rated chapters", () => {
  const legacy = {
    a1: { due: "2026-10-05", interval: 10, ease: 2.2, reps: 0 },
    a3: { due: "2026-09-30", interval: 3, ease: 2.5, reps: 2 },
    retired: { due: "2026-10-06", interval: 4, ease: 2.5, reps: 1 },
  };
  const migrated = migrateLegacyReviews(legacy, catalog, now);
  assert.equal(migrated.a1.dueAt, new Date(2026, 9, 5, 6, 30, 0).toISOString());
  assert.equal(migrated.a1.reps, 0);
  assert.equal(migrated.a1.intervalDays, 10);
  assert.equal(migrated.a1.ease, 2.2);
  const progress = normalizeStoredProgress(null, catalog, now, legacy);
  assert.deepEqual(progress.scopes, [{ bookId: "a", chapters: [1] }, { bookId: "a", chapters: [2] }]);
  const queue = buildStudyQueue(catalog, progress, now);
  assert.equal(queue.counts.reviewDue, 1);
  assert.equal(queue.counts.newAvailable, 1);
  assert.equal(queue.remainingNewLimit, 20);
  assert.deepEqual(queue.items.map(item => item.cardId), ["a3", "a2"]);
  assert.ok(progress.cards.retired);
  assert.equal(legacy.a1.due, "2026-10-05");
});

test("malformed storage is safe and invalid legacy dates receive a valid immediate due timestamp", () => {
  for (const value of [null, undefined, [], ["a1"], "invalid-json", "[]", 42, { version: 2 }, { version: 1, cards: [], scopes: [], dailyNewLimit: NaN }]) {
    assert.doesNotThrow(() => normalizeStoredProgress(value, catalog, now));
  }
  const migrated = migrateLegacyReviews({ a1: { due: "2026-02-30", interval: NaN, ease: Infinity, reps: -2 }, a2: [], a3: { due: "nonsense" }, b1: "nonsense" }, catalog, now);
  assert.equal(migrated.a1.dueAt, now.toISOString());
  assert.equal(migrated.a1.ease, 2.5);
  assert.equal(migrated.a1.reps, 0);
  assert.equal(migrated.a3.dueAt, now.toISOString());
  assert.equal(migrated.a2, undefined);
  const progress = normalizeStoredProgress({ version: 1, cards: { a1: { dueAt: "2026-02-30T12:00:00Z" }, a2: null }, scopes: [[], { bookId: "a", chapters: [99] }], daily: { date: localStudyDate(now), admitted: [null, "a1"] } }, catalog, now);
  assert.deepEqual(progress.cards, {});
  assert.deepEqual(progress.scopes, []);
  assert.deepEqual(progress.daily.admitted, []);
});

test("333 and 825 state stays independent even when card IDs coincide", () => {
  const subject333 = applyRating(active(), "a1", "good", now);
  const subject825 = active();
  assert.equal(buildStudyQueue(catalog, subject333, now).counts.newToday, 1);
  assert.equal(buildStudyQueue(catalog, subject825, now).counts.newToday, 2);
  assert.deepEqual(subject825.cards, {});
  assert.equal(buildStudyQueue(catalog, subject333, advance(1440)).counts.reviewDue, 1);
  assert.equal(buildStudyQueue(catalog, subject825, advance(1440)).counts.reviewDue, 0);
});

test("valid old catalog IDs remain in history but never enter the current queue", () => {
  const first = previewSchedule(undefined, "good", new Date(2026, 8, 28, 12));
  const progress = normalizeStoredProgress({
    ...active(),
    cards: { retired: first, a1: first },
    scopes: [{ bookId: "a", chapters: [1] }],
  }, catalog, now);
  assert.ok(progress.cards.retired);
  assert.deepEqual(buildStudyQueue(catalog, progress, now).items.map(item => item.cardId), ["a1", "a2"]);
  const next = applyRating(progress, "a1", "hard", now);
  assert.deepEqual(next.cards.retired, progress.cards.retired);
  assert.equal(next.cards.a1.firstStudiedAt, first.firstStudiedAt);
  assert.equal(next.cards.a1.lastReviewedAt, now.toISOString());
  assert.equal(buildStudyQueue(catalog, next, now).counts.reviewDue, 0);
  assert.equal(buildStudyQueue(catalog, next, new Date(next.cards.a1.dueAt)).counts.reviewDue, 1);
});

test("JSON arrays, invalid timestamps and non-finite values cannot admit invalid card states", () => {
  const review = previewSchedule(undefined, "good", now);
  for (const invalid of [
    { ...review, dueAt: "2026-09-30" },
    { ...review, dueAt: "2026-09-30T24:00:00Z" },
    { ...review, dueAt: "2026-02-30T12:00:00Z" },
    { ...review, firstStudiedAt: "bad" },
    { ...review, reps: NaN },
    { ...review, ease: Infinity },
    { ...review, lapses: [] },
    { ...review, stage: "unknown" },
  ]) {
    const restored = normalizeStoredProgress({ ...active(), cards: { a1: invalid } }, catalog, now);
    assert.equal(restored.cards.a1, undefined);
    assert.equal(buildStudyQueue(catalog, restored, now).counts.reviewDue, 0);
  }
  const array = normalizeStoredProgress("[]", catalog, now);
  assert.deepEqual(array.scopes, []);
  const legacyWithSpecialKey = JSON.parse('{"__proto__":{"due":"2026-09-30","interval":1,"ease":2.5,"reps":0}}');
  const migrated = migrateLegacyReviews(legacyWithSpecialKey, catalog, now);
  assert.ok(Object.prototype.hasOwnProperty.call(migrated, "__proto__"));
  assert.equal({}.due, undefined);
  assert.throws(() => previewSchedule(undefined, "good", "bad"), RangeError);
});

test("local calendar quota and ISO timestamps round-trip on both sides of midnight", () => {
  const late = new Date(2026, 8, 30, 23, 59, 0);
  const midnight = new Date(2026, 9, 1, 0, 0, 0);
  let progress = { ...createEmptyProgress(late, 1), scopes: [{ bookId: "a", chapters: [1] }] };
  progress = applyRating(progress, "a1", "again", late);
  assert.equal(progress.daily.date, "2026-09-30");
  assert.equal(progress.cards.a1.dueAt, midnight.toISOString());
  assert.equal(buildStudyQueue(catalog, progress, midnight).remainingNewLimit, 1);
  assert.equal(buildStudyQueue(catalog, progress, midnight).counts.reviewDue, 1);
  const restored = normalizeStoredProgress(JSON.stringify(progress), catalog, midnight);
  assert.equal(restored.daily.date, "2026-10-01");
  assert.equal(restored.cards.a1.firstStudiedAt, late.toISOString());
  assert.equal(restored.cards.a1.dueAt, midnight.toISOString());
});
