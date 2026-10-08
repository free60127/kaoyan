/** 设备标识: 同步合并时区分"哪台设备写入的", 生成一次永久使用。 */
export const deviceIdKey = "yantu-device-id";

export function getDeviceId(): string {
  try {
    const existing = localStorage.getItem(deviceIdKey);
    if (existing) return existing;
    const id = `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(deviceIdKey, id);
    return id;
  } catch { return "d-unknown"; }
}

export function deviceLabel(selfId: string, otherId: string): string {
  return otherId === selfId ? "本机" : "另一设备";
}
