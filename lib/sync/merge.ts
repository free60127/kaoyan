/** 旧版数据首次导入的合并策略(纯函数)。正常同步使用 document.ts 的因果版本。
 *  这里不负责撤销、集合删除等正常同步操作，仅兼容没有版本记录的旧数据。
 *  设计要点:
 *  - canonicalJson: 递归排序对象键的稳定序列化——一切"是否有变化"的判断都用它,
 *    键插入顺序不同不再造成回推循环(F06)。
 *  - 输出全部规范化(映射键排序), 双端收敛到逐字节相同的内容。
 *  - done: {marks, touch} 按触碰时间逐键判定, 撤销/取消不再被旧值复活(F08)。
 *  - stats: devices 按设备分桶, 合并按设备逐字段取较大, 显示合计(F07 并行学习不吞计数)。
 *  - mistakes: 删除留 tombstone(deleted), 合并按 id 取 lastAt 新者, 删除不复活(F08)。
 *  - personal: rev 高者胜; 同 rev 内容分歧时无损拼接双方文本并升 rev(F03 不丢任一笔记)。
 *  - session: 位置/科目保留本机，草稿按键并集，同键保留双方文字。
 * 全部防御式: 形状不符保守返回, 绝不抛错。 */


export type MergeKind = "srs" | "done" | "mistakes" | "stats" | "activity" | "excluded" | "personal" | "session" | "timing" | "timingSettings";

export const SYNCABLE_KEYS: Record<string, MergeKind> = {
  "yantu-card-timing-settings-v1": "timingSettings",
  "yantu-card-timing-v1-333": "timing",
  "yantu-card-timing-v1-825": "timing",
  "yantu-card-timing-v1-politics": "timing",
  "yantu-srs-v1-333": "srs",
  "yantu-srs-v1-825": "srs",
  "yantu-srs-v1-politics": "srs",
  "yantu-done": "done",
  "yantu-done-825": "done",
  "yantu-done-politics": "done",
  "yantu-mistakes-v1": "mistakes",
  "yantu-stats-v1-333": "stats",
  "yantu-stats-v1-825": "stats",
  "yantu-stats-v1-politics": "stats",
  "yantu-activity-v1-333": "activity",
  "yantu-activity-v1-825": "activity",
  "yantu-activity-v1-politics": "activity",
  "yantu-mcq-excluded-v1": "excluded",
  "yantu-personal-v1": "personal",
  "yantu-learning-session-v1": "session",
};

