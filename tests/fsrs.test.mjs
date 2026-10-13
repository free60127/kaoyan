import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// Compile the real TypeScript modules in memory; no generated files or user storage.
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const options = entry => ({
  entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "node20",
});
const scheduler = await import(`data:text/javascript;base64,${Buffer.from((await build(options("../lib/study-scheduler.ts"))).outputFiles[0].text).toString("base64")}`);
const fsrs = await import(`data:text/javascript;base64,${Buffer.from((await build(options("../lib/fsrs.ts"))).outputFiles[0].text).toString("base64")}`);
const merge = await import(`data:text/javascript;base64,${Buffer.from((await build(options("../lib/sync/merge.ts"))).outputFiles[0].text).toString("base64")}`);
const { createEmptyProgress, normalizeStoredProgress, applyRating, previewSchedule } = scheduler;
const { fsrsInitialStability, fsrsInitialDifficulty, fsrsRetrievability, fsrsIntervalDays } = fsrs;
const { mergeKeyValue } = merge;

const now = new Date(2026, 8, 30, 12, 0, 0); // 本地 2026-09-30 12:00
const fsrsConfig = (retention = 0.9) => ({ algorithm: "fsrs", retention, setAt: now.toISOString() });
const fsrsProgress = (retention = 0.9) => ({ ...createEmptyProgress(now, 20), scheduler: fsrsConfig(retention) });
const approx = (actual, expected, epsilon = 0.001) => assert.ok(Math.abs(actual - expected) < epsilon, `expected ${actual} ≈ ${expected}`);

test("FSRS initial stability/difficulty match the official py-fsrs default parameters", () => {
  approx(fsrsInitialStability(1), 0.212);
  approx(fsrsInitialStability(3), 2.3065);
  approx(fsrsInitialStability(4), 8.2956);
  // D0(good) = 6.4133 - e^(0.8334*2) + 1 = 2.11828
  approx(fsrsInitialDifficulty(3), 2.11828, 0.001);
  // D0(easy) = 6.4133 - e^(0.8334*3) + 1 = -4.77 -> 钳到 1
  assert.equal(fsrsInitialDifficulty(4), 1);
  // D0(again) = 6.4133 - e^0 + 1 = 6.4133
  approx(fsrsInitialDifficulty(1), 6.4133, 0.001);
});

test("retrievability follows the power-law forgetting curve; interval = stability at 0.9 retention", () => {
  // R(稳定性处) = 0.9（稳定性的定义）
  approx(fsrsRetrievability(10, 10), 0.9, 0.001);
  // R(1天后, S=2.3065) = (1 + 0.980467/2.3065)^(-0.1542) = 0.946827
  approx(fsrsRetrievability(1, 2.3065), 0.946827, 0.001);
  // I(S, 0.9) = S
  assert.equal(fsrsIntervalDays(10, 0.9), 10);
  assert.equal(fsrsIntervalDays(2.3065, 0.9), 2);
  // 0.8 保留率把间隔拉长约 3.3 倍
  assert.equal(fsrsIntervalDays(10, 0.8), 33);
});

test("FSRS mode: a new card rated good graduates to a day interval aligned at 06:30", () => {
  const next = applyRating(fsrsProgress(), "c1", "good", now);
  const review = next.cards.c1;
  assert.equal(review.stage, "review");
  assert.equal(review.intervalDays, 2); // round(S0(good)=2.3065)
  const due = new Date(review.dueAt);
  assert.equal(due.getDate(), 2); // 9/30 + 2 天
  assert.equal(due.getHours(), 6);
  assert.equal(due.getMinutes(), 30);
  approx(review.fsrs.s, 2.3065, 0.001);
  approx(review.fsrs.d, 2.11828, 0.001);
  assert.equal(review.fsrs.step, null);
});

test("FSRS mode: again/hard keep minute semantics matching the page copy", () => {
  const again = applyRating(fsrsProgress(), "c1", "again", now).cards.c1;
  const hard = applyRating(fsrsProgress(), "c2", "hard", now).cards.c2;
  assert.equal(Math.round((Date.parse(again.dueAt) - now.getTime()) / 60_000), 1);
  assert.equal(Math.round((Date.parse(hard.dueAt) - now.getTime()) / 60_000), 5);
  assert.equal(hard.stage, "learning");
  assert.equal(hard.fsrs.step, 1);
});

