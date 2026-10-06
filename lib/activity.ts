/** 今日活动日志: 按条记录评分/答题/撤销等事件, 供统计页"今天完成了什么"清单。 */
export type ActivityEntry = { t: string; kind: "rating" | "undo" | "quiz" | "practice"; subject: string; label: string; detail: string };
export type ActivityStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };
export const activityKey = (subject: string) => `yantu-activity-v1-${subject}`;
const MAX_ENTRIES = 300;

function readEntries(store: ActivityStore, subject: string): ActivityEntry[] {
  try {
    const raw = store.getItem(activityKey(subject));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is ActivityEntry => {
      if (!item || typeof item !== "object") return false;
      const row = item as Record<string, unknown>;
      return typeof row.t === "string" && typeof row.kind === "string" && typeof row.label === "string";
    }).slice(-MAX_ENTRIES);
  } catch { return []; }
}

export function recordActivity(store: ActivityStore, subject: string, kind: ActivityEntry["kind"], label: string, detail = "", now: Date = new Date()): void {
  const entries = readEntries(store, subject);
  entries.push({ t: now.toISOString(), kind, subject, label: label.slice(0, 160), detail: detail.slice(0, 160) });
  try { store.setItem(activityKey(subject), JSON.stringify(entries.slice(-MAX_ENTRIES))); } catch { /* 存储失败时横幅通道已覆盖, 这里静默 */ }
}

/** 今天的活动(按本地日历日), 最新的在前。 */
export function todayActivities(store: ActivityStore, subject: string, now: Date = new Date()): ActivityEntry[] {
  const todayKey = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return readEntries(store, subject)
    .filter(entry => entry.t.slice(0, 10) === todayKey)
    .reverse();
}

/** 撤销最近一条活动记录(评分撤销时调用, 保持清单与实际一致)。 */
export function dropLastActivity(store: ActivityStore, subject: string, kind: ActivityEntry["kind"], labelMatch?: string): void {
  const entries = readEntries(store, subject);
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (entries[i].kind !== kind) continue;
    if (labelMatch && !entries[i].label.startsWith(labelMatch.slice(0, 60))) continue;
    entries.splice(i, 1);
    try { store.setItem(activityKey(subject), JSON.stringify(entries.slice(-MAX_ENTRIES))); } catch { /* ignore */ }
    return;
  }
}
