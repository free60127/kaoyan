import { isRestorableView, learningSessionKey, restoreLearningSession, type BookIds, type LearningLocation, type LearningSession, type StudySubject } from "./learning-session";
import { normalizeStoredProgress, normalizeStudyScopes, type CardIdentity, type StudyProgress, type StudyScope, type StudyTime } from "./study-scheduler";
import { MAX_MOCK_RECORD_CHARS, validateMockSavedRecord, type MockSavedRecord } from "./mock-practice-storage";
import type { MockPracticeBook } from "./mock-practice-state";
import { parseHighlightMarkers, stripHighlightMarkers } from "./highlight-markers";
import { renderRichSegments } from "./rich-text";
import { parsePersonalStore, personalStorageKey, type PersonalStore } from "./personal-cards";
import type { RichContent } from "./rich-text";
import { examTargetKey, validateExamTarget, type ExamTargetRecord } from "./exam-target";
import { normalizeMistakeCounters } from "./mistakes";
import { validateTimingRecords, validateTimingSettings, timingSettingsKey, formatStudyTime, type TimingRecords, type TimingSettings } from "./card-timing";

export const MAX_BACKUP_BYTES = 8 * 1024 * 1024;
// 个人编辑层放最前: 导入时先恢复个人卡, 再恢复依赖它的复习记录
export const BACKUP_STORAGE_KEYS = [personalStorageKey, learningSessionKey, "yantu-srs-v1-333", "yantu-srs-v1-825", "yantu-srs-v1-politics", "yantu-done", "yantu-done-825", "yantu-done-politics", "yantu-mistakes-v1", "yantu-stats-v1-333", "yantu-stats-v1-825", "yantu-stats-v1-politics", "yantu-card-timing-v1-333", "yantu-card-timing-v1-825", "yantu-card-timing-v1-politics", timingSettingsKey, "yantu-activity-v1-333", "yantu-activity-v1-825", "yantu-activity-v1-politics", "yantu-mcq-excluded-v1", "kaoyan.mock-practice.v1.333", "kaoyan.mock-practice.v1.825", examTargetKey] as const;
export type BackupStorageKey = typeof BACKUP_STORAGE_KEYS[number];
export type BackupSubject = "333" | "825" | "politics";
export type BackupProgress = StudyProgress & { newScopes: StudyScope[] };
export type BackupMistake = { id: string; subject: string; kind: string; refId: string; label: string; wrongCount: number; wrongCounts?: Record<string, number>; lastAt: string; deleted?: boolean; restoredDeletion?: boolean; pendingOnly?: boolean };
export type BackupDayStat = { date: string; ratings: number; again: number; newCards: number; quiz: number; quizCorrect: number; devices?: Record<string, Record<string, number>> };
export type BackupActivity = { t: string; kind: string; subject: string; label: string; detail: string };
export type BackupRecordMap = {
  "yantu-card-timing-settings-v1": TimingSettings;
  "yantu-card-timing-v1-333": TimingRecords;
  "yantu-card-timing-v1-825": TimingRecords;
  "yantu-card-timing-v1-politics": TimingRecords;
  "yantu-exam-target-v1": ExamTargetRecord;
  "yantu-personal-v1": PersonalStore;
  "yantu-learning-session-v1": LearningSession;
  "yantu-srs-v1-333": BackupProgress;
  "yantu-srs-v1-825": BackupProgress;
  "yantu-srs-v1-politics": BackupProgress;
  "yantu-done": Record<string, unknown>;
  "yantu-done-825": Record<string, unknown>;
  "yantu-done-politics": Record<string, unknown>;
  "yantu-mistakes-v1": BackupMistake[];
  "yantu-activity-v1-333": BackupActivity[];
  "yantu-activity-v1-825": BackupActivity[];
  "yantu-activity-v1-politics": BackupActivity[];
  "yantu-mcq-excluded-v1": string[];
  "yantu-stats-v1-333": Record<string, BackupDayStat>;
  "yantu-stats-v1-825": Record<string, BackupDayStat>;
  "yantu-stats-v1-politics": Record<string, BackupDayStat>;
  "kaoyan.mock-practice.v1.333": MockSavedRecord;
  "kaoyan.mock-practice.v1.825": MockSavedRecord;
};
/** Omitted keys are absent snapshots, and are left untouched on import. */
export type StudyBackup = { format: "yantu-study-backup"; version: 1; createdAt: string; records: Partial<BackupRecordMap> };
export type BackupCard = CardIdentity & { front: string; back: string; source: string };
export type BackupQuestion = { id: string; book: string; stem: string; source: string; referenceAnswer?: string | null; analysis?: string | null; answerSource?: string | null };
export type BackupCatalog = { books: MockPracticeBook[]; cards: BackupCard[]; questions?: BackupQuestion[] };
export type BackupCatalogs = Record<BackupSubject, BackupCatalog>;
export type BackupStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type BackupSummary = Record<StudySubject, { studiedCards: number; completedChapters: number; mockQuestions: number; drafts: number; mistakes: number; quizAnswers: number }>;
export type BackupDocumentBlock = { type: "heading" | "paragraph"; text: string; color?: string; hl?: string };
export type BackupDocument = { title: string; blocks: BackupDocumentBlock[] };

