/** 云同步引擎 v2。协议: 本地写入 → outbox(持久化待上传队列) → 确认成功才出队;
 *  拉取 → 按类型合并 → 写入成功才确认远端版本, 失败进 pendingApply 周期重试。
 *  内容比较一律用 canonicalJson(键序无关, F06); 时间戳仅展示, 不参与判定(F12)。
 *  本机数据按账号分区(F02): 切换账号互不带数据, 访客分区独立。
 *  损坏键隔离到隔离区(F13), 不阻断其余数据同步。 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, mergeKindFor, mergeKeyValue, SYNCABLE_KEYS } from "./merge";

const CONFIG_KEY = "yantu-sync-config";
const OUTBOX_KEY = "yantu-sync-outbox-v1";
const PARTITION_KEY = "yantu-partition-v1";
const QUARANTINE_KEY = "yantu-sync-quarantine-v1";
const LWW_KEYS = new Set(["yantu-exam-target-v1", "kaoyan.mock-practice.v1.333", "kaoyan.mock-practice.v1.825"]);
const PUSH_INTERVAL_MS = 5000;
const DEVICE_KEY = "yantu-device-id";
const PARTITION_EXEMPT = new Set([CONFIG_KEY, OUTBOX_KEY, PARTITION_KEY, QUARANTINE_KEY, DEVICE_KEY]);

export type SyncState = "off" | "signed-out" | "connecting" | "online" | "error";
export type SyncStatus = { state: SyncState; email?: string; error?: string; lastSync?: string; pendingUploads: number; pendingApply: number };
export type SyncResult = { pulled: number; pushed: number; failed: string[]; errors: string[] };

let client: SupabaseClient | null = null;
let userId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let channel: ReturnType<SupabaseClient["channel"]> | null = null;
let pageListeners: (() => void) | null = null;
let initPromise: Promise<void> | null = null;
/** 已确认的远端内容(规范化)与本地内容(规范化): 判定"是否有新东西"全靠内容, 不靠时钟(F12) */
let ackedRemote = new Map<string, string>();
let ackedLocal = new Map<string, string>();
let outbox: Record<string, string> = {};
let pendingApply = new Map<string, { value: unknown }>();
let previousUid: string | null = null;
let syncBusy = false;
const listeners = new Set<(status: SyncStatus) => void>();
let status: SyncStatus = { state: "off", pendingUploads: 0, pendingApply: 0 };

function setStatus(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch, pendingUploads: Object.keys(readOutbox()).length, pendingApply: pendingApply.size };
  for (const listener of listeners) listener(status);
}
export function getSyncStatus(): SyncStatus { return { ...status, pendingUploads: Object.keys(readOutbox()).length, pendingApply: pendingApply.size }; }
export function onSyncStatus(listener: (status: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(getSyncStatus());
  return () => listeners.delete(listener);
}

// ---------- 配置 ----------
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
  // 容错常见粘贴错误: 去掉 /rest/v1、/auth/v1 等接口后缀与尾部斜杠
  const url = config.url.trim().replace(/\/+$/, "").replace(/^(https:\/\/[^/]+).*$/i, "$1");
  localStorage.setItem(CONFIG_KEY, JSON.stringify({ url, anonKey: config.anonKey.trim() }));
}

// ---------- 本地读写(带成功/失败与隔离 F13) ----------
function readLocal(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeLocal(key: string, json: string): boolean {
  const previous = localStorage.getItem(key);
  if (previous === json) return true;
  try {
    localStorage.setItem(key, json);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue: json, oldValue: previous, storageArea: localStorage, url: location.href }));
    return true;
  } catch { return false; }
}
function parseLocalSafe(key: string): { ok: true; value: unknown } | { ok: false } {
  const raw = readLocal(key);
  if (raw === null) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(raw) }; }
  catch {
    try { localStorage.setItem(`${QUARANTINE_KEY}:${key}`, raw); } catch { /* 隔离区满则放弃 */ }
    return { ok: false };
  }
}

// ---------- outbox(持久化待上传队列, F04) ----------
function loadOutbox(): void { outbox = readOutbox(); }

function readOutbox(): Record<string, string> {
  try {
    const raw = localStorage.getItem(OUTBOX_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}
function writeOutbox(out: Record<string, string>): void {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(out)); } catch { /* 队列过大: 下周期重试 */ }
}

