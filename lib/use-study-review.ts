import { useEffect, useMemo, useRef, useState } from "react";
import { applyRating, buildStudyQueue, createEmptyProgress, normalizeStoredProgress, normalizeStudyScopes, previewSchedule, type CardIdentity, type Rating, type StudyProgress, type StudyScope, type StudyTime } from "./study-scheduler";
import { cardMatchesStudyScope } from "./study-review-view";

export type StudyReviewSession = { progress: StudyProgress; newScopes: StudyScope[] };
export const studyReviewKey = (subject: "333" | "825") => `yantu-srs-v1-${subject}`;
const legacyKey = (subject: "333" | "825") => subject === "825" ? "yantu-reviews-825" : "yantu-reviews";

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

export function useStudyReview(subject: "333" | "825", catalog: readonly CardIdentity[], enabled: boolean) {
  const [session, setSession] = useState<StudyReviewSession | null>(null);
  const sessionRef = useRef<StudyReviewSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [storageError, setStorageError] = useState("");
  const [lastRating, setLastRating] = useState<{ cardId: string; dueAt: string } | null>(null);
  function persist(next: StudyReviewSession) {
    try { localStorage.setItem(studyReviewKey(subject), serializeStudyReview(next)); setStorageError(""); }
    catch { setStorageError("浏览器未能保存学习记录。当前页面可继续使用；请允许本地存储后再离开或刷新。"); }
  }
  function commit(next: StudyReviewSession) {
    sessionRef.current = next; setSession(next); persist(next); setNow(Date.now());
  }
  useEffect(() => {
    // In particular, 825 must not normalize or persist before its real catalog arrives.
    if (!enabled || sessionRef.current) return;
    let restored: StudyReviewSession;
    let readable = true;
    try { restored = restoreStudyReview(localStorage.getItem(studyReviewKey(subject)), catalog, Date.now(), localStorage.getItem(legacyKey(subject))); }
    catch {
      readable = false;
      restored = { progress: createEmptyProgress(Date.now()), newScopes: [] };
      setStorageError("浏览器未能读取学习记录。请允许本地存储；当前页面的进度可能无法保留。");
    }
    sessionRef.current = restored; setSession(restored);
    if (readable) persist(restored);
  }, [enabled, catalog, subject]);
  useEffect(() => {
    if (!enabled) return;
    const update = () => setNow(Date.now());
    const timer = window.setInterval(update, 1000);
    window.addEventListener("focus", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); };
  }, [enabled]);
  const fallback = useMemo(() => ({ progress: createEmptyProgress(now), newScopes: [] }), [now]);
  const current = session ?? fallback;
  const queue = useMemo(() => buildReviewSession(catalog, current, now), [catalog, current, now]);
  return {
    ready: session !== null, progress: current.progress, newScopes: current.newScopes, queue, now, storageError, lastRating,
    queueForScope(scope: StudyScope) { return buildReviewSession(catalog, current, now, scope); },
    selectScopes(scopes: StudyScope[]) { if (sessionRef.current) commit(selectNewStudyScopes(sessionRef.current, scopes, catalog)); },
    pauseScope(scope: StudyScope) { if (sessionRef.current) commit(pauseStudyScope(sessionRef.current, scope)); },
    setDailyNewLimit(value: number) {
      if (sessionRef.current && Number.isInteger(value) && value >= 0 && value <= 200) commit({ ...sessionRef.current, progress: { ...sessionRef.current.progress, dailyNewLimit: value } });
    },
    rateCard(cardId: string, grade: Rating, scope?: StudyScope) {
      const previous = sessionRef.current, instant = Date.now();
      if (!previous) return;
      const next = rateStudyReviewCard(previous, catalog, cardId, grade, instant, scope);
      if (!next) return;
      commit(next); setLastRating({ cardId, dueAt: next.progress.cards[cardId].dueAt });
    },
    preview(cardId: string, grade: Rating) { return previewSchedule(current.progress.cards[cardId], grade, now); },
  };
}

export type StudyReviewController = ReturnType<typeof useStudyReview>;
