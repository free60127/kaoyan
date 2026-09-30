import type { CardIdentity, StudyProgress, StudyQueue, StudyScope, StudyTime } from "./study-scheduler";

export function cardMatchesStudyScope(card: CardIdentity, scope: StudyScope): boolean {
  return card.book === scope.bookId && scope.chapters.includes(card.chapter) && (scope.section === undefined || card.section === scope.section);
}

/** Filter the actual supplied queue without changing its order, admissions, or shared quota. */
export function scopedStudyReviewView(queue: StudyQueue, catalog: readonly CardIdentity[], progress: StudyProgress, scope: StudyScope, now: StudyTime) {
  const localCards = catalog.filter(card => cardMatchesStudyScope(card, scope));
  const ids = new Set(localCards.map(card => card.id));
  const items = queue.items.filter(item => ids.has(item.cardId));
  const instant = new Date(now).getTime();
  let nextDueAt: string | null = null;
  for (const card of localCards) {
    if (!progress.scopes.some(active => cardMatchesStudyScope(card, active))) continue;
    const dueAt = progress.cards[card.id]?.dueAt;
    if (dueAt && Date.parse(dueAt) > instant && (nextDueAt === null || Date.parse(dueAt) < Date.parse(nextDueAt))) nextDueAt = dueAt;
  }
  return {
    items,
    counts: {
      reviewDue: items.filter(item => item.kind !== "new").length,
      learningDue: items.filter(item => item.kind === "learning").length,
      newToday: items.filter(item => item.kind === "new").length,
    },
    nextDueAt,
    remainingNewLimit: queue.remainingNewLimit,
  };
}

/** Resolve before rendering, so changing location cannot briefly show the old browse index. */
export function studyBrowseIndex(position: { scopeKey: string; index: number }, scopeKey: string, length: number): number {
  if (position.scopeKey !== scopeKey || length <= 0) return 0;
  return Math.max(0, Math.min(position.index, length - 1));
}