/** 整键 last-write-wins(引擎按同步结果判定先后): 考试日期、AI 模拟卷记录。 */
export const LWW_KEYS = new Set(["yantu-exam-target-v1", "kaoyan.mock-practice.v1.333", "kaoyan.mock-practice.v1.825"]);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isArr = Array.isArray;
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** 递归排序对象键的稳定序列化: 内容相同则字符串相同, 与键插入顺序无关。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (isArr(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

export const mergeKindFor = (key: string): MergeKind | "lww" => (key in SYNCABLE_KEYS ? SYNCABLE_KEYS[key] : LWW_KEYS.has(key) ? "lww" : "lww");

/** 合并入口: 返回合并结果与(规范化意义下)是否有变化。 */
export function mergeKeyValue(kind: MergeKind | "lww", local: unknown, remote: unknown): { value: unknown; changed: boolean } {
  if (local === undefined || local === null) return { value: remote, changed: remote !== undefined && remote !== null };
  if (remote === undefined || remote === null) return { value: local, changed: false };
  if (canonicalJson(local) === canonicalJson(remote)) return { value: local, changed: false };
  try {
    let value: unknown;
    switch (kind) {
      case "srs": value = mergeSrs(local, remote); break;
      case "done": value = mergeDone(local, remote); break;
      case "mistakes": value = mergeMistakes(local, remote); break;
      case "stats": value = mergeStats(local, remote); break;
      case "activity": value = mergeActivity(local, remote); break;
      case "excluded": value = mergeArrayUnion(local, remote); break;
      case "personal": value = mergePersonal(local, remote); break;
      case "session": value = mergeSession(local, remote); break;
      case "timing": value = { ...(isObj(local) ? local : {}), ...(isObj(remote) ? remote : {}) }; break;
      case "timingSettings": value = { enabled: isObj(local) && local.enabled === true && isObj(remote) && remote.enabled === true }; break;
      default: value = remote;
    }
    value = JSON.parse(canonicalJson(value)); // 输出规范化: 键序确定, 双端收敛到相同字节
    return { value, changed: canonicalJson(value) !== canonicalJson(local) };
  } catch { return { value: local, changed: false }; }
}

// ---------- srs ----------
function mergeSrs(local: unknown, remote: unknown) {
  const lc = isObj(local) && isObj(local.cards) ? local.cards as Record<string, unknown> : {};
  const rc = isObj(remote) && isObj(remote.cards) ? remote.cards as Record<string, unknown> : {};
  const cards: Record<string, unknown> = {};
  for (const id of [...new Set([...Object.keys(lc), ...Object.keys(rc)])].sort()) {
    const mine = lc[id], theirs = rc[id];
    if (!isObj(mine)) { cards[id] = theirs; continue; }
    if (!isObj(theirs)) { cards[id] = mine; continue; }
    cards[id] = String(theirs.lastReviewedAt || "") > String(mine.lastReviewedAt || "") ? theirs : mine;
  }
  const daily = mergeDaily(local, remote);
  return { ...((remote as Record<string, unknown>) || {}), cards, scopes: sortedUnion(local, remote, "scopes"), newScopes: sortedUnion(local, remote, "newScopes"), daily };
}
function mergeDaily(local: unknown, remote: unknown) {
  const ld = isObj(local) && isObj(local.daily) ? local.daily as Record<string, unknown> : null;
  const rd = isObj(remote) && isObj(remote.daily) ? remote.daily as Record<string, unknown> : null;
  if (!ld) return rd; if (!rd) return ld;
  if (ld.date !== rd.date) return String(ld.date || "") > String(rd.date || "") ? ld : rd;
  const admitted = [...new Set([...arrOf(ld.admitted).map(canonicalJson), ...arrOf(rd.admitted).map(canonicalJson)])].sort().map(v => JSON.parse(v));
  return { ...rd, admitted };
}
function arrOf(v: unknown): unknown[] { return isArr(v) ? v : []; }
function sortedUnion(local: unknown, remote: unknown, field: string) {
  const a = isObj(local) && isArr(local[field]) ? local[field] as unknown[] : [];
  const b = isObj(remote) && isArr(remote[field]) ? remote[field] as unknown[] : [];
  return [...new Set([...a, ...b].map(canonicalJson))].map(v => JSON.parse(v)).sort((x, y) => compare(canonicalJson(x), canonicalJson(y)));
}

// ---------- done ----------
type DoneShape = { marks: Record<string, boolean>; touch: Record<string, { v: boolean; t: string; d: string }> };
function toDoneShape(value: unknown): DoneShape {
  if (isObj(value) && isObj(value.marks)) {
    const out: DoneShape = { marks: {}, touch: {} };
    for (const [key, v] of Object.entries(value.marks as Record<string, unknown>)) if (typeof v === "boolean") out.marks[key] = v;
    if (isObj(value.touch)) {
      for (const [key, entry] of Object.entries(value.touch as Record<string, unknown>)) {
        const item = entry as Record<string, unknown>;
        if (typeof item.v === "boolean" && typeof item.t === "string") out.touch[key] = { v: item.v, t: item.t, d: typeof item.d === "string" ? item.d : "" };
      }
    }
    return out;
  }
  // 旧版纯布尔映射迁移
  const out: DoneShape = { marks: {}, touch: {} };
  if (isObj(value)) for (const [key, v] of Object.entries(value)) if (typeof v === "boolean") out.marks[key] = v;
  return out;
}
/** 按触碰时间逐键判定(F08): 撤销的 false 有更新的触碰, 不再被另一端旧 true 复活。 */
function mergeDone(local: unknown, remote: unknown) {
  const a = toDoneShape(local), b = toDoneShape(remote);
  const marks: Record<string, boolean> = { ...a.marks };
  const touch: DoneShape["touch"] = { ...a.touch };
  for (const key of [...new Set([...Object.keys(a.marks), ...Object.keys(b.marks), ...Object.keys(a.touch), ...Object.keys(b.touch)])].sort()) {
    const ta = a.touch[key], tb = b.touch[key];
    if (ta && tb) {
      const winner = tb.t > ta.t || tb.t === ta.t && canonicalJson(tb) > canonicalJson(ta) ? tb : ta;
      marks[key] = winner.v; touch[key] = winner;
    } else if (tb) {
      // 明确触碰优先于无时间的旧数据，包括取消标记。
      const v = tb.v;
      marks[key] = v === true; touch[key] = { v: v === true, t: tb.t, d: tb.d || "" };
    } else if (ta) {
      const v = ta.v;
      marks[key] = v === true; touch[key] = { v: v === true, t: ta.t, d: ta.d || "" };
    } else {
      const v = a.marks[key] === true || b.marks[key] === true ? true : a.marks[key] ?? b.marks[key] ?? false;
      marks[key] = v === true;
    }
  }
  return { marks, touch };
}

// ---------- mistakes(含 tombstone) ----------
function mergeMistakes(local: unknown, remote: unknown) {
  if (!isArr(local) || !isArr(remote)) return remote;
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of [...local, ...remote] as Record<string, unknown>[]) {
    const id = String(item.id ?? "");
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) { byId.set(id, item); continue; }
    // 同时刻删除优先；新的答错记录可以恢复到可见列表。
    if ((item.deleted === true || existing.deleted === true) && item.lastAt === existing.lastAt) {
      byId.set(id, item.deleted === true ? item : existing);
      continue;
    }
    const newer = String(item.lastAt || "") > String(existing.lastAt || "") ? item : existing;
    byId.set(id, { ...newer, wrongCount: Math.max(Number(item.wrongCount) || 0, Number(existing.wrongCount) || 0) });
  }
  return [...byId.values()].sort((a, b) => compare(String(a.id), String(b.id)));
}

