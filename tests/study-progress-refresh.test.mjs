import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
async function realModule(path) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false,
    platform: "node", format: "esm", target: "node20", jsx: "automatic",
    plugins: [{ name: "shared-react", setup(builder) {
      builder.onResolve({ filter: /^(react(?:\/.*)?|lucide-react)$/ }, args => ({ path: pathToFileURL(require.resolve(args.path)).href, external: true }));
    } }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
}
const { createStudyReviewSync, restoreStudyReview, serializeStudyReview, buildReviewSession, useStudyReview, studyReviewKey } = await realModule("../lib/use-study-review.ts");
const { applyRating, createEmptyProgress, localStudyDate, newCardsStudiedToday } = await realModule("../lib/study-scheduler.ts");
const { scopedStudyReviewView } = await realModule("../lib/study-review-view.ts");
const { StudyReviewCards } = await realModule("../app/components/StudyReview.tsx");
const { Overview333, Overview825, OverviewPolitics } = await realModule("../app/components/OverviewPanels.tsx");
const now = new Date(2026, 9, 7, 12).getTime();
const day = days => now + days * 86_400_000;
const catalog = [
  { id: "a1", book: "a", chapter: 1, section: "one" },
  { id: "a2", book: "a", chapter: 1, section: "two" },
  { id: "a3", book: "a", chapter: 1, section: "two" },
  { id: "b1", book: "b", chapter: 2, section: "one" },
];
const scope = { bookId: "a", chapters: [1] };
const books = [
  { id: "a", name: "书 A", short: "A", tone: "#abc", chapters: [{ title: "第一章" }] },
  { id: "b", name: "书 B", short: "B", tone: "#abc", chapters: [{ title: "第一章" }, { title: "第二章" }] },
];
const cards = catalog.map(card => ({ ...card, front: card.id, back: "答案", source: "测试" }));
function storage() {
  const values = new Map();
  return { values, writes: 0, getItem(key) { return values.get(key) ?? null; }, setItem(key, value) { this.writes++; values.set(key, value); } };
}

for (const subject of ["333", "825", "politics"]) {
  test(`${subject}: partial and exhausted chapter reload retains completion, selections, quota and exact future schedules`, () => {
    const store = storage();
    const open = (instant = now) => createStudyReviewSync(subject, catalog, store, () => instant);
    const first = open();
    first.selectScopes([scope]); first.setDailyNewLimit(100);
    first.rateCard("a1", "good"); first.rateCard("a2", "easy");
    const savedPartial = structuredClone(first.session);
    const partial = open();
    assert.deepEqual(partial.session, savedPartial);
    assert.equal(newCardsStudiedToday(partial.session.progress, now), 2);
    assert.equal(buildReviewSession(catalog, partial.session, now).counts.newToday, 1);
    partial.rateCard("a3", "good");
    const savedComplete = structuredClone(partial.session);
    const writes = store.writes;
    const complete = open();
    assert.deepEqual(complete.session, savedComplete);
    const queue = buildReviewSession(catalog, complete.session, now);
    assert.equal(newCardsStudiedToday(complete.session.progress, now), 3);
    assert.equal(queue.counts.newToday, 0);
    assert.equal(queue.counts.reviewDue, 0);
    assert.equal(queue.remainingNewLimit, 97);
    assert.equal(queue.nextDueAt, new Date(day(1)).toISOString());
    assert.deepEqual(complete.session.progress.scopes, [scope]);
    assert.deepEqual(complete.session.newScopes, [scope]);
    const tomorrow = open(day(1));
    assert.equal(newCardsStudiedToday(tomorrow.session.progress, day(1)), 0);
    const tomorrowQueue = buildReviewSession(catalog, tomorrow.session, day(1));
    assert.deepEqual(tomorrowQueue.items.map(item => item.cardId), ["a1", "a3"]);
    assert.equal(tomorrowQueue.remainingNewLimit, 100);
    assert.deepEqual(tomorrow.session.progress.cards, savedComplete.progress.cards);
    const severalDays = open(day(4));
    assert.deepEqual(buildReviewSession(catalog, severalDays.session, day(4)).items.map(item => item.cardId), ["a1", "a3", "a2"]);
    assert.deepEqual(severalDays.session.progress.cards, savedComplete.progress.cards);
    assert.equal(store.writes, writes, "reload and queue construction must never rewrite schedules");
  });
}

