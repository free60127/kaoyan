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

const card = (id, lastReviewedAt, extra = {}) => ({ id, dueAt: "2027-01-01T00:00:00.000Z", intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, stage: "review", firstStudiedAt: "2026-10-01T00:00:00.000Z", lastReviewedAt, ...extra });
const srs = (cards, daily) => ({ version: 1, cards, scopes: [], newScopes: [], dailyNewLimit: 20, daily });

test("同步合并: SRS 按卡取最新复习状态, 当日准入并集, 范围并集", async () => {
  const merge = await realModule("../lib/sync/merge.ts");
  const local = srs(
    { "a": card("a", "2026-10-07T10:00:00.000Z"), "b": card("b", "2026-10-07T09:00:00.000Z") },
    { date: "2026-10-07", admitted: ["a"] },
  );
  local.scopes = [{ bookId: "china", chapters: [1] }];
  local.newScopes = [{ bookId: "china", chapters: [1] }];
  const remote = srs(
    { "a": card("a", "2026-10-07T12:00:00.000Z", { intervalDays: 9 }), "c": card("c", "2026-10-07T08:00:00.000Z") },
    { date: "2026-10-07", admitted: ["c"] },
  );
  remote.scopes = [{ bookId: "china", chapters: [2] }];
  remote.newScopes = [{ bookId: "china", chapters: [2] }];
  const { value, changed } = merge.mergeKeyValue("srs", local, remote);
  assert.equal(changed, true);
  // a 取远端更新的状态; b 保留本地; c 新增
  assert.equal(value.cards.a.intervalDays, 9);
  assert.ok(value.cards.b);
  assert.ok(value.cards.c);
  // 当日准入并集
  assert.deepEqual([...value.daily.admitted].sort(), ["a", "c"]);
  // 范围并集
  assert.equal(value.scopes.length, 2);
  assert.equal(value.newScopes.length, 2);
  // 本地对象不被修改
  assert.equal(local.cards.a.intervalDays, 3);
});

test("同步合并: done true 并集 / 错题按 lastAt / 计数取大 / 活动去重 / 排除并集 / 个人层按 rev", async () => {
  const merge = await realModule("../lib/sync/merge.ts");
  // done: 一端标记另一端未标 → true 保留
  const done = merge.mergeKeyValue("done", { "china-1": true, "china-2": false }, { "china-2": true, "china-3": true });
  assert.equal(done.value["china-1"], true);
  assert.equal(done.value["china-2"], true);
  assert.equal(done.value["china-3"], true);
  // 错题: 同 id 取 lastAt 较新
  const mistakes = merge.mergeKeyValue("mistakes",
    [{ id: "m1", lastAt: "2026-10-07T09:00:00.000Z", wrongCount: 1 }, { id: "m2", lastAt: "2026-10-06T09:00:00.000Z", wrongCount: 2 }],
    [{ id: "m1", lastAt: "2026-10-07T11:00:00.000Z", wrongCount: 2 }]);
  assert.equal(mistakes.value.find(item => item.id === "m1").wrongCount, 2);
  assert.equal(mistakes.value.length, 2);
  // 统计: 按日按字段取较大
  const stats = merge.mergeKeyValue("stats",
    { "2026-10-07": { date: "2026-10-07", ratings: 5, again: 1, newCards: 10, quiz: 3, quizCorrect: 2 } },
    { "2026-10-07": { date: "2026-10-07", ratings: 3, again: 0, newCards: 12, quiz: 9, quizCorrect: 9 } });
  assert.deepEqual(stats.value["2026-10-07"], { date: "2026-10-07", ratings: 5, again: 1, newCards: 12, quiz: 9, quizCorrect: 9 });
  // 活动: 去重合并
  const activity = merge.mergeKeyValue("activity",
    [{ t: "2026-10-07T01:00:00.000Z", kind: "rating", label: "卡A", detail: "记住了" }],
    [{ t: "2026-10-07T02:00:00.000Z", kind: "rating", label: "卡B", detail: "记住了" }, { t: "2026-10-07T01:00:00.000Z", kind: "rating", label: "卡A", detail: "记住了" }]);
  assert.equal(activity.value.length, 2);
  assert.equal(activity.value[0].label, "卡A"); // 按时间排序
  // 排除标记: 并集
  const excluded = merge.mergeKeyValue("excluded", ["x1"], ["x2", "x1"]);
  assert.deepEqual([...excluded.value].sort(), ["x1", "x2"]);
  // 个人层: rev 高者胜, seq 取最大
  const personal = merge.mergeKeyValue("personal",
    { version: 1, seq: 4, overlays: { "333:c1": { rev: 2, note: { text: "新" } } }, cards: [{ id: "mine-1", rev: 1 }] },
    { version: 1, seq: 7, overlays: { "333:c1": { rev: 1, note: { text: "旧" } } }, cards: [{ id: "mine-1", rev: 3 }, { id: "mine-2", rev: 1 }] });
  assert.equal(personal.value.overlays["333:c1"].rev, 2);
  assert.equal(personal.value.cards.length, 2);
  assert.equal(personal.value.seq, 7);
  // 形状异常保守返回
  assert.deepEqual(merge.mergeKeyValue("srs", "broken", { any: 1 }).value, { any: 1 });
});

test("同步键注册: 备份键均映射到合并策略或 LWW, 临时数据不同步", async () => {
  const merge = await realModule("../lib/sync/merge.ts");
  const backupKeys = ["yantu-personal-v1", "yantu-learning-session-v1", "yantu-srs-v1-333", "yantu-srs-v1-825", "yantu-srs-v1-politics", "yantu-done", "yantu-done-825", "yantu-done-politics", "yantu-mistakes-v1", "yantu-stats-v1-333", "yantu-stats-v1-825", "yantu-stats-v1-politics", "yantu-activity-v1-333", "yantu-activity-v1-825", "yantu-activity-v1-politics", "yantu-mcq-excluded-v1", "kaoyan.mock-practice.v1.333", "kaoyan.mock-practice.v1.825", "yantu-exam-target-v1"];
  for (const key of backupKeys) {
    assert.notEqual(merge.mergeKindFor(key), undefined, `${key} 应可同步`);
  }
  for (const key of ["yantu-practice-round-v1-333-practice", "yantu-browse-position-v1", "yantu-key"]) {
    assert.equal(merge.mergeKindFor(key), "lww");
    assert.ok(!merge.SYNCABLE_KEYS[key], `${key} 不应周期同步`);
  }
});