const subjects: BackupSubject[] = ["333", "825", "politics"];
const allSubjects: StudySubject[] = [...subjects, "english"];
const srsKey = (subject: BackupSubject) => `yantu-srs-v1-${subject}` as "yantu-srs-v1-333" | "yantu-srs-v1-825" | "yantu-srs-v1-politics";
const doneKey = (subject: BackupSubject) => (subject === "333" ? "yantu-done" : `yantu-done-${subject}`) as "yantu-done" | "yantu-done-825" | "yantu-done-politics";
const mockKey = (subject: "333" | "825") => `kaoyan.mock-practice.v1.${subject}` as "kaoyan.mock-practice.v1.333" | "kaoyan.mock-practice.v1.825";
const has = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const fail = (path: string, reason = "格式无效"): never => { throw new Error(`学习备份 ${path}：${reason}。`); };
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(path);
  return value as Record<string, unknown>;
}
function text(value: unknown, path: string, max = 200_000): string {
  if (typeof value !== "string" || value.length > max) return fail(path);
  return value;
}
function integer(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return fail(path);
  return value;
}
function dateOnly(value: unknown, path: string): string {
  const date = text(value, path, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return fail(path);
  return date;
}
function timestamp(value: unknown, path: string): string {
  const stamp = text(value, path, 100);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) || !Number.isFinite(Date.parse(stamp))) return fail(path);
  dateOnly(stamp.slice(0, 10), path);
  const [h, m, s] = stamp.slice(11, 19).split(":").map(Number);
  if (h > 23 || m > 59 || s > 59) return fail(path);
  return new Date(stamp).toISOString();
}
function boundedList(value: unknown, max: number, path: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) return fail(path);
  return value;
}
/** Checks the original payload, including fields that will later be discarded. */
function safePayload(value: unknown): void {
  const seen = new Set<object>();
  let nodes = 0;
  const visit = (entry: unknown, depth: number) => {
    if (depth > 30 || ++nodes > 250_000) fail("数据", "层级或条目数量超限");
    if (!entry || typeof entry !== "object") {
      if (typeof entry === "number" && !Number.isFinite(entry)) fail("数据");
      if (["function", "symbol", "bigint", "undefined"].includes(typeof entry)) fail("数据");
      return;
    }
    if (seen.has(entry)) fail("数据", "包含循环或共享对象引用");
    seen.add(entry);
    if (!Array.isArray(entry) && Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) fail("数据", "对象原型无效");
    for (const key of Object.keys(entry)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) fail("数据", "包含禁止的原型键");
      visit((entry as Record<string, unknown>)[key], depth + 1);
    }
    seen.delete(entry);
  };
  visit(value, 0);
  let raw: string;
  try { raw = JSON.stringify(value); } catch { return fail("数据"); }
  if (!raw || new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) fail("数据", "超过 8 MiB 大小上限");
}
function parsePayload(raw: string, path: string): unknown {
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES) return fail(path, "超过 8 MiB 大小上限");
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return fail(path, "JSON 损坏"); }
  safePayload(value);
  return value;
}
function bookIds(catalogs: BackupCatalogs): BookIds {
  return Object.fromEntries(subjects.map(subject => [subject, catalogs[subject].books.map(book => book.id)]));
}
function bookFor(catalogs: BackupCatalogs, subject: BackupSubject, id: unknown, path: string): MockPracticeBook {
  return catalogs[subject].books.find(book => book.id === id) ?? fail(path, "未知书目");
}
function chapterFor(book: MockPracticeBook, value: unknown, path: string): number {
  return integer(value, 1, book.chapters.length, path);
}
function location(value: unknown, subject: StudySubject, catalogs: BackupCatalogs, path: string): LearningLocation {
  const row = object(value, path), book = text(row.book, path, 200);
  const chapter = subject === "english" ? integer(row.chapter, 1, 10_000, path) : chapterFor(bookFor(catalogs, subject, book, path), row.chapter, path);
  const section = text(row.section, path);
  if (subject === "english" ? book !== "" || section !== "" : section !== "" && !bookFor(catalogs, subject, book, path).chapters[chapter - 1].sections.includes(section)) fail(path, "未知小节");
  if (!isRestorableView(subject, row.view)) fail(path, "未知页面");
  if (row.pastMode !== "index" && row.pastMode !== "practice") fail(path);
  integer(row.pastYear, 1900, 2200, path); integer(row.pastIndex, 0, 100_000, path);
  return { book, chapter, section, view: row.view as LearningLocation["view"], pastMode: row.pastMode as LearningLocation["pastMode"], pastYear: row.pastYear as number, pastIndex: row.pastIndex as number };
}
function session(value: unknown, catalogs: BackupCatalogs): LearningSession {
  const row = object(value, "学习位置");
  if (row.version !== 1 || !allSubjects.includes(row.subject as StudySubject)) fail("学习位置", "版本或科目无效");
  const locations = object(row.locations, "学习位置"), planner = object(row.plannerPrompts, "学习计划");
  if (Object.keys(locations).some(key => !allSubjects.includes(key as StudySubject)) || Object.keys(planner).some(key => !allSubjects.includes(key as StudySubject))) fail("学习位置", "未知科目");
  const cleanLocations = Object.fromEntries(allSubjects.map(subject => [subject, location(locations[subject], subject, catalogs, subject)]));
  const drafts = (value: unknown, kind: "feynman" | "past") => Object.fromEntries(Object.entries(object(value, "草稿")).map(([key, value]) => {
    let parts: unknown;
    try { parts = JSON.parse(key); } catch { return fail("草稿", "索引无效"); }
    if (!Array.isArray(parts) || !subjects.includes(parts[0]) || typeof parts[1] !== "string") return fail("草稿", "科目或书目无效");
    const book = bookFor(catalogs, parts[0], parts[1], "草稿");
    if (kind === "feynman") {
      if (parts.length !== 4) fail("草稿");
      const chapter = chapterFor(book, parts[2], "草稿"), section = text(parts[3], "草稿");
      if (section && !book.chapters[chapter - 1].sections.includes(section)) fail("草稿", "未知小节");
    } else if (parts.length !== 3 || parts[0] !== "825" || !catalogs["825"].questions?.some(question => question.id === parts[2] && question.book === book.id)) fail("真题作答", "未知题目");
    return [key, text(value, "草稿")];
  }));
  const clean = { version: 1, subject: row.subject, locations: cleanLocations, feynmanDrafts: drafts(row.feynmanDrafts, "feynman"), pastAnswers: drafts(row.pastAnswers, "past"), plannerPrompts: Object.fromEntries(Object.entries(planner).map(([key, value]) => [key, text(value, "学习计划")])) };
  // Strict guards above ensure the existing restorer cannot silently lose an entry.
  return restoreLearningSession(JSON.stringify(clean), bookIds(catalogs));
}
function scopes(value: unknown, catalog: BackupCatalog, path: string): StudyScope[] {
  const list = boundedList(value, 10_000, path);
  const clean = list.map(entry => {
    const row = object(entry, path), book = catalog.books.find(book => book.id === row.bookId) ?? fail(path, "未知书目");
    const chapters = boundedList(row.chapters, book.chapters.length, path).map(value => chapterFor(book, value, path));
    if (!chapters.length || new Set(chapters).size !== chapters.length) fail(path);
    const section = row.section === undefined ? undefined : text(row.section, path, 500);
    if (section !== undefined && (!section.trim() || chapters.some(chapter => !book.chapters[chapter - 1].sections.includes(section)))) fail(path, "未知小节");
    if (chapters.some(chapter => !catalog.cards.some(card => card.book === book.id && card.chapter === chapter && (section === undefined || card.section === section)))) fail(path, "范围没有对应卡片");
    return { bookId: book.id, chapters, ...(section === undefined ? {} : { section }) };
  });
  if (new Set(clean.map(entry => JSON.stringify({ ...entry, chapters: [...entry.chapters].sort((a, b) => a - b) }))).size !== clean.length) fail(path, "重复范围");
  const normalized = normalizeStudyScopes(clean, catalog.cards);
  if (normalized.length !== clean.length) fail(path);
  return normalized;
}
function progress(value: unknown, catalog: BackupCatalog, allowMissingNewScopes = false): BackupProgress {
  const row = object(value, "复习记录");
  if (row.version !== 1) fail("复习记录", "版本不兼容");
  const cards = object(row.cards, "复习卡片");
  if (Object.keys(cards).length > 20_000) fail("复习卡片", "数量超限");
  for (const [id, entry] of Object.entries(cards)) {
    if (!id || id.length > 200) fail("复习卡片", "卡片标识无效");
    const review = object(entry, "复习卡片");
    for (const field of ["dueAt", "firstStudiedAt", "lastReviewedAt"]) timestamp(review[field], `复习卡片 ${field}`);
    if (typeof review.intervalDays !== "number" || !Number.isFinite(review.intervalDays) || review.intervalDays < 0 || review.intervalDays > 36_500 || typeof review.ease !== "number" || !Number.isFinite(review.ease) || review.ease < 1.3 || review.ease > 10) fail("复习卡片");
    integer(review.reps, 0, Number.MAX_SAFE_INTEGER, "复习次数"); integer(review.lapses, 0, Number.MAX_SAFE_INTEGER, "遗忘次数");
    if (!["learning", "review", "relearning"].includes(String(review.stage))) fail("复习阶段");
  }
  const cleanScopes = scopes(row.scopes, catalog, "复习范围");
  const newScopes = scopes(row.newScopes === undefined && allowMissingNewScopes ? [] : row.newScopes, catalog, "新学范围");
  integer(row.dailyNewLimit, 0, 200, "每日新卡上限");
  const daily = object(row.daily, "每日记录"), date = dateOnly(daily.date, "每日记录日期");
  const admitted = boundedList(daily.admitted, 20_000, "每日记录").map(value => {
    const id = text(value, "每日记录", 200);
    if (!has(cards, id)) fail("每日记录", "未学习卡片");
    return id;
  });
  if (new Set(admitted).size !== admitted.length) fail("每日记录", "重复卡片");
  const normalized = normalizeStoredProgress({ ...row, cards, scopes: cleanScopes }, catalog.cards, `${date}T12:00:00`);
  return { ...normalized, scopes: cleanScopes, daily: { date, admitted }, newScopes };
}
/** 章节标记 v2: {marks, touch}——touch 记录每键触碰时间与设备, 云合并据此判定新旧(F08 撤销不复活)。 */
function completion(value: unknown, catalog: BackupCatalog): Record<string, unknown> {
  const row = object(value, "章节标记");
  const valid = new Set(catalog.books.flatMap(book => book.chapters.map((_, index) => `${book.id}-${index + 1}`)));
  const isV2 = row.marks !== undefined || row.touch !== undefined;
  if (isV2) for (const key of Object.keys(row)) if (!["marks", "touch"].includes(key)) fail("章节标记", "包含未允许的字段");
  const marksRow = isV2 ? object(row.marks ?? {}, "章节标记") : row;
  const marks: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(marksRow)) {
    if (!valid.has(key) || typeof value !== "boolean") return fail("章节标记", "未知章节或值无效");
    marks[key] = value;
  }
  const touch: Record<string, { v: boolean; t: string; d: string }> = {};
  if (row.touch !== undefined) {
    for (const [key, entry] of Object.entries(object(row.touch, "章节标记触碰"))) {
      if (!valid.has(key)) continue;
      const item = object(entry, "章节标记触碰");
      touch[key] = { v: item.v === true, t: timestamp(item.t, "章节标记触碰"), d: text(item.d, "章节标记触碰", 80) };
    }
  }
  return { marks, touch };
}
function mistakes(value: unknown): BackupMistake[] {
  return boundedList(value, 20_000, "错题本").map(entry => {
    const row = object(entry, "错题条目");
    const subject = text(row.subject, "错题条目", 20);
    const kind = String(row.kind);
    if (!["card", "quiz", "practice"].includes(kind)) fail("错题条目", "类型无效");
    const wrongCount = integer(row.wrongCount, 0, 1_000_000, "错题次数");
    const wrongCounts = row.wrongCounts === undefined ? undefined : Object.fromEntries(Object.entries(object(row.wrongCounts, "错题设备计数")).map(([id, n]) => [text(id, "错题设备", 80), integer(n, 0, 1_000_000, "错题设备计数")]));
    if (wrongCounts && Object.values(wrongCounts).reduce((sum, n) => sum + n, 0) !== wrongCount) fail("错题设备计数", "与错题总次数不一致");
    const id = text(row.id, "错题条目", 200), refId = text(row.refId, "错题条目", 200);
    // deleted 是 tombstone(F08): 已删除的错题保留记录, 防止另一端旧数据复活
    return { id, subject, kind, refId, label: text(row.label, "错题条目"), wrongCount, ...(wrongCounts ? { wrongCounts } : {}), lastAt: timestamp(row.lastAt, "错题时间"), ...(row.deleted === true ? { deleted: true } : {}), ...(row.restoredDeletion === true ? { restoredDeletion: true } : {}), ...(typeof row.pendingOnly === "boolean" ? { pendingOnly: row.pendingOnly } : {}) };
  });
}
function activities(value: unknown): BackupActivity[] {
  return boundedList(value, 2_000, "活动日志").map(entry => {
    const row = object(entry, "活动条目");
    const kind = text(row.kind, "活动类型", 20);
    if (!["rating", "undo", "quiz", "practice"].includes(kind)) fail("活动类型");
    return { t: timestamp(row.t, "活动时间"), kind, subject: text(row.subject, "活动科目", 20), label: text(row.label, "活动内容"), detail: text(row.detail, "活动明细") };
  });
}

