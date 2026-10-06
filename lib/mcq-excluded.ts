/** 人工"不适合选择题"排除标记: 用户在自测中标记的卡不再进入自动选择题。 */
export const mcqExcludedKey = "yantu-mcq-excluded-v1";

export function readMcqExcluded(): Set<string> {
  try {
    const raw = localStorage.getItem(mcqExcludedKey);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.length <= 200));
  } catch { return new Set(); }
}

export function addMcqExcluded(cardId: string): Set<string> {
  const set = readMcqExcluded();
  set.add(cardId);
  try { localStorage.setItem(mcqExcludedKey, JSON.stringify([...set])); } catch { /* ignore */ }
  return set;
}

export function resetMcqExcluded(): Set<string> {
  const empty = new Set<string>();
  try { localStorage.removeItem(mcqExcludedKey); } catch { /* ignore */ }
  return empty;
}
