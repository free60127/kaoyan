/** Transparent interval scheduling. All time and storage are supplied by the caller. */
export type CardIdentity = { id: string; book: string; chapter: number; section?: string };
export type StudyScope = { bookId: string; chapters: number[]; section?: string };
export type Rating = "again" | "hard" | "good" | "easy";
export type StudyTime = Date | string | number;
export type ReviewState = {
  dueAt: string;
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
  stage: "learning" | "review" | "relearning";
  firstStudiedAt: string;
  lastReviewedAt: string;
};
export type StudyProgress = {
  version: 1;
  cards: Record<string, ReviewState>;
  scopes: StudyScope[];
  dailyNewLimit: number;
  daily: { date: string; admitted: string[] };
};
export type SchedulePreview = ReviewState & { delayMinutes: number; delayDays: number };
export type StudyQueue = {
  items: { cardId: string; kind: "new" | "learning" | "review"; dueAt: string | null }[];
  counts: { reviewDue: number; learningDue: number; newAvailable: number; newToday: number };
  nextDueAt: string | null;
  remainingNewLimit: number;
};

const MINUTE = 60_000;
const MAX_INTERVAL = 36_500;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonnegativeInt = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;

function time(value: StudyTime): Date {
  const result = new Date(value instanceof Date ? value.getTime() : value);
  if (!Number.isFinite(result.getTime())) throw new RangeError("A valid explicit study time is required");
  return result;
}

/** Local calendar date, including for quota accounting around midnight. */
export function localStudyDate(now: StudyTime): string {
  const date = time(now);
  return `${date.getFullYear().toString().padStart(4, "0")}-${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")}`;
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!localMidnight(value.slice(0, 10))) return null;
  const [hour, minute, second] = value.slice(11, 19).split(":").map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function localMidnight(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(0, 0, 0, 0);
  if (result.getFullYear() !== year || result.getMonth() !== month - 1 || result.getDate() !== day) return null;
  return result.toISOString();
}

function limit(value: unknown): number {
  return nonnegativeInt(value) && value <= 200 ? value : 20;
}

export function createEmptyProgress(now: StudyTime, dailyNewLimit = 20): StudyProgress {
  return { version: 1, cards: {}, scopes: [], dailyNewLimit: limit(dailyNewLimit), daily: { date: localStudyDate(now), admitted: [] } };
}

function identities(catalog: readonly CardIdentity[]): CardIdentity[] {
  const seen = new Set<string>();
  return catalog.filter(card => {
    if (!card || typeof card.id !== "string" || !card.id || typeof card.book !== "string" || !card.book || !Number.isSafeInteger(card.chapter) || card.chapter < 1 || seen.has(card.id)) return false;
    seen.add(card.id);
    return true;
  });
}

export function normalizeStudyScopes(value: unknown, catalog: readonly CardIdentity[]): StudyScope[] {
  if (!Array.isArray(value)) return [];
  const cards = identities(catalog);
  const seen = new Set<string>();
  const scopes: StudyScope[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.bookId !== "string" || !Array.isArray(entry.chapters)) continue;
    if (entry.section !== undefined && (typeof entry.section !== "string" || !entry.section.trim())) continue;
    const section = typeof entry.section === "string" ? entry.section : undefined;
    const chapters = [...new Set(entry.chapters.filter((chapter): chapter is number =>
      nonnegativeInt(chapter) && cards.some(card => card.book === entry.bookId && card.chapter === chapter && (section === undefined || card.section === section))
    ))].sort((a, b) => a - b);
    if (!chapters.length) continue;
    const scope: StudyScope = { bookId: entry.bookId, chapters, ...(section === undefined ? {} : { section }) };
    const key = JSON.stringify(scope);
    if (!seen.has(key)) scopes.push(scope);
    seen.add(key);
  }
  return scopes;
}

function normalizedReview(value: unknown): ReviewState | null {
  if (!isRecord(value)) return null;
  const dueAt = timestamp(value.dueAt);
  const firstStudiedAt = timestamp(value.firstStudiedAt);
  const lastReviewedAt = timestamp(value.lastReviewedAt);
  if (!dueAt || !firstStudiedAt || !lastReviewedAt || !finite(value.intervalDays) || value.intervalDays < 0 || value.intervalDays > MAX_INTERVAL || !finite(value.ease) || value.ease < 1.3 || value.ease > 10 || !nonnegativeInt(value.reps) || !nonnegativeInt(value.lapses) || !["learning", "review", "relearning"].includes(String(value.stage))) return null;
  return { dueAt, firstStudiedAt, lastReviewedAt, intervalDays: value.intervalDays, ease: value.ease, reps: value.reps, lapses: value.lapses, stage: value.stage as ReviewState["stage"] };
}

