export type MistakeKind = "card" | "quiz" | "practice";
export type Mistake = { id: string; subject: string; kind: MistakeKind; refId: string; label: string; wrongCount: number; lastAt: string };
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
      wrongCount: Number.isInteger(item.wrongCount) && (item.wrongCount as number) > 0 ? item.wrongCount as number : 1,
      lastAt: typeof item.lastAt === "string" ? item.lastAt : new Date().toISOString(),
    }));
  } catch { return []; }
}

export function readMistakes(): Mistake[] {
  try { return parseList(localStorage.getItem(mistakesStorageKey)); } catch { return []; }
}

export const mistakesSavedEvent = "yantu-storage-saved";
export const mistakesSaveFailedEvent = "yantu-storage-error";

/** Upsert: same subject+kind+refId accumulates wrongCount and refreshes lastAt.
 *  返回写入是否成功; 失败时广播事件, 页面统一提示(静默失败会让记录在刷新后消失)。 */
export function recordMistake(subject: string, kind: MistakeKind, refId: string, label: string, now: Date = new Date()): boolean {
  const list = readMistakes();
  const id = mistakeId(subject, kind, refId);
  const existing = list.find(item => item.id === id);
  const next: Mistake = existing
    ? { ...existing, wrongCount: existing.wrongCount + 1, lastAt: now.toISOString(), label: label.slice(0, 200) || existing.label }
    : { id, subject, kind, refId, label: label.slice(0, 200), wrongCount: 1, lastAt: now.toISOString() };
  const updated = [next, ...list.filter(item => item.id !== id)];
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(updated));
    notifyStorage(mistakesSavedEvent);
    return true;
  } catch {
    notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" });
    return false;
  }
}

export function removeMistake(id: string): Mistake[] {
  return removeMistakes([id]);
}

/** Remove several mistakes at once by entry id. 写失败时广播事件（横幅提示），内存结果仍返回供本次会话使用。 */
export function removeMistakes(ids: readonly string[]): Mistake[] {
  const drop = new Set(ids);
  const updated = readMistakes().filter(item => !drop.has(item.id));
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(updated));
    notifyStorage(mistakesSavedEvent);
  } catch { notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" }); }
  return updated;
}

/** Remove every entry of a subject whose refId matches (re-quiz mastered cards). */
export function removeMistakesByRef(subject: string, refIds: readonly string[]): Mistake[] {
  const drop = new Set(refIds);
  const updated = readMistakes().filter(item => !(item.subject === subject && drop.has(item.refId)));
  try {
    localStorage.setItem(mistakesStorageKey, JSON.stringify(updated));
    notifyStorage(mistakesSavedEvent);
  } catch { notifyStorage(mistakesSaveFailedEvent, { store: "mistakes" }); }
  return updated;
}

/** Clear one subject's mistakes. 同上，失败可见。 */
export function clearMistakes(subject: string): Mistake[] {
  const updated = readMistakes().filter(item => item.subject !== subject);
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
    if (item.subject !== subject || item.kind === "quiz") continue;
    const existing = byRef.get(item.refId);
    if (!existing) { byRef.set(item.refId, { ...item }); continue; }
    const newer = item.lastAt > existing.lastAt ? item : existing;
    byRef.set(item.refId, { ...newer, wrongCount: existing.wrongCount + item.wrongCount });
  }
  return [...byRef.values()]
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.wrongCount - a.wrongCount)
    .slice(0, limit);
}