function richContent(value: unknown, path: string): RichContent {
  const row = object(value, path);
  const content = text(row.text, path, 20_000);
  const runs = boundedList(row.runs === undefined ? [] : row.runs, 400, path).map(entry => {
    const run = object(entry, path);
    const kind = text(run.kind, path, 10);
    if (!["color", "hl", "b", "u"].includes(kind)) fail(path, "样式类型无效");
    const start = integer(run.start, 0, content.length, path), end = integer(run.end, 0, content.length, path);
    if (end <= start) fail(path, "样式区间无效");
    if (run.value === undefined) {
      if (kind === "color" || kind === "hl") fail(path, "缺少颜色值");
      return { start, end, kind: kind as "b" | "u" };
    }
    const value = text(run.value, path, 7);
    if (!/^#[0-9a-fA-F]{6}$/.test(value)) fail(path, "颜色值无效");
    return { start, end, kind: kind as "color" | "hl", value };
  });
  return { text: content, runs };
}

function personalLayer(value: unknown, catalogs: BackupCatalogs): PersonalStore {
  const row = object(value, "个人编辑层");
  if (row.version !== 1) fail("个人编辑层", "版本不兼容");
  integer(row.seq, 0, 1_000_000_000, "个人编辑层版本");
  const store = parsePersonalStore(JSON.stringify({ version: 1, seq: row.seq, overlays: {}, cards: [] }));
  const overlays = object(row.overlays, "个人修改");
  if (Object.keys(overlays).length > 5_000) fail("个人修改", "数量超限");
  for (const [key, entry] of Object.entries(overlays)) {
    if (!key || key.length > 260 || !key.includes(":")) fail("个人修改", "索引无效");
    const item = object(entry, `个人修改 ${key}`);
    const overlay: PersonalStore["overlays"][string] = {
      rev: integer(item.rev, 1, 1_000_000, `个人修改 ${key}`),
      updatedAt: timestamp(item.updatedAt, `个人修改 ${key}`),
      baseHash: text(item.baseHash, `个人修改 ${key}`, 64),
    };
    if (item.q !== undefined) overlay.q = richContent(item.q, `个人修改 ${key} 问题`);
    if (item.a !== undefined) overlay.a = richContent(item.a, `个人修改 ${key} 答案`);
    if (item.note !== undefined) overlay.note = richContent(item.note, `个人修改 ${key} 补充`);
    if (item.bg !== undefined) {
      const bg = text(item.bg, `个人修改 ${key}`, 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(bg)) fail(`个人修改 ${key}`, "背景色无效");
      overlay.bg = bg;
    }
    if (item.hidden !== undefined) {
      if (typeof item.hidden !== "boolean") fail(`个人修改 ${key}`, "隐藏标记无效");
      overlay.hidden = item.hidden === true;
    }
    if (overlay.q || overlay.a || overlay.note || overlay.bg || overlay.hidden) store.overlays[key] = overlay;
  }
  for (const entry of boundedList(row.cards === undefined ? [] : row.cards, 2_000, "个人卡")) {
    const item = object(entry, "个人卡");
    const id = text(item.id, "个人卡", 80);
    if (!id.startsWith("mine-")) fail("个人卡", "标识无效");
    const subject = text(item.subject, "个人卡", 20);
    if (!["333", "825", "politics"].includes(subject)) fail("个人卡", "科目无效");
    const book = bookFor(catalogs, subject as BackupSubject, item.book, "个人卡");
    const chapter = chapterFor(book, item.chapter, "个人卡");
    const section = text(item.section, "个人卡");
    if (section && !book.chapters[chapter - 1].sections.includes(section)) fail("个人卡", "未知小节");
    // safePayload 禁止 undefined 值字段: 可选字段一律条件赋值
    const cleanCard: PersonalStore["cards"][number] = {
      id,
      subject: subject as PersonalStore["cards"][number]["subject"],
      book: book.id,
      chapter,
      section,
      front: richContent(item.front, "个人卡 问题"),
      back: richContent(item.back, "个人卡 答案"),
      createdAt: timestamp(item.createdAt, "个人卡"),
      rev: integer(item.rev, 1, 1_000_000, "个人卡"),
    };
    if (item.note !== undefined) cleanCard.note = richContent(item.note, "个人卡 补充");
    if (item.bg !== undefined) {
      const bg = text(item.bg, "个人卡", 7);
      if (!/^#[0-9a-fA-F]{6}$/.test(bg)) fail("个人卡", "背景色无效");
      cleanCard.bg = bg;
    }
    if (item.hidden === true) cleanCard.hidden = true;
    store.cards.push(cleanCard);
  }
  return store;
}
function dayStats(value: unknown): Record<string, BackupDayStat> {
  return Object.fromEntries(Object.entries(object(value, "学习统计")).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date)).map(([date, entry]) => {
    const row = object(entry, `学习统计 ${date}`);
    const clean: BackupDayStat = {
      date: dateOnly(row.date, "统计日期"),
      ratings: integer(row.ratings, 0, 100_000, "评分次数"),
      again: integer(row.again, 0, 100_000, "重来次数"),
      newCards: integer(row.newCards, 0, 100_000, "新学张数"),
      quiz: integer(row.quiz, 0, 100_000, "练习题数"),
      quizCorrect: integer(row.quizCorrect, 0, 100_000, "练习答对"),
    };
    // 设备分桶(F07): 原样保留, 云合并按设备取值
    if (row.devices !== undefined) {
      const devices = object(row.devices, `学习统计 ${date} 设备`);
      const cleanDevices: Record<string, Record<string, number>> = {};
      for (const [deviceId, bucket] of Object.entries(devices)) {
        const bucketRow = object(bucket, `学习统计 ${date} 设备`);
        cleanDevices[deviceId.slice(0, 80)] = {
          ratings: integer(bucketRow.ratings, 0, 100_000, "评分次数"),
          again: integer(bucketRow.again, 0, 100_000, "重来次数"),
          newCards: integer(bucketRow.newCards, 0, 100_000, "新学张数"),
          quiz: integer(bucketRow.quiz, 0, 100_000, "练习题数"),
          quizCorrect: integer(bucketRow.quizCorrect, 0, 100_000, "练习答对"),
        };
      }
      if (Object.keys(cleanDevices).length) clean.devices = cleanDevices;
    }
    return [dateOnly(date, "统计日期"), clean];
  }));
}
function cleanRecord(key: BackupStorageKey, value: unknown, catalogs: BackupCatalogs, collecting = false): BackupRecordMap[BackupStorageKey] {
  if (key === timingSettingsKey) return validateTimingSettings(value);
  if (key === examTargetKey) {
    const row = object(value, "考试日期");
    // Backup records retain supported fields only, including when removing credentials.
    try { return validateExamTarget({ version: row.version, date: row.date }); } catch { return fail("考试日期", "日期或版本无效"); }
  }
  if (key === personalStorageKey) return personalLayer(value, catalogs);
  if (key === learningSessionKey) return session(value, catalogs);
  if (key === "yantu-mistakes-v1") return mistakes(value);
  if (key === "yantu-mcq-excluded-v1") return boundedList(value, 20_000, "排除标记").map(id => text(id, "排除标记", 200));
  if (key.startsWith("yantu-activity-v1-")) return activities(value);
  if (key.startsWith("yantu-stats-v1-")) return dayStats(value);
  if (key.startsWith("yantu-card-timing-v1-")) return validateTimingRecords(Object.fromEntries(Object.entries(object(value, "闪卡背诵用时")).filter(([id]) => id !== "apiKey")));
  const subject = key.endsWith("825") ? "825" : key.endsWith("politics") ? "politics" : "333";
  if (key.startsWith("yantu-srs")) return progress(value, catalogs[subject], collecting);
  if (key.startsWith("yantu-done")) return completion(value, catalogs[subject]);
  const raw = JSON.stringify(value);
  if (raw.length > MAX_MOCK_RECORD_CHARS) fail("模拟卷", "超过模拟卷保存上限");
  return validateMockSavedRecord(value, subject as "333" | "825", catalogs[subject].books);
}