test("FSRS mode: cross-day good graduates with the official recall-stability interval", () => {
  const day2 = new Date(now.getTime() + 1440 * 60_000);
  let progress = applyRating(fsrsProgress(), "c1", "good", now);
  progress = applyRating(progress, "c1", "good", day2);
  const review = progress.cards.c1;
  assert.equal(review.stage, "review");
  assert.equal(review.intervalDays, 7);
  assert.equal(review.reps, 2);
  assert.equal(review.lapses, 0);
  // S' = 2.3065 * (1 + 2.1718) ≈ 7.3153（官方公式：难度均值回归基准用未钳制 D₀(easy)）
  approx(review.fsrs.s, 7.3153, 0.01);
  approx(review.fsrs.d, 2.11121, 0.001);
  // 7 天后到期, 对齐早上 6:30
  const due = new Date(review.dueAt);
  const expected = new Date(2026, 9, 8, 6, 30, 0);
  assert.equal(due.getFullYear(), expected.getFullYear());
  assert.equal(due.getMonth(), expected.getMonth());
  assert.equal(due.getDate(), expected.getDate());
  assert.equal(due.getHours(), 6);
  assert.equal(due.getMinutes(), 30);
});

test("FSRS mode: again from review starts relearning and counts a lapse", () => {
  const day2 = new Date(now.getTime() + 1440 * 60_000);
  let progress = applyRating(fsrsProgress(), "c1", "good", now);
  progress = applyRating(progress, "c1", "good", day2);
  const day9 = new Date(day2.getTime() + 8 * 86_400_000);
  progress = applyRating(progress, "c1", "again", day9);
  const review = progress.cards.c1;
  assert.equal(review.stage, "relearning");
  assert.equal(review.lapses, 1);
  assert.equal(Math.round((Date.parse(review.dueAt) - day9.getTime()) / 60_000), 1); // 重学习 1 分钟(与"重来"说明一致)
  assert.ok(review.fsrs.s > 0);
});

test("FSRS mode: easy on a new card graduates immediately with interval from w3", () => {
  const review = applyRating(fsrsProgress(), "c1", "easy", now).cards.c1;
  assert.equal(review.stage, "review");
  assert.equal(review.intervalDays, 8); // round(S0(easy)=8.2956)
  const due = new Date(review.dueAt);
  assert.equal(due.getDate(), 8); // 9/30 + 8 天 = 10/8
  assert.equal(due.getHours(), 6);
});

test("FSRS mode: same-day good uses short-term stability then graduates with day interval", () => {
  let progress = applyRating(fsrsProgress(), "c1", "again", now);
  const plus2 = new Date(now.getTime() + 2 * 60_000);
  // 第一步(1 分钟)到期后再评 good: 同日 → 短项稳定度(官方对 increase<1 钳到 1), 直接毕业进天间隔
  progress = applyRating(progress, "c1", "good", plus2);
  const review = progress.cards.c1;
  assert.equal(review.stage, "review");
  assert.equal(review.intervalDays, 1); // again 先评: S0(again)=0.212, 毕业间隔 round→1 天
  approx(review.fsrs.s, 0.24669, 0.001); // 同日短项稳定度: S<1 时 increase>1, 微增
});

test("target retention moves intervals: 0.8 schedules far later than 0.9", () => {
  const seed = { s: 7.31672, d: 2.11139, st: "review", step: null, lr: new Date(now.getTime() - 86_400_000).toISOString() };
  const make = () => ({ ...createEmptyProgress(now, 20), scheduler: fsrsConfig(0.9), cards: { c1: { dueAt: now.toISOString(), intervalDays: 7, ease: 2.5, reps: 2, lapses: 0, stage: "review", firstStudiedAt: seed.lr, lastReviewedAt: seed.lr, fsrs: seed } } });
  const at90 = applyRating(make(), "c1", "good", now).cards.c1;
  const at80 = applyRating({ ...make(), scheduler: fsrsConfig(0.8) }, "c1", "good", now).cards.c1;
  // 稳定性先增长（跨日 recall），再按保留率换算间隔：0.9 → 12 天, 0.8 → 40 天
  assert.equal(at90.intervalDays, 12);
  assert.equal(at80.intervalDays, 40);
  assert.ok(at80.intervalDays > at90.intervalDays);
});

test("switching from SM-2 history: first FSRS rating derives memory from legacy state", () => {
  const legacy = { ...createEmptyProgress(now, 20), cards: { c1: { dueAt: now.toISOString(), intervalDays: 6, ease: 2.5, reps: 3, lapses: 1, stage: "review", firstStudiedAt: now.toISOString(), lastReviewedAt: now.toISOString() } } };
  const next = applyRating({ ...legacy, scheduler: fsrsConfig() }, "c1", "good", now);
  const review = next.cards.c1;
  assert.ok(review.fsrs, "fsrs memory created");
  approx(review.fsrs.s, 6, 0.001); // 由旧间隔换算
  assert.ok(review.intervalDays >= 6, "FSRS interval continues from legacy stability");
  assert.equal(review.reps, 4);
});

test("FSRS is the default: progress without scheduler config follows the FSRS path", () => {
  const next = applyRating(createEmptyProgress(now, 20), "c1", "good", now);
  const review = next.cards.c1;
  assert.ok(review.fsrs, "default path is FSRS since 2026-10-12");
  assert.equal(review.stage, "review");
  assert.equal(review.intervalDays, 2);
  approx(review.fsrs.s, 2.3065, 0.001);
});

