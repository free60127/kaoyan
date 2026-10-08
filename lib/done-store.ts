/** 章节标记存储(F08/F09): marks + 每键触碰时间/设备, 云合并用触碰判定新旧,
 *  撤销(标记 false)不会再被另一端的旧 true 复活。旧版纯布尔映射自动迁移。 */
import { getDeviceId } from "./device";

export type DoneValue = {
  marks: Record<string, boolean>;
  touch: Record<string, { v: boolean; t: string; d: string }>;
};

export function normalizeDone(raw: unknown): DoneValue {
  const marks: Record<string, boolean> = {};
  const touch: Record<string, { v: boolean; t: string; d: string }> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "boolean") marks[key] = value;
    }
  }
  return { marks, touch };
}

export function readDone(store: { getItem(key: string): string | null }, key: string): DoneValue {
  try {
    const raw = store.getItem(key);
    if (!raw) return normalizeDone(null);
    const parsed: unknown = JSON.parse(raw);
    // 新版形状 { marks, touch }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "marks" in (parsed as Record<string, unknown>)) {
      const row = parsed as Record<string, unknown>;
      const normalized = normalizeDone(row.marks);
      const touch: Record<string, { v: boolean; t: string; d: string }> = {};
      if (row.touch && typeof row.touch === "object" && !Array.isArray(row.touch)) {
        for (const [k, entry] of Object.entries(row.touch as Record<string, unknown>)) {
          const item = entry as Record<string, unknown>;
          if (typeof item.v === "boolean" && typeof item.t === "string") touch[k] = { v: item.v, t: item.t, d: typeof item.d === "string" ? item.d : "" };
        }
      }
      return { marks: normalized.marks, touch };
    }
    return normalizeDone(parsed); // 旧版纯布尔映射
  } catch { return normalizeDone(null); }
}

export function writeDone(store: { getItem(key: string): string | null; setItem(key: string, value: string): void }, key: string, marks: Record<string, boolean>, changedKeys: string[]): boolean {
  const previous = readDone(store, key);
  const now = new Date().toISOString();
  const device = getDeviceId();
  const touch = { ...previous.touch };
  for (const changed of changedKeys) {
    touch[changed] = { v: marks[changed] === true, t: now, d: device };
  }
  try {
    store.setItem(key, JSON.stringify({ marks, touch }));
    return true;
  } catch { return false; }
}