/** Called on demand. The 825/politics JSON catalogs remain lazy imports.
 *  个人卡并入目录: 复习范围/位置校验需要它们存在, 小节目录也由卡标签派生。 */
export async function loadBackupCatalogs(): Promise<BackupCatalogs> {
  const [data333, outlines, module825, modulePolitics] = await Promise.all([import("./study-data"), import("./outlines"), import("./825/study-data"), import("./politics/study-data")]);
  const [data825, dataPolitics, knowledge333] = await Promise.all([module825.load825StudyData(), modulePolitics.loadPoliticsStudyData(), data333.loadKnowledgeCards()]);
  const personal = parsePersonalStore(typeof localStorage === "undefined" ? null : localStorage.getItem(personalStorageKey));
  const toBackupCard = (card: PersonalStore["cards"][number]): BackupCard => ({ id: card.id, book: card.book, chapter: card.chapter, ...(card.section ? { section: card.section } : {}), front: card.front.text, back: card.back.text, source: "个人补充卡" });
  const personalBy = (subject: PersonalStore["cards"][number]["subject"]) => personal.cards.filter(card => !card.hidden && card.subject === subject).map(toBackupCard);
  const cards333 = [...data333.cards, ...knowledge333, ...personalBy("333")].map(card => ({ ...card, ...(/^〔(.+?)〕/.exec(card.front)?.[1] ? { section: /^〔(.+?)〕/.exec(card.front)![1] } : {}) }));
  const cardsPolitics = [...dataPolitics.cards, ...personalBy("politics")];
  const cards825 = [...data825.cards, ...personalBy("825")];
  const books333 = data333.books.map(book => ({ id: book.id, name: book.name, chapters: book.chapters.map((title, index) => ({ title, sections: outlines.outlines[book.id]?.[index] || [] })) }));
  const booksPolitics = dataPolitics.books.map(book => ({ id: book.id, name: book.name, chapters: book.chapters.map(title => ({ title, sections: [] as string[] })) }));
  for (const [books, cards] of [[books333, cards333], [booksPolitics, cardsPolitics], [data825.books, cards825]] as [MockPracticeBook[], BackupCard[]][]) {
    for (const book of books) book.chapters.forEach((chapter, index) => {
      const labels = [...new Set(cards.filter(card => card.book === book.id && card.chapter === index + 1 && card.section).map(card => card.section!))];
      if (labels.length) chapter.sections = labels;
    });
  }
  return { "333": { books: books333, cards: cards333 }, "825": { ...data825, cards: cards825 }, politics: { books: booksPolitics, cards: cardsPolitics } };
}