// ---------- stats(设备分桶) ----------
type DeviceBucket = Record<string, Record<string, number>>;
function mergeStats(local: unknown, remote: unknown) {
  if (!isObj(local) || !isObj(remote)) return remote;
  const days: Record<string, unknown> = { ...local };
  for (const [date, entry] of Object.entries(remote)) {
    const mine = days[date];
    if (!isObj(mine) || !isObj(entry)) { days[date] = entry; continue; }
    const a = isObj(mine.devices) ? mine.devices as DeviceBucket : (Object.keys(mine).some(k => k !== "date" && k !== "devices") ? { legacy: pickFields(mine) } : {});
    const b = isObj(entry.devices) ? entry.devices as DeviceBucket : (Object.keys(entry).some(k => k !== "date" && k !== "devices") ? { legacy: pickFields(entry) } : {});
    const devices: DeviceBucket = {};
    for (const deviceId of [...new Set([...Object.keys(a), ...Object.keys(b)])]) {
      const da = a[deviceId] || {}, db = b[deviceId] || {};
      devices[deviceId] = {
        ratings: Math.max(Number(da.ratings) || 0, Number(db.ratings) || 0),
        again: Math.max(Number(da.again) || 0, Number(db.again) || 0),
        newCards: Math.max(Number(da.newCards) || 0, Number(db.newCards) || 0),
        quiz: Math.max(Number(da.quiz) || 0, Number(db.quiz) || 0),
        quizCorrect: Math.max(Number(da.quizCorrect) || 0, Number(db.quizCorrect) || 0),
      };
    }
    const total: Record<string, unknown> = { date };
    const sum = { ratings: 0, again: 0, newCards: 0, quiz: 0, quizCorrect: 0 };
    for (const bucket of Object.values(devices)) {
      sum.ratings += bucket.ratings || 0; sum.again += bucket.again || 0; sum.newCards += bucket.newCards || 0;
      sum.quiz += bucket.quiz || 0; sum.quizCorrect += bucket.quizCorrect || 0;
    }
    Object.assign(total, sum);
    days[date] = { ...total, devices };
  }
  return days;
}
function pickFields(row: Record<string, unknown>): Record<string, number> {
  return {
    ratings: Number(row.ratings) || 0, again: Number(row.again) || 0,
    newCards: Number(row.newCards) || 0, quiz: Number(row.quiz) || 0,
    quizCorrect: Number(row.quizCorrect) || 0,
  };
}

