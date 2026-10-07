/** 云同步引擎: Supabase(邮箱登录) + kv 行存储 + 实时订阅。
 *  - 推送: 周期 diff 本地可同步键与上次同步快照, 变化即 upsert(updated_at=now)
 *  - 拉取: realtime 行变更 → 按类型智能合并 → 写回 localStorage → 合成 storage 事件驱动全页刷新
 *  - 冲突: 按类型的确定性合并(SRS 按卡/错题按条目/计数取大/个人层按 rev), 双端离线修改可收敛
 *  不同步: 选择题未完成题组、自由浏览位置、DeepSeek 密钥(仅会话存储)。 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mergeKindFor, mergeKeyValue, SYNCABLE_KEYS, type MergeKind } from "./merge";

const CONFIG_KEY = "yantu-sync-config";
const LWW_KEYS = new Set(["yantu-learning-session-v1", "yantu-exam-target-v1", "kaoyan.mock-practice.v1.333", "kaoyan.mock-practice.v1.825"]);
const PUSH_INTERVAL_MS = 5000;
const ACTIVITY_LIMIT_KEYS = true;

export type SyncState = "off" | "signed-out" | "connecting" | "online" | "error";
export type SyncStatus = { state: SyncState; email?: string; error?: string; lastSync?: string };

let client: SupabaseClient | null = null;
let userId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let channel: ReturnType<SupabaseClient["channel"]> | null = null;
/** key → 上次同步的本地 JSON 快照与行时间戳 */
const lastSynced = new Map<string, { json: string; updatedAt: string }>();
const listeners = new Set<(status: SyncStatus) => void>();
let status: SyncStatus = { state: "off" };

export const SYNC_EXCLUDED = ["选择题未完成题组与自由浏览位置"];

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

export function getSyncStatus(): SyncStatus { return status; }
export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export type SyncConfig = { url: string; anonKey: string };
export function getSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SyncConfig>;
    if (typeof parsed.url !== "string" || !parsed.url.startsWith("https://") || typeof parsed.anonKey !== "string" || !parsed.anonKey) return null;
    return { url: parsed.url, anonKey: parsed.anonKey };
  } catch { return null; }
}
export function saveSyncConfig(config: SyncConfig): void {
  // 常见粘贴错误容错: 去掉 /rest/v1、/auth/v1 等接口后缀, 只保留 协议+主机+项目ref
  const url = config.url.trim().replace(/\/+$/, "").replace(/^(https:\/\/[^/]+).*$/i, "$1");
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, anonKey: config.anonKey.trim() }));
}

function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, json: string) {
  const previous = localStorage.getItem(key);
  if (previous === json) return;
  try {
    localStorage.setItem(key, json);
    // 合成 storage 事件: 同标签内的复习/统计/错题/个人层监听器据此刷新
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: json, oldValue: previous, storageArea: localStorage, url: location.href }));
  } catch { /* 配额满等写入失败: 下个周期重试 */ }
}

function syncableKey(key: string): boolean {
  return key in SYNCABLE_KEYS || LWW_KEYS.has(key);
}
function mergeKindOf(key: string): MergeKind | "lww" {
  return LWW_KEYS.has(key) ? "lww" : mergeKindFor(key);
}

/** 远端行 → 合并进本地; 返回是否写入了本地。
 *  合并结果若是远端的超集(本地有更新内容), 必须回推到云端——否则另一台设备永远看不到(F08场景)。
 *  lastSynced 的写入顺序: 回推完成后才记录快照, 否则去重检查会误跳过回推。 */
function applyRemote(key: string, remoteValue: unknown, updatedAt: string): boolean {
  if (!syncableKey(key)) return false;
  const known = lastSynced.get(key);
  if (known && known.updatedAt >= updatedAt) return false; // 已应用过更新的版本
  const localJson = readLocal(key);
  const localValue = localJson === null ? null : JSON.parse(localJson);
  const kind = mergeKindOf(key);
  const merged = localJson === null ? { value: remoteValue, changed: true } : mergeKeyValue(kind, localValue, remoteValue);
  const mergedJson = JSON.stringify(merged.value);
  if (localJson !== mergedJson) writeLocal(key, mergedJson);
  const remoteIsBehind = JSON.stringify(remoteValue) !== mergedJson;
  if (remoteIsBehind) {
    void pushKey(key, mergedJson, true);
    lastSynced.set(key, { json: mergedJson, updatedAt: new Date().toISOString() });
  } else {
    lastSynced.set(key, { json: mergedJson, updatedAt });
  }
  return localJson !== mergedJson;
}