// ---------- 账号分区(F02) ----------
function isPartitionable(key: string): boolean {
  return key.startsWith("yantu-") && !PARTITION_EXEMPT.has(key) && !key.startsWith("sb-");
}
function savePartition(uid: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(PARTITION_KEY) || "{}") as Record<string, Record<string, string>>;
    const snapshot: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && isPartitionable(key)) snapshot[key] = localStorage.getItem(key) as string;
    }
    all[uid] = snapshot;
    localStorage.setItem(PARTITION_KEY, JSON.stringify(all));
  } catch { /* 分区快照失败: 保持现状 */ }
}
function restorePartition(uid: string): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(PARTITION_KEY) || "{}") as Record<string, Record<string, string>>;
    const snapshot = all[uid];
    if (!snapshot) return false;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && isPartitionable(key) && !(key in snapshot)) localStorage.removeItem(key);
    }
    for (const [key, value] of Object.entries(snapshot)) localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}
/** 登录切换: 先保存上一身份的数据, 再加载目标身份分区; 首次登录以当前本机数据作为初始分区。 */
function switchPartition(previousUid: string | null, uid: string): void {
  if (previousUid) savePartition(previousUid);
  if (!restorePartition(uid)) savePartition(uid);
}

function syncableKey(key: string): boolean { return key in SYNCABLE_KEYS || LWW_KEYS.has(key); }

/** 拉取: 远端行 → 按类型合并 → 写本地成功才确认; 失败进 pendingApply 周期重试(F05)。 */
function applyRemote(key: string, remoteValue: unknown): boolean {
  const parsedLocal = parseLocalSafe(key);
  const merged = mergeKeyValue(mergeKindFor(key), parsedLocal.ok ? parsedLocal.value : null, remoteValue);
  const mergedJson = JSON.stringify(merged.value);
  const written = writeLocal(key, mergedJson);
  if (!written) {
    pendingApply.set(key, { value: remoteValue });
    setStatus({ state: "error", error: "云端数据未能保存到本机（存储空间不足或被禁用），恢复后将自动重试。" });
    return false;
  }
  pendingApply.delete(key);
  ackedRemote.set(key, canonicalJson(remoteValue));
  ackedLocal.set(key, canonicalJson(merged.value));
  delete outbox[key];
  // 合并结果是远端的超集(本机有更新内容): 回推, 让另一台设备收敛
  if (canonicalJson(remoteValue) !== canonicalJson(merged.value)) outbox[key] = mergedJson;
  return true;
}

/** 推送一条(带确认): 成功才出队并推进本地基线(F04)。 */
async function pushOutboxEntry(key: string): Promise<boolean> {
  if (!client || !userId) return false;
  const localJson = readLocal(key) ?? "";
  const queued = outbox[key] || "";
  let localCanonical = "", queuedCanonical = "";
  try {
    localCanonical = localJson ? canonicalJson(JSON.parse(localJson)) : "";
    queuedCanonical = queued ? canonicalJson(JSON.parse(queued)) : "";
  } catch { /* 损坏内容跳过 */ }
  // 本地内容比队列里的更新: 推本地最新; 否则推队列(可能是崩溃前待传内容)
  const json = localCanonical && (!queuedCanonical || localCanonical !== queuedCanonical) ? localJson : queued;
  let value: unknown;
  try { value = JSON.parse(json); } catch { delete outbox[key]; writeOutbox(outbox); return false; }
  const { error } = await client.from("kv_store").upsert({ user_id: userId, key, value, updated_at: new Date().toISOString() });
  if (error) {
    setStatus({ state: "error", error: `上传 ${key} 失败：${error.message}`, lastSync: status.lastSync });
    return false;
  }
  ackedRemote.set(key, canonicalJson(value));
  ackedLocal.set(key, canonicalJson(value));
  delete outbox[key];
  writeOutbox(outbox);
  setStatus({ state: "online", error: undefined, lastSync: new Date().toISOString() });
  return true;
}

/** 本地新变化入队: 与上次确认的本地内容比较(规范化), 变化即入队(F06 键序无关)。 */
function queueLocalChanges(): void {
  if (!userId) return;
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !syncableKey(key)) continue;
    const raw = readLocal(key);
    if (raw === null) continue;
    let canonical = "";
    try { canonical = canonicalJson(JSON.parse(raw)); } catch { continue; }
    if (ackedLocal.get(key) === canonical) continue;
    outbox[key] = raw;
  }
}

async function pullAll(result?: SyncResult): Promise<number> {
  if (!client || !userId) return 0;
  const { data, error } = await client.from("kv_store").select("key, value, updated_at").eq("user_id", userId);
  if (error) {
    result?.failed.push("__pull__");
    result?.errors.push(`下载失败：${error.message}`);
    setStatus({ state: "error", error: `下载失败：${error.message}`, lastSync: status.lastSync });
    return 0;
  }
  let applied = 0;
  for (const row of data ?? []) {
    try {
      if (applyRemote(String(row.key), row.value)) applied += 1;
    } catch { /* F13: 单行异常不阻断其余数据 */ }
  }
  return applied;
}