/** Retains valid unknown IDs for history; queue construction uses only the current catalog. */
export function migrateLegacyReviews(legacy: unknown, _catalog: readonly CardIdentity[], now: StudyTime): Record<string, ReviewState> {
  if (!isRecord(legacy)) return {};
  const instant = time(now).toISOString();
  // Legacy has no admission date. Mark it as historical so migration never consumes today's new quota.
  const historical = new Date(time(now).getTime());
  historical.setDate(historical.getDate() - 1);
  const firstStudiedAt = historical.toISOString();
  const entries: [string, ReviewState][] = [];
  for (const [id, value] of Object.entries(legacy)) {
    if (!id || !isRecord(value) || !(own(value, "due") || own(value, "interval") || own(value, "reps"))) continue;
    entries.push([id, {
      dueAt: localMidnight(value.due) ?? instant,
      intervalDays: finite(value.interval) && value.interval >= 0 ? Math.min(MAX_INTERVAL, value.interval) : 0,
      ease: finite(value.ease) && value.ease >= 1.3 ? Math.min(10, value.ease) : 2.5,
      reps: nonnegativeInt(value.reps) ? value.reps : 0,
      lapses: 0,
      stage: "review",
      firstStudiedAt,
      lastReviewedAt: firstStudiedAt,
    }]);
  }
  return Object.fromEntries(entries);
}

function admittedToday(progress: StudyProgress, now: StudyTime): string[] {
  const date = localStudyDate(now);
  const ids = new Set(progress.daily.date === date ? progress.daily.admitted : []);
  for (const [id, review] of Object.entries(progress.cards)) {
    const valid = normalizedReview(review);
    if (valid && localStudyDate(valid.firstStudiedAt) === date) ids.add(id);
  }
  return [...ids];
}

/** Accepts parsed storage or its raw JSON string. Does not read, write, or remove storage. */
export function normalizeStoredProgress(stored: unknown, catalog: readonly CardIdentity[], now: StudyTime, legacy?: unknown): StudyProgress {
  const parse = (value: unknown): unknown => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return null; }
  };
  const raw = parse(stored);
  const fresh = createEmptyProgress(now);
  if (isRecord(raw) && raw.version === 1) {
    fresh.cards = isRecord(raw.cards) ? Object.fromEntries(Object.entries(raw.cards).flatMap(([id, value]) => {
      const review = normalizedReview(value);
      return id && review ? [[id, review]] : [];
    })) : {};
    fresh.scopes = normalizeStudyScopes(raw.scopes, catalog);
    fresh.dailyNewLimit = limit(raw.dailyNewLimit);
    if (isRecord(raw.daily) && raw.daily.date === fresh.daily.date && Array.isArray(raw.daily.admitted)) {
      const known = new Set(identities(catalog).map(card => card.id));
      fresh.daily.admitted = [...new Set(raw.daily.admitted.filter((id): id is string => typeof id === "string" && known.has(id) && own(fresh.cards, id)))];
    }
  } else {
    fresh.cards = migrateLegacyReviews(parse(legacy === undefined ? raw : legacy), catalog, now);
    fresh.scopes = normalizeStudyScopes(identities(catalog).filter(card => own(fresh.cards, card.id)).map(card => ({ bookId: card.book, chapters: [card.chapter] })), catalog);
  }
  fresh.daily.admitted = admittedToday(fresh, now);
  return fresh;
}

function matches(card: CardIdentity, scopes: readonly StudyScope[]): boolean {
  return scopes.some(scope => scope.bookId === card.book && scope.chapters.includes(card.chapter) && (scope.section === undefined || scope.section === card.section));
}

