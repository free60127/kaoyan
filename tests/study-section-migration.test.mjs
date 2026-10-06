import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function bundle(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20", logLevel: "silent" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const scheduler = await bundle("../lib/study-scheduler.ts");
const sessionApi = await bundle("../lib/learning-session.ts");
const backupApi = await bundle("../lib/study-backup.ts");
const mockApi = await bundle("../lib/mock-practice-storage.ts");
const old = "第五节 教育的发展趋势", corrected = "第三节 教育的起源与发展";
const now = "2026-10-06T12:00:00.000Z";
const card = { id: "principles-k1-043", book: "principles", chapter: 1, section: corrected };
const scope = { bookId: "principles", chapters: [1], section: old };
const review = { dueAt: "2026-10-08T12:00:00.000Z", firstStudiedAt: "2026-10-05T12:00:00.000Z", lastReviewedAt: "2026-10-05T12:00:00.000Z", intervalDays: 3, ease: 2.5, reps: 2, lapses: 0, stage: "review" };

test("verified section rename preserves rated IDs, exact due dates and daily quota history", () => {
  const saved = { version: 1, cards: { [card.id]: review }, scopes: [scope], dailyNewLimit: 13, daily: { date: "2026-10-06", admitted: [] } };
  const restored = scheduler.normalizeStoredProgress(saved, [card], now);
  assert.deepEqual(restored.cards, saved.cards);
  assert.equal(restored.dailyNewLimit, 13);
  assert.deepEqual(restored.scopes, [{ ...scope, section: corrected }]);
  assert.equal(scheduler.buildStudyQueue([card], restored, now).items.length, 0);
  assert.deepEqual(scheduler.normalizeStudyScopes([{ ...scope, bookId: "china" }, { ...scope, chapters: [2] }, { ...scope, chapters: [1, 2] }], [card]), []);
});

test("old location and scoped Feynman draft migrate together; a newer draft is never overwritten", () => {
  const ids = { "333": ["principles"] };
  const session = sessionApi.createLearningSession(ids);
  session.locations["333"].section = old;
  const oldKey = sessionApi.feynmanDraftKey("333", session.locations["333"]);
  const newKey = sessionApi.feynmanDraftKey("333", { ...session.locations["333"], section: corrected });
  session.feynmanDrafts[oldKey] = "旧小节完整草稿";
  let restored = sessionApi.restoreLearningSession(JSON.stringify(session), ids);
  assert.equal(restored.locations["333"].section, corrected);
  assert.equal(restored.feynmanDrafts[newKey], "旧小节完整草稿");
  assert.equal(restored.feynmanDrafts[oldKey], undefined);
  session.feynmanDrafts[newKey] = "较新版本";
  restored = sessionApi.restoreLearningSession(JSON.stringify(session), ids);
  assert.equal(restored.feynmanDrafts[newKey], "较新版本");
  assert.equal(restored.feynmanDrafts[oldKey], "旧小节完整草稿");
  const catalog = [{ id: "principles", chapters: [{ sections: [corrected] }] }];
  assert.equal(sessionApi.validateLocation(session.locations["333"], catalog).section, corrected);
  assert.equal(sessionApi.validateLocation(session.locations["333"], [{ id: "principles", chapters: [{ sections: ["第一节 教育的概念"] }] }]).section, "");
});

test("older backup imports both review/new-learning scopes without losing schedules, and rejects unrelated invalid sections", async () => {
  const catalogs = await backupApi.loadBackupCatalogs();
  const progress = { version: 1, cards: { [card.id]: review }, scopes: [scope], newScopes: [scope], dailyNewLimit: 13, daily: { date: "2026-10-06", admitted: [] } };
  const locations = Object.fromEntries(["333", "825", "politics", "english"].map(subject => [subject, sessionApi.defaultLocation(subject, Object.fromEntries(Object.entries(catalogs).map(([key, c]) => [key, c.books.map(b => b.id)])))]));
  locations["333"].section = old;
  const key = sessionApi.feynmanDraftKey("333", locations["333"]);
  const raw = { format: "yantu-study-backup", version: 1, createdAt: now, records: {
    "yantu-srs-v1-333": progress,
    "yantu-learning-session-v1": { version: 1, subject: "333", locations, feynmanDrafts: { [key]: "仍可恢复的草稿" }, plannerPrompts: {}, pastAnswers: {} },
  } };
  const restored = backupApi.validateStudyBackup(JSON.stringify(raw), catalogs);
  const restoredProgress = restored.records["yantu-srs-v1-333"];
  assert.deepEqual(restoredProgress.cards, progress.cards);
  assert.deepEqual(restoredProgress.scopes, [{ ...scope, section: corrected }]);
  assert.deepEqual(restoredProgress.newScopes, [{ ...scope, section: corrected }]);
  const restoredSession = restored.records["yantu-learning-session-v1"];
  assert.equal(restoredSession.locations["333"].section, corrected);
  assert.equal(restoredSession.feynmanDrafts[sessionApi.feynmanDraftKey("333", restoredSession.locations["333"])], "仍可恢复的草稿");
  const overlapping = structuredClone(raw);
  overlapping.records["yantu-srs-v1-333"].scopes.push({ ...scope, section: corrected });
  assert.deepEqual(backupApi.validateStudyBackup(JSON.stringify(overlapping), catalogs).records["yantu-srs-v1-333"].scopes, [{ ...scope, section: corrected }]);
  const duplicate = structuredClone(raw);
  duplicate.records["yantu-srs-v1-333"].scopes.push({ ...scope });
  assert.throws(() => backupApi.validateStudyBackup(JSON.stringify(duplicate), catalogs), /重复范围/);
  const invalid = structuredClone(raw);
  invalid.records["yantu-srs-v1-333"].newScopes[0].section = "未知节";
  assert.throws(() => backupApi.validateStudyBackup(JSON.stringify(invalid), catalogs), /未知小节/);
});

test("a saved mock paper using the corrected section keeps its complete question and user's answer", async () => {
  const catalogs = await backupApi.loadBackupCatalogs();
  const book = catalogs["333"].books.find(b => b.id === "principles");
  const unit = { bookId: book.id, chapterNo: 1, bookName: book.name, chapterName: book.chapters[0].title, section: old };
  const config = { "single-choice": 0, definition: 0, "short-answer": 0, essay: 1, "material-analysis": 0 };
  const record = { version: 1, subject: "333", settings: { counts: Object.fromEntries(Object.entries(config).map(([key, n]) => [key, String(n)])), selection: { principles: [1] }, sectionScope: { bookId: "principles", chapter: 1, name: old } }, session: {
    snapshot: { subject: "333", config, ranges: [{ bookId: "principles", chapters: [1], section: old }], scopeLabel: old, createdAt: now },
    result: { questions: [{ ...unit, id: "saved-essay", type: "essay", stem: "已保存的完整论述题", referenceAnswer: "完整旧答案", rationale: "原解析", source: "AI 模拟题", knowledgePointIds: [card.id] }], coverage: { requestedUnits: [unit], coveredUnits: [{ ...unit }], uncoveredUnits: [], complete: true, note: "原覆盖说明" } },
    cursor: 0, mode: "paper", responses: { "saved-essay": { text: "我已写好的作答", revealed: true } },
  } };
  const restored = mockApi.validateMockSavedRecord(record, "333", catalogs["333"].books);
  assert.equal(restored.settings.sectionScope.name, corrected);
  assert.equal(restored.session.snapshot.ranges[0].section, corrected);
  assert.equal(restored.session.result.questions[0].section, corrected);
  assert.equal(restored.session.result.questions[0].stem, "已保存的完整论述题");
  assert.deepEqual(restored.session.responses, record.session.responses);
  const invalid = structuredClone(record);
  invalid.session.result.questions[0].section = "第一节 教育的概念";
  assert.throws(() => mockApi.validateMockSavedRecord(invalid, "333", catalogs["333"].books), /无效/);
});