test("completed today counts unique persisted first ratings by local date, independently of paused scopes and unknown history", () => {
  const beforeMidnight = new Date(2026, 9, 7, 23, 59, 30).getTime();
  const afterMidnight = new Date(2026, 9, 8, 0, 1).getTime();
  let progress = applyRating(createEmptyProgress(beforeMidnight), "historic-id", "again", beforeMidnight);
  progress = applyRating(progress, "historic-id", "good", afterMidnight);
  progress = applyRating(progress, "a1", "again", afterMidnight);
  progress = applyRating(progress, "a1", "easy", afterMidnight + 60_000);
  const restored = restoreStudyReview(serializeStudyReview({ progress, newScopes: [] }), catalog, afterMidnight);
  assert.equal(newCardsStudiedToday(restored.progress, beforeMidnight), 1);
  assert.equal(newCardsStudiedToday(restored.progress, afterMidnight), 1);
  assert.equal(restored.progress.cards["historic-id"].firstStudiedAt, new Date(beforeMidnight).toISOString());
  assert.deepEqual(restored.progress.cards, progress.cards);
  assert.equal(buildReviewSession(catalog, restored, afterMidnight).items.length, 0);
  const scoped = scopedStudyReviewView(buildReviewSession(catalog, restored, afterMidnight), catalog, restored.progress, scope, afterMidnight);
  assert.equal(scoped.studiedToday, 1);
  assert.equal(localStudyDate(restored.progress.cards.a1.firstStudiedAt), localStudyDate(afterMidnight));
});

test("quota exhaustion reload and local midnight reset keep unstudied cards and future reviews separate", () => {
  const store = storage();
  let instant = new Date(2026, 9, 7, 23, 59).getTime();
  const open = () => createStudyReviewSync("333", catalog, store, () => instant);
  const first = open(); first.selectScopes([scope]); first.setDailyNewLimit(2);
  first.rateCard("a1", "good"); first.rateCard("a2", "easy");
  const reload = open();
  assert.equal(newCardsStudiedToday(reload.session.progress, instant), 2);
  assert.equal(buildReviewSession(catalog, reload.session, instant).counts.newAvailable, 1);
  assert.equal(buildReviewSession(catalog, reload.session, instant).counts.newToday, 0);
  instant = new Date(2026, 9, 8, 0, 0).getTime();
  reload.refresh();
  const queue = buildReviewSession(catalog, reload.session, instant);
  assert.equal(newCardsStudiedToday(reload.session.progress, instant), 0);
  assert.equal(queue.remainingNewLimit, 2);
  assert.deepEqual(queue.items.map(item => [item.cardId, item.kind]), [["a3", "new"]]);
});

test("catalog rebinding recovers saved sections and card eligibility without persisting partial normalization", () => {
  const store = storage();
  const writer = createStudyReviewSync("825", catalog, store, () => now);
  writer.selectScopes([{ bookId: "b", chapters: [2], section: "one" }]); writer.rateCard("b1", "easy");
  const exact = store.getItem(studyReviewKey("825"));
  const reader = createStudyReviewSync("825", catalog.slice(0, 1), store, () => now);
  assert.deepEqual(reader.session.newScopes, []);
  reader.updateCatalog(catalog);
  assert.deepEqual(reader.session, writer.session);
  assert.equal(store.getItem(studyReviewKey("825")), exact);
  reader.selectScopes([scope]);
  assert.ok(reader.rateCard("a2", "good"), "ratings must use the newly bound catalog");
  assert.deepEqual(reader.session.progress.cards.b1, writer.session.progress.cards.b1);
});

test("cross-tab completed counts refresh, first-rating undo survives reload, and later ratings are not overwritten", () => {
  const store = storage(); let instant = now;
  const open = subject => createStudyReviewSync(subject, catalog, store, () => instant);
  const a = open("333"), b = open("333"), politics = open("politics");
  a.selectScopes([scope]); b.refresh();
  a.rateCard("a1", "good");
  const undo = a.lastUndo;
  b.rateCard("a2", "easy");
  a.storageChanged({ key: studyReviewKey("333") });
  assert.equal(newCardsStudiedToday(a.session.progress, now), 2);
  assert.ok(a.undoLastRating(undo));
  const reload = open("333");
  assert.equal(newCardsStudiedToday(reload.session.progress, now), 1);
  assert.equal(reload.session.progress.cards.a1, undefined);
  assert.deepEqual(reload.session.progress.cards.a2, b.session.progress.cards.a2);
  assert.equal(buildReviewSession(catalog, reload.session, now).remainingNewLimit, 19);
  assert.equal(newCardsStudiedToday(politics.session.progress, now), 0);
  a.rateCard("a1", "again");
  const staleUndo = a.lastUndo;
  instant += 60_000; b.rateCard("a1", "good");
  const laterSchedule = structuredClone(b.session.progress.cards.a1);
  assert.equal(a.undoLastRating(staleUndo), null);
  assert.deepEqual(open("333").session.progress.cards.a1, laterSchedule);
});

