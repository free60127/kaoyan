import { newCardsStudiedToday, type CardIdentity, type StudyProgress, type StudyQueue, type StudyScope, type StudyTime } from "./study-scheduler";

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
    studiedToday: newCardsStudiedToday(progress, now, localCards),
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

/** 固定当前显示的队首卡（R12）：实时到期只更新队列与计数；
 *  只要被固定的卡仍在当前队列中，就继续显示它，评分/换范围后才轮到下一张。 */
export function pickPinnedHead<T extends { cardId: string }>(pinned: { key: string; cardId: string } | null, queueKey: string, items: readonly T[]): T | null {
  if (pinned && pinned.key === queueKey) {
    const found = items.find(item => item.cardId === pinned.cardId);
    if (found) return found;
  }
  return items[0] ?? null;
}

/** 自由浏览位置持久化（R10）：按 科目→范围 记住正在看的卡片 ID，
 *  恢复时优先按 ID 定位（卡库更新后索引可能漂移），再退回索引。浏览进度与 SRS 队列完全独立。 */
export const browsePositionKey = "yantu-browse-position-v1";
export type BrowseStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function saveBrowsePosition(store: BrowseStore, subject: string, scopeKey: string, cardId: string, index: number): void {
  let all: Record<string, { cardId: string; index: number }> = {};
  try {
    const raw = store.getItem(browsePositionKey);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) all = parsed as Record<string, { cardId: string; index: number }>;
    }
  } catch { all = {}; }
  all[`${subject}:${scopeKey}`] = { cardId, index };
  // 每科目只留最近 40 个范围，防止无限增长
  const keys = Object.keys(all);
  if (keys.length > 200) {
    for (const key of keys.slice(0, keys.length - 200)) delete all[key];
  }
  try { store.setItem(browsePositionKey, JSON.stringify(all)); } catch { /* 浏览位置丢失可接受 */ }
}

export function loadBrowsePosition(store: BrowseStore, subject: string, scopeKey: string, cards: readonly { id: string }[]): number {
  try {
    const raw = store.getItem(browsePositionKey);
    if (!raw) return 0;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return 0;
    const saved = (parsed as Record<string, { cardId?: unknown; index?: unknown }>)[`${subject}:${scopeKey}`];
    if (!saved || typeof saved !== "object") return 0;
    if (typeof saved.cardId === "string" && saved.cardId) {
      const byId = cards.findIndex(card => card.id === saved.cardId);
      if (byId >= 0) return byId;
    }
    if (typeof saved.index === "number" && Number.isInteger(saved.index) && saved.index >= 0 && saved.index < cards.length) return saved.index;
    return 0;
  } catch { return 0; }
}
