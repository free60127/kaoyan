/** 云同步合并策略(纯函数, 可测试)。每类数据有自己的合并语义:
 *  - srs: 按卡片取 lastReviewedAt 较新的复习状态; 范围/新学范围并集; 当日准入并集
 *  - done/mcq-excluded: 并集
 *  - mistakes: 按条目 id 取 lastAt 较新
 *  - stats: 按日、按字段取较大值(两台设备各自累计的计数取多者)
 *  - activity: 按 t+kind+label 去重合并, 保留最近 300 条
 *  - personal: 覆盖层/个人卡按条目 rev 较高者, seq 取最大
 *  - session/exam/mock: 整键 last-write-wins(由引擎按 updated_at 判定)
 * 全部防御式: 形状不符时保守返回原值, 绝不抛错。 */

export type MergeKind = "srs" | "done" | "mistakes" | "stats" | "activity" | "excluded" | "personal";

export const SYNCABLE_KEYS: Record<string, MergeKind> = {
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
  // 以下键由引擎按 LWW 处理(不在本表中的可同步键走 lww)
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isArr = Array.isArray;

/** 返回合并结果与是否有变化; local/remote 为 JSON 对象(未知形状)。 */
export function mergeKeyValue(kind: MergeKind | "lww", local: unknown, remote: unknown): { value: unknown; changed: boolean } {
  if (local === undefined || local === null) return { value: remote, changed: remote !== undefined && remote !== null };
  if (remote === undefined || remote === null) return { value: local, changed: false };
  if (local === remote) return { value: local, changed: false };
  try {
    switch (kind) {
      case "srs": return mergeSrs(local, remote);
      case "done": case "excluded": return mergeUnion(local, remote);
      case "mistakes": return mergeMistakes(local, remote);
      case "stats": return mergeStats(local, remote);
      case "activity": return mergeActivity(local, remote);
      case "personal": return mergePersonal(local, remote);
      default: return { value: remote, changed: true }; // lww
    }
  } catch { return { value: local, changed: false }; }
}

function mergeUnion(local: unknown, remote: unknown) {
  // 布尔映射(done 章节标记): true 并集——任一端标记过即保留
  if (isObj(local) && isObj(remote) && !isArr(local) && !isArr(remote)) {
    const merged: Record<string, unknown> = { ...local };
    let changed = false;
    for (const [key, value] of Object.entries(remote)) {
      const mergedValue = value === true || local[key] === true ? true : merged[key] ?? value;
      if (merged[key] !== mergedValue) { merged[key] = mergedValue; changed = true; }
    }
    return { value: merged, changed };
  }
  // 数组(excluded 排除标记): 去重并集
  if (!isArr(local) || !isArr(remote)) return { value: remote, changed: true };
  const set = new Set([...(local as unknown[]).map(v => JSON.stringify(v)), ...(remote as unknown[]).map(v => JSON.stringify(v))]);
  const merged = [...set].map(v => JSON.parse(v));
  return { value: merged, changed: merged.length !== (local as unknown[]).length };
}

function mergeSrs(local: unknown, remote: unknown) {
  if (!isObj(local) || !isObj(remote)) return { value: remote, changed: true };
  const lc = isObj(local.cards) ? local.cards : {};
  const rc = isObj(remote.cards) ? remote.cards : {};
  const cards: Record<string, unknown> = { ...lc };
  for (const [id, entry] of Object.entries(rc)) {
    const mine = lc[id];
    if (!isObj(mine)) { cards[id] = entry; continue; }
    const a = String(mine.lastReviewedAt || ""), b = String((entry as Record<string, unknown>).lastReviewedAt || "");
    cards[id] = b > a ? entry : mine;
  }
  const scopeUnion = (a: unknown, b: unknown) => {
    if (!isArr(a) || !isArr(b)) return isArr(b) ? b : a;
    const set = new Set(a.map(v => JSON.stringify(v)));
    for (const v of b) set.add(JSON.stringify(v));
    return [...set].map(v => JSON.parse(v));
  };
  const localDaily = isObj(local.daily) ? local.daily : null;
  const remoteDaily = isObj(remote.daily) ? remote.daily : null;
  let daily = localDaily ?? remoteDaily;
  if (localDaily && remoteDaily && localDaily.date === remoteDaily.date) {
    daily = { ...remoteDaily, admitted: scopeUnion(localDaily.admitted, remoteDaily.admitted) };
  } else if (localDaily && remoteDaily) {
    daily = String(remoteDaily.date) > String(localDaily.date) ? remoteDaily : localDaily;
  }
  const merged = {
    ...remote,
    cards,
    scopes: scopeUnion(local.scopes, remote.scopes),
    newScopes: scopeUnion(local.newScopes, remote.newScopes),
    dailyNewLimit: Math.max(Number(local.dailyNewLimit) || 0, Number(remote.dailyNewLimit) || 0) || remote.dailyNewLimit,
    daily,
  };
  return { value: merged, changed: JSON.stringify(merged) !== JSON.stringify(local) };
}

function mergeMistakes(local: unknown, remote: unknown) {
  if (!isArr(local) || !isArr(remote)) return { value: remote, changed: true };
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of [...local, ...remote] as Record<string, unknown>[]) {
    const id = String(item.id ?? "");
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) { byId.set(id, item); continue; }
    byId.set(id, String(item.lastAt || "") > String(existing.lastAt || "") ? item : existing);
  }
  const merged = [...byId.values()].sort((a, b) => String(b.lastAt || "").localeCompare(String(a.lastAt || ""))).slice(0, 20_000);
  return { value: merged, changed: JSON.stringify(merged) !== JSON.stringify(local) };
}

