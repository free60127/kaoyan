export type MistakeKind = "card" | "quiz" | "practice";
import { getDeviceId } from "./device";
export type Mistake = { id: string; subject: string; kind: MistakeKind; refId: string; label: string; wrongCount: number; wrongCounts?: Record<string, number>; lastAt: string; /** 手动待复习，不代表答错。 */ pendingOnly?: boolean; /** 撤销恢复旧删除状态；并发新答错仍应可见。 */ restoredDeletion?: boolean; /** tombstone(F08): 已删除标记, 云合并防复活 */ deleted?: boolean };
const counters = (value: unknown): Record<string, number> => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([id, n]) => !["__proto__", "constructor", "prototype"].includes(id) && typeof n === "number" && Number.isSafeInteger(n) && n >= 0)) : {};
/** Repair the old aggregate-only undo while preserving its recorded total.
 * The precise historical intent cannot be recovered; do not invent extra errors. */
export function normalizeMistakeCounters(row: { wrongCount?: unknown; wrongCounts?: unknown }): { wrongCount: number; wrongCounts: Record<string, number> } {
  const wrongCounts = counters(row.wrongCounts);
  const total = Object.values(wrongCounts).reduce((sum, n) => sum + n, 0);
  const wrongCount = typeof row.wrongCount === "number" && Number.isSafeInteger(row.wrongCount) && row.wrongCount >= 0 ? row.wrongCount : total || 1;
  if (!Object.keys(wrongCounts).length) return { wrongCount, wrongCounts: { legacy: wrongCount } };
  if (total < wrongCount) wrongCounts.legacy = (wrongCounts.legacy || 0) + wrongCount - total;
  let excess = total - wrongCount;
  for (const id of Object.keys(wrongCounts).sort()) {
    if (excess <= 0) break;
    const drop = Math.min(wrongCounts[id], excess); wrongCounts[id] -= drop; excess -= drop;
  }
  return { wrongCount, wrongCounts };
}
const isPending = (item: { subject: string; kind?: string; pendingOnly?: boolean }) => item.pendingOnly === true || item.pendingOnly === undefined && item.subject === "825" && item.kind === "quiz";
/** 广播存储写入结果; Node/测试环境无 window 时静默。 */
function notifyStorage(type: string, detail?: Record<string, string>) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}
export const mistakesStorageKey = "yantu-mistakes-v1";
const mistakeId = (subject: string, kind: MistakeKind, refId: string) => `${subject}:${kind}:${refId}`;

function parseList(value: string | null): Mistake[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Mistake => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return typeof record.subject === "string" && typeof record.refId === "string" && typeof record.label === "string";
    }).map(item => ({
      id: typeof item.id === "string" ? item.id : mistakeId(item.subject, item.kind ?? "card", item.refId),
      subject: item.subject,
      kind: (item.kind === "quiz" || item.kind === "practice" ? item.kind : "card") as MistakeKind,
      refId: item.refId,
      label: item.label.slice(0, 200),
      ...normalizeMistakeCounters(isPending(item) ? { wrongCount: 0, wrongCounts: item.wrongCounts } : item),
      pendingOnly: isPending(item),
      lastAt: typeof item.lastAt === "string" ? item.lastAt : new Date().toISOString(),
      ...(item.deleted === true ? { deleted: true } : {}),
      ...(item.restoredDeletion === true ? { restoredDeletion: true } : {}),
    }));
  } catch { return []; }
}

/** 全量(含 tombstone): 读改写路径用——tombstone 必须保留才能防云合并复活。 */
export function readMistakes(): Mistake[] {
  try { return parseList(localStorage.getItem(mistakesStorageKey)); } catch { return []; }
}
/** 用户可见列表(UI/重练候选/只练错题): 过滤已删除。 */
export function readVisibleMistakes(): Mistake[] {
  return readMistakes().filter(item => !item.deleted && (item.wrongCount > 0 || item.pendingOnly));
}

