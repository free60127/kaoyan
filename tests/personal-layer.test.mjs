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

test("rich-text: 教材标记与个人样式叠加渲染, 纯文本偏移对齐", async () => {
  const rich = await realModule("../lib/rich-text.ts");
  const text = "墨子主张⟦g|兼爱、非攻⟧，教育作用在于⟦s|兴天下之利⟧。";
  // 纯文本: 墨(0)子(1)主(2)张(3)兼(4)爱(5)、(6)非(7)攻(8)，(9)教(10)育(11)作(12)用(13)在(14)于(15)兴(16)天(17)下(18)之(19)利(20)。(21)
  const segments = rich.renderRichSegments(text, [
    { start: 0, end: 2, kind: "b" },
    { start: 17, end: 20, kind: "hl", value: "#ffe98a" },
  ]);
  const plain = segments.map(segment => segment.text).join("");
  assert.equal(plain, "墨子主张兼爱、非攻，教育作用在于兴天下之利。");
  const bold = segments.find(segment => segment.b);
  assert.equal(bold.text, "墨子"); // 个人加粗落在纯文本前 2 字
  const highlighted = segments.find(segment => segment.hl === "#ffe98a");
  assert.ok(highlighted.text.includes("天下之"));
  const green = segments.find(segment => segment.textbook === "hl-g");
  assert.equal(green.text, "兼爱、非攻");
});

test("rich-text: 编辑文本后 runs 按差分调整, 不产生越界", async () => {
  const rich = await realModule("../lib/rich-text.ts");
  const runs = [{ start: 5, end: 10, kind: "color", value: "#cf3b2e" }];
  // 前插: 区间平移
  const shifted = rich.adjustRuns(runs, "abcdefghij", "12345abcdefghij");
  assert.deepEqual([shifted[0].start, shifted[0].end], [10, 15]);
  // 删除覆盖区间: 区间收缩
  const shrunk = rich.adjustRuns(runs, "abcdefghij", "abcij");
  assert.ok(shrunk.length === 0 || shrunk[0].end - shrunk[0].start < 5);
  const bounded = rich.sanitizeRuns(shifted, 3);
  for (const run of bounded) { assert.ok(run.start >= 0 && run.end <= 3); }
});

test("rich-text: 编辑后的答案重新注入教材重点标记", async () => {
  const rich = await realModule("../lib/rich-text.ts");
  const original = "墨子主张⟦g|兼爱、非攻⟧，还提倡⟦s|节用⟧。";
  const edited = "墨子的核心主张是兼爱、非攻，同时提倡节用。"; // 用户改写, 丢掉标记
  const restored = rich.reinjectTextbookMarkers(original, edited);
  assert.ok(restored.includes("⟦g|"), restored);
  assert.ok(restored.includes("兼爱、非攻"));
  assert.ok(!restored.includes("⟦⟧"));
  // 完全无关的新文本不注入
  assert.equal(rich.reinjectTextbookMarkers(original, "完全不同的内容"), "完全不同的内容");
});

