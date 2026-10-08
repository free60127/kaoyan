import { viewAvailable } from "./subject-capabilities";
export type StudySubject = "333" | "825" | "politics" | "english";
export type StudyView = "overview" | "chapters" | "cards" | "quiz" | "choice" | "essay" | "mock" | "feynman" | "planner" | "mistakes" | "stats" | "search";
export type LearningLocation = {
  book: string; chapter: number; section: string; view: StudyView;
  pastMode: "practice" | "index"; pastYear: number; pastIndex: number;
};
export type LearningSession = {
  version: 1; subject: StudySubject; locations: Record<StudySubject, LearningLocation>;
  feynmanDrafts: Record<string, string>; plannerPrompts: Partial<Record<StudySubject, string>>; pastAnswers: Record<string, string>;
};
export type BookIds = Partial<Record<StudySubject, string[]>>;
export const learningSessionKey = "yantu-learning-session-v1";
export const defaultPlannerPrompt = "请结合当前科目的书目和进度，为我安排今天可执行的学习计划，包含主动回忆、练习和复盘。";
const subjects: StudySubject[] = ["333", "825", "politics", "english"];
const views: StudyView[] = ["overview", "chapters", "cards", "quiz", "choice", "essay", "mock", "feynman", "planner", "mistakes", "stats", "search"];
/** 页面可用性: 委托给科目能力表(静态导入; capabilities 只引类型与图标, 无循环)。 */
export const isRestorableView = (subject: StudySubject, view: unknown): view is StudyView => {
  if (!views.includes(view as StudyView)) return false;
  return viewAvailable(subject, view as StudyView);
};
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 200_000;
const integer = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export const isStudySubject = (value: unknown): value is StudySubject => subjects.includes(value as StudySubject);
export function defaultLocation(subject: StudySubject, ids: BookIds): LearningLocation {
  return { book: ids[subject]?.[0] || "", chapter: 1, section: "", view: "overview", pastMode: "practice", pastYear: 2026, pastIndex: 0 };
}
function readLocation(value: unknown, subject: StudySubject, ids: BookIds): LearningLocation {
  const base = defaultLocation(subject, ids);
  if (!record(value)) return base;
  const validBook = typeof value.book === "string" && (ids[subject]?.includes(value.book) || (subject === "english" && value.book === ""));
  return {
    ...base, book: validBook ? value.book as string : base.book,
    chapter: validBook && integer(value.chapter, 1, 10_000) ? value.chapter as number : 1,
    section: validBook && text(value.section) ? value.section : "",
    view: views.includes(value.view as StudyView) && !(subject === "politics" && (value.view === "quiz" || value.view === "mock")) ? value.view as StudyView : "overview",
    pastMode: value.pastMode === "index" ? "index" : "practice",
    pastYear: integer(value.pastYear, 1900, 2200) ? value.pastYear as number : base.pastYear,
    pastIndex: integer(value.pastIndex, 0, 100_000) ? value.pastIndex as number : 0,
  };
}
export function createLearningSession(ids: BookIds): LearningSession {
  return { version: 1, subject: "333", locations: Object.fromEntries(subjects.map(subject => [subject, defaultLocation(subject, ids)])) as LearningSession["locations"], feynmanDrafts: {}, plannerPrompts: {}, pastAnswers: {} };
}
export const feynmanDraftKey = (subject: StudySubject, location: Pick<LearningLocation, "book" | "chapter" | "section">) => JSON.stringify([subject, location.book, location.chapter, location.section]);
export const pastAnswerKey = (book: string, questionId: string) => JSON.stringify(["825", book, questionId]);
function readDrafts(value: unknown, ids: BookIds, kind: "feynman" | "past") {
  if (!record(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, value]) => {
    if (!text(value)) return false;
    try {
      const parts: unknown = JSON.parse(key);
      if (!Array.isArray(parts) || !isStudySubject(parts[0]) || typeof parts[1] !== "string" || !ids[parts[0]]?.includes(parts[1])) return false;
      return kind === "feynman" ? parts.length === 4 && integer(parts[2], 1, 10_000) && text(parts[3]) : parts.length === 3 && parts[0] === "825" && text(parts[2]) && !!parts[2];
    } catch { return false; }
  })) as Record<string, string>;
}
export function restoreLearningSession(raw: string | null, ids: BookIds, legacyRaw: string | null = null): LearningSession {
  const result = createLearningSession(ids);
  try {
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (record(saved) && saved.version === 1) {
      if (isStudySubject(saved.subject)) result.subject = saved.subject;
      for (const subject of subjects) result.locations[subject] = readLocation(record(saved.locations) ? saved.locations[subject] : null, subject, ids);
      result.feynmanDrafts = readDrafts(saved.feynmanDrafts, ids, "feynman");
      result.pastAnswers = readDrafts(saved.pastAnswers, ids, "past");
      if (record(saved.plannerPrompts)) for (const subject of subjects) if (text(saved.plannerPrompts[subject])) result.plannerPrompts[subject] = saved.plannerPrompts[subject];
      return result;
    }
  } catch { /* Recover a usable default or the earlier location format. */ }
  try {
    const saved: unknown = legacyRaw ? JSON.parse(legacyRaw) : null;
    if (record(saved) && isStudySubject(saved.subject)) { result.subject = saved.subject; result.locations[saved.subject] = readLocation(saved, saved.subject, ids); }
  } catch { /* Corrupt storage cannot prevent studying. */ }
  return result;
}
/** Call only once a lazy catalog is available, so a pending location is not erased. */
export function validateLocation(location: LearningLocation, books: { id: string; chapters: { sections: string[] }[] }[]): LearningLocation {
  if (!books.length) return location;
  const book = books.find(item => item.id === location.book) || books[0];
  const chapter = book.id === location.book && location.chapter <= book.chapters.length ? location.chapter : 1;
  const section = book.id === location.book && chapter === location.chapter && book.chapters[chapter - 1]?.sections.includes(location.section) ? location.section : "";
  return book.id === location.book && chapter === location.chapter && section === location.section ? location : { ...location, book: book.id, chapter, section };
}

function sessionPaths(session: LearningSession): Map<string, string> {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(session.feynmanDrafts)) map.set("fd:" + key, value);
  for (const [key, value] of Object.entries(session.pastAnswers)) map.set("pa:" + key, value);
  for (const [key, value] of Object.entries(session.plannerPrompts)) map.set("pp:" + key, value);
  return map;
}
export function changedSessionPaths(before: LearningSession | null, after: LearningSession): Set<string> {
  if (!before) return new Set(sessionPaths(after).keys());
  const beforePaths = sessionPaths(before), afterPaths = sessionPaths(after), dirty = new Set<string>();
  for (const [path, value] of afterPaths) if (beforePaths.get(path) !== value) dirty.add(path);
  for (const path of beforePaths.keys()) if (!afterPaths.has(path)) dirty.add(path);
  return dirty;
}
/** Shared drafts merge, but navigation belongs to each open tab. */
export function mergeLearningSession(local: LearningSession, remote: LearningSession, dirty: Set<string>): LearningSession {
  const merged: LearningSession = { ...JSON.parse(JSON.stringify(remote)), subject: local.subject, locations: local.locations };
  for (const [path, value] of sessionPaths(local)) {
    if (!dirty.has(path)) continue;
    if (path.startsWith("fd:")) merged.feynmanDrafts[path.slice(3)] = value;
    else if (path.startsWith("pa:")) merged.pastAnswers[path.slice(3)] = value;
    else if (path.startsWith("pp:")) merged.plannerPrompts[path.slice(3) as StudySubject] = value;
  }
  return merged;
}