export const mistakesSavedEvent = "yantu-storage-saved";
export const mistakesSaveFailedEvent = "yantu-storage-error";
function saveMistakes(list: Mistake[]): boolean {
  try { localStorage.setItem(mistakesStorageKey, JSON.stringify(list)); notifyStorage(mistakesSavedEvent, { store: "mistakes" }); return true; }
  catch { notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" }); return false; }
}

export type MistakeUndo = { id: string; device: string; countBefore: number; totalBefore: number; deletedBefore: boolean };
export function captureMistakeUndo(subject: string, kind: MistakeKind, refId: string): MistakeUndo {
  const id = mistakeId(subject, kind, refId), device = getDeviceId();
  const previous = readMistakes().find(item => item.id === id);
  return { id, device, countBefore: previous?.wrongCounts?.[device] || 0, totalBefore: previous?.wrongCount || 0, deletedBefore: previous?.deleted === true };
}
/** Undo exactly this device's latest increment, never another device's work.
 * Zero counters are retained so their causal version can defeat stale values. */
export function undoMistake(token: MistakeUndo): boolean {
  const list = readMistakes(), entry = list.find(item => item.id === token.id);
  if (!entry || (entry.wrongCounts?.[token.device] || 0) !== token.countBefore + 1) return false;
  const wrongCounts = { ...entry.wrongCounts, [token.device]: token.countBefore };
  const wrongCount = Object.values(wrongCounts).reduce((sum, n) => sum + n, 0);
  const restoreDeletion = token.deletedBefore && wrongCount <= token.totalBefore;
  const next = { ...entry, wrongCounts, wrongCount, lastAt: new Date().toISOString(),
    deleted: entry.deleted || restoreDeletion, restoredDeletion: !entry.deleted && restoreDeletion };
  return saveMistakes(list.map(item => item.id === token.id ? next : item));
}

export function markPendingReview(subject: string, kind: MistakeKind, refId: string, label: string): boolean {
  const list = readMistakes(), id = mistakeId(subject, kind, refId);
  const existing = list.find(item => item.id === id);
  const next: Mistake = { ...existing, id, subject, kind, refId, label: label.slice(0, 200), wrongCount: 0,
    wrongCounts: Object.fromEntries(Object.keys(existing?.wrongCounts || {}).map(id => [id, 0])), pendingOnly: true,
    deleted: false, restoredDeletion: false, lastAt: new Date().toISOString() };
  return saveMistakes([next, ...list.filter(item => item.id !== id)]);
}

/** Upsert: same subject+kind+refId accumulates wrongCount and refreshes lastAt.
 *  返回写入是否成功; 失败时广播事件, 页面统一提示(静默失败会让记录在刷新后消失)。 */
export function recordMistake(subject: string, kind: MistakeKind, refId: string, label: string, now: Date = new Date()): boolean {
  const list = readMistakes();
  const id = mistakeId(subject, kind, refId);
  const existing = list.find(item => item.id === id);
  const wrongCounts = { ...(existing?.wrongCounts || (existing ? { legacy: existing.wrongCount } : {})) };
  const device = getDeviceId(); wrongCounts[device] = (wrongCounts[device] || 0) + 1;
  const next: Mistake = existing
    ? { ...existing, deleted: false, restoredDeletion: false, pendingOnly: false, wrongCounts, wrongCount: Object.values(wrongCounts).reduce((sum, n) => sum + n, 0), lastAt: now.toISOString(), label: label.slice(0, 200) || existing.label }
    : { id, subject, kind, refId, label: label.slice(0, 200), pendingOnly: false, wrongCounts, wrongCount: 1, lastAt: now.toISOString() };
  const updated = [next, ...list.filter(item => item.id !== id)];
  return saveMistakes(updated);
}

export function removeMistake(id: string): Mistake[] {
  return removeMistakes([id]);
}

/** Remove several mistakes at once by entry id. 写失败时广播事件（横幅提示），内存结果仍返回供本次会话使用。 */
/** 删除 = tombstone(F08): 条目保留 deleted 标记, 云合并不会被另一端的旧数据复活。 */
export function removeMistakes(ids: readonly string[]): Mistake[] {
  const drop = new Set(ids);
  const now = new Date().toISOString();
  const updated = readMistakes().map(item => drop.has(item.id) ? { ...item, deleted: true, restoredDeletion: false, lastAt: now } : item);
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(updated));
    notifyStorage(mistakesSavedEvent);
  } catch { notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" }); }
  return updated;
}

/** Remove every entry of a subject whose refId matches (re-quiz mastered cards). */
export function removeMistakesByRef(subject: string, refIds: readonly string[]): Mistake[] {
  const drop = new Set(refIds);
  const now = new Date().toISOString();
  const updated = readMistakes().map(item => item.subject === subject && drop.has(item.refId) ? { ...item, deleted: true, restoredDeletion: false, lastAt: now } : item);
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(updated));
    notifyStorage(mistakesSavedEvent);
  } catch { notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" }); }
  return updated;
}

/** Clear one subject's mistakes. 同上，失败可见。 */
export function clearMistakes(subject: string): Mistake[] {
  const now = new Date().toISOString();
  const updated = readMistakes().map(item => item.subject === subject ? { ...item, deleted: true, restoredDeletion: false, lastAt: now } : item);
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(updated));
    notifyStorage(mistakesSavedEvent);
  } catch { notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" }); }
  return updated;
}

/** For tests and import paths that work on a raw string. */
export const parseMistakes = parseList;

/** Re-quiz selection: newest mistakes of one subject first, capped.
 *  同一张卡可能既有闪卡错题又有自测错题: 按 refId 去重(取最近一条, 错误次数合并), 避免一卷重复出同一卡。 */
export function selectRequizList(list: Mistake[], subject: string, limit = 20): Mistake[] {
  const byRef = new Map<string, Mistake>();
  for (const item of list) {
    if (item.subject !== subject || item.kind === "quiz" || item.deleted) continue;
    const existing = byRef.get(item.refId);
    if (!existing) { byRef.set(item.refId, { ...item }); continue; }
    const newer = item.lastAt > existing.lastAt ? item : existing;
    byRef.set(item.refId, { ...newer, wrongCount: existing.wrongCount + item.wrongCount });
  }
  return [...byRef.values()]
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.wrongCount - a.wrongCount)
    .slice(0, limit);
}
