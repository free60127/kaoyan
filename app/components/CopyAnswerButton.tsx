import { useEffect, useRef, useState, type RefObject } from "react";
import { copyAnswer } from "@/lib/copy-answer";

export function CopyAnswerButton({ text, answerRef }: { text: string; answerRef?: RefObject<HTMLTextAreaElement | null> }) {
  const [status, setStatus] = useState<"" | "copied" | "manual">("");
  const [pending, setPending] = useState(false);
  const manualRef = useRef<HTMLTextAreaElement | null>(null);
  const generation = useRef(0);
  const latestText = useRef(text); latestText.current = text;
  useEffect(() => { generation.current++; setStatus(""); setPending(false); }, [text]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (status !== "manual") return;
    const area = answerRef?.current || manualRef.current;
    area?.focus(); area?.select();
  }, [status, answerRef]);
  async function copy() {
    const current = ++generation.current, value = text;
    setPending(true); setStatus("");
    try {
      await copyAnswer(value, navigator.clipboard);
      if (generation.current === current && latestText.current === value) setStatus("copied");
    } catch {
      if (generation.current === current && latestText.current === value) setStatus("manual");
    } finally { if (generation.current === current) setPending(false); }
  }
  return <div className="copy-answer">
    <button className="secondary" disabled={!text.trim() || pending} onClick={copy}>{pending ? "复制中…" : "复制我的答案"}</button>
    <span role="status" aria-live="polite">{status === "copied" ? "已复制" : status === "manual" ? "剪贴板不可用，答案已选中，请按 Ctrl+C / ⌘C 手动复制。" : ""}</span>
    {status === "manual" && !answerRef && <textarea ref={manualRef} className="copy-manual" aria-label="手动复制我的答案" readOnly value={text}/>}
  </div>;
}