async function pushKey(key: string, jsonOverride?: string, force = false) {
  if (!client || !userId) return;
  const json = jsonOverride ?? readLocal(key) ?? "";
  const known = lastSynced.get(key);
  if (!force && known && known.json === json) return;
  let value: unknown;
  try { value = json === "" ? null : JSON.parse(json); } catch { return; }
  const updatedAt = new Date().toISOString();
  const { error } = await client.from("kv_store").upsert({ user_id: userId, key, value, updated_at: updatedAt });
  if (error) { setStatus({ state: "error", error: `上传 ${key} 失败：${error.message}` }); return; }
  lastSynced.set(key, { json, updatedAt });
  setStatus({ state: "online", error: undefined, lastSync: new Date().toISOString() });
}

async function pushChanged(): Promise<number> {
  if (!client || !userId) return 0;
  const pushed: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !syncableKey(key)) continue;
    const json = readLocal(key) ?? "";
    const known = lastSynced.get(key);
    if (known && known.json === json) continue;
    await pushKey(key, json);
    pushed.push(key);
  }
  return pushed.length;
}

async function pullAll(): Promise<number> {
  if (!client || !userId) return 0;
  const { data, error } = await client.from("kv_store").select("key, value, updated_at").eq("user_id", userId);
  if (error) { setStatus({ state: "error", error: `下载失败：${error.message}` }); return 0; }
  let applied = 0;
  for (const row of data ?? []) {
    if (applyRemote(String(row.key), row.value, String(row.updated_at))) applied += 1;
    else if (!lastSynced.has(String(row.key))) lastSynced.set(String(row.key), { json: readLocal(String(row.key)) ?? "", updatedAt: String(row.updated_at) });
  }
  setStatus({ state: "online", error: undefined, lastSync: new Date().toISOString() });
  return applied;
}

async function fullSync(): Promise<void> {
  await pullAll();
  await pushChanged();
}

export async function syncNow(): Promise<void> {
  if (!client || !userId) return;
  await fullSync();
}

async function startOnline(sessionEmail: string): Promise<void> {
  setStatus({ state: "connecting", error: undefined });
  await fullSync();
  channel = client!.channel("kv-store-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "kv_store", filter: `user_id=eq.${userId}` }, payload => {
      const row = payload.new as { key?: string; value?: unknown; updated_at?: string } | null;
      if (row?.key) applyRemote(String(row.key), row.value, String(row.updated_at ?? ""));
    })
    .subscribe();
  // 周期任务: 推送本地变化; 每 3 个周期(约15s)再拉取一次——realtime 断线(锁屏/休眠/网络切换)后仍能追上另一端
  if (!timer) {
    let ticks = 0;
    timer = setInterval(() => {
      ticks += 1;
      void pushChanged();
      if (ticks % 3 === 0) void pullAll();
    }, PUSH_INTERVAL_MS);
  }
  const onVisible = () => {
    if (document.visibilityState === "visible") { void pushChanged(); void pullAll(); }
    else void pushChanged(); // 切后台/锁屏前尽力推送
  };
  const onPageHide = () => { void pushChanged(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onPageHide);
  pageListeners = () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onPageHide);
  };
  setStatus({ state: "online", email: sessionEmail, lastSync: new Date().toISOString() });
}

let pageListeners: (() => void) | null = null;

function stopOnline(): void {
  if (channel) { void client?.removeChannel(channel); channel = null; }
  if (timer) { clearInterval(timer); timer = null; }
  if (pageListeners) { pageListeners(); pageListeners = null; }
  lastSynced.clear();
  userId = null;
}

let initPromise: Promise<void> | null = null;

/** 应用启动时调用(幂等): 已配置则自动连接并开始同步, 无需打开同步面板。 */
export function initSync(): Promise<void> {
  if (!initPromise) initPromise = doInitSync();
  return initPromise;
}

async function doInitSync(): Promise<void> {
  const config = getSyncConfig();
  if (!config) { setStatus({ state: "off" }); return; }
  if (client) return;
  client = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  setStatus({ state: "connecting" });
  const { data } = await client.auth.getSession();
  const session = data.session;
  client.auth.onAuthStateChange((event, authSession) => {
    if (event === "SIGNED_IN" && authSession?.user) {
      userId = authSession.user.id;
      void startOnline(authSession.user.email || authSession.user.id);
    } else if (event === "SIGNED_OUT") {
      stopOnline();
      setStatus({ state: "signed-out" });
    }
  });
  if (session?.user) {
    userId = session.user.id;
    await startOnline(session.user.email || session.user.id);
  } else setStatus({ state: "signed-out" });
}

export async function syncSignUp(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  if (!client) return { ok: false, message: "请先填写并保存同步服务配置。" };
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return { ok: false, message: error.message };
  // 邮箱确认开启时不会有会话; 关闭时直接登录
  return data.session ? { ok: true, message: "注册成功，同步已开启。" } : { ok: true, message: "注册成功：请到邮箱点击确认链接，然后回来登录。" };
}

export async function syncSignIn(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  if (!client) return { ok: false, message: "请先填写并保存同步服务配置。" };
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, message: error.message };
  return { ok: true, message: "已登录，正在同步…" };
}

export async function syncSignOut(): Promise<void> {
  await client?.auth.signOut();
}
