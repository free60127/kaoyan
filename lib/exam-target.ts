export const examTargetKey = "yantu-exam-target-v1";
export type ExamTargetRecord = { version: 1; date: string };
export type ExamTargetSnapshot = { date: string | null; today: string; ready: boolean; error: string };
type ExamTargetStorage = Pick<Storage, "getItem" | "setItem">;

/** A real Gregorian calendar date, with a four-digit year from 0001 to 9999. */
export function isExamDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function validateExamTarget(value: unknown): ExamTargetRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("考试日期格式无效。");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 2 || row.version !== 1 || !isExamDate(row.date)) throw new Error("考试日期格式无效。");
  return { version: 1, date: row.date };
}

export function localCalendarDate(now: Date): string {
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function calendarDay(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  // UTC is used only for calendar ordinals, never to interpret the user's local day.
  // setUTCFullYear also preserves years 0001–0099 (Date.UTC maps them to 1901–1999).
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime() / 86_400_000;
}

export function examDaysRemaining(target: string, today: string): number {
  if (!isExamDate(target) || !isExamDate(today)) throw new Error("考试日期格式无效。");
  return calendarDay(target) - calendarDay(today);
}

export function examDateLabel(date: string | null): string {
  if (!date) return "设置考试日期";
  if (!isExamDate(date)) throw new Error("考试日期格式无效。");
  const [year, month, day] = date.split("-").map(Number);
  return `${year} 年 ${month} 月 ${day} 日`;
}

export function examCountdownLabel(date: string | null, today: string): string {
  if (!date) return "目标初试日期未设置";
  const days = examDaysRemaining(date, today);
  return days > 0 ? `距考试 ${days} 天` : days === 0 ? "今天考试" : `考试已过 ${-days} 天`;
}

export function examPlannerContext(date: string | null): string {
  return date ? `${examDateLabel(date)}初试（手动设置）` : "2027 年 12 月初试，未设置具体日期";
}

export function millisecondsToLocalMidnight(now: Date): number {
  const next = new Date(now.getTime());
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
}

/** Reads never write. A failed save leaves the last successfully read/saved date intact. */
export function createExamTargetController(storage: () => ExamTargetStorage, now: () => Date = () => new Date()) {
  let snapshot: ExamTargetSnapshot = { date: null, today: localCalendarDate(now()), ready: false, error: "" };
  const listeners = new Set<() => void>();
  const publish = (next: ExamTargetSnapshot) => {
    if (Object.keys(next).every(key => next[key as keyof ExamTargetSnapshot] === snapshot[key as keyof ExamTargetSnapshot])) return;
    snapshot = next;
    listeners.forEach(listener => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    refresh() {
      const today = localCalendarDate(now());
      try {
        const raw = storage().getItem(examTargetKey);
        const date = raw === null ? null : validateExamTarget(JSON.parse(raw)).date;
        publish({ date, today, ready: true, error: "" });
      } catch {
        publish({ ...snapshot, today, ready: true, error: "考试日期未能读取，原有存储未更改。请检查浏览器存储或备份；保存新日期会替换原有设置。" });
      }
    },
    save(date: string): boolean {
      // Validation belongs to the editor; snapshot.error describes storage failures only.
      if (!snapshot.ready || !isExamDate(date)) return false;
      try { storage().setItem(examTargetKey, JSON.stringify({ version: 1, date } satisfies ExamTargetRecord)); }
      catch {
        publish({ ...snapshot, error: "考试日期未能保存，请允许本地存储后重试。当前目标日期未更改。" });
        return false;
      }
      publish({ date, today: localCalendarDate(now()), ready: true, error: "" });
      return true;
    },
  };
}

export type ExamTargetController = ReturnType<typeof createExamTargetController>;
type ExamTargetClock = { window: EventTarget; document: EventTarget & { visibilityState: string }; now: () => Date; setTimeout: (callback: () => void, delay: number) => number; clearTimeout: (id: number) => void };

/** Re-arm after waking or a timezone/clock change; local midnight may be 23 or 25 hours away. */
export function watchExamTarget(controller: ExamTargetController, clock: ExamTargetClock): () => void {
  let timer: number;
  const refresh = () => {
    clock.clearTimeout(timer);
    controller.refresh();
    // The hourly cap also detects clock/timezone changes while the tab remains active.
    timer = clock.setTimeout(refresh, Math.min(millisecondsToLocalMidnight(clock.now()) + 50, 3_600_000));
  };
  const onStorage = (event: Event) => {
    const key = (event as StorageEvent).key;
    if (key === examTargetKey || key === null) refresh();
  };
  const onVisible = () => { if (clock.document.visibilityState === "visible") refresh(); };
  clock.window.addEventListener("focus", refresh);
  clock.window.addEventListener("storage", onStorage);
  clock.document.addEventListener("visibilitychange", onVisible);
  refresh();
  return () => {
    clock.clearTimeout(timer);
    clock.window.removeEventListener("focus", refresh);
    clock.window.removeEventListener("storage", onStorage);
    clock.document.removeEventListener("visibilitychange", onVisible);
  };
}
