import { useEffect, useRef, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { cleanApiKey } from "@/lib/deepseek-browser";

export function ApiKeySettings({ apiKey, onCommit, onClose }: { apiKey: string; onCommit: (key: string) => void; onClose: () => void }) {
  const [draft, setDraft] = useState(apiKey), [error, setError] = useState("");
  const dialog = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]') || [])];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); if (previous?.isConnected) previous.focus(); };
  }, []);
  function commit(value: string) {
    const cleaned = cleanApiKey(value);
    try {
      if (cleaned) sessionStorage.setItem("yantu-key", cleaned);
      else sessionStorage.removeItem("yantu-key");
    } catch { setError("浏览器未能保存密钥。请允许会话存储后重试；当前已配置的密钥未更改。"); return; }
    onCommit(cleaned); onClose();
  }
  return <div className="yantu-key-overlay" onClick={onClose}><div ref={dialog} className="key-modal" role="dialog" aria-modal="true" aria-labelledby="key-title" onClick={event => event.stopPropagation()}>
    <button className="modal-close" onClick={onClose} aria-label="关闭密钥设置"><X size={20}/></button><span className="key-icon"><KeyRound size={23}/></span><h2 id="key-title">连接 DeepSeek</h2>
    <p>填入自己的 API Key 后生成计划和反馈。点击保存后，密钥只保存在 sessionStorage，请求由浏览器直接发送给 DeepSeek。</p>
    <label htmlFor="api-key">API Key</label><input ref={input} id="api-key" type="password" value={draft} onChange={event => setDraft(event.target.value)} placeholder="sk-..." autoComplete="off"/>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="modal-actions"><button className="secondary" onClick={() => commit("")}>清除</button><button className="secondary" onClick={onClose}>取消</button><button className="primary" onClick={() => commit(draft)}>保存并继续</button></div>
  </div></div>;
}