test("explicit SM-2 config keeps the legacy path and no fsrs field", () => {
  const sm2 = { ...createEmptyProgress(now, 20), scheduler: { algorithm: "sm2", retention: 0.9, setAt: now.toISOString() } };
  const next = applyRating(sm2, "c1", "good", now);
  const review = next.cards.c1;
  assert.equal(review.fsrs, undefined);
  assert.equal(review.intervalDays, 1);
  assert.equal(review.ease, 2.5); // SM-2 新卡 good 不加 ease（只有 easy/hard 调整）
});

test("previewSchedule also defaults to FSRS without config", () => {
  const preview = previewSchedule(undefined, "good", now);
  assert.equal(preview.stage, "review");
  assert.equal(preview.intervalDays, 2);
});

test("previewSchedule honors the scheduler config in fsrs mode", () => {
  const seed = { dueAt: now.toISOString(), intervalDays: 7, ease: 2.5, reps: 2, lapses: 0, stage: "review", firstStudiedAt: now.toISOString(), lastReviewedAt: now.toISOString(), fsrs: { s: 7.31672, d: 2.11139, st: "review", step: null, lr: now.toISOString() } };
  const preview = previewSchedule(seed, "good", now, fsrsConfig(0.9));
  assert.equal(preview.stage, "review");
  assert.equal(preview.intervalDays, 7);
  assert.equal(preview.delayMinutes, 7 * 1440);
  const sm2 = previewSchedule(seed, "good", now);
  assert.equal(sm2.fsrs, undefined);
  assert.ok(sm2.intervalDays >= 1, "SM-2 preview still schedules day intervals");
});

test("normalizeStoredProgress round-trips scheduler config and fsrs memory, dropping invalid ones", () => {
  const good = {
    version: 1,
    cards: { c1: { dueAt: now.toISOString(), intervalDays: 7, ease: 2.5, reps: 2, lapses: 0, stage: "review", firstStudiedAt: now.toISOString(), lastReviewedAt: now.toISOString(), fsrs: { s: 7.3, d: 2.1, st: "review", step: null, lr: now.toISOString() } } },
    scopes: [], dailyNewLimit: 20, daily: { date: "2026-09-30", admitted: [] },
    scheduler: { algorithm: "fsrs", retention: 0.85, setAt: now.toISOString() },
  };
  const restored = normalizeStoredProgress(JSON.stringify(good), [], now);
  assert.equal(restored.scheduler.algorithm, "fsrs");
  assert.equal(restored.scheduler.retention, 0.85);
  assert.equal(restored.cards.c1.fsrs.s, 7.3);
  const badRetention = { ...good, scheduler: { algorithm: "fsrs", retention: 0.5, setAt: now.toISOString() } };
  assert.equal(normalizeStoredProgress(JSON.stringify(badRetention), [], now).scheduler, undefined);
  const badAlgorithm = { ...good, scheduler: { algorithm: "anki", retention: 0.9, setAt: now.toISOString() } };
  assert.equal(normalizeStoredProgress(JSON.stringify(badAlgorithm), [], now).scheduler, undefined);
  const badMemory = JSON.parse(JSON.stringify(good));
  badMemory.cards.c1.fsrs = { s: 0, d: 2, st: "review", step: null, lr: now.toISOString() };
  const restoredBad = normalizeStoredProgress(JSON.stringify(badMemory), [], now);
  assert.equal(restoredBad.cards.c1.fsrs, undefined);
  assert.ok(restoredBad.cards.c1.reps === 2, "card itself stays valid");
});

test("sync merge: scheduler setting resolves by newest setAt and survives one-sided edits", () => {
  const local = { version: 1, cards: {}, scopes: [], newScopes: [], daily: { date: "2026-09-30", admitted: [] }, scheduler: { algorithm: "fsrs", retention: 0.85, setAt: "2026-10-01T08:00:00Z" } };
  const remote = { version: 1, cards: {}, scopes: [], newScopes: [], daily: { date: "2026-09-30", admitted: [] }, scheduler: { algorithm: "sm2", retention: 0.9, setAt: "2026-10-01T07:00:00Z" } };
  assert.equal(mergeKeyValue("srs", local, remote).value.scheduler.algorithm, "fsrs");
  assert.equal(mergeKeyValue("srs", remote, local).value.scheduler.algorithm, "fsrs");
  const plain = { version: 1, cards: {}, scopes: [], newScopes: [], daily: { date: "2026-09-30", admitted: [] } };
  assert.equal(mergeKeyValue("srs", local, plain).value.scheduler.algorithm, "fsrs");
  assert.equal(mergeKeyValue("srs", plain, remote).value.scheduler.algorithm, "sm2");
  assert.equal(mergeKeyValue("srs", plain, plain).value.scheduler, undefined);
});
