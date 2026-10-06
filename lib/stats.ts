/** 轻量每日学习统计: 每次评分/新学/答题按日累计, 供统计页与连续天数计算。 */
export type DayStat = { date: string; ratings: number; again: number; newCards: number; quiz: number; quizCorrect: number };
export type StatStore = { getItem(key: string): string | null; setItem(key: string, value: string): void };
/** 广播存储写入结果; Node/测试环境无 window 时静默。 */
function notifyStorage(type: string, detail?: Record<string, string>) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  window.dispatchEvent(new CustomEvent(type, { detail }));
}
export const statsKey = (subject: string) => `yantu-stats-v1-${subject}`;

export const studyDate = (now: Date): string => {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const DAY_FIELDS = ["ratings", "again", "newCards", "quiz", "quizCorrect"] as const;

function sanitizeDay(value: unknown, date: string): DayStat | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const out: DayStat = { date, ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 };
  for (const field of DAY_FIELDS) {
    const num = row[field];
    if (typeof num === "number" && Number.isFinite(num) && num >= 0 && num <= 1_000_000) out[field] = Math.floor(num);
  }
  return out;
}

/** 读取并净化: 损坏条目丢弃而非整体失败, 数值夹紧到合法区间(与 study-backup 的容错风格一致)。 */
function readDays(store: StatStore, subject: string): Record<string, DayStat> {
  try {
    const raw = store.getItem(statsKey(subject));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, DayStat> = {};
    for (const [date, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const day = sanitizeDay(value, date);
      if (day) out[date] = day;
    }
    return out;
  } catch { return {}; }
}

export function recordStat(store: StatStore, subject: string, patch: Partial<Omit<DayStat, "date">>, now: Date = new Date()): DayStat {
  const date = studyDate(now);
  const days = readDays(store, subject);
  const base = days[date] || { date, ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 };
  const next: DayStat = {
    date,
    ratings: base.ratings + (patch.ratings || 0),
    again: base.again + (patch.again || 0),
    newCards: base.newCards + (patch.newCards || 0),
    quiz: base.quiz + (patch.quiz || 0),
    quizCorrect: base.quizCorrect + (patch.quizCorrect || 0),
  };
  days[date] = next;
  try {
    store.setItem(statsKey(subject), JSON.stringify(days));
    notifyStorage("yantu-storage-saved");
    return next;
  } catch {
    notifyStorage("yantu-storage-error", { store: "stats", subject });
    return next;
  }
}

export function listStats(store: StatStore, subject: string): DayStat[] {
  return Object.values(readDays(store, subject)).sort((a, b) => a.date.localeCompare(b.date));
}

/** 最近 n 天(含今天), 空日补零, 供图表。 */
export function lastNDays(store: StatStore, subject: string, n: number, now: Date = new Date()): DayStat[] {
  const days = readDays(store, subject);
  const out: DayStat[] = [];
  for (let offset = n - 1; offset >= 0; offset -= 1) {
    const date = studyDate(new Date(now.getTime() - offset * 86400000));
    out.push(days[date] || { date, ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 });
  }
  return out;
}

/** 连续学习天数: 今天(或昨天)往前每天都有活动量的最长连续段。 */
export function streakDays(store: StatStore, subject: string, now: Date = new Date()): number {
  const days = readDays(store, subject);
  const active = (date: string) => {
    const stat = days[date];
    return !!stat && (stat.ratings > 0 || stat.quiz > 0);
  };
  let streak = 0;
  const start = active(studyDate(now)) ? 0 : (active(studyDate(new Date(now.getTime() - 86400000))) ? 1 : -1);
  if (start < 0) return 0;
  for (let offset = start; ; offset += 1) {
    const date = studyDate(new Date(now.getTime() - offset * 86400000));
    if (!active(date)) break;
    streak += 1;
    if (offset > 3650) break;
  }
  return streak;
}