async function drainOutbox(result?: SyncResult): Promise<number> {
  let pushed = 0;
  for (const key of Object.keys({ ...outbox })) {
    if (!outbox[key]) continue;
    const ok = await pushOutboxEntry(key);
    if (ok) pushed += 1;
    else result?.failed.push(key);
  }
  return pushed;
}

async function fullSync(): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, failed: [], errors: [] };
  queueLocalChanges();
  result.pulled = await pullAll(result);
  result.pushed = await drainOutbox(result);
  queueLocalChanges();
  setStatus({ state: "online", error: result.errors.length ? result.errors[0] : undefined, lastSync: new Date().toISOString() });
  return result;
}

export async function syncNow(): Promise<SyncResult> {
  if (!client || !userId) return { pulled: 0, pushed: 0, failed: ["__off__"], errors: ["同步未连接。"] };
  if (syncBusy) return { pulled: 0, pushed: 0, failed: [], errors: [] };
  syncBusy = true;
  try { return await fullSync(); } finally { syncBusy = false; }
}

async function startOnline(email: string): Promise<void> {
  setStatus({ state: "connecting", error: undefined });
  loadOutbox();
  const result = await fullSync();
  channel = client!.channel("kv-store-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "kv_store", filter: `user_id=eq.${userId}` }, payload => {
      const row = payload.new as { key?: string; value?: unknown } | null;
      if (row?.key) {
        try { applyRemote(String(row.key), row.value); } catch { /* 单行异常隔离(F13) */ }
      }
    })
    .subscribe();
  if (!timer) {
    let ticks = 0;
    timer = setInterval(() => {
      ticks += 1;
      queueLocalChanges();
      void drainOutbox();
      if (ticks % 3 === 0) void pullAll();
      for (const [key, pending] of [...pendingApply.entries()]) {
        try { applyRemote(key, pending.value); } catch { /* 下周期再试 */ }
      }
    }, PUSH_INTERVAL_MS);
  }
  const onVisible = () => {
    if (document.visibilityState === "visible") void syncNow();
    else { queueLocalChanges(); void drainOutbox(); }
  };
  const onPageHide = () => { queueLocalChanges(); void drainOutbox(); };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onPageHide);
  pageListeners = () => {
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("pagehide", onPageHide);
  };
  setStatus({ state: "online", email, lastSync: new Date().toISOString(), error: result.errors.length ? result.errors[0] : undefined });
}

function stopOnline(): void {
  if (channel) { void client?.removeChannel(channel); channel = null; }
  if (timer) { clearInterval(timer); timer = null; }
  if (pageListeners) { pageListeners(); pageListeners = null; }
  ackedRemote = new Map(); ackedLocal = new Map(); pendingApply = new Map();
  userId = null;
}

export async function initSync(): Promise<void> {
  if (!initPromise) initPromise = doInitSync();
  return initPromise;
}

async function doInitSync(): Promise<void> {
  const config = getSyncConfig();
  if (!config) { setStatus({ state: "off" }); return; }
  if (client) return;
  client = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  loadOutbox();
  setStatus({ state: "connecting" });
  client.auth.onAuthStateChange((event, authSession) => {
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && authSession?.user && userId !== authSession.user.id) {
      if (userId && userId !== authSession.user.id) stopOnline();
      switchPartition(previousUid, authSession.user.id);
      previousUid = authSession.user.id;
      userId = authSession.user.id;
      ackedRemote = new Map(); ackedLocal = new Map(); outbox = {};
      void startOnline(authSession.user.email || authSession.user.id);
    } else if (event === "SIGNED_OUT") {
      if (previousUid) savePartition(previousUid);
      previousUid = null;
      stopOnline();
      setStatus({ state: "signed-out" });
    }
  });
  const { data } = await client.auth.getSession();
  if (data.session?.user && userId !== data.session.user.id) {
    switchPartition(previousUid, data.session.user.id);
    previousUid = data.session.user.id;
    userId = data.session.user.id;
    void startOnline(data.session.user.email || data.session.user.id);
  } else if (!data.session) setStatus({ state: "signed-out" });
}

export async function syncSignUp(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  if (!client) return { ok: false, message: "请先填写并保存同步服务配置。" };
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return { ok: false, message: error.message };
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
