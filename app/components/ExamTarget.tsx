import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CalendarDays, X } from "lucide-react";
import { createExamTargetController, examCountdownLabel, examDateLabel, isExamDate, watchExamTarget, type ExamTargetController, type ExamTargetSnapshot } from "@/lib/exam-target";
import "./exam-target.css";

export function useExamTarget() {
  const [controller] = useState(() => createExamTargetController(() => window.localStorage));
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useEffect(() => watchExamTarget(controller, {
    window, document, now: () => new Date(),
    setTimeout: (callback, delay) => window.setTimeout(callback, delay),
    clearTimeout: id => window.clearTimeout(id),
  }), [controller]);
  return { controller, snapshot };
}

function ExamTargetEditor({ controller, snapshot, onClose }: { controller: ExamTargetController; snapshot: ExamTargetSnapshot; onClose: () => void }) {
  const [initialDate] = useState(snapshot.date || ""), [formError, setFormError] = useState("");
  const dialog = useRef<HTMLFormElement>(null), input = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    input.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      // Review shortcuts listen on window. Keep every key within the modal,
      // while leaving native date-input and button behavior intact.
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") || [])];
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); document.body.style.overflow = previousOverflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="exam-target-overlay" onClick={onClose}>
    <form ref={dialog} className="exam-target-editor" role="dialog" aria-modal="true" aria-labelledby="exam-target-title" onClick={event => event.stopPropagation()} onSubmit={event => {
      event.preventDefault();
      const date = input.current?.value || "";
      if (!isExamDate(date)) { setFormError("请选择有效的考试日期。"); input.current?.focus(); return; }
      setFormError("");
      if (controller.save(date)) onClose();
    }}>
      <button type="button" className="exam-target-close" onClick={onClose} aria-label="关闭考试日期设置"><X size={20}/></button>
      <h2 id="exam-target-title">设置目标考试日期</h2>
      <p id="exam-target-help">按你的备考目标选择初试日期。倒计时按本地日期每天更新；日期由你设置，请以官方安排为准。</p>
      <label htmlFor="exam-target-date">目标初试日期</label>
      {/* Native date inputs retain incomplete year/month/day segments across unrelated renders. */}
      <input ref={input} id="exam-target-date" type="date" required min="0001-01-01" max="9999-12-31" defaultValue={initialDate} onChange={() => setFormError("")} onInvalid={() => setFormError("请选择有效的考试日期。")} aria-describedby={`exam-target-help${formError || snapshot.error ? " exam-target-error" : ""}`}/>
      {(formError || snapshot.error) && <p id="exam-target-error" className="exam-target-error" role="alert">{formError || snapshot.error}</p>}
      <div className="exam-target-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button type="submit" className="primary" disabled={!snapshot.ready}>保存日期</button></div>
    </form>
  </div>;
}

export function ExamTarget({ controller, snapshot }: { controller: ExamTargetController; snapshot: ExamTargetSnapshot }) {
  const [open, setOpen] = useState(false);
  const countdown = snapshot.ready ? examCountdownLabel(snapshot.date, snapshot.today) : "考试日期读取中…";
  return <div className="exam-target">
    <button type="button" className="exam-target-trigger" disabled={!snapshot.ready} aria-haspopup="dialog" aria-expanded={open} aria-label={`${countdown}，${examDateLabel(snapshot.date)}${snapshot.error ? "，存储出现问题" : ""}，点击设置`} onClick={() => setOpen(true)}>
      <CalendarDays size={18}/><span><b>{!snapshot.ready || snapshot.date ? countdown : "设置考试日期"}</b><small>{snapshot.date ? examDateLabel(snapshot.date) : "目标初试倒计时"}</small></span>
      {snapshot.error && <span className="exam-target-error-mark" title={snapshot.error} aria-hidden="true">!</span>}
    </button>
    {open && <ExamTargetEditor controller={controller} snapshot={snapshot} onClose={() => setOpen(false)}/>}
  </div>;
}