function mergeStats(local: unknown, remote: unknown) {
  if (!isObj(local) || !isObj(remote)) return { value: remote, changed: true };
  const merged: Record<string, unknown> = { ...local };
  for (const [date, entry] of Object.entries(remote)) {
    const mine = merged[date];
    if (!isObj(mine) || !isObj(entry)) { merged[date] = entry; continue; }
    merged[date] = {
      date: entry.date ?? date,
      ratings: Math.max(Number(mine.ratings) || 0, Number(entry.ratings) || 0),
      again: Math.max(Number(mine.again) || 0, Number(entry.again) || 0),
      newCards: Math.max(Number(mine.newCards) || 0, Number(entry.newCards) || 0),
      quiz: Math.max(Number(mine.quiz) || 0, Number(entry.quiz) || 0),
      quizCorrect: Math.max(Number(mine.quizCorrect) || 0, Number(entry.quizCorrect) || 0),
    };
  }
  return { value: merged, changed: JSON.stringify(merged) !== JSON.stringify(local) };
}

function mergeActivity(local: unknown, remote: unknown) {
  if (!isArr(local) || !isArr(remote)) return { value: remote, changed: true };
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const item of [...(local as unknown[]), ...(remote as unknown[])]) {
    if (!isObj(item)) continue;
    const key = `${item.t}|${item.kind}|${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  merged.sort((a, b) => String((a as Record<string, unknown>).t || "").localeCompare(String((b as Record<string, unknown>).t || "")));
  const trimmed = merged.slice(-300);
  return { value: trimmed, changed: JSON.stringify(trimmed) !== JSON.stringify(local) };
}

function mergePersonal(local: unknown, remote: unknown) {
  if (!isObj(local) || !isObj(remote)) return { value: remote, changed: true };
  const overlaysLocal = isObj(local.overlays) ? local.overlays : {};
  const overlaysRemote = isObj(remote.overlays) ? remote.overlays : {};
  const overlays: Record<string, unknown> = { ...overlaysLocal };
  for (const [key, entry] of Object.entries(overlaysRemote)) {
    const mine = overlaysLocal[key];
    if (!isObj(mine) || Number((entry as Record<string, unknown>).rev || 0) > Number(mine.rev || 0)) overlays[key] = entry;
  }
  const cardsLocal = isArr(local.cards) ? local.cards as Record<string, unknown>[] : [];
  const cardsRemote = isArr(remote.cards) ? remote.cards as Record<string, unknown>[] : [];
  const cardsById = new Map<string, Record<string, unknown>>();
  for (const card of [...cardsLocal, ...cardsRemote]) {
    const id = String(card.id ?? "");
    if (!id) continue;
    const existing = cardsById.get(id);
    if (!existing || Number(card.rev || 0) > Number(existing.rev || 0)) cardsById.set(id, card);
  }
  const merged = {
    version: 1,
    seq: Math.max(Number(local.seq) || 0, Number(remote.seq) || 0),
    overlays,
    cards: [...cardsById.values()],
  };
  return { value: merged, changed: JSON.stringify(merged) !== JSON.stringify(local) };
}

export const mergeKindFor = (key: string): MergeKind | "lww" => SYNCABLE_KEYS[key] ?? "lww";
