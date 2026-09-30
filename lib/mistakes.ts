export type MistakeKind = "card" | "quiz" | "practice";
export type Mistake = { id: string; subject: string; kind: MistakeKind; refId: string; label: string; wrongCount: number; lastAt: string };
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

/** Upsert: same subject+kind+refId accumulates wrongCount and refreshes lastAt. */
export function recordMistake(subject: string, kind: MistakeKind, refId: string, label: string, now: Date = new Date()): Mistake[] {
  const list = readMistakes();
  const id = mistakeId(subject, kind, refId);
  const existing = list.find(item => item.id === id);
  const next: Mistake = existing
    ? { ...existing, wrongCount: existing.wrongCount + 1, lastAt: now.toISOString(), label: label.slice(0, 200) || existing.label }
    : { id, subject, kind, refId, label: label.slice(0, 200), wrongCount: 1, lastAt: now.toISOString() };
  const updated = [next, ...list.filter(item => item.id !== id)];
  try { localStorage.setItem(mistakesStorageKey, JSON.stringify(updated)); } catch { /* 存储不可用时仅本次会话可见 */ }
  return updated;
}

export function removeMistake(id: string): Mistake[] {
  return removeMistakes([id]);
}

/** Remove several mistakes at once (e.g. after a re-quiz round masters them). */
export function removeMistakes(ids: readonly string[]): Mistake[] {
  const drop = new Set(ids);
  const updated = readMistakes().filter(item => !drop.has(item.id));
  try { localStorage.setItem(mistakesStorageKey, JSON.stringify(updated)); } catch { /* ignore */ }
  return updated;
}

export function clearMistakes(subject: string): Mistake[] {
  const updated = readMistakes().filter(item => item.subject !== subject);
  try { localStorage.setItem(mistakesStorageKey, JSON.stringify(updated)); } catch { /* ignore */ }
  return updated;
}

/** For tests and import paths that work on a raw string. */
export const parseMistakes = parseList;

/** Re-quiz selection: newest mistakes of one subject first, capped. */
export function selectRequizList(list: Mistake[], subject: string, limit = 20): Mistake[] {
  return list
    .filter(item => item.subject === subject && item.kind !== "quiz")
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || b.wrongCount - a.wrongCount)
    .slice(0, limit);
}
