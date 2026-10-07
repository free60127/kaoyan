import { lazy, useEffect, useState } from "react";
import { Cloud, X } from "lucide-react";

type SyncStatus = { state: "off" | "signed-out" | "connecting" | "online" | "error"; email?: string; error?: string; lastSync?: string };

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
  const [status, setStatus] = useState<SyncStatus>({ state: "off" });
  const [config, setConfig] = useState({ url: "", anonKey: "" });
  const [email, setEmail] = useState(""), [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ error?: boolean; text: string }>({ text: "" });
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [engine, setEngine] = useState<typeof import("@/lib/sync/engine") | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("@/lib/sync/engine").then(module => {
      if (cancelled) return;
      setEngine(module);
      module.onSyncStatus(setStatus);
      const saved = module.getSyncConfig();
      if (saved) setConfig(saved);
      void module.initSync();
    });
    return () => { cancelled = true; };
  }, []);

  async function saveConfig() {
    if (!engine) return;
    if (!/^https:\/\/.+\.supabase\.co/.test(config.url.trim())) { setMessage({ error: true, text: "项目 URL 应形如 https://xxxx.supabase.co" }); return; }
    if (!config.anonKey.trim().startsWith("eyJ")) { setMessage({ error: true, text: "匿名密钥 anon key 是以 eyJ 开头的长字符串（不是 service_role 密钥）。" }); return; }
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
    } finally { setBusy(false); }
  }

  const configured = !!config.url && !!config.anonKey;
  const stateLabel: Record<SyncStatus["state"], string> = {
    off: "未配置", "signed-out": "已配置 · 未登录", connecting: "连接中…", online: "已连接", error: "同步出错",
  };

  return <div className="backup-shade"><div className="backup-dialog" role="dialog" aria-modal="true" aria-label="云同步" onKeyDown={event => { if (event.key === "Escape" && !busy) onClose(); }} tabIndex={-1}>
    <div className="backup-heading"><h2 id="sync-title"><Cloud size={20}/> 云同步 · 邮箱账号</h2><button className="icon-button" aria-label="关闭云同步" onClick={onClose}><X size={20}/></button></div>
    <div className="backup-body">
      <p className="mock-help">登录后，本机的学习记录（复习排期、错题本、统计、个人编辑、考试日期等）会自动与你的账号同步；另一台设备登录同一邮箱即可看到相同数据，任一设备评分/学新卡都会自动推送。仅保存在本浏览器的内容：选择题未完成题组、自由浏览位置、DeepSeek 密钥。</p>

      <p className="mock-selection">当前状态：<b>{stateLabel[status.state]}</b>{status.email ? ` · ${status.email}` : ""}{status.lastSync ? ` · 上次同步 ${new Date(status.lastSync).toLocaleTimeString("zh-CN")}` : ""}</p>
      {status.error && <p className="error" role="alert">{status.error}</p>}
      {message.text && <p className={message.error ? "error" : "card-edit-status"} role={message.error ? "alert" : "status"}>{message.text}</p>}

      <fieldset className="sync-fieldset">
        <legend>① 连接你的 Supabase 项目（免费，一次性设置）</legend>
        <p className="mock-help">在 supabase.com 创建免费项目 → SQL Editor 里执行下面的建表语句 → 把 Project URL 和 anon public key 粘贴到这里。数据按账号隔离，密钥公开是设计安全的。</p>
        <label>项目 URL<input value={config.url} onChange={(event) => setConfig(previous => ({ ...previous, url: event.target.value }))} placeholder="https://xxxx.supabase.co"/></label>
        <label>anon public key<input value={config.anonKey} onChange={(event) => setConfig(previous => ({ ...previous, anonKey: event.target.value }))} placeholder="eyJhbGciOi…"/></label>
        <button className="secondary" onClick={saveConfig}>保存配置并连接</button>
        <details className="sync-sql"><summary>建表 SQL（点开复制到 Supabase SQL Editor）</summary>
          <pre>{SETUP_SQL}</pre>
        </details>
      </fieldset>

      {configured && status.state !== "online" && <fieldset className="sync-fieldset">
        <legend>② {mode === "signin" ? "登录" : "注册"}（邮箱 + 密码）</legend>
        <div className="mistake-filters"><button className={mode === "signin" ? "mode-button active" : "mode-button"} onClick={() => setMode("signin")}>登录</button><button className={mode === "signup" ? "mode-button active" : "mode-button"} onClick={() => setMode("signup")}>注册新账号</button></div>
        <label>邮箱<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com"/></label>
        <label>密码（至少 6 位）<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••"/></label>
        <button className="primary" disabled={busy || !email.trim() || password.length < 6} onClick={() => auth(mode)}>{busy ? "处理中…" : mode === "signin" ? "登录并开始同步" : "注册"}</button>
        <p className="mock-help">注册新账号时，本项目若开启了邮箱确认，需要先去邮箱点确认链接再登录。首次登录会把本机数据上传到账号，换设备登录会先合并再保持同步。</p>
      </fieldset>}

      {status.state === "online" && <fieldset className="sync-fieldset">
        <legend>同步</legend>
        <button className="secondary" disabled={!engine} onClick={() => { setMessage({ text: "正在同步…" }); void engine?.syncNow().then(() => setMessage({ text: "同步完成。" })); }}>立即同步</button>
        <button className="secondary" disabled={!engine} onClick={() => { if (window.confirm("退出登录后本机数据保留，但暂停云同步。确定？")) void engine?.syncSignOut(); }}>退出登录</button>
        <p className="mock-help">同一数据在两台设备同时修改时按类型智能合并：复习状态按卡片取最新、错题按条目、计数取较大值、个人编辑按版本号。极端情况下以先收敛的一端为准，不会整份覆盖。</p>
      </fieldset>}
    </div>
  </div></div>;
}

export default SyncPanel;