export function buildStudyQueue(catalog: readonly CardIdentity[], progress: StudyProgress, now: StudyTime, filter?: StudyScope | StudyScope[]): StudyQueue {
  const instant = time(now).getTime();
  const cards = identities(catalog);
  const scopes = normalizeStudyScopes(progress.scopes, cards);
  const filters = filter === undefined ? null : normalizeStudyScopes(Array.isArray(filter) ? filter : [filter], cards);
  const selected = cards.filter(card => matches(card, scopes) && (filters === null || matches(card, filters)));
  const due: StudyQueue["items"] = [];
  const unseen: StudyQueue["items"] = [];
  let nextDueAt: string | null = null;
  for (const card of selected) {
    const review = own(progress.cards, card.id) ? normalizedReview(progress.cards[card.id]) : null;
    if (!review) {
      unseen.push({ cardId: card.id, kind: "new", dueAt: null });
    } else if (Date.parse(review.dueAt) <= instant) {
      due.push({ cardId: card.id, kind: review.stage === "review" ? "review" : "learning", dueAt: review.dueAt });
    } else if (nextDueAt === null || Date.parse(review.dueAt) < Date.parse(nextDueAt)) {
      nextDueAt = review.dueAt;
    }
  }
  due.sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  const remainingNewLimit = Math.max(0, limit(progress.dailyNewLimit) - admittedToday(progress, now).length);
  const newItems = unseen.slice(0, remainingNewLimit);
  return {
    items: [...due, ...newItems],
    counts: { reviewDue: due.length, learningDue: due.filter(item => item.kind === "learning").length, newAvailable: unseen.length, newToday: newItems.length },
    nextDueAt,
    remainingNewLimit,
  };
}

export function previewSchedule(previous: ReviewState | undefined, grade: Rating, now: StudyTime): SchedulePreview {
  if (!["again", "hard", "good", "easy"].includes(grade)) throw new RangeError("Unknown study rating");
  const instant = time(now);
  const old = normalizedReview(previous);
  const shortLearning = !old || old.stage !== "review";
  let delayMinutes: number;
  let ease = old?.ease ?? 2.5;
  let reps = old?.reps ?? 0;
  let lapses = old?.lapses ?? 0;
  let stage: ReviewState["stage"];
  if (shortLearning) {
    delayMinutes = grade === "again" ? 1 : grade === "hard" ? 5 : grade === "easy" ? 4 * 1440 : 1440;
    stage = grade === "again" || grade === "hard" ? (old?.stage === "relearning" ? "relearning" : "learning") : "review";
    if (grade === "good" || grade === "easy") reps += 1;
    if (grade === "easy") ease = Math.min(10, ease + 0.15);
  } else if (grade === "again") {
    delayMinutes = 1;
    stage = "relearning";
    lapses += 1;
    ease = Math.max(1.3, ease - 0.2);
  } else {
    const interval = grade === "hard" ? Math.max(1, old.intervalDays * 1.2)
      : grade === "easy" ? Math.max(4, old.intervalDays * ease * 1.3)
      : old.reps === 0 ? 1 : old.reps === 1 ? 3 : Math.max(1, old.intervalDays * ease);
    delayMinutes = Math.min(MAX_INTERVAL, interval) * 1440;
    stage = "review";
    reps += 1;
    if (grade === "hard") ease = Math.max(1.3, ease - 0.15);
    if (grade === "easy") ease = Math.min(10, ease + 0.15);
  }
  const delayDays = delayMinutes / 1440;
  return {
    dueAt: new Date(instant.getTime() + delayMinutes * MINUTE).toISOString(),
    intervalDays: delayDays,
    ease, reps, lapses, stage,
    firstStudiedAt: old?.firstStudiedAt ?? instant.toISOString(),
    lastReviewedAt: instant.toISOString(),
    delayMinutes, delayDays,
  };
}

/** Immutable update. A first rating admits the card; subsequent ratings preserve its history. */
export function applyRating(progress: StudyProgress, cardId: string, grade: Rating, now: StudyTime): StudyProgress {
  if (typeof cardId !== "string" || !cardId) throw new RangeError("A card ID is required");
  const old = own(progress.cards, cardId) ? progress.cards[cardId] : undefined;
  const { delayMinutes: _minutes, delayDays: _days, ...review } = previewSchedule(old, grade, now);
  const next: StudyProgress = {
    ...progress,
    cards: { ...progress.cards, [cardId]: review },
    daily: { date: localStudyDate(now), admitted: admittedToday(progress, now) },
  };
  next.daily.admitted = admittedToday(next, now);
  return next;
}
