/** 轻量每日学习统计: 每次评分/新学/答题按日累计, 供统计页与连续天数计算。
 *  云同步下按设备分桶(F07): devices[设备id] 是该设备本日的独立累计,
 *  显示值 = 各设备之和; 合并按设备取值, 双端并行学习不会互相吞计数,
 *  撤销只扣本设备桶, 能正确传播到另一端。 */
import { getDeviceId } from "./device";

export type DeviceStat = { ratings: number; again: number; newCards: number; quiz: number; quizCorrect: number };
export type DayStat = { date: string; ratings: number; again: number; newCards: number; quiz: number; quizCorrect: number; devices?: Record<string, DeviceStat> };
export const LEGACY_DEVICE = "legacy";
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
  if (isObj(row.devices)) {
    const devices: Record<string, DeviceStat> = {};
    for (const [deviceId, bucket] of Object.entries(row.devices)) {
      if (!isObj(bucket)) continue;
      const clean = sanitizeDay(bucket, date);
      if (clean) devices[deviceId.slice(0, 80)] = { ratings: clean.ratings, again: clean.again, newCards: clean.newCards, quiz: clean.quiz, quizCorrect: clean.quizCorrect };
    }
    if (Object.keys(devices).length) out.devices = devices;
  }
  return out;
}
function isObj(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }

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

function withoutDevices(day: DayStat): DeviceStat { return { ratings: day.ratings, again: day.again, newCards: day.newCards, quiz: day.quiz, quizCorrect: day.quizCorrect }; }
function sumBuckets(buckets: Record<string, DeviceStat>): DeviceStat {
  const out = { ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 };
  for (const bucket of Object.values(buckets)) {
    out.ratings += bucket.ratings || 0; out.again += bucket.again || 0; out.newCards += bucket.newCards || 0;
    out.quiz += bucket.quiz || 0; out.quizCorrect += bucket.quizCorrect || 0;
  }
  return out;
}
/** 撤销扣减: 只动本设备桶, 各端合并后合计正确传播(F07)。 */
export function reduceStat(store: StatStore, subject: string, patch: Partial<Omit<DayStat, "date">>, date: string): void {
  const days = readDays(store, subject);
  const day = days[date];
  if (!day) return;
  const device = getDeviceId();
  const buckets: Record<string, DeviceStat> = day.devices && Object.keys(day.devices).length ? { ...day.devices } : { [LEGACY_DEVICE]: withoutDevices(day) };
  const mine = buckets[device] || { ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 };
  buckets[device] = {
    ratings: Math.max(0, mine.ratings - (patch.ratings || 0)),
    again: Math.max(0, mine.again - (patch.again || 0)),
    newCards: Math.max(0, mine.newCards - (patch.newCards || 0)),
    quiz: Math.max(0, mine.quiz - (patch.quiz || 0)),
    quizCorrect: Math.max(0, mine.quizCorrect - (patch.quizCorrect || 0)),
  };
  const updated: DayStat = { ...day, ...sumBuckets(buckets), devices: buckets };
  try {
    store.setItem(statsKey(subject), JSON.stringify({ ...days, [date]: updated }));
    notifyStorage("yantu-storage-saved");
  } catch { notifyStorage("yantu-storage-error", { store: "stats", subject }); }
}

export function recordStat(store: StatStore, subject: string, patch: Partial<Omit<DayStat, "date">>, now: Date = new Date()): DayStat {
  const date = studyDate(now);
  const days = readDays(store, subject);
  const device = getDeviceId();
  const base = days[date] || { date, ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0, devices: {} };
  const buckets: Record<string, DeviceStat> = base.devices && Object.keys(base.devices).length ? { ...base.devices } : { [LEGACY_DEVICE]: withoutDevices(base) };
  const mine = buckets[device] || { ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 };
  buckets[device] = {
    ratings: mine.ratings + (patch.ratings || 0),
    again: mine.again + (patch.again || 0),
    newCards: mine.newCards + (patch.newCards || 0),
    quiz: mine.quiz + (patch.quiz || 0),
    quizCorrect: mine.quizCorrect + (patch.quizCorrect || 0),
  };
  const next: DayStat = { date, ...sumBuckets(buckets), devices: buckets };
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
