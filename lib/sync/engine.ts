/** Durable account-scoped sync; all transport paths share one serialized runner. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { canonicalJson, SYNCABLE_KEYS, LWW_KEYS } from "./merge";
import { compactDocument, documentConflicts, editDocument, importLegacy, isSyncDocument, legacyDocument, materialize, mergeDocuments, normalizeDocument, type SyncDocument } from "./document";
import { getDeviceId } from "../device";
const CONFIG_KEY = "yantu-sync-config", OUTBOX_KEY = "yantu-sync-outbox-v1", META_KEY = "yantu-sync-meta-v3";
const PARTITION_KEY = "yantu-partition-v1", ACTIVE_KEY = "yantu-sync-active-partition", QUARANTINE_KEY = "yantu-sync-quarantine-v1";
const EXEMPT = new Set([CONFIG_KEY, PARTITION_KEY, ACTIVE_KEY, "yantu-device-id"]);
export type SyncState = "off" | "signed-out" | "connecting" | "online" | "error";
export type SyncStatus = { state: SyncState; email?: string; error?: string; lastSync?: string; pendingUploads: number; pendingApply: number; conflicts?: number };
export type SyncResult = { pulled: number; pushed: number; failed: string[]; errors: string[] };
export type SyncConfig = { url: string; anonKey: string };
let client: SupabaseClient | null = null, userId: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null, channel: ReturnType<SupabaseClient["channel"]> | null = null;
let pageListeners: (() => void) | null = null, initPromise: Promise<void> | null = null;
let generation = 0, running: Promise<SyncResult> | null = null;
let runningPull = false;
const remoteInbox = new Map<string, { key: string; value: unknown }>();
let outbox: Record<string, string> = {}, docs: Record<string, SyncDocument> = {}, baselines: Record<string, unknown> = {};
let pendingApply = new Map<string, { value: unknown }>();
let status: SyncStatus = { state: "off", pendingUploads: 0, pendingApply: 0 };
const listeners = new Set<(s: SyncStatus) => void>();
export const getSyncConflicts = (): Record<string, ReturnType<typeof documentConflicts>> => Object.fromEntries(Object.entries(docs).map(([key, doc]) => [key, documentConflicts(doc)] as const).filter(([, conflicts]) => Object.keys(conflicts).length));
export const getSyncConflictArchive = () => ({ version: 1, conflicts: getSyncConflicts(), documents: Object.fromEntries(Object.keys(getSyncConflicts()).map(key => [key, docs[key]])) });
function conflictCount() { return Object.values(getSyncConflicts()).reduce((n, entries) => n + Object.keys(entries).length, 0); }
function setStatus(patch: Partial<SyncStatus>) { status = { ...status, ...patch, pendingUploads: Object.keys(outbox).length, pendingApply: pendingApply.size, conflicts: conflictCount() }; for (const fn of listeners) fn({ ...status }); }
export const getSyncStatus = (): SyncStatus => ({ ...status, pendingUploads: Object.keys(outbox).length, pendingApply: pendingApply.size, conflicts: conflictCount() });
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void { listeners.add(fn); fn(getSyncStatus()); return () => { listeners.delete(fn); }; }
export function getSyncConfig(): SyncConfig | null {
  try { return normalizeSyncConfig(JSON.parse(localStorage.getItem(CONFIG_KEY) || "null")); } catch { return null; }
}
export function normalizeSyncConfig(config: unknown): SyncConfig | null {
  if (!config || typeof config !== "object") return null;
  const v = config as Partial<SyncConfig>;
  if (typeof v.url !== "string" || typeof v.anonKey !== "string") return null;
  try {
    const url = new URL(v.url.trim()), anonKey = v.anonKey.trim();
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/i.test(url.hostname) || url.username || url.password || !/^(eyJ|sb_publishable_)[\w.-]+$/.test(anonKey)) return null;
    return { url: url.origin, anonKey };
  } catch { return null; }
}
export function saveSyncConfig(config: SyncConfig): void {
  const normalized = normalizeSyncConfig(config);
  if (!normalized) throw new Error("请填写 https://项目编号.supabase.co 和有效的 anon / Publishable key。");
  localStorage.setItem(CONFIG_KEY, JSON.stringify(normalized));
}
const syncableKey = (key: string) => Object.hasOwn(SYNCABLE_KEYS, key) || LWW_KEYS.has(key);
const WIRE_PREFIX = "yantu-sync-v3:";
function logicalKey(wireKey: string): string | null {
  if (syncableKey(wireKey)) return wireKey; // Legacy rows remain readable.
  if (!wireKey.startsWith(WIRE_PREFIX)) return null;
  try { const key = decodeURIComponent(wireKey.slice(WIRE_PREFIX.length).split(":")[0]); return syncableKey(key) ? key : null; } catch { return null; }
}
function wireKey(key: string): string { return `${WIRE_PREFIX}${encodeURIComponent(key)}:${encodeURIComponent(getDeviceId())}`; }
const readLocal = (key: string): string | null => localStorage.getItem(key);
function parseLocalSafe(key: string): { ok: true; value: unknown } | { ok: false } {
  const raw = readLocal(key); try { return { ok: true, value: raw === null ? null : JSON.parse(raw) }; }
  catch { try { localStorage.setItem(`${QUARANTINE_KEY}:${key}`, raw || ""); } catch { /* Original retained. */ } return { ok: false }; }
}
function writeLocal(key: string, value: unknown): boolean {
  try {
    const oldValue = readLocal(key), newValue = value === null ? null : canonicalJson(value); if (oldValue === newValue) return true;
    if (newValue === null) localStorage.removeItem(key); else localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue, storageArea: localStorage, url: location.href })); return true;
  } catch { return false; }
}
function readOutbox(): Record<string, string> {
  try { const v = JSON.parse(readLocal(OUTBOX_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([k, v]) => syncableKey(k) && typeof v === "string")) as Record<string, string> : {}; } catch { return {}; }
}
function persist(): boolean {
  try { localStorage.setItem(META_KEY, canonicalJson({ docs, baselines, pending: Object.keys(outbox) })); localStorage.setItem(OUTBOX_KEY, canonicalJson(Object.fromEntries(Object.keys(outbox).map(key => [key, "@document"])))); return true; }
  catch { setStatus({ state: "error", error: "待同步记录未能保存到本机，请释放存储空间后重试。" }); return false; }
}
function loadOutbox(): void {
  outbox = readOutbox(); docs = {}; baselines = {};
  try {
    const meta = JSON.parse(readLocal(META_KEY) || "{}");
    for (const [key, doc] of Object.entries(meta.docs || {})) if (syncableKey(key) && isSyncDocument(doc)) docs[key] = normalizeDocument(key, doc);
    baselines = meta.baselines || {};
    // The first write is the durable commit. Recover a crash before the index write.
    for (const key of Array.isArray(meta.pending) ? meta.pending : []) if (typeof key === "string" && syncableKey(key) && docs[key]) outbox[key] = canonicalJson(docs[key]);
    for (const [key, json] of Object.entries(outbox)) {
      if (json === "@document" && docs[key]) { outbox[key] = canonicalJson(docs[key]); continue; }
      const v = JSON.parse(json); if (isSyncDocument(v)) { const normalized = normalizeDocument(key, v); docs[key] = docs[key] ? mergeDocuments(docs[key], normalized) : normalized; }
    }
  } catch { /* Legacy queue recaptured from application data. */ }
}
function capture(key: string): void {
  const local = parseLocalSafe(key); if (!local.ok) return;
  if (!docs[key]) { if (local.value === null) return; docs[key] = legacyDocument(key, local.value); baselines[key] = local.value; outbox[key] = canonicalJson(docs[key]); return; }
  const next = compactDocument(key, editDocument(key, docs[key], baselines[key], local.value, getDeviceId()));
  if (canonicalJson(next) !== canonicalJson(docs[key])) { docs[key] = next; outbox[key] = canonicalJson(next); }
  baselines[key] = local.value;
}
function queueLocalChanges(): boolean {
  if (!userId) return true;
  try { for (const key of new Set([...Object.keys(SYNCABLE_KEYS), ...LWW_KEYS, ...Object.keys(docs)])) capture(key); return persist(); }
  catch { setStatus({ state: "error", error: "本地存储暂时不可用，记录未上传。" }); return false; }
}
function applyRemote(key: string, remote: unknown): boolean {
  if (!syncableKey(key)) return true;
  try {
    if (remote && typeof remote === "object" && "protocol" in remote && !isSyncDocument(remote)) throw new Error("invalid sync document");
    if (isSyncDocument(remote)) remote = normalizeDocument(key, remote);
    capture(key); const parsed = parseLocalSafe(key), local = parsed.ok ? parsed.value : null;
    const before = docs[key] ? canonicalJson(docs[key]) : "";
    const merged = compactDocument(key, isSyncDocument(remote) ? mergeDocuments(docs[key] || legacyDocument(key, null), remote) : importLegacy(key, docs[key], local, remote));
    const value = materialize(key, merged, local); if (!writeLocal(key, value)) throw new Error("write failed");
    docs[key] = merged; baselines[key] = value;
    if ((!isSyncDocument(remote) || canonicalJson(merged) !== canonicalJson(remote)) && (before !== canonicalJson(merged) || outbox[key])) outbox[key] = canonicalJson(merged);
    else if (outbox[key] && canonicalJson(JSON.parse(outbox[key])) === canonicalJson(merged)) delete outbox[key];
    if (!persist()) throw new Error("metadata failed"); pendingApply.delete(key); return true;
  } catch (error) { pendingApply.set(key, { value: remote }); setStatus({ state: "error", error: String(error).includes("invalid sync document") ? "云端同步记录损坏或版本不兼容，本机记录已保留，请检查云端记录并更新应用。" : "云端数据未能保存到本机（存储空间不足或被禁用），恢复后将自动重试。" }); return false; }
}
function isPartitionable(key: string): boolean { return (key.startsWith("yantu-") || key.startsWith("kaoyan.")) && !EXEMPT.has(key); }
function partitions(): Record<string, Record<string, string>> { return JSON.parse(readLocal(PARTITION_KEY) || "{}"); }
function savePartition(uid: string): void {
  const all = partitions(), snapshot: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key && isPartitionable(key)) snapshot[key] = readLocal(key)!; }
  all[uid] = snapshot; localStorage.setItem(PARTITION_KEY, JSON.stringify(all));
}
function switchPartition(uid: string): void {
  const previous = readLocal(ACTIVE_KEY) || "guest"; if (previous === uid) return;
  savePartition(previous); const all = partitions();
  // Only the first guest login imports guest data; empty B cannot inherit A.
  const target = all[uid] || (previous === "guest" && uid !== "guest" && !Object.keys(all).some(id => id !== "guest") ? all.guest : {}), before = all[previous];
  try {
    for (const key of Object.keys(before)) if (!(key in target)) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(target)) localStorage.setItem(key, value);
    localStorage.setItem(ACTIVE_KEY, uid);
  } catch (error) {
    // A target-only key written before a later failure must not remain in A.
    for (const key of Object.keys(target)) if (!Object.hasOwn(before, key)) localStorage.removeItem(key);
    for (const [key, value] of Object.entries(before)) localStorage.setItem(key, value);
    throw error;
  }
  window.dispatchEvent(new StorageEvent("storage", { key: null, storageArea: localStorage, url: location.href }));
  window.dispatchEvent(new CustomEvent("yantu-account-changed"));
}
function failure(result: SyncResult | undefined, key: string, message: string) {
  if (result && !result.failed.includes(key)) result.failed.push(key); if (result && !result.errors.includes(message)) result.errors.push(message); setStatus({ state: "error", error: message });
}
async function pullAll(result?: SyncResult): Promise<number> {
  const active = client, uid = userId, token = generation; if (!active || !uid) return 0;
  try {
    // PostgREST caps each response. Stable ordering and explicit ranges keep old
    // device rows beyond the first page participating in the merge.
    const rows: { key: string; value: unknown; updated_at: string }[] = [], pageSize = 500;
    for (let offset = 0; ;) {
      const { data, count, error } = await active.from("kv_store").select("key, value, updated_at", { count: "exact" }).eq("user_id", uid).order("key").range(offset, offset + pageSize - 1);
      if (token !== generation) return 0;
      if (error) { failure(result, "__pull__", `下载失败：${error.message}`); return 0; }
      rows.push(...(data || [])); offset += data?.length || 0;
      if (typeof count === "number" ? offset >= count : !data || data.length < pageSize) break;
      if (!data?.length) { failure(result, "__pull__", "下载未完成：服务返回空分页，请稍后重试。"); return 0; }
    }
    let applied = 0; for (const row of rows) { const key = logicalKey(String(row.key)); if (!key) continue; if (applyRemote(key, row.value)) applied++; else failure(result, key, status.error || "本机写入失败。"); } return applied;
  } catch (error) { if (token === generation) failure(result, "__pull__", `下载失败：${String(error)}`); return 0; }
}
async function pushOutboxEntry(key: string, result?: SyncResult): Promise<boolean> {
  const active = client, uid = userId, token = generation, sent = outbox[key]; if (!active || !uid || !sent) return false;
  try {
    // Different devices never overwrite the same row. An ACK remains durable even
    // if the sender closes immediately and another device uploads concurrently.
    const { error } = await active.from("kv_store").upsert({ user_id: uid, key: wireKey(key), value: JSON.parse(sent), updated_at: new Date().toISOString() }); if (token !== generation) return false;
    if (error) { failure(result, key, `上传 ${key} 失败：${error.message}`); return false; }
    capture(key); if (outbox[key] === sent) delete outbox[key];
    if (!persist()) { failure(result, key, status.error!); return false; } return true;
  } catch (error) { if (token === generation) failure(result, key, `上传 ${key} 失败：${String(error)}`); return false; }
}
async function drainOutbox(result?: SyncResult): Promise<number> { let pushed = 0; const token = generation; for (const key of Object.keys(outbox)) { if (token !== generation) break; if (await pushOutboxEntry(key, result)) pushed++; } return pushed; }
async function fullSync(pull = true): Promise<SyncResult> {
  const result: SyncResult = { pulled: 0, pushed: 0, failed: [], errors: [] }, token = generation;
  if (!queueLocalChanges()) failure(result, "__storage__", status.error!);
  if (pull) result.pulled = await pullAll(result);
  const cancelled = () => ({ ...result, failed: ["__account_changed__"], errors: ["账号已切换，本轮同步取消。"] });
  if (token !== generation) return cancelled();
  for (const [wire, row] of [...remoteInbox]) {
    remoteInbox.delete(wire);
    if (applyRemote(row.key, row.value)) result.pulled++; else failure(result, row.key, status.error!);
  }
  for (const [key, pending] of [...pendingApply]) if (!applyRemote(key, pending.value)) failure(result, key, status.error!);
  if (persist()) result.pushed = await drainOutbox(result); else failure(result, "__storage__", status.error!);
  if (token !== generation) return cancelled(); if (!queueLocalChanges()) failure(result, "__storage__", status.error!);
  const failed = result.failed.length > 0 || pendingApply.size > 0;
  setStatus(failed ? { state: "error", error: result.errors[0] || "部分数据未同步，将自动重试。" } : { state: "online", error: undefined, lastSync: new Date().toISOString() }); return result;
}
function runSync(pull: boolean): Promise<SyncResult> {
  if (!client || !userId) return Promise.resolve({ pulled: 0, pushed: 0, failed: ["__off__"], errors: ["同步未连接。"] });
  if (running) return pull && !runningPull ? running.then(() => runSync(true)) : running;
  // Deferring starts the runner only after the lock has been installed, including
  // push-only cycles which might otherwise run synchronously through an empty queue.
  const token = generation, job = Promise.resolve().then(() => token === generation ? fullSync(pull) : { pulled: 0, pushed: 0, failed: ["__account_changed__"], errors: ["账号已切换，本轮同步取消。"] }); running = job; runningPull = pull;
  void job.finally(() => { if (running === job) { running = null; if (token === generation && remoteInbox.size) void runSync(false); } }).catch(() => {}); return job;
}
export function syncNow(): Promise<SyncResult> { return runSync(true); }
function stopOnline(): void {
  generation++; running = null; remoteInbox.clear(); if (channel) { void client?.removeChannel(channel); channel = null; } if (timer) { clearInterval(timer); timer = null; }
  pageListeners?.(); pageListeners = null; docs = {}; baselines = {}; outbox = {}; pendingApply.clear(); userId = null;
}
async function startOnline(email: string): Promise<void> {
  const token = generation, uid = userId; setStatus({ state: "connecting", email, error: undefined }); loadOutbox();
  channel = client!.channel("kv-store-changes").on("postgres_changes", { event: "*", schema: "public", table: "kv_store", filter: `user_id=eq.${uid}` }, payload => {
    if (token !== generation) return;
    const row = payload.new as { key?: string; value?: unknown } | null;
    const key = row?.key ? logicalKey(row.key) : null;
    if (!key || !row?.key) return;
    remoteInbox.set(row.key, { key, value: row.value }); void runSync(false);
  }).subscribe();
  let ticks = 0;
  timer = setInterval(() => { if (token === generation) void runSync(++ticks % 3 === 0); }, 5000);
  const visible = () => { if (token === generation) { queueLocalChanges(); if (document.visibilityState === "visible") void syncNow(); } }, hide = () => { if (token === generation) queueLocalChanges(); };
  document.addEventListener("visibilitychange", visible); window.addEventListener("pagehide", hide);
  pageListeners = () => { document.removeEventListener("visibilitychange", visible); window.removeEventListener("pagehide", hide); }; await syncNow();
}
function activate(uid: string, email: string, restoringSession = false): void {
  if (uid === userId) return;
  try {
    if (userId) { queueLocalChanges(); savePartition(userId); }
    stopOnline();
    // v2 had no active marker. On authenticated startup the live data is newer
    // than its old login-time partition snapshot; adopt it instead of restoring.
    if (restoringSession && !readLocal(ACTIVE_KEY)) { savePartition(uid); localStorage.setItem(ACTIVE_KEY, uid); }
    else switchPartition(uid);
    userId = uid; void startOnline(email);
  }
  catch { stopOnline(); setStatus({ state: "error", email: undefined, error: "账号数据分区未能保存，未切换学习数据。请释放存储空间后重新登录。" }); }
}
export function initSync(): Promise<void> { return initPromise ||= doInitSync(); }
async function doInitSync(): Promise<void> {
  const config = getSyncConfig(); if (!config) { setStatus({ state: "off" }); return; }
  client = createClient(config.url, config.anonKey, { auth: { persistSession: true, autoRefreshToken: true } }); setStatus({ state: "connecting" });
  client.auth.onAuthStateChange((event, session) => {
    if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session?.user) activate(session.user.id, session.user.email || session.user.id, event === "INITIAL_SESSION");
    else if (event === "SIGNED_OUT") {
      try { if (userId) { queueLocalChanges(); savePartition(userId); } stopOnline(); switchPartition("guest"); setStatus({ state: "signed-out", email: undefined, error: undefined }); }
      catch { stopOnline(); setStatus({ state: "error", email: undefined, error: "退出账号时本机分区保存失败，请释放存储空间后重试。" }); }
    }
  });
  const { data } = await client.auth.getSession(); if (data.session?.user) activate(data.session.user.id, data.session.user.email || data.session.user.id, true);
  else { try { if (readLocal(ACTIVE_KEY) && readLocal(ACTIVE_KEY) !== "guest") switchPartition("guest"); setStatus({ state: "signed-out", email: undefined }); } catch { setStatus({ state: "error", error: "无法恢复访客数据，请检查本地存储。" }); } }
}
export async function syncSignUp(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  if (!client) return { ok: false, message: "请先填写并保存同步服务配置。" }; const { data, error } = await client.auth.signUp({ email, password });
  return error ? { ok: false, message: error.message } : { ok: true, message: data.session ? "注册成功，同步已开启。" : "注册成功：请到邮箱点击确认链接，然后回来登录。" };
}
export async function syncSignIn(email: string, password: string): Promise<{ ok: boolean; message: string }> {
  if (!client) return { ok: false, message: "请先填写并保存同步服务配置。" }; const { error } = await client.auth.signInWithPassword({ email, password }); return error ? { ok: false, message: error.message } : { ok: true, message: "已登录，正在同步…" };
}
export async function syncSignOut(): Promise<void> {
  if (!client) return;
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) throw error;
}
