/** 收藏星标(D): 闪卡/选择题可收藏, 快捷过滤"只看收藏"。按科目存卡 ID 列表。 */
export const favoritesKey = "yantu-favorites-v1";
export type FavoriteKind = "card" | "choice";

function readAll(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(favoritesKey);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (Array.isArray(value)) out[key] = value.filter((id): id is string => typeof id === "string" && id.length <= 200).slice(0, 5000);
    }
    return out;
  } catch { return {}; }
}

function writeAll(all: Record<string, string[]>): void {
  try { localStorage.setItem(favoritesKey, JSON.stringify(all)); } catch { /* 收藏失败可接受 */ }
}

const slot = (subject: string, kind: FavoriteKind) => `${subject}:${kind}`;

export function readFavorites(subject: string, kind: FavoriteKind = "card"): Set<string> {
  return new Set(readAll()[slot(subject, kind)] || []);
}

/** 返回切换后的新集合(已写入存储)。 */
export function toggleFavorite(subject: string, id: string, kind: FavoriteKind = "card"): Set<string> {
  const all = readAll();
  const key = slot(subject, kind);
  const list = new Set(all[key] || []);
  if (list.has(id)) list.delete(id); else list.add(id);
  all[key] = [...list];
  writeAll(all);
  return list;
}

export function favoriteCount(subject: string, kind: FavoriteKind = "card"): number {
  return (readAll()[slot(subject, kind)] || []).length;
}
