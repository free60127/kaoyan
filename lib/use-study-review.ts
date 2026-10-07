import { useEffect, useMemo, useRef, useState } from "react";
import { applyRating, buildStudyQueue, createEmptyProgress, newCardsStudiedToday, normalizeStoredProgress, normalizeStudyScopes, previewSchedule, undoRating, type CardIdentity, type Rating, type RatingUndo, type ReviewState, type StudyProgress, type StudyScope, type StudyTime } from "./study-scheduler";
import { cardMatchesStudyScope } from "./study-review-view";

export type StudyReviewSession = { progress: StudyProgress; newScopes: StudyScope[] };
export type StudySubject = "333" | "825" | "politics";
export const studyReviewKey = (subject: StudySubject) => `yantu-srs-v1-${subject}`;
const legacyKey = (subject: StudySubject) => subject === "825" ? "yantu-reviews-825" : subject === "politics" ? "yantu-reviews-politics" : "yantu-reviews";

function parse(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** New learning selection is distinct from ongoing review enrollment. */
export function restoreStudyReview(stored: unknown, catalog: readonly CardIdentity[], now: StudyTime, legacy?: unknown): StudyReviewSession {
  const progress = normalizeStoredProgress(stored, catalog, now, legacy);
  const raw = parse(stored);
  const newScopes = normalizeStudyScopes(raw && typeof raw === "object" && "newScopes" in raw ? raw.newScopes : [], catalog);
  return { progress, newScopes };
}

export function serializeStudyReview(session: StudyReviewSession): string {
  return JSON.stringify({ ...session.progress, newScopes: session.newScopes });
}

function mergeScopes(scopes: StudyScope[], catalog: readonly CardIdentity[]): StudyScope[] {
  const expanded = normalizeStudyScopes(scopes, catalog).flatMap(scope => scope.chapters.map(chapter => ({ ...scope, chapters: [chapter] })));
  return normalizeStudyScopes(expanded.filter(scope => scope.section === undefined || !expanded.some(other => other.bookId === scope.bookId && other.chapters[0] === scope.chapters[0] && other.section === undefined)), catalog);
}

export function selectNewStudyScopes(session: StudyReviewSession, scopes: StudyScope[], catalog: readonly CardIdentity[]): StudyReviewSession {
  const newScopes = mergeScopes(scopes, catalog);
  return { progress: { ...session.progress, scopes: mergeScopes([...session.progress.scopes, ...newScopes], catalog) }, newScopes };
}

export function pauseStudyScope(session: StudyReviewSession, paused: StudyScope): StudyReviewSession {
  const remove = (scopes: StudyScope[]) => scopes.flatMap(scope => {
    if (scope.bookId !== paused.bookId || (paused.section !== undefined && scope.section !== paused.section)) return [scope];
    const chapters = scope.chapters.filter(chapter => !paused.chapters.includes(chapter));
    return chapters.length ? [{ ...scope, chapters }] : [];
  });
  return { progress: { ...session.progress, scopes: remove(session.progress.scopes) }, newScopes: remove(session.newScopes) };
}

export function buildReviewSession(catalog: readonly CardIdentity[], session: StudyReviewSession, now: StudyTime, scope?: StudyScope) {
  const locationCatalog = scope ? catalog.filter(card => cardMatchesStudyScope(card, scope)) : catalog;
  const ongoing = buildStudyQueue(locationCatalog, session.progress, now);
  const selected = buildStudyQueue(locationCatalog, session.progress, now, session.newScopes);
  return { ...ongoing, items: [...ongoing.items.filter(item => item.kind !== "new"), ...selected.items.filter(item => item.kind === "new")], counts: { ...ongoing.counts, newAvailable: selected.counts.newAvailable, newToday: selected.counts.newToday } };
}

/** Validate against the same scope queue at rating time; admission remains shared across all locations. */
export function rateStudyReviewCard(session: StudyReviewSession, catalog: readonly CardIdentity[], cardId: string, grade: Rating, now: StudyTime, scope?: StudyScope): StudyReviewSession | null {
  if (!buildReviewSession(catalog, session, now, scope).items.some(item => item.cardId === cardId)) return null;
  return { ...session, progress: applyRating(session.progress, cardId, grade, now) };
}

type SessionMutation = (session: StudyReviewSession) => StudyReviewSession | null;
type ReviewStorage = Pick<Storage, "getItem" | "setItem">;
const READ_ERROR = "浏览器未能读取学习记录。当前页面的进度已保留；请允许本地存储。";
const WRITE_ERROR = "浏览器未能保存学习记录。当前页面可继续使用；请允许本地存储后再离开或刷新。";

/** Synchronous read/apply/write protects sequential tabs; localStorage has no atomic CAS for simultaneous writes. */
export function createStudyReviewSync(subject: StudySubject, catalog: readonly CardIdentity[], storage: ReviewStorage, clock: () => StudyTime, changed: (session: StudyReviewSession, error: string) => void = () => {}) {
  let session: StudyReviewSession = { progress: createEmptyProgress(clock()), newScopes: [] };
  let error = "";
  let loaded = false;
  let pending: SessionMutation[] = [];
  let lastUndo: RatingUndo | null = null;
  const key = studyReviewKey(subject);
  function publish(next: StudyReviewSession, nextError: string) {
    const differs = serializeStudyReview(next) !== serializeStudyReview(session) || nextError !== error;
    session = next; error = nextError;
    if (differs) changed(session, error);
  }
  function read() {
    const stored = storage.getItem(key);
    if (stored !== null) {
      const raw = parse(stored);
      // Never turn a malformed shared snapshot into an empty replacement for live progress.
      if (!raw || typeof raw !== "object" || Array.isArray(raw) || !("version" in raw) || raw.version !== 1 || !("cards" in raw) || !raw.cards || typeof raw.cards !== "object" || Array.isArray(raw.cards) || !("scopes" in raw) || !Array.isArray(raw.scopes)) throw new Error(READ_ERROR);
    }
    const restored = restoreStudyReview(stored, catalog, clock(), stored === null ? storage.getItem(legacyKey(subject)) : undefined);
    loaded = true;
    return restored;
  }
  try { session = read(); } catch { error = READ_ERROR; }

  function refresh() {
    // Failed local writes must not be replaced by an older persistent snapshot on focus/events.
    if (pending.length) return;
    try { publish(read(), ""); } catch { publish(session, READ_ERROR); }
  }
  function mutate(operation: SessionMutation): StudyReviewSession | null {
    let latest = session;
    let readable = true;
    try {
      latest = read();
      for (const retry of pending) latest = retry(latest) ?? latest;
    } catch { readable = false; }
    const next = operation(latest);
    if (!next) { publish(latest, readable ? (pending.length ? error : "") : READ_ERROR); return null; }
    pending.push(operation);
    if (readable) {
      try {
        storage.setItem(key, serializeStudyReview(next));
        pending = []; publish(next, "");
      } catch { publish(next, WRITE_ERROR); }
    } else publish(next, READ_ERROR);
    return next;
  }
  const expanded = (scopes: StudyScope[]) => normalizeStudyScopes(scopes, catalog).flatMap(scope => scope.chapters.map(chapter => ({ ...scope, chapters: [chapter] })));
  const scopeKey = (scope: StudyScope) => JSON.stringify(scope);
  return {
    get session() { return session; },
    get catalog() { return catalog; },
    get ready() { return loaded; },
    get lastUndo() { return lastUndo; },
    get storageError() { return error; },
    get hasPendingWrites() { return pending.length > 0; },
    refresh,
    updateCatalog(nextCatalog: readonly CardIdentity[]) { catalog = nextCatalog; refresh(); },
    storageChanged(event: { key: string | null }) { if (event.key === key || event.key === null) refresh(); },
    selectScopes(scopes: StudyScope[]) {
      // UI selections are based on the visible snapshot: apply only its additions/removals to the latest tab state.
      const before = expanded(session.newScopes), desired = expanded(scopes);
      const removed = new Set(before.filter(scope => !desired.some(item => scopeKey(item) === scopeKey(scope))).map(scopeKey));
      const added = desired.filter(scope => !before.some(item => scopeKey(item) === scopeKey(scope)));
      return mutate(latest => selectNewStudyScopes(latest, [...expanded(latest.newScopes).filter(scope => !removed.has(scopeKey(scope))), ...added], catalog));
    },
    pauseScope(scope: StudyScope) { return mutate(latest => pauseStudyScope(latest, scope)); },
    setDailyNewLimit(value: number) {
      if (!Number.isInteger(value) || value < 0 || value > 200) return null;
      return mutate(latest => ({ ...latest, progress: { ...latest.progress, dailyNewLimit: value } }));
    },
    rateCard(cardId: string, grade: Rating, scope?: StudyScope) {
      const instant = clock();
      return mutate(latest => {
        const next = rateStudyReviewCard(latest, catalog, cardId, grade, instant, scope);
        if (next) lastUndo = { cardId, previous: latest.progress.cards[cardId] ? { ...latest.progress.cards[cardId] } : null, daily: { ...latest.progress.daily, admitted: [...latest.progress.daily.admitted] }, expected: next.progress.cards[cardId] };
        return next;
      });
    },
    undoLastRating(undo: RatingUndo) {
      return mutate(latest => {
        // A later rating in another tab supersedes this undo; keep its saved schedule.
        if (undo.expected && Object.entries(undo.expected).some(([field, value]) => latest.progress.cards[undo.cardId]?.[field as keyof ReviewState] !== value)) return null;
        return { ...latest, progress: undoRating(latest.progress, undo) };
      });
    },
  };
}

export function useStudyReview(subject: StudySubject, catalog: readonly CardIdentity[], enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ subject: StudySubject; catalog: readonly CardIdentity[]; session: StudyReviewSession } | null>(null);
  const syncRef = useRef<{ subject: StudySubject; sync: ReturnType<typeof createStudyReviewSync> } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [storageError, setStorageError] = useState("");
  const [lastRating, setLastRating] = useState<{ cardId: string; dueAt: string } | null>(null);
  const undoRef = useRef<RatingUndo | null>(null);
  useEffect(() => {
    // In particular, 825 must not normalize or persist before its real catalog arrives.
    if (!enabled) return;
    if (!syncRef.current || syncRef.current.subject !== subject) {
      const storage = { getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) };
      const sync = createStudyReviewSync(subject, catalog, storage, Date.now, (next, error) => { setSnapshot({ subject, catalog: sync.catalog, session: next }); setStorageError(error); setNow(Date.now()); });
      syncRef.current = { subject, sync };
      setLastRating(null); undoRef.current = null;
    }
    const sync = syncRef.current.sync;
    if (sync.catalog !== catalog) sync.updateCatalog(catalog);
    else sync.refresh();
    setSnapshot({ subject, catalog, session: sync.session }); setStorageError(sync.storageError);
    const refresh = () => { sync.refresh(); setNow(Date.now()); };
    const onStorage = (event: StorageEvent) => {
      try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
      sync.storageChanged(event); setNow(Date.now());
    };
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("storage", onStorage); };
  }, [enabled, catalog, subject]);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    return () => { window.clearInterval(timer); };
  }, [enabled]);
  const fallback = useMemo(() => ({ progress: createEmptyProgress(now), newScopes: [] }), [now]);
  const bound = enabled && snapshot?.subject === subject && snapshot.catalog === catalog;
  const current = bound ? snapshot.session : fallback;
  const ready = !!bound && !!syncRef.current?.sync.ready;
  const activeSync = () => ready ? syncRef.current?.sync : undefined;
  const queue = useMemo(() => buildReviewSession(catalog, current, now), [catalog, current, now]);
  return {
    ready, progress: current.progress, newScopes: current.newScopes, queue, now, storageError: enabled ? storageError : "", lastRating: bound ? lastRating : null,
    studiedToday: newCardsStudiedToday(current.progress, now),
    queueForScope(scope: StudyScope) { return buildReviewSession(catalog, current, now, scope); },
    selectScopes(scopes: StudyScope[]) { activeSync()?.selectScopes(scopes); },
    pauseScope(scope: StudyScope) { activeSync()?.pauseScope(scope); },
    setDailyNewLimit(value: number) { activeSync()?.setDailyNewLimit(value); },
    rateCard(cardId: string, grade: Rating, scope?: StudyScope) {
      const next = activeSync()?.rateCard(cardId, grade, scope);
      if (!next) return false;
      undoRef.current = activeSync()?.lastUndo ?? null;
      setLastRating({ cardId, dueAt: next.progress.cards[cardId].dueAt });
      return true;
    },
    undoLastRating() {
      const undo = undoRef.current;
      if (!undo) return false;
      const next = activeSync()?.undoLastRating(undo);
      undoRef.current = null;
      setLastRating(null);
      return !!next;
    },
    canUndo: !!bound && !!undoRef.current,
    preview(cardId: string, grade: Rating) { return previewSchedule(current.progress.cards[cardId], grade, now); },
  };
}

export type StudyReviewController = ReturnType<typeof useStudyReview>;
