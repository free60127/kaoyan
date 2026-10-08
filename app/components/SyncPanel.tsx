import { useEffect, useState } from "react";
import { Cloud, X } from "lucide-react";

type SyncStatus = { state: "off" | "signed-out" | "connecting" | "online" | "error"; email?: string; error?: string; lastSync?: string; pendingUploads: number; pendingApply: number; conflicts?: number };

const SETUP_SQL = `create table public.kv_store (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.kv_store enable row level security;
create policy "own rows" on public.kv_store for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
alter publication supabase_realtime add table public.kv_store;`;

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<SyncStatus>({ state: "off", pendingUploads: 0, pendingApply: 0 });
  const [config, setConfig] = useState({ url: "", anonKey: "" });
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ error?: boolean; text: string }>({ text: "" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [engine, setEngine] = useState<typeof import("@/lib/sync/engine") | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    import("@/lib/sync/engine").then(module => {
      if (cancelled) return;
      setEngine(module);
      unsubscribe = module.onSyncStatus(setStatus);
      const saved = module.getSyncConfig();
      if (saved) setConfig(saved);
      void module.initSync();
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);

  async function saveConfig() {
    if (!engine) return;
    if (!/^https:\/\/.+\.supabase\.co/.test(config.url.trim())) { setMessage({ error: true, text: "项目 URL 应形如 https://xxxx.supabase.co" }); return; }
    const key = config.anonKey.trim();
    // 兼容两种密钥: 旧版 anon key(eyJ 开头)与新式 publishable key(sb_publishable_ 开头)
    if (!key.startsWith("eyJ") && !key.startsWith("sb_publishable_")) { setMessage({ error: true, text: "密钥应是 eyJ 开头的 anon key，或 sb_publishable_ 开头的 Publishable key（不是 Secret key）。" }); return; }
    engine.saveSyncConfig(config);
    setMessage({ text: "配置已保存，正在连接…" });
    location.reload();
  }

  async function auth(kind: "signin" | "signup") {
    if (!engine) return;
    setBusy(true);
    try {
      const result = kind === "signin" ? await engine.syncSignIn(email.trim(), password) : await engine.syncSignUp(email.trim(), password);
      setMessage({ error: !result.ok, text: result.message });
    } catch (error) { setMessage({ error: true, text: `连接失败：${String(error)}` }); }
    finally { setBusy(false); }
  }

  const configured = !!config.url && !!config.anonKey;
  const stateLabel: Record<SyncStatus["state"], string> = {
    off: "未配置", "signed-out": "已配置 · 未登录", connecting: "连接中…", online: "已连接", error: "同步出错",
  };

  return <div className="backup-shade"><div className="backup-dialog" role="dialog" aria-modal="true" aria-label="云同步" onKeyDown={event => { if (event.key === "Escape" && !busy) onClose(); }} tabIndex={-1}>
    <div className="backup-heading"><h2 id="sync-title"><Cloud size={20}/> 云同步 · 邮箱账号</h2><button className="icon-button" aria-label="关闭云同步" onClick={onClose}><X size={20}/></button></div>
    <div className="backup-body">
      <p className="mock-help">登录后，本机的学习记录（复习排期、错题本、统计、个人编辑、考试日期等）会自动与你的账号同步；另一台设备登录同一邮箱即可看到相同数据，任一设备评分/学新卡都会自动推送。仅保存在本浏览器的内容：选择题未完成题组、自由浏览位置、DeepSeek 密钥。</p>

      <p className="mock-selection">当前状态：<b>{stateLabel[status.state]}</b>{status.email ? ` · ${status.email}` : ""}{status.pendingUploads ? ` · 待上传 ${status.pendingUploads} 项` : ""}{status.pendingApply ? ` · 待保存 ${status.pendingApply} 项` : ""}{status.lastSync ? ` · 上次同步 ${new Date(status.lastSync).toLocaleTimeString("zh-CN")}` : ""}</p>
      {status.error && <p className="error" role="alert">{status.error}</p>}
      {!!status.conflicts && <div role="status"><p>有 {status.conflicts} 处双端同时修改。文字已尽可能合并；不同样式或非文字值采用一致的选择规则，原版本仍保留。请检查内容后编辑保存，或先导出双方原稿。</p><button className="secondary" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(engine?.getSyncConflictArchive(), null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "yantu-sync-conflicts.json"; link.click(); URL.revokeObjectURL(url);
      }}>导出冲突原稿</button></div>}
      {message.text && <p className={message.error ? "error" : "card-edit-status"} role={message.error ? "alert" : "status"}>{message.text}</p>}

      <fieldset className="sync-fieldset">
        <legend>① 连接你的 Supabase 项目（免费，一次性设置）</legend>
        <p className="mock-help">在 supabase.com 创建免费项目 → SQL Editor 里执行下面的建表语句 → 把 Project URL 和 anon public key 粘贴到这里。数据按账号隔离，密钥公开是设计安全的。</p>
        <label>项目 URL<input value={config.url} onChange={(event) => setConfig(previous => ({ ...previous, url: event.target.value }))} placeholder="https://xxxx.supabase.co"/></label>
        <label>anon key 或 Publishable key<input value={config.anonKey} onChange={(event) => setConfig(previous => ({ ...previous, anonKey: event.target.value }))} placeholder="eyJhbGciOi…"/></label>
        <button className="secondary" onClick={saveConfig}>保存配置并连接</button>
        <details className="sync-sql"><summary>建表 SQL（点开复制到 Supabase SQL Editor）</summary>
          <pre>{SETUP_SQL}</pre>
        </details>
      </fieldset>

      {configured && !status.email && <fieldset className="sync-fieldset">
        <legend>② {mode === "signin" ? "登录" : "注册"}（邮箱 + 密码）</legend>
        <div className="mistake-filters"><button className={mode === "signin" ? "mode-button active" : "mode-button"} onClick={() => setMode("signin")}>登录</button><button className={mode === "signup" ? "mode-button active" : "mode-button"} onClick={() => setMode("signup")}>注册新账号</button></div>
        <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <label>密码（至少 6 位）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••"/></label>
        <button className="primary" disabled={busy || !email.trim() || password.length < 6} onClick={() => auth(mode)}>{busy ? "处理中…" : mode === "signin" ? "登录并开始同步" : "注册"}</button>
        <p className="mock-help">注册新账号时，本项目若开启了邮箱确认，需要先去邮箱点确认链接再登录。首次登录会把本机数据上传到账号，换设备登录会先合并再保持同步。</p>
      </fieldset>}

      {status.email && <fieldset className="sync-fieldset">
        <legend>同步</legend>
        <button className="secondary" disabled={!engine || busy} onClick={() => { setBusy(true); setMessage({ text: "正在同步…" }); void engine?.syncNow().then(result => {
          if (result.errors.length || result.failed.length) setMessage({ error: true, text: `同步未完成：上传 ${result.pushed} 项、下载合并 ${result.pulled} 项，${result.failed.length + result.errors.length} 项失败（将自动重试）。` });
          else setMessage({ text: engine?.getSyncStatus().pendingUploads ? "本轮同步已完成，期间产生的新修改正在等待后续上传。" : `同步完成：上传 ${result.pushed} 项、下载合并 ${result.pulled} 项。` });
        }).catch(error => setMessage({ error: true, text: `同步失败：${String(error)}` })).finally(() => setBusy(false)); }}>立即同步</button>
        <button className="secondary" disabled={!engine || busy} onClick={() => { if (window.confirm("退出后返回访客数据，账号学习记录保留在本机分区。确定退出？")) void engine?.syncSignOut().catch(error => setMessage({ error: true, text: `退出失败：${String(error)}` })); }}>退出登录</button>
        <p className="mock-help">各设备的学习记录会合并，后续撤销、删除也会同步。两端同时修改同一份草稿或卡片文字时，双方内容会保留并标出“另一设备的修改”，请检查后编辑整理。页面位置各设备独立。</p>
      </fieldset>}
    </div>
  </div></div>;
}

export default SyncPanel;