export function validateStudyBackup(input: unknown, catalogs: BackupCatalogs): StudyBackup {
  const value = typeof input === "string" ? parsePayload(input, "文件") : input;
  safePayload(value);
  const row = object(value, "文件");
  if (Object.keys(row).length !== 4 || Object.keys(row).some(key => !["format", "version", "createdAt", "records"].includes(key)) || row.format !== "yantu-study-backup" || row.version !== 1) fail("文件", "格式或版本不兼容");
  const createdAt = timestamp(row.createdAt, "导出时间"), records = object(row.records, "记录");
  if (Object.keys(records).some(key => !BACKUP_STORAGE_KEYS.includes(key as BackupStorageKey))) fail("记录", "包含未允许的存储键");
  const clean = Object.fromEntries(Object.entries(records).map(([key, value]) => [key, cleanRecord(key as BackupStorageKey, value, catalogs)])) as Partial<BackupRecordMap>;
  const backup: StudyBackup = { format: "yantu-study-backup", version: 1, createdAt, records: clean };
  safePayload(backup);
  return backup;
}

export function collectStudyBackup(storage: Pick<Storage, "getItem">, catalogs: BackupCatalogs, now: StudyTime): StudyBackup {
  const createdAt = new Date(now instanceof Date ? now.getTime() : now).toISOString();
  const records: Partial<BackupRecordMap> = {};
  for (const key of BACKUP_STORAGE_KEYS) {
    let raw: string | null;
    try { raw = storage.getItem(key); } catch { return fail("本地记录", "读取失败"); }
    if (raw !== null) {
      let value = parsePayload(raw, key);
      if (key === "yantu-mistakes-v1") value = boundedList(value, 20_000, "错题本").map(entry => {
        const row = object(entry, "错题条目");
        // Only local legacy counts are repaired. Imported backup validation
        // remains strict; malformed fields still fail instead of disappearing.
        const wrongCount = integer(row.wrongCount, 0, 1_000_000, "错题次数");
        if (row.wrongCounts !== undefined) for (const [id, n] of Object.entries(object(row.wrongCounts, "错题设备计数"))) {
          text(id, "错题设备", 80); integer(n, 0, 1_000_000, "错题设备计数");
        }
        const pendingOnly = row.pendingOnly === true || row.pendingOnly === undefined && row.subject === "825" && row.kind === "quiz";
        return { ...row, ...normalizeMistakeCounters({ wrongCount: pendingOnly ? 0 : wrongCount, wrongCounts: row.wrongCounts }), pendingOnly };
      });
      Object.assign(records, { [key]: cleanRecord(key, value, catalogs, true) });
      continue;
    }
    if (key === learningSessionKey) {
      const legacyRaw = storage.getItem("yantu-last-place");
      if (legacyRaw !== null) {
        const legacy = object(parsePayload(legacyRaw, "旧版位置"), "旧版位置");
        if (!allSubjects.includes(legacy.subject as StudySubject)) fail("旧版位置", "科目无效");
        const restored = restoreLearningSession(null, bookIds(catalogs), legacyRaw);
        const current = restored.locations[restored.subject];
        for (const field of ["book", "chapter", "section", "view", "pastMode", "pastYear", "pastIndex"] as const) if (has(legacy, field) && legacy[field] !== current[field]) fail("旧版位置", "字段无效");
        records[key] = session(restored, catalogs);
      }
    } else if (key.startsWith("yantu-srs")) {
      const subject = key.slice("yantu-srs-v1-".length) as BackupSubject;
      const legacyRaw = storage.getItem(subject === "333" ? "yantu-reviews" : `yantu-reviews-${subject}`);
      if (legacyRaw !== null) {
        const legacy = object(parsePayload(legacyRaw, "旧版复习"), "旧版复习"), catalog = catalogs[subject];
        if (Object.keys(legacy).length > 20_000) fail("旧版复习", "数量超限");
        for (const [id, value] of Object.entries(legacy)) {
          if (!id || id.length > 200) fail("旧版复习", "卡片标识无效");
          const review = object(value, "旧版复习");
          if (!["due", "interval", "reps"].some(field => has(review, field))) fail("旧版复习");
          if (has(review, "due")) dateOnly(review.due, "旧版到期日");
          if (has(review, "interval") && (typeof review.interval !== "number" || !Number.isFinite(review.interval) || review.interval < 0 || review.interval > 36_500)) fail("旧版间隔");
          if (has(review, "ease") && (typeof review.ease !== "number" || !Number.isFinite(review.ease) || review.ease < 1.3 || review.ease > 10)) fail("旧版难度");
          if (has(review, "reps")) integer(review.reps, 0, Number.MAX_SAFE_INTEGER, "旧版复习次数");
        }
        Object.assign(records, { [key]: { ...normalizeStoredProgress(null, catalog.cards, now, legacy), newScopes: [] } });
      }
    }
  }
  return validateStudyBackup({ format: "yantu-study-backup", version: 1, createdAt, records }, catalogs);
}