test("stale-tab due-card undo restores the schedule immediately before its own accepted rating", () => {
  const store = storage(); let instant = now;
  const open = () => createStudyReviewSync("333", catalog, store, () => instant);
  const a = open(), b = open(); a.selectScopes([scope]); b.refresh();
  a.rateCard("a1", "again"); const previous = structuredClone(a.session.progress.cards.a1);
  instant += 60_000;
  b.rateCard("a1", "good");
  assert.deepEqual(b.lastUndo.previous, previous);
  assert.ok(b.undoLastRating(b.lastUndo));
  assert.deepEqual(open().session.progress.cards.a1, previous);
});

const overviewProps = {
  subjectLabel: "333", books, done: {}, completed: 0, totalChapters: 3, total333: 3,
  due: 0, newToday: 0, studiedToday: 2, dailyLimit: 2, reviewReady: true,
  score: { right: 0, total: 0 }, pastQuestionCount: 0, cardCount: 4, perBookCards: {},
  chapter: 1, chapterName: "第一章", activeBookName: "书 A", onChooseBook() {}, onSetView() {},
};
for (const Overview of [Overview333, Overview825, OverviewPolitics]) {
  test(`${Overview.name} renders completed and remaining with loading placeholders`, () => {
    const loaded = renderToStaticMarkup(React.createElement(Overview, overviewProps));
    assert.match(loaded, /今日已学新卡<\/small><strong>2<\/strong>/);
    assert.match(loaded, /今日剩余新卡 0 张 · 上限 2 张/);
    const waiting = renderToStaticMarkup(React.createElement(Overview, { ...overviewProps, reviewReady: false }));
    assert.match(waiting, /今日已学新卡<\/small><strong>—<\/strong>/);
    assert.match(waiting, /正在读取学习记录/);
    assert.doesNotMatch(waiting, /今日剩余新卡 0/);
  });
}

test("disabled/unhydrated hook and cards never render fabricated loaded quota or queue metadata", () => {
  for (const enabled of [false, true]) {
    let controller;
    function Harness() { controller = useStudyReview("333", catalog, enabled); return null; }
    renderToStaticMarkup(React.createElement(Harness));
    assert.equal(controller.ready, false);
    const html = renderToStaticMarkup(React.createElement(StudyReviewCards, {
      subject: "333", review: controller, cards, books, bookId: "a", chapter: 1, section: "", picker: null,
    }));
    assert.match(html, /正在读取学习范围与记录/);
    assert.doesNotMatch(html, /每日新卡余额 20|今日已学新卡|今日剩余新卡|尚未选择新学范围|先选择今天/);
  }
});

test("completed chapter cards show persisted progress alongside an empty queue and the original next due time", () => {
  const store = storage();
  const writer = createStudyReviewSync("333", catalog, store, () => now);
  writer.selectScopes([scope]); writer.setDailyNewLimit(100);
  for (const id of ["a1", "a2", "a3"]) writer.rateCard(id, "good");
  const restored = createStudyReviewSync("333", catalog, store, () => now);
  const review = {
    ready: restored.ready, progress: restored.session.progress, newScopes: restored.session.newScopes,
    queue: buildReviewSession(catalog, restored.session, now), now, storageError: "", lastRating: null,
    studiedToday: newCardsStudiedToday(restored.session.progress, now),
    queueForScope(location) { return buildReviewSession(catalog, restored.session, now, location); },
  };
  const html = renderToStaticMarkup(React.createElement(StudyReviewCards, {
    subject: "333", review, cards, books, bookId: "a", chapter: 1, section: "", picker: null,
  }));
  assert.match(html, /今日已学新卡 <b>3<\/b>/);
  assert.match(html, /今日剩余新卡 <b>0<\/b>/);
  assert.match(html, /每日新卡余额 97 张/);
  assert.match(html, /当前范围今日已学新卡 3 张，累计已学 3 张/);
  assert.match(html, /当前范围下次到期/);
  assert.deepEqual(restored.session.progress.cards, writer.session.progress.cards);
});

test("initial storage read failure stays unready until a valid snapshot is restored", () => {
  const store = storage();
  const writer = createStudyReviewSync("825", catalog, store, () => now);
  writer.selectScopes([scope]); writer.rateCard("a1", "easy");
  let blocked = true;
  const reader = createStudyReviewSync("825", catalog, {
    getItem(key) { if (blocked) throw new Error("unavailable"); return store.getItem(key); },
    setItem(key, value) { store.setItem(key, value); },
  }, () => now);
  assert.equal(reader.ready, false);
  const writes = store.writes;
  blocked = false; reader.refresh();
  assert.equal(reader.ready, true);
  assert.deepEqual(reader.session, writer.session);
  assert.equal(store.writes, writes);
});
