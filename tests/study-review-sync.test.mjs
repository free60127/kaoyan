import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({ entryPoints: [fileURLToPath(new URL("../lib/use-study-review.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", target: "node20" });
const { createStudyReviewSync, studyReviewKey, buildReviewSession, restoreStudyReview } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const instant = new Date(2026, 8, 30, 12).getTime();
const catalog = [
  ...Array.from({ length: 25 }, (_, index) => ({ id: `a${index}`, book: "a", chapter: 1 })),
  { id: "a-next", book: "a", chapter: 2 }, { id: "b0", book: "b", chapter: 1 },
];
const scope = (bookId, chapter) => ({ bookId, chapters: [chapter] });
function fakeStorage() {
  const values = new Map();
  return {
    values, reads: 0, writes: 0, failRead: false, failWrite: false,
    getItem(key) { this.reads++; if (this.failRead) throw new Error("private read failure"); return values.get(key) ?? null; },
    setItem(key, value) { this.writes++; if (this.failWrite) throw new Error("private write failure"); values.set(key, value); },
  };
}
const open = (storage, subject = "333", changed) => createStudyReviewSync(subject, catalog, storage, () => instant, changed);
const saved = (storage, subject = "333") => restoreStudyReview(storage.values.get(studyReviewKey(subject)), catalog, instant);
const queue = controller => buildReviewSession(catalog, controller.session, instant);

test("two tabs refresh quota and queue from storage events and focus without save loops", () => {
  const storage = fakeStorage();
  let updates = 0;
  const a = open(storage, "333", () => { updates++; });
  const b = open(storage);
  a.selectScopes([scope("a", 1)]);
  b.refresh();
  a.rateCard("a0", "good");
  a.rateCard("a1", "good");
  b.setDailyNewLimit(5);
  assert.equal(a.session.progress.dailyNewLimit, 20);
  const writes = storage.writes;
  a.storageChanged({ key: studyReviewKey("333") });
  assert.equal(a.session.progress.dailyNewLimit, 5);
  assert.equal(queue(a).counts.newToday, 3);
  assert.equal(queue(a).remainingNewLimit, 3);
  assert.deepEqual(a.session, b.session);
  const observed = updates;
  a.refresh(); // The hook uses this same read on window focus.
  a.storageChanged({ key: studyReviewKey("333") });
  assert.equal(storage.writes, writes);
  assert.equal(updates, observed);
});

test("sequential stale-tab ratings reread and preserve both records and latest limit", () => {
  const storage = fakeStorage();
  const a = open(storage), b = open(storage);
  a.selectScopes([scope("a", 1)]);
  b.refresh();
  a.rateCard("a0", "good");
  b.setDailyNewLimit(5);
  a.rateCard("a1", "easy");
  b.rateCard("a2", "hard");
  const progress = saved(storage).progress;
  assert.deepEqual(Object.keys(progress.cards), ["a0", "a1", "a2"]);
  assert.deepEqual(progress.daily.admitted, ["a0", "a1", "a2"]);
  assert.equal(progress.dailyNewLimit, 5);
  assert.equal(progress.cards.a0.reps, 1);
  assert.equal(progress.cards.a1.reps, 1);
  assert.equal(progress.cards.a2.stage, "learning");
});

test("stale visible card cannot be rated twice or bypass another tab's consumed quota", () => {
  const storage = fakeStorage();
  const a = open(storage), b = open(storage);
  a.selectScopes([scope("a", 1)]);
  a.setDailyNewLimit(1);
  b.refresh();
  assert.ok(queue(b).items.some(item => item.cardId === "a0"));
  a.rateCard("a0", "good");
  const writes = storage.writes;
  assert.equal(b.rateCard("a0", "easy"), null);
  assert.equal(b.rateCard("a1", "good"), null);
  assert.equal(storage.writes, writes);
  assert.deepEqual(b.session.progress.cards, a.session.progress.cards);
  assert.equal(queue(b).remainingNewLimit, 0);
});

test("scope additions and removals apply visible changes to latest ranges without losing another tab's ranges", () => {
  const storage = fakeStorage();
  const a = open(storage), b = open(storage);
  a.selectScopes([scope("a", 1)]);
  b.refresh();
  b.selectScopes([...b.session.newScopes, scope("b", 1)]);
  a.selectScopes([...a.session.newScopes, scope("a", 2)]);
  assert.deepEqual(saved(storage).newScopes, [scope("a", 1), scope("b", 1), scope("a", 2)]);
  b.selectScopes(b.session.newScopes.filter(item => item.bookId !== "a"));
  assert.deepEqual(saved(storage).newScopes, [scope("b", 1), scope("a", 2)]);
  a.pauseScope(scope("b", 1));
  assert.deepEqual(saved(storage).newScopes, [scope("a", 2)]);
  assert.ok(saved(storage).progress.scopes.some(item => item.bookId === "a" && item.chapters.includes(1)));
});

test("unrelated storage keys are ignored and subjects remain isolated", () => {
  const storage = fakeStorage();
  const a = open(storage), english = open(storage, "825"), politics = open(storage, "politics");
  a.selectScopes([scope("a", 1)]);
  english.setDailyNewLimit(2);
  politics.setDailyNewLimit(3);
  const reads = storage.reads;
  a.storageChanged({ key: studyReviewKey("825") });
  a.storageChanged({ key: "irrelevant" });
  assert.equal(storage.reads, reads);
  assert.equal(a.session.progress.dailyNewLimit, 20);
  assert.equal(saved(storage, "825").progress.dailyNewLimit, 2);
  assert.equal(saved(storage, "politics").progress.dailyNewLimit, 3);
  assert.deepEqual(english.session.newScopes, []);
  assert.deepEqual(politics.session.newScopes, []);
});

test("read failures and malformed storage retain live records and never save an empty replacement", () => {
  const storage = fakeStorage(), a = open(storage);
  a.selectScopes([scope("a", 1)]);
  a.rateCard("a0", "good");
  const before = structuredClone(a.session), writes = storage.writes;
  storage.failRead = true;
  a.refresh();
  assert.deepEqual(a.session, before);
  assert.match(a.storageError, /未能读取/);
  assert.doesNotMatch(a.storageError, /private/);
  storage.failRead = false;
  for (const malformed of ["{", "null", "[]", '{}', '{"version":1,"cards":[],"scopes":[]}']) {
    storage.values.set(studyReviewKey("333"), malformed);
    a.storageChanged({ key: studyReviewKey("333") });
    assert.deepEqual(a.session, before);
    assert.match(a.storageError, /未能读取/);
  }
  assert.equal(storage.writes, writes);
});

test("pending failed writes survive focus and events; next mutation replays intent over another tab's latest records", () => {
  const storage = fakeStorage();
  const a = open(storage), b = open(storage);
  a.selectScopes([scope("a", 1)]);
  b.refresh();
  storage.failWrite = true;
  a.setDailyNewLimit(5);
  assert.equal(a.session.progress.dailyNewLimit, 5);
  assert.equal(a.hasPendingWrites, true);
  assert.match(a.storageError, /未能保存/);
  const pending = structuredClone(a.session);
  storage.failWrite = false;
  b.rateCard("a0", "good");
  a.refresh();
  a.storageChanged({ key: studyReviewKey("333") });
  assert.deepEqual(a.session, pending);
  a.rateCard("a1", "easy");
  assert.equal(a.hasPendingWrites, false);
  assert.equal(a.storageError, "");
  const result = saved(storage);
  assert.equal(result.progress.dailyNewLimit, 5);
  assert.deepEqual(Object.keys(result.progress.cards), ["a0", "a1"]);
});

test("mutations remain usable during read failure and retry without losing later external records", () => {
  const storage = fakeStorage();
  const a = open(storage), b = open(storage);
  a.selectScopes([scope("a", 1)]);
  b.refresh();
  storage.failRead = true;
  const writes = storage.writes;
  a.rateCard("a0", "good");
  a.setDailyNewLimit(4);
  assert.equal(storage.writes, writes);
  assert.ok(a.session.progress.cards.a0);
  assert.equal(a.session.progress.dailyNewLimit, 4);
  assert.equal(a.hasPendingWrites, true);
  storage.failRead = false;
  b.rateCard("a1", "easy");
  a.refresh();
  assert.ok(a.session.progress.cards.a0);
  a.selectScopes([...a.session.newScopes, scope("b", 1)]);
  assert.deepEqual(Object.keys(saved(storage).progress.cards), ["a1", "a0"]);
  assert.equal(saved(storage).progress.dailyNewLimit, 4);
  assert.equal(a.hasPendingWrites, false);
});

test("initial read failure creates a usable controller and later restores storage", () => {
  const storage = fakeStorage();
  const writer = open(storage);
  writer.setDailyNewLimit(7);
  storage.failRead = true;
  const a = open(storage);
  assert.match(a.storageError, /未能读取/);
  storage.failRead = false;
  a.refresh();
  assert.equal(a.session.progress.dailyNewLimit, 7);
  assert.equal(a.storageError, "");
});

test("legacy history survives first mutation when no current snapshot exists", () => {
  const storage = fakeStorage();
  storage.values.set("yantu-reviews", JSON.stringify({ a0: { due: "2026-10-04", interval: 4, ease: 2.6, reps: 3 } }));
  const a = open(storage);
  assert.equal(a.session.progress.cards.a0.reps, 3);
  a.setDailyNewLimit(5);
  assert.equal(saved(storage).progress.cards.a0.reps, 3);
  assert.equal(saved(storage).progress.dailyNewLimit, 5);
});

test("storage clear refreshes a clean session without an automatic write", () => {
  const storage = fakeStorage(), a = open(storage);
  a.selectScopes([scope("a", 1)]);
  a.rateCard("a0", "good");
  storage.values.clear();
  const writes = storage.writes;
  a.storageChanged({ key: null });
  assert.deepEqual(a.session.progress.cards, {});
  assert.deepEqual(a.session.newScopes, []);
  assert.equal(storage.writes, writes);
});