export function summarizeStudyBackup(input: StudyBackup, catalogs: BackupCatalogs): BackupSummary {
  const backup = validateStudyBackup(input, catalogs);
  const result = Object.fromEntries(allSubjects.map(subject => [subject, { studiedCards: 0, completedChapters: 0, mockQuestions: 0, drafts: 0, mistakes: 0, quizAnswers: 0 }])) as BackupSummary;
  for (const subject of subjects) {
    result[subject].studiedCards = Object.keys(backup.records[srsKey(subject)]?.cards || {}).length;
    const doneRecord = backup.records[doneKey(subject)];
    if (doneRecord && typeof doneRecord === "object" && "marks" in doneRecord) {
      result[subject].completedChapters = Object.values((doneRecord as { marks: Record<string, boolean> }).marks).filter(Boolean).length;
    } else {
      result[subject].completedChapters = Object.values(doneRecord || {}).filter(Boolean).length;
    }
    if (subject !== "politics") result[subject].mockQuestions = backup.records[mockKey(subject)]?.session?.result.questions.length || 0;
  }
  const mistakeList = backup.records["yantu-mistakes-v1"];
  if (mistakeList) for (const entry of mistakeList) {
    if (!entry.deleted && (entry.wrongCount > 0 || entry.pendingOnly) && allSubjects.includes(entry.subject as StudySubject)) result[entry.subject as StudySubject].mistakes++;
  }
  for (const subject of subjects) {
    result[subject].quizAnswers = Object.values(backup.records[`yantu-stats-v1-${subject}` as BackupStorageKey] || {}).reduce((sum: number, day) => sum + ((day as { quiz?: number } | undefined)?.quiz || 0), 0);
  }
  const saved = backup.records[learningSessionKey];
  if (saved) {
    for (const key of Object.keys(saved.feynmanDrafts)) result[JSON.parse(key)[0] as StudySubject].drafts++;
    result["825"].drafts += Object.keys(saved.pastAnswers).length;
    for (const key of Object.keys(saved.plannerPrompts)) result[key as StudySubject].drafts++;
  }
  return result;
}