test("personal-cards: 覆盖层保存带版本锁, 冲突可检出; 个人卡增删改与隐藏", async () => {
  const personal = await realModule("../lib/personal-cards.ts");
  const store = new Map();
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  try {
    // 首次保存 (expectedRev null)
    const first = personal.saveOverlay("333", "principles-k1-001", { note: { text: "易错点", runs: [] } }, "原问题", "原答案", null);
    assert.equal(first.ok, true);
    const rev = first.store.overlays["333:principles-k1-001"].rev;
    // 旧版本保存 → 冲突
    const conflict = personal.saveOverlay("333", "principles-k1-001", { note: { text: "旧写入", runs: [] } }, "原问题", "原答案", rev - 1);
    assert.equal(conflict.reason, "conflict");
    // 最新版本保存 → 成功且 rev 递增
    const second = personal.saveOverlay("333", "principles-k1-001", { q: null, a: null, note: { text: "更新后的补充", runs: [] } }, "原问题", "原答案", rev);
    assert.equal(second.ok, true);
    const overlay = second.store.overlays["333:principles-k1-001"];
    assert.equal(overlay.q, undefined); // null 清除
    assert.equal(overlay.note.text, "更新后的补充");
    // 全字段清除后覆盖层消失
    const cleared = personal.saveOverlay("333", "principles-k1-001", { note: null }, "原问题", "原答案", overlay.rev);
    assert.ok(!cleared.store.overlays["333:principles-k1-001"]);

    // 个人卡
    const added = personal.addPersonalCard({ subject: "333", book: "principles", chapter: 1, section: "第一节 教育的概念", front: { text: "自建问题", runs: [] }, back: { text: "自建答案", runs: [] }, note: { text: "补充", runs: [] } });
    assert.equal(added.ok, true);
    const card = added.store.cards[0];
    assert.ok(card.id.startsWith("mine-"));
    assert.equal(card.section, "第一节 教育的概念"); // 归属独立字段
    const hidden = personal.setPersonalCardHidden(card.id, true);
    assert.equal(hidden.store.cards[0].hidden, true);
    const shown = personal.setPersonalCardHidden(card.id, false);
    assert.equal(shown.store.cards[0].hidden, undefined);
    const removed = personal.deletePersonalCard(card.id);
    assert.equal(removed.store.cards.length, 0);
    // 坏数据安全解析
    store.set(personal.personalStorageKey, "{broken");
    assert.deepEqual(personal.readPersonal().cards, []);
  } finally {
    delete globalThis.localStorage;
  }
});

test("scheduler: resetCardProgress 清除复习状态与当日准入, 范围保留", async () => {
  const scheduler = await realModule("../lib/study-scheduler.ts");
  const now = "2026-10-07T12:00:00.000Z";
  const progress = {
    version: 1,
    cards: { "card-a": { dueAt: now, intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, stage: "review", firstStudiedAt: now, lastReviewedAt: now } },
    scopes: [{ bookId: "china", chapters: [1] }],
    dailyNewLimit: 20,
    daily: { date: "2026-10-07", admitted: ["card-a"] },
  };
  const reset = scheduler.resetCardProgress(progress, "card-a", now);
  assert.deepEqual(reset.cards, {});
  assert.deepEqual(reset.daily.admitted, []);
  assert.equal(reset.scopes.length, 1); // 范围不动
  assert.deepEqual(progress.cards["card-a"], { dueAt: now, intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, stage: "review", firstStudiedAt: now, lastReviewedAt: now }); // 原对象不变
  // 未学过的卡: 原样返回
  assert.equal(scheduler.resetCardProgress(reset, "card-a", now), reset);
});

test("多标签: 旧标签的滞后写入被 rev 锁拒绝, 新内容不丢", async () => {
  const personal = await realModule("../lib/personal-cards.ts");
  const store = new Map();
  // 两个标签共用同一 localStorage: 读改写各自进行
  globalThis.localStorage = { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) };
  try {
    // 标签 A 首存
    const a1 = personal.saveOverlay("333", "card-x", { note: { text: "A 的补充", runs: [] } }, "原问题", "原答案", null);
    assert.equal(a1.ok, true);
    // 标签 B 读到 A 的版本并保存更新
    const bRead = personal.readPersonal();
    const bRev = bRead.overlays["333:card-x"].rev;
    const bSave = personal.saveOverlay("333", "card-x", { note: { text: "B 更新的补充", runs: [] } }, "原问题", "原答案", bRev);
    assert.equal(bSave.ok, true);
    // 标签 A 用过期 rev 再写: 必须被拒绝, B 的内容保持完整
    const a2 = personal.saveOverlay("333", "card-x", { note: { text: "A 的旧写入", runs: [] } }, "原问题", "原答案", a1.store.overlays["333:card-x"].rev);
    assert.equal(a2.reason, "conflict");
    assert.equal(personal.readPersonal().overlays["333:card-x"].note.text, "B 更新的补充");
    // A 重读最新版本后写入成功(无丢失)
    const latest = personal.readPersonal();
    const a3 = personal.saveOverlay("333", "card-x", { note: { text: "A 在最新版本上的追加", runs: [] } }, "原问题", "原答案", latest.overlays["333:card-x"].rev);
    assert.equal(a3.ok, true);
    assert.equal(a3.store.overlays["333:card-x"].note.text, "A 在最新版本上的追加");
  } finally {
    delete globalThis.localStorage;
  }
});