// ---------- activity / excluded ----------
function mergeActivity(local: unknown, remote: unknown) {
  if (!isArr(local) || !isArr(remote)) return remote;
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const item of [...local, ...remote] as Record<string, unknown>[]) {
    if (!isObj(item)) continue;
    const key = `${item.t}|${item.kind}|${item.subject || ""}|${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) => compare(String(a.t || ""), String(b.t || "")));
  return merged.slice(-300);
}
function mergeArrayUnion(local: unknown, remote: unknown) {
  if (!isArr(local) || !isArr(remote)) return remote;
  return [...new Set([...local, ...remote].map(canonicalJson))].map(v => JSON.parse(v)).sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
}

// ---------- personal(同 rev 无损合并) ----------
/** 同 rev 内容分歧(F03): 以设备 id 决定拼接顺序, 双方文本都保留——确定性、无损、双端收敛。
 *  注: 前后端/搜索会把这类拼接文本按普通文本处理, 用户可再编辑整理。 */
function concatConflict(a: string, b: string): string {
  // 按文本自身字典序排序: 与"哪台设备执行合并"无关, 双端结果逐字节一致(F03 收敛)
  const [head, tail] = a <= b ? [a, b] : [b, a];
  return `${head}\n——另一设备的修改——\n${tail}`;
}

function mergePersonal(local: unknown, remote: unknown) {
  const lo = isObj(local) ? local : {};
  const ro = isObj(remote) ? remote : {};
  const overlaysLocal = isObj(lo.overlays) ? lo.overlays as Record<string, unknown> : {};
  const overlaysRemote = isObj(ro.overlays) ? ro.overlays as Record<string, unknown> : {};
  const overlays: Record<string, unknown> = {};
  for (const key of [...new Set([...Object.keys(overlaysLocal), ...Object.keys(overlaysRemote)])].sort()) {
    const mine = overlaysLocal[key], theirs = overlaysRemote[key];
    if (!isObj(mine)) { overlays[key] = theirs; continue; }
    if (!isObj(theirs)) { overlays[key] = mine; continue; }
    const revM = Number(mine.rev || 0), revT = Number(theirs.rev || 0);
    if (revM !== revT) { overlays[key] = revM > revT ? mine : theirs; continue; }
    // 同 rev 且内容不同(F03 并发编辑): 文本无损拼接, rev+1, 双端确定性收敛
    if (canonicalJson(mine) !== canonicalJson(theirs)) {
      overlays[key] = conflictMergeEntries(mine, theirs);
    } else overlays[key] = mine;
  }
  const cardsLocal = isArr(lo.cards) ? lo.cards as Record<string, unknown>[] : [];
  const cardsRemote = isArr(ro.cards) ? ro.cards as Record<string, unknown>[] : [];
  const cardsById = new Map<string, Record<string, unknown>>();
  for (const card of [...cardsLocal, ...cardsRemote]) {
    const id = String(card.id ?? "");
    if (!id) continue;
    const existing = cardsById.get(id);
    if (!existing) { cardsById.set(id, card); continue; }
    const revM = Number(existing.rev || 0), revT = Number(card.rev || 0);
    if (revM !== revT) { cardsById.set(id, revM > revT ? existing : card); continue; }
    if (canonicalJson(existing) !== canonicalJson(card)) {
      cardsById.set(id, conflictMergeEntries(existing, card));
    } else cardsById.set(id, existing);
  }
  return {
    version: 1,
    seq: Math.max(Number(lo.seq || 0), Number(ro.seq || 0)),
    overlays,
    cards: [...cardsById.values()].sort((a, b) => compare(String(a.id), String(b.id))),
  };
}

function conflictMergeEntries(mine: Record<string, unknown>, theirs: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(canonicalJson(mine) > canonicalJson(theirs) ? mine : theirs) };
  const substantive = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "updatedAt" && key !== "rev"));
  const conflict = canonicalJson(substantive(mine)) !== canonicalJson(substantive(theirs));
  merged.updatedAt = [String(mine.updatedAt || ""), String(theirs.updatedAt || "")].sort().at(-1);
  for (const field of ["q", "a", "note", "front", "back"] as const) {
    const mineText = typeof mine[field] === "object" && mine[field] !== null ? String((mine[field] as Record<string, unknown>).text || "") : typeof mine[field] === "string" ? mine[field] as string : "";
    const theirsText = typeof theirs[field] === "object" && theirs[field] !== null ? String((theirs[field] as Record<string, unknown>).text || "") : typeof theirs[field] === "string" ? theirs[field] as string : "";
    if (mineText === theirsText) continue;
    if (!mineText || !theirsText) { merged[field] = mineText ? mine[field] : theirs[field]; continue; }
    const ordered = mineText <= theirsText ? [mine[field], theirs[field]] : [theirs[field], mine[field]];
    if (typeof mine[field] === "object" || typeof theirs[field] === "object") {
      const left = isObj(ordered[0]) ? ordered[0] : { text: ordered[0], runs: [] };
      const right = isObj(ordered[1]) ? ordered[1] : { text: ordered[1], runs: [] };
      const offset = String(left.text).length + "\n——另一设备的修改——\n".length;
      merged[field] = { text: concatConflict(mineText, theirsText), runs: [...arrOf(left.runs), ...arrOf(right.runs).filter(isObj).map(run => ({ ...run, start: Number(run.start) + offset, end: Number(run.end) + offset }))] };
    } else merged[field] = concatConflict(mineText, theirsText);
  }
  merged.rev = Math.max(revOf(mine), revOf(theirs)) + (conflict ? 1 : 0);
  return merged;
}
function revOf(entry: Record<string, unknown>): number { return Number(entry.rev || 0); }

// ---------- session(位置每设备保留, 草稿按键并集) ----------
function mergeSession(local: unknown, remote: unknown) {
  const lo = isObj(local) ? local : {};
  const ro = isObj(remote) ? remote : {};
  const merged: Record<string, unknown> = JSON.parse(JSON.stringify(ro));
  merged.subject = lo.subject ?? ro.subject ?? "333";
  merged.locations = isObj(lo.locations) ? JSON.parse(JSON.stringify(lo.locations)) : ro.locations; // 导航每设备独立
  const unionMaps = (localKey: string, remoteKey: string) => {
    const a = isObj(lo[localKey]) ? lo[localKey] as Record<string, unknown> : {};
    const b = isObj(ro[remoteKey]) ? ro[remoteKey] as Record<string, unknown> : {};
    const merged: Record<string, unknown> = { ...b, ...a };
    for (const key of Object.keys(a)) if (typeof a[key] === "string" && typeof b[key] === "string" && a[key] !== b[key]) merged[key] = [...new Set([...String(a[key]).split("\n——另一设备的修改——\n"), ...String(b[key]).split("\n——另一设备的修改——\n")])].sort().join("\n——另一设备的修改——\n");
    return merged;
  };
  merged.feynmanDrafts = unionMaps("feynmanDrafts", "feynmanDrafts");
  merged.pastAnswers = unionMaps("pastAnswers", "pastAnswers");
  merged.plannerPrompts = unionMaps("plannerPrompts", "plannerPrompts");
  return merged;
}