/** Validates everything and snapshots every affected key before the first write. */
export function applyStudyBackup(storage: BackupStorage, input: unknown, catalogs: BackupCatalogs): { keys: BackupStorageKey[]; summary: BackupSummary } {
  const backup = validateStudyBackup(input, catalogs), keys = BACKUP_STORAGE_KEYS.filter(key => has(backup.records, key));
  const previous = new Map(keys.map(key => [key, storage.getItem(key)]));
  const attempted: BackupStorageKey[] = [];
  try {
    for (const key of keys) {
      attempted.push(key);
      storage.setItem(key, JSON.stringify(backup.records[key]));
    }
  } catch {
    const failed: BackupStorageKey[] = [];
    for (const key of [...attempted].reverse()) {
      try {
        const raw = previous.get(key)!;
        if (raw === null) storage.removeItem(key); else storage.setItem(key, raw);
      } catch { failed.push(key); }
    }
    if (failed.length) fail("导入", `写入失败且回滚失败；请保留备份文件，受影响存储键：${failed.join("、")}`);
    fail("导入", "写入失败，已恢复原有记录");
  }
  return { keys, summary: summarizeStudyBackup(backup, catalogs) };
}

/** Text only: the PDF layer owns pagination, fonts and backup embedding. */
export function buildBackupDocument(input: StudyBackup, catalogs: BackupCatalogs): BackupDocument {
  const backup = validateStudyBackup(input, catalogs), blocks: BackupDocumentBlock[] = [];
  const add = (text: string, type: BackupDocumentBlock["type"] = "paragraph", style?: { color?: string; hl?: string }) => blocks.push(style ? { type, text, ...style } : { type, text });
  const describe = (subject: BackupSubject, bookId: string, chapters: number[], section?: string) => {
    const book = bookFor(catalogs, subject, bookId, "文档");
    return `《${book.name}》${chapters.map(chapter => `第 ${chapter} 章 ${book.chapters[chapter - 1].title}`).join("、")}${section ? ` / ${section}` : ""}`;
  };
  add(`导出时间：${backup.createdAt}`);
  const examTarget = backup.records[examTargetKey];
  if (examTarget) add(`目标初试日期：${examTarget.date}（手动设置）`);
  for (const subject of subjects) {
    add(subject === "politics" ? "政治" : `${subject} 学习记录`, "heading");
    const timings = backup.records[`yantu-card-timing-v1-${subject}` as "yantu-card-timing-v1-333"];
    if (timings && Object.keys(timings).length) {
      add(`闪卡背诵累计有效用时：${formatStudyTime(Object.values(timings).reduce((sum, row) => sum + row.elapsedMs, 0))}`, "heading");
      for (const row of Object.values(timings).sort((a, b) => a.startedAt.localeCompare(b.startedAt))) add(`卡片 ${row.cardId}：${row.label}\n开始：${row.startedAt}；用时：${formatStudyTime(row.elapsedMs)}；${row.kind === "new" ? "新卡学习" : row.kind === "learning" ? "短间隔回顾" : "到期复习"}；${row.status === "completed" ? "已完成背诵" : row.status === "undone" ? "评分已撤销" : "中途离开 / 尚未评分"}${row.grade ? `；评分：${row.grade}` : ""}`);
    }
    const progress = backup.records[srsKey(subject)];
    if (progress) {
      add(`每日新卡上限：${progress.dailyNewLimit}；配额日期：${progress.daily.date}；当天已接纳：${progress.daily.admitted.length} 张`);
      for (const [label, ranges] of [["复习范围", progress.scopes], ["新学范围", progress.newScopes]] as const) for (const range of ranges) add(`${label}：${describe(subject, range.bookId, range.chapters, range.section)}`);
      for (const [id, review] of Object.entries(progress.cards)) {
        const card = catalogs[subject].cards.find(card => card.id === id);
        add(`${card ? `${describe(subject, card.book, [card.chapter], card.section)}\n问题：${card.front}\n参考内容：${stripHighlightMarkers(card.back)}` : `卡片 ${id}（当前题库已移除，保留历史记录）`}\n下次复习：${review.dueAt}；阶段：${review.stage}；复习次数：${review.reps}；遗忘次数：${review.lapses}\n间隔天数：${review.intervalDays}；难度系数：${review.ease}\n首次学习：${review.firstStudiedAt}；上次复习：${review.lastReviewedAt}${card ? `\n来源：${card.source}` : ""}`);
      }
    }
    const doneRow = backup.records[doneKey(subject)];
    const doneMarks = doneRow && typeof doneRow === "object" && "marks" in doneRow ? (doneRow as { marks: Record<string, boolean> }).marks : doneRow as Record<string, boolean> | undefined;
    for (const [key, done] of Object.entries(doneMarks || {})) {
      const book = catalogs[subject].books.find(book => key.startsWith(`${book.id}-`))!;
      add(`${done ? "已完成" : "未完成"}：${describe(subject, book.id, [Number(key.slice(book.id.length + 1))])}`);
    }
  }
  const saved = backup.records[learningSessionKey];
  if (saved) {
    add("学习位置与草稿", "heading"); add(`当前科目：${saved.subject}`);
    for (const subject of allSubjects) {
      const loc = saved.locations[subject];
      add(`${subject} 位置：${subject === "english" ? "英语二" : describe(subject, loc.book, [loc.chapter], loc.section)}；页面：${loc.view}；真题模式：${loc.pastMode}；年份：${loc.pastYear}；索引：${loc.pastIndex}`);
    }
    for (const [key, value] of Object.entries(saved.feynmanDrafts)) {
      const [subject, book, chapter, section] = JSON.parse(key) as [BackupSubject, string, number, string];
      add(`费曼复述：${describe(subject, book, [chapter], section)}\n${value}`);
    }
    for (const [key, value] of Object.entries(saved.pastAnswers)) {
      const [, book, id] = JSON.parse(key) as [string, string, string];
      const question = catalogs["825"].questions!.find(question => question.id === id && question.book === book)!;
      add(`825 真题作答\n题目：${question.stem}\n我的作答：${value}\n参考答案：${question.referenceAnswer || "资料未提供"}\n解析：${question.analysis || "资料未提供"}\n来源：${question.source}${question.answerSource ? `\n答案来源：${question.answerSource}` : ""}`);
    }
    for (const [subject, value] of Object.entries(saved.plannerPrompts)) add(`${subject} 学习计划提示草稿\n${value}`);
  }
  const personal = backup.records[personalStorageKey];
  if (personal && (Object.keys(personal.overlays).length || personal.cards.length)) {
    add("个人编辑与补充", "heading");
    add("以下为个人修改、补充与新建卡；「原文」指教材内置内容，样式以颜色近似还原。");
    const TEXTBOOK_COLOR: Record<string, { color?: string; hl?: string }> = { hl_g: { color: "#0c8a4d" }, hl_b: { color: "#1a66c8" }, hl_r: { color: "#cf3b2e" }, hl_y: { hl: "#ffe98a" }, hl_s: {} };
    const styledBlocks = (label: string, content: RichContent) => {
      for (const segment of renderRichSegments(content.text, content.runs)) {
        if (!segment.text.trim()) continue;
        const textbook = segment.textbook ? TEXTBOOK_COLOR[`hl_${segment.textbook}`] || {} : {};
        add(`${label}：${segment.text}`, "paragraph", { ...(segment.color ? { color: segment.color } : {}), ...(segment.hl ? { hl: segment.hl } : {}), ...textbook });
      }
    };
    for (const subject of subjects) {
      const bookOf = (card: { book: string; chapter: number; section?: string }) => {
        const found = catalogs[subject].cards.find(item => item.id === card.book) || catalogs[subject].books.find(item => item.id === card.book);
        return found ? describe(subject, card.book, [card.chapter], card.section) : `书目 ${card.book} 第 ${card.chapter} 章`;
      };
      for (const [key, overlay] of Object.entries(personal.overlays).filter(([key]) => key.startsWith(`${subject}:`))) {
        const cardId = key.slice(subject.length + 1);
        const card = catalogs[subject].cards.find(item => item.id === cardId);
        add(`修改 · ${card ? `${describe(subject, card.book, [card.chapter], card.section)}\n原文问题：${card.front}\n原文答案：${stripHighlightMarkers(card.back)}` : `卡片 ${cardId}`}${overlay.hidden ? "（已隐藏）" : ""}`);
        if (overlay.q) styledBlocks("修改后问题", overlay.q);
        if (overlay.a) styledBlocks("修改后答案", overlay.a);
        if (overlay.note) styledBlocks("我的补充", overlay.note);
        if (overlay.bg) add(`整卡背景：${overlay.bg}`);
      }
      for (const card of personal.cards.filter(card => card.subject === subject)) {
        add(`个人卡 · ${bookOf(card)}${card.hidden ? "（已隐藏）" : ""}`);
        styledBlocks("问题", card.front);
        styledBlocks("答案", card.back);
        if (card.note) styledBlocks("补充", card.note);
        if (card.bg) add(`整卡背景：${card.bg}`);
      }
    }
  }
  for (const subject of ["333", "825"] as const) {
    const record = backup.records[mockKey(subject)];
    if (!record) continue;
    add(`${subject} AI 模拟卷`, "heading"); add("以下题目为 AI 生成的模拟练习，非历年真题；参考答案仅供练习。");
    for (const [book, chapters] of Object.entries(record.settings.selection)) if (chapters.length) add(`设置范围：${describe(subject, book, chapters, record.settings.sectionScope?.bookId === book ? record.settings.sectionScope.name : undefined)}`);
    add(`题型数量草稿：${JSON.stringify(record.settings.counts)}`);
    const session = record.session;
    if (!session) { add("当前没有已生成的模拟卷。"); continue; }
    add(`生成时间：${session.snapshot.createdAt}；范围：${session.snapshot.scopeLabel}；模式：${session.mode}；当前题目：${session.cursor + 1}`);
    for (const range of session.snapshot.ranges) add(`生成范围：${describe(subject, range.bookId, range.chapters || [], range.section)}`);
    add(`覆盖说明：${session.result.coverage.note}；完整覆盖：${session.result.coverage.complete ? "是" : "否"}`);
    session.result.questions.forEach((question, index) => {
      const response = session.responses[question.id];
      add(`${index + 1}. ${question.stem}\n${describe(subject, question.bookId, [question.chapterNo], question.section)}${question.points !== undefined ? `；分值：${question.points}` : ""}${question.groupLabel ? `；组别：${question.groupLabel}` : ""}`);
      if (question.type === "single-choice") {
        question.options.forEach((option, i) => add(`${"ABCD"[i]}. ${option}`));
        add(`我的作答：${response?.choice === undefined ? "未作答" : "ABCD"[response.choice]}\n参考答案：${"ABCD"[question.answer]}\n解析：${question.explanation}`);
      } else add(`我的作答：${response?.text || "未作答"}\n参考答案：${question.referenceAnswer}\n解析：${question.rationale}`);
      add(`已查看参考答案：${response?.revealed ? "是" : "否"}\n来源：${question.source}\n知识点：${question.knowledgePointIds.join("、")}`);
    });
  }
  return { title: "研途学习记录与模拟卷备份", blocks };
}
