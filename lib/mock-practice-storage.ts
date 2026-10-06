import { MAX_MOCK_QUIZ_QUESTIONS, MOCK_QUIZ_TYPES, type MockQuizQuestion, type MockQuizUnit } from "./mock-quiz";
import { snapshotMockSettings, type MockCounts, type MockPracticeBook, type MockResponse, type MockSession } from "./mock-practice-state";
import type { MockPaperTemplateId } from "./mock-paper-templates";
import { canonicalStudySection } from "./study-section-alias";

export const MAX_MOCK_RECORD_CHARS = 1_000_000; // At most 2 MB in UTF-16 local storage.
export type MockSettings = { counts: MockCounts; selection: Record<string, number[]>; sectionScope?: { bookId: string; chapter: number; name: string }; templateId?: MockPaperTemplateId };
export type MockSavedRecord = { version: 1; subject: "333" | "825"; settings: MockSettings; session: MockSession | null };
type StorageAccess = Pick<Storage, "getItem" | "setItem">;
export type MockStorageRead = { status: "empty" } | { status: "loaded"; record: MockSavedRecord } | { status: "error"; message: string };
export const mockStorageKey = (subject: "333" | "825") => `kaoyan.mock-practice.v1.${subject}`;
const invalid = () => { throw new Error("保存的模拟卷格式无效。"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 20000, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim())) return invalid();
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) return invalid();
  return value;
}
function list<T>(value: unknown, max: number, parse: (value: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value.map(parse);
}
function template(value: unknown, subject: "333" | "825"): MockPaperTemplateId | undefined {
  if (value === undefined) return undefined;
  if (value !== `${subject}-2026`) return invalid();
  return value as MockPaperTemplateId;
}

/** Rebuild only known fields; credentials and arbitrary extra properties never enter storage. */
export function validateMockSavedRecord(value: unknown, subject: "333" | "825", books: MockPracticeBook[]): MockSavedRecord {
  const row = object(value);
  if ((subject !== "333" && subject !== "825") || row.version !== 1 || row.subject !== subject) return invalid();
  const findBook = (id: unknown) => books.find((book) => book.id === id) || invalid();
  const parseChapter = (bookId: string, value: unknown) => integer(value, 1, findBook(bookId).chapters.length);
  const parseSection = (bookId: string, chapter: number, value: unknown) => {
    const rawSection = text(value, 500);
    const section = subject === "333" ? canonicalStudySection(bookId, chapter, rawSection) : rawSection;
    if (!findBook(bookId).chapters[chapter - 1].sections.includes(section)) return invalid();
    return section;
  };
  const parseRanges = (value: unknown) => {
    const ranges = list(value, books.length, (value) => {
      const range = object(value), bookId = findBook(range.bookId).id;
      const chapters = list(range.chapters, findBook(bookId).chapters.length, (value) => parseChapter(bookId, value));
      if (!chapters.length || new Set(chapters).size !== chapters.length) return invalid();
      const section = range.section === undefined ? undefined : parseSection(bookId, chapters[0], range.section);
      if (section && chapters.length !== 1) return invalid();
      return { bookId, chapters, ...(section ? { section } : {}) };
    });
    if (!ranges.length || new Set(ranges.map((range) => range.bookId)).size !== ranges.length) return invalid();
    return ranges;
  };
  const rawSettings = object(row.settings), rawCounts = object(rawSettings.counts);
  // Keep bounded form drafts (including a blank or decimal); generation validates counts.
  const counts = Object.fromEntries(MOCK_QUIZ_TYPES.map((type) => [type, text(rawCounts[type], 32, true)])) as MockCounts;
  const selection = Object.fromEntries(Object.entries(object(rawSettings.selection)).map(([id, value]) => {
    const book = findBook(id), chapters = list(value, book.chapters.length, (value) => parseChapter(id, value));
    if (new Set(chapters).size !== chapters.length) return invalid();
    return [id, chapters];
  }));
  let sectionScope: MockSettings["sectionScope"];
  if (rawSettings.sectionScope !== undefined) {
    const section = object(rawSettings.sectionScope), bookId = findBook(section.bookId).id, chapter = parseChapter(bookId, section.chapter);
    if (selection[bookId]?.length !== 1 || selection[bookId][0] !== chapter) return invalid();
    sectionScope = { bookId, chapter, name: parseSection(bookId, chapter, section.name) };
  }
  const settings: MockSettings = { counts, selection, ...(sectionScope ? { sectionScope } : {}), ...(rawSettings.templateId !== undefined ? { templateId: template(rawSettings.templateId, subject) } : {}) };
  if (row.session === null) return { version: 1, subject, settings, session: null };
  const rawSession = object(row.session), rawSnapshot = object(rawSession.snapshot);
  if (rawSnapshot.subject !== subject) return invalid();
  const ranges = parseRanges(rawSnapshot.ranges), config = object(rawSnapshot.config);
  // snapshotMockSettings validates all five counts and applicable book-filtered templates.
  if (Object.keys(config).some((key) => !MOCK_QUIZ_TYPES.includes(key as typeof MOCK_QUIZ_TYPES[number]))) return invalid();
  const snapshot = snapshotMockSettings(subject, Object.fromEntries(MOCK_QUIZ_TYPES.map((type) => [type, String(integer(config[type], 0, MAX_MOCK_QUIZ_QUESTIONS))])) as MockCounts, ranges, text(rawSnapshot.scopeLabel, 10000), template(rawSnapshot.templateId, subject));
  snapshot.createdAt = text(rawSnapshot.createdAt, 200);
  const parseUnit = (value: unknown): MockQuizUnit => {
    const unit = object(value), book = findBook(unit.bookId), chapterNo = parseChapter(book.id, unit.chapterNo);
    if (unit.bookName !== book.name || unit.chapterName !== book.chapters[chapterNo - 1].title) return invalid();
    const range = ranges.find((range) => range.bookId === book.id && range.chapters.includes(chapterNo));
    const section = unit.section === undefined ? undefined : parseSection(book.id, chapterNo, unit.section);
    if (!range || range.section !== section) return invalid();
    return { bookId: book.id, chapterNo, bookName: book.name, chapterName: book.chapters[chapterNo - 1].title, ...(section !== undefined ? { section } : {}) };
  };
  const rawResult = object(rawSession.result);
  const questions = list(rawResult.questions, MAX_MOCK_QUIZ_QUESTIONS, (value): MockQuizQuestion => {
    const question = object(value), type = question.type;
    if (!MOCK_QUIZ_TYPES.includes(type as typeof MOCK_QUIZ_TYPES[number])) return invalid();
    const knowledgePointIds = list(question.knowledgePointIds, 100, (value) => text(value, 200));
    if (!knowledgePointIds.length) return invalid();
    const base = { ...parseUnit(question), id: text(question.id, 200), stem: text(question.stem), source: text(question.source, 1000), knowledgePointIds,
      ...(question.points !== undefined ? { points: integer(question.points, 0, 150) } : {}), ...(question.groupLabel !== undefined ? { groupLabel: text(question.groupLabel, 500) } : {}) };
    if (["__proto__", "constructor", "prototype"].includes(base.id)) return invalid();
    if (type === "single-choice") {
      const options = list(question.options, 4, (value) => text(value, 10000));
      if (options.length !== 4) return invalid();
      return { ...base, type, options: options as [string, string, string, string], answer: integer(question.answer, 0, 3), explanation: text(question.explanation) };
    }
    return { ...base, type: type as "definition" | "short-answer" | "essay" | "material-analysis", referenceAnswer: text(question.referenceAnswer), rationale: text(question.rationale) };
  });
  if (!questions.length || new Set(questions.map((question) => question.id)).size !== questions.length || MOCK_QUIZ_TYPES.some((type) => questions.filter((question) => question.type === type).length !== snapshot.config[type])) return invalid();
  const rawCoverage = object(rawResult.coverage), maxUnits = books.reduce((sum, book) => sum + book.chapters.length, 0);
  const unitKey = (unit: MockQuizUnit) => `${unit.bookId}:${unit.chapterNo}:${unit.section || ""}`;
  const requestedUnits = list(rawCoverage.requestedUnits, maxUnits, parseUnit), coveredUnits = list(rawCoverage.coveredUnits, maxUnits, parseUnit), uncoveredUnits = list(rawCoverage.uncoveredUnits, maxUnits, parseUnit);
  const expected = new Set(ranges.flatMap((range) => range.chapters.map((chapter) => `${range.bookId}:${chapter}:${range.section || ""}`)));
  const requested = new Set(requestedUnits.map(unitKey)), covered = new Set(questions.map(unitKey)), partition = [...coveredUnits, ...uncoveredUnits].map(unitKey);
  if (requested.size !== requestedUnits.length || requested.size !== expected.size || [...requested].some((key) => !expected.has(key)) || new Set(partition).size !== partition.length || partition.length !== requested.size || coveredUnits.some((unit) => !covered.has(unitKey(unit))) || coveredUnits.length !== covered.size || uncoveredUnits.some((unit) => covered.has(unitKey(unit))) || rawCoverage.complete !== (uncoveredUnits.length === 0)) return invalid();
  if (rawSession.mode !== "practice" && rawSession.mode !== "paper") return invalid();
  const responses = Object.fromEntries(Object.entries(object(rawSession.responses)).map(([id, value]) => {
    const question = questions.find((question) => question.id === id), response = object(value);
    if (!question || (response.choice !== undefined && question.type !== "single-choice") || (response.text !== undefined && question.type === "single-choice") || (response.revealed !== undefined && typeof response.revealed !== "boolean")) return invalid();
    const clean: MockResponse = { ...(response.choice !== undefined ? { choice: integer(response.choice, 0, 3) } : {}), ...(response.text !== undefined ? { text: text(response.text, 20000, true) } : {}), ...(response.revealed !== undefined ? { revealed: response.revealed as boolean } : {}) };
    return [id, clean];
  }));
  return { version: 1, subject, settings, session: { snapshot, result: { questions, coverage: { requestedUnits, coveredUnits, uncoveredUnits, complete: rawCoverage.complete as boolean, note: text(rawCoverage.note, 10000) } }, cursor: integer(rawSession.cursor, 0, questions.length - 1), mode: rawSession.mode, responses } };
}

export function readMockPractice(storage: StorageAccess, subject: "333" | "825", books: MockPracticeBook[]): MockStorageRead {
  let raw;
  try { raw = storage.getItem(mockStorageKey(subject)); } catch { return { status: "error", message: "无法读取本地模拟卷；当前页面可继续使用，刷新后可能无法恢复。" }; }
  if (raw === null) return { status: "empty" };
  try {
    if (raw.length > MAX_MOCK_RECORD_CHARS) return invalid();
    return { status: "loaded", record: validateMockSavedRecord(JSON.parse(raw), subject, books) };
  } catch { return { status: "error", message: "本地模拟卷记录损坏、版本不兼容或范围已变更，未能恢复。修改设置或生成新卷后将重新保存。" }; }
}
export function writeMockPractice(storage: StorageAccess, record: MockSavedRecord, books: MockPracticeBook[]): { ok: true } | { ok: false; message: string } {
  try {
    const raw = JSON.stringify(validateMockSavedRecord(record, record.subject, books));
    if (raw.length > MAX_MOCK_RECORD_CHARS) return { ok: false, message: "模拟卷与作答超过本地保存大小上限，尚未保存；请保留当前页面。" };
    storage.setItem(mockStorageKey(record.subject), raw);
    return { ok: true };
  } catch { return { ok: false, message: "本地保存失败（空间不足、存储不可用或数据格式无效）；当前卷与作答尚未保存，请保留当前页面。" }; }
}
