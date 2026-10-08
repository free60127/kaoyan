import { studyDate, type StatStore } from "./stats";
import type { Rating } from "./study-scheduler";

export type TimingKind = "new" | "learning" | "review";
export type CardTiming = {
  id: string; cardId: string; label: string; contentKey: string; kind: TimingKind;
  startedAt: string; updatedAt: string; elapsedMs: number; days: Record<string, number>;
  status: "interrupted" | "completed" | "undone"; grade?: Rating;
};
export type TimingRecords = Record<string, CardTiming>;
export const cardTimingKey = (subject: string) => `yantu-card-timing-v1-${subject}`;
export const timingSettingsKey = "yantu-card-timing-settings-v1";
export type TimingSettings = { enabled: boolean };
export function validateTimingSettings(value: unknown): TimingSettings {
  if (!value || typeof value !== "object" || !("enabled" in value) || typeof value.enabled !== "boolean") throw new Error("自动计时设置格式无效");
  return { enabled: value.enabled };
}
export function timingEnabled(store: StatStore): boolean {
  try { const raw = store.getItem(timingSettingsKey); return raw === null ? true : validateTimingSettings(JSON.parse(raw)).enabled; } catch { return false; }
}
export function setTimingEnabled(store: StatStore, enabled: boolean): boolean {
  try {
    store.setItem(timingSettingsKey, JSON.stringify({ enabled }));
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("yantu-timing-settings-changed"));
      window.dispatchEvent(new CustomEvent("yantu-storage-saved", { detail: { store: "timing-settings" } }));
    }
    return true;
  } catch {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("yantu-storage-error", { detail: { store: "timing-settings" } }));
    return false;
  }
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const safeId = (v: unknown): v is string => typeof v === "string" && !!v && v.length <= 200 && !["__proto__", "constructor", "prototype"].includes(v);
const stamp = (v: unknown): v is string => {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) return false;
  const date = v.slice(0, 10), [h, m, s] = v.slice(11, 19).split(":").map(Number);
  return new Date(date + "T00:00:00Z").toISOString().slice(0, 10) === date && h < 24 && m < 60 && s < 60;
};
export function createTimingId(): string {
  // Older Android WebViews may expose crypto without randomUUID.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `visit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
/** Strict for backups/writes; callers reading UI may fall back without overwriting bad data. */
export function validateTimingRecords(value: unknown): TimingRecords {
  if (!obj(value)) throw new Error("闪卡用时记录格式无效");
  const out: TimingRecords = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!obj(raw) || !safeId(id) || raw.id !== id || !safeId(raw.cardId) || typeof raw.label !== "string" || raw.label.length > 300 || !safeId(raw.contentKey)
      || !["new", "learning", "review"].includes(String(raw.kind)) || !stamp(raw.startedAt) || !stamp(raw.updatedAt)
      || !["interrupted", "completed", "undone"].includes(String(raw.status)) || !obj(raw.days)
      || !Number.isSafeInteger(raw.elapsedMs) || Number(raw.elapsedMs) < 0
      || raw.grade !== undefined && !["again", "hard", "good", "easy"].includes(String(raw.grade))
      || raw.status !== "interrupted" && raw.grade === undefined) throw new Error("闪卡用时记录格式无效");
    const days: Record<string, number> = {};
    for (const [date, ms] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
        || !Number.isSafeInteger(ms) || Number(ms) < 0 || Number(ms) > 86400000) throw new Error("闪卡用时日期或时长无效");
      days[date] = Number(ms);
    }
    if (Object.values(days).reduce((a, b) => a + b, 0) !== raw.elapsedMs) throw new Error("闪卡用时合计不一致");
    out[id] = { id, cardId: raw.cardId, label: raw.label, contentKey: raw.contentKey, kind: raw.kind as TimingKind,
      startedAt: raw.startedAt, updatedAt: raw.updatedAt, elapsedMs: Number(raw.elapsedMs), days, status: raw.status as CardTiming["status"], ...(raw.grade ? { grade: raw.grade as Rating } : {}) };
  }
  return out;
}
export function readTimingRecords(store: StatStore, subject: string): TimingRecords {
  try { return validateTimingRecords(JSON.parse(store.getItem(cardTimingKey(subject)) || "{}")); } catch { return {}; }
}
// A changed card starts a new comparison series, including changes to personal notes.
export function timingContentKey(...text: string[]): string {
  const input = JSON.stringify(text); let a = 2166136261, b = 5381;
  for (let i = 0; i < input.length; i++) { a = Math.imul(a ^ input.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ input.charCodeAt(i); }
  return `${input.length}-${a >>> 0}-${b >>> 0}`;
}

/** Injectable clock: elapsed time uses a monotonic clock; wall time only assigns local dates. */
export function createCardTimer(base: Omit<CardTiming, "elapsedMs" | "days" | "status" | "updatedAt" | "grade">, clock = () => ({ monotonic: performance.now(), wall: Date.now() })) {
  let running: ReturnType<typeof clock> | null = null;
  const days: Record<string, number> = {};
  let ended = false;
  const accrue = () => {
    if (!running || ended) return;
    const now = clock();
    const duration = Math.max(0, Math.floor(now.monotonic - running.monotonic));
    // Attribute across midnight using elapsed time, even when the system clock is adjusted.
    let left = duration, wall = running.wall;
    while (left > 0) {
      const date = studyDate(new Date(wall));
      const midnight = new Date(wall); midnight.setHours(24, 0, 0, 0);
      const chunk = Math.min(left, Math.max(1, midnight.getTime() - wall));
      days[date] = (days[date] || 0) + chunk; left -= chunk; wall += chunk;
    }
    running = { monotonic: running.monotonic + duration, wall: now.wall };
  };
  const snapshot = (status: CardTiming["status"], grade?: Rating): CardTiming => ({ ...base, updatedAt: new Date(clock().wall).toISOString(),
    days: { ...days }, elapsedMs: Object.values(days).reduce((a, b) => a + b, 0), status, ...(grade ? { grade } : {}) });
  return {
    resume() { if (!ended && !running) running = clock(); },
    pause() { accrue(); running = null; },
    checkpoint() { accrue(); return snapshot("interrupted"); },
    finish(grade?: Rating) { if (ended) return null; accrue(); running = null; ended = true; return snapshot(grade ? "completed" : "interrupted", grade); },
  };
}

// Retain failed writes in memory until storage recovers, scoped to the original account.
const pending = new Map<StatStore, Map<string, Map<string, CardTiming>>>();
export function saveCardTiming(store: StatStore, subject: string, row: CardTiming, account = "guest"): boolean {
  if (row.status === "interrupted" && row.elapsedMs < 1000) return true; // Ignore StrictMode probes / immediate navigation.
  const byAccount = pending.get(store) || new Map<string, Map<string, CardTiming>>(); pending.set(store, byAccount);
  const key = `${account}:${cardTimingKey(subject)}`, rows = byAccount.get(key) || new Map<string, CardTiming>();
  rows.set(row.id, row); byAccount.set(key, rows);
  return flushCardTiming(store, subject, account);
}
export function flushCardTiming(store: StatStore, subject: string, account = "guest"): boolean {
  const byAccount = pending.get(store), key = `${account}:${cardTimingKey(subject)}`, rows = byAccount?.get(key);
  if (!rows?.size) return true;
  try {
    const existing = validateTimingRecords(JSON.parse(store.getItem(cardTimingKey(subject)) || "{}"));
    for (const row of rows.values()) existing[row.id] = row;
    store.setItem(cardTimingKey(subject), JSON.stringify(validateTimingRecords(existing)));
    byAccount!.delete(key);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("yantu-storage-saved", { detail: { store: "card-timing" } }));
    return true;
  } catch {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("yantu-storage-error", { detail: { store: "card-timing", subject } }));
    return false;
  }
}
export function timingComparisons(rows: CardTiming[]) {
  const groups = new Map<string, CardTiming[]>();
  for (const row of rows) { const list = groups.get(row.cardId) || []; list.push(row); groups.set(row.cardId, list); }
  return [...groups].map(([cardId, history]) => {
    history.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
    const latest = history.at(-1)!;
    const completed = history.filter(r => r.status === "completed" && r.contentKey === latest.contentKey && r.elapsedMs > 0);
    const first = completed[0], last = completed.at(-1);
    const improvement = completed.length > 1 && first && last ? (first.elapsedMs - last.elapsedMs) / first.elapsedMs * 100 : null;
    return { cardId, history, latest, first, last, improvement, completedCount: completed.length };
  }).sort((a, b) => b.latest.startedAt.localeCompare(a.latest.startedAt) || a.cardId.localeCompare(b.cardId));
}
export function formatStudyTime(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  return `${Math.floor(seconds / 3600)} 小时 ${Math.floor(seconds % 3600 / 60)} 分`;
}
