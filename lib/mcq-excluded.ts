/** 人工"不适合选择题"排除标记: 用户在自测/题库练习中标记的题不再进入自动组卷。
 *  按科目分键(333 与政治题库互不干扰); 无参调用默认 333, 兼容旧数据。 */
const keyFor = (subject: string) => `yantu-mcq-excluded-v1${subject && subject !== "333" ? `-${subject}` : ""}`;

export function mcqExcludedKey(subject = "333"): string {
  return keyFor(subject);
}

export function readMcqExcluded(subject = "333"): Set<string> {
  try {
    const raw = localStorage.getItem(keyFor(subject));
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length <= 200));
  } catch { return new Set(); }
}

export function addMcqExcluded(cardId: string, subject = "333"): Set<string> {
  const set = readMcqExcluded(subject);
  set.add(cardId);
  try { localStorage.setItem(keyFor(subject), JSON.stringify([...set])); } catch { /* ignore */ }
  return set;
}

export function resetMcqExcluded(subject = "333"): Set<string> {
  const empty = new Set<string>();
  try { localStorage.removeItem(keyFor(subject)); } catch { /* ignore */ }
  return empty;
}
