import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  addPersonalCard, deletePersonalCard, newPersonalCardId, readPersonal,
  saveOverlay, updatePersonalCard,
  type PersonalCard, type PersonalOverlay, type PersonalSubject,
} from "@/lib/personal-cards";
import { adjustRuns, RICH_COLORS, RICH_HIGHLIGHTS, reinjectTextbookMarkers, richEqualsText, sanitizeRuns, type RichRun, type RichRunKind } from "@/lib/rich-text";
import { RichTextView } from "./RichTextView";

const DRAFT_KEY = "yantu-card-edit-draft-v1";
type FieldState = { text: string; runs: RichRun[] };
type Fields = { q: FieldState; a: FieldState; note: FieldState; bg: string | undefined };
type Target =
  | { kind: "textbook"; cardId: string; originalFront: string; originalBack: string }
  | { kind: "personal"; card: PersonalCard }
  | { kind: "new"; book: string; chapter: number; section: string };

type Book = { id: string; name: string; chapters: { title: string; sections?: string[] }[] };

const BG_SWATCHES = ["#fff7d6", "#e8f1ff", "#e9f9ee"];

const draftId = (subject: string, target: Target) =>
  target.kind === "textbook" ? `${subject}:t:${target.cardId}`
    : target.kind === "personal" ? `${subject}:p:${target.card.id}`
    : `${subject}:new:${target.book}:${target.chapter}:${target.section}`;

function loadDraft(id: string): Fields | null {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}");
    const draft = all && typeof all === "object" ? (all as Record<string, unknown>)[id] : null;
    if (!draft || typeof draft !== "object") return null;
    const row = draft as Record<string, unknown>;
    const field = (value: unknown): FieldState => {
      const item = (value || {}) as Record<string, unknown>;
      const text = typeof item.text === "string" ? item.text : "";
      return { text, runs: sanitizeRuns((item.runs || []) as RichRun[], text.length) };
    };
    return { q: field(row.q), a: field(row.a), note: field(row.note), bg: typeof row.bg === "string" ? row.bg : undefined };
  } catch { return null; }
}

function writeDraft(id: string, fields: Fields | null): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") as Record<string, unknown>;
    if (fields) all[id] = { ...fields, savedAt: new Date().toISOString() };
    else delete all[id];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
    return true;
  } catch { return false; }
}

function TextField({ label, value, onChange, textareaRef, onFocus, onSelect, placeholder, rows }: {
  label: string; value: FieldState; onChange: (next: FieldState) => void; textareaRef?: (node: HTMLTextAreaElement | null) => void;
  onFocus: () => void; onSelect: (selection: { start: number; end: number }) => void; placeholder: string; rows: number;
}) {
  return <label className="card-edit-field">
    <span>{label}</span>
    <textarea
      ref={textareaRef}
      rows={rows}
      value={value.text}
      placeholder={placeholder}
      onFocus={onFocus}
      onSelect={(event) => onSelect({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
      onChange={(event) => onChange({ text: event.target.value, runs: adjustRuns(value.runs, value.text, event.target.value) })}
    />
  </label>;
}

/** 闪卡个人编辑器: 修改问题/答案(保留原卡 ID 与复习排期)、添加"我的补充"、
 *  新建个人卡、文字颜色/底纹/加粗/下划线、整卡背景、恢复原文。
 *  草稿自动保存; 面板在闪卡按钮之外, 打开时由父级暂停快捷键。 */
export function CardEditor({ subject, subjectName, books, target, overlay, onDone, onAddScope, onResetCard }: {
  subject: PersonalSubject;
  subjectName: string;
  books: Book[];
  target: Target;
  overlay?: PersonalOverlay;
  onDone: () => void;
  /** 新建卡"保存并加入今日新学": 由父级调用 review.selectScopes(受每日上限约束) */
  onAddScope: (scope: { bookId: string; chapters: number[]; section?: string }) => void;
  onResetCard: (cardId: string) => void;
}) {
  const initial = useMemo<Fields>(() => {
    if (target.kind === "textbook") {
      const draft = loadDraft(draftId(subject, target));
      if (draft) return draft;
      const q = overlay?.q;
      const a = overlay?.a;
      return {
        q: { text: q ? q.text : target.originalFront, runs: q ? q.runs : [] },
        a: { text: a ? a.text : target.originalBack, runs: a ? a.runs : [] },
        note: overlay?.note ? { ...overlay.note } : { text: "", runs: [] },
        bg: overlay?.bg,
      };
    }
    if (target.kind === "personal") {
      const draft = loadDraft(draftId(subject, target));
      if (draft) return draft;
      return {
        q: { ...target.card.front },
        a: { ...target.card.back },
        note: target.card.note ? { ...target.card.note } : { text: "", runs: [] },
        bg: target.card.bg,
      };
    }
    const draft = loadDraft(draftId(subject, target));
    return draft || { q: { text: "", runs: [] }, a: { text: "", runs: [] }, note: { text: "", runs: [] }, bg: undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [fields, setFields] = useState<Fields>(initial);
  const [status, setStatus] = useState<{ error?: boolean; text: string }>(() => {
    const hadDraft = loadDraft(draftId(subject, target));
    return { text: hadDraft ? "已恢复上次未保存的草稿。" : "" };
  });
  const [showOriginal, setShowOriginal] = useState(false);
  const [resetAsNew, setResetAsNew] = useState(false);
  const [location, setLocation] = useState(target.kind === "new" ? { book: target.book, chapter: target.chapter, section: target.section } : null);
  const activeField = useRef<keyof Omit<Fields, "bg"> | null>(null);
  const selection = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const dirty = useMemo(() =>
    JSON.stringify(fields) !== JSON.stringify(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  , [fields]);

  // 草稿自动保存: 变更即写, 状态条提示
  useEffect(() => {
    if (!dirty) return;
    const ok = writeDraft(draftId(subject, target), fields);
    setStatus({ text: ok ? "草稿已保存（关闭面板后下次可恢复）。" : "草稿保存失败，请复制保留内容。", error: !ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields]);

  const update = (field: keyof Omit<Fields, "bg">, next: FieldState) => setFields(previous => ({ ...previous, [field]: next }));

  function applyStyle(kind: RichRunKind, value?: string) {
    const field = activeField.current;
    if (!field) { setStatus({ error: true, text: "请先在输入框里选中要设置样式的文字。" }); return; }
    const current = fields[field];
    let { start, end } = selection.current;
    if (end <= start) { // 无选区: 应用到全部
      start = 0; end = current.text.length;
      if (end <= start) { setStatus({ error: true, text: "这个输入框还没有内容。" }); return; }
    }
    const runs = sanitizeRuns([...current.runs, { start, end, kind, ...(value ? { value } : {}) }], current.text.length);
    update(field, { ...current, runs });
    setStatus({ text: "样式已应用到选中文字。" });
  }

  function clearStyle() {
    const field = activeField.current;
    if (!field) return;
    const current = fields[field];
    let { start, end } = selection.current;
    if (end <= start) { start = 0; end = current.text.length; }
    update(field, { ...current, runs: current.runs.filter(run => run.end <= start || run.start >= end) });
  }

  function finish() { writeDraft(draftId(subject, target), null); onDone(); }

  function cancel() {
    if (dirty && !window.confirm("有未保存的修改。放弃并关闭？（草稿仍会保留，下次可恢复）")) { writeDraft(draftId(subject, target), fields); return; }
    finish();
  }

  function saveTextbook() {
    if (target.kind !== "textbook") return;
    if (!fields.q.text.trim() || !fields.a.text.trim()) { setStatus({ error: true, text: "问题和答案不能为空。" }); return; }
    // 答案重注入教材重点标记(按原文匹配), 个人样式区间以纯文本偏移存储
    const aText = reinjectTextbookMarkers(target.originalBack, fields.a.text);
    const originalRev = overlay?.rev ?? null;
    const patch = {
      q: richEqualsText(overlay?.q, target.originalFront) && fields.q.text === target.originalFront ? null : { text: fields.q.text, runs: sanitizeRuns(fields.q.runs, fields.q.text.length) },
      a: fields.a.text === target.originalBack && !fields.a.runs.length ? null : { text: aText, runs: sanitizeRuns(fields.a.runs, fields.a.text.length) },
      note: fields.note.text.trim() ? { text: fields.note.text, runs: sanitizeRuns(fields.note.runs, fields.note.text.length) } : null,
      bg: fields.bg ?? null,
      ...(resetAsNew ? {} : {}),
    };
    const result = saveOverlay(subject, target.cardId, patch, target.originalFront, target.originalBack, originalRev);
    if (!result.ok) {
      setStatus({ error: true, text: result.reason === "conflict" ? "另一标签页刚修改了这张卡。请关闭面板重新打开，在最新版本上继续编辑。" : "保存失败：浏览器存储不可用或已满。请复制保留内容。" });
      return;
    }
    if (resetAsNew && window.confirm("将同时清除此卡的学习记录，重新作为新卡学习。确定？")) onResetCard(target.cardId);
    setStatus({ text: "修改已保存。复习排期与学习记录保持不变。" });
    setTimeout(finish, 600);
  }

  function savePersonalCard(joinScope: boolean) {
    if (!fields.q.text.trim() || !fields.a.text.trim()) { setStatus({ error: true, text: "问题和答案不能为空。" }); return; }
    const loc = target.kind === "personal" ? { book: target.card.book, chapter: target.card.chapter, section: target.card.section } : (location || { book: books[0]?.id || "", chapter: 1, section: "" });
    if (!loc.book) { setStatus({ error: true, text: "请选择书目。" }); return; }
    const front = { text: fields.q.text, runs: sanitizeRuns(fields.q.runs, fields.q.text.length) };
    const back = { text: fields.a.text, runs: sanitizeRuns(fields.a.runs, fields.a.text.length) };
    const note = fields.note.text.trim() ? { text: fields.note.text, runs: sanitizeRuns(fields.note.runs, fields.note.text.length) } : undefined;
    if (target.kind === "personal") {
      const result = updatePersonalCard(target.card.id, { front, back, note, bg: fields.bg }, target.card.rev);
      if (!result.ok) { setStatus({ error: true, text: result.reason === "conflict" ? "另一标签页刚修改了这张卡，请关闭后重新打开。" : "保存失败：浏览器存储不可用或已满。" }); return; }
      setStatus({ text: "修改已保存。" });
      setTimeout(finish, 500);
      return;
    }
    const created = addPersonalCard({
      subject, book: loc.book, chapter: loc.chapter, section: loc.section,
      front, back, note, bg: fields.bg,
    });
    if (!created.ok) { setStatus({ error: true, text: "保存失败：浏览器存储不可用或个人卡数量已达上限。" }); return; }
    if (joinScope) {
      onAddScope({ bookId: loc.book, chapters: [loc.chapter], ...(loc.section ? { section: loc.section } : {}) });
      setStatus({ text: "个人卡已保存并加入今日新学（受每日新卡上限约束）。" });
    } else setStatus({ text: "个人卡已保存。可在「设置学习范围」里把它加入学习。" });
    setTimeout(finish, 700);
  }

  const originalText = target.kind === "textbook" ? { front: target.originalFront, back: target.originalBack } : null;
  const previewBack = target.kind === "textbook" ? reinjectTextbookMarkers(target.originalBack, fields.a.text) : fields.a.text;
  const previewFront = fields.q.text;
  const activeBook = books.find(book => book.id === (location?.book ?? (target.kind === "personal" ? target.card.book : "")));
  const sectionOptions = activeBook?.chapters[(location?.chapter || 1) - 1]?.sections || [];

  return <section className="panel card-editor" aria-label="闪卡编辑器">
    <div className="panel-heading"><div><span className="eyebrow">EDIT CARD</span><h2>{target.kind === "new" ? "新建个人闪卡" : target.kind === "personal" ? "编辑个人卡" : "编辑闪卡"}</h2></div>
      <div className="card-edit-actions-head">{originalText && <button className="text-button" onClick={() => setShowOriginal(value => !value)}>{showOriginal ? "返回编辑" : "查看原文"}</button>}
        {target.kind === "personal" && <button className="text-button" onClick={() => { if (window.confirm("删除这张个人卡？（学习记录保留在历史中，可从备份恢复）")) { deletePersonalCard(target.card.id); finish(); } }}><Trash2 size={14}/>删除</button>}
      </div></div>
    <p className="mock-help">{target.kind === "textbook"
      ? "修改会与教材原文分开保存：不清空学习记录、不改变下次复习时间，也不增加今日新学。随时可恢复原文；「我的补充」独立于教材答案。"
      : target.kind === "personal" ? "编辑你的个人卡。归属可在下方调整。" : "个人卡与教材卡一起进入复习，带「个人补充」标记；归属保存为独立字段。选择保存后是否加入今日新学。"}</p>

    {showOriginal && originalText && <div className="card-edit-original">
      <b>教材原文</b>
      <p><small>问题</small>{originalText.front}</p>
      <p><small>答案</small><RichTextView text={originalText.back} /></p>
    </div>}

    {target.kind !== "textbook" && <div className="practice-config card-edit-location">
      <label>书目<select value={location?.book || ""} disabled={target.kind === "personal"} onChange={(event) => setLocation({ book: event.target.value, chapter: 1, section: "" })}>
        {books.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}
      </select></label>
      <label>章节<select value={location?.chapter || 1} disabled={target.kind === "personal"} onChange={(event) => setLocation(previous => ({ book: previous?.book || "", chapter: Number(event.target.value), section: "" }))}>
        {(activeBook?.chapters || []).map((chapter, index) => <option key={index} value={index + 1}>第 {index + 1} 章 · {chapter.title}</option>)}
      </select></label>
      {sectionOptions.length > 0 && <label>小节<select value={location?.section || ""} disabled={target.kind === "personal"} onChange={(event) => setLocation(previous => previous ? { ...previous, section: event.target.value } : previous)}>
        <option value="">本章全部小节</option>
        {sectionOptions.map(section => <option key={section} value={section}>{section}</option>)}
      </select></label>}
    </div>}

    <div className="card-edit-toolbar" role="toolbar" aria-label="文字样式">
      <span className="card-edit-toolbar-label">文字颜色</span>
      {RICH_COLORS.map(color => <button key={color} type="button" className="rich-swatch" style={{ backgroundColor: color }} aria-label={`文字颜色 ${color}`} onClick={() => applyStyle("color", color)}/>)}
      <span className="card-edit-toolbar-label">高亮</span>
      {RICH_HIGHLIGHTS.map(color => <button key={color} type="button" className="rich-swatch rich-swatch-hl" style={{ backgroundColor: color }} aria-label={`高亮 ${color}`} onClick={() => applyStyle("hl", color)}/>)}
      <button type="button" className="mode-button" onClick={() => applyStyle("b")}>加粗</button>
      <button type="button" className="mode-button" onClick={() => applyStyle("u")}>下划线</button>
      <button type="button" className="mode-button" onClick={clearStyle}>清除所选格式</button>
      <span className="card-edit-toolbar-label">整卡背景</span>
      <button type="button" className={"mode-button" + (fields.bg ? "" : " active")} onClick={() => setFields(previous => ({ ...previous, bg: undefined }))}>默认</button>
      {BG_SWATCHES.map(color => <button key={color} type="button" className={"rich-swatch" + (fields.bg === color ? " active-ring" : "")} style={{ backgroundColor: color }} aria-label={`背景 ${color}`} onClick={() => setFields(previous => ({ ...previous, bg: color }))}/>)}
    </div>

    <TextField label="问题" value={fields.q} rows={3} placeholder="问题（保留原卡 ID 与复习排期）"
      onChange={next => update("q", next)}
      textareaRef={node => { if (node) activeField.current = "q"; }}
      onFocus={() => { activeField.current = "q"; }}
      onSelect={selectionData => { selection.current = selectionData; }}/>
    <TextField label="答案" value={fields.a} rows={7} placeholder="答案。教材重点颜色在保存后自动保留"
      onChange={next => update("a", next)}
      textareaRef={node => { if (node) activeField.current = "a"; }}
      onFocus={() => { activeField.current = "a"; }}
      onSelect={selectionData => { selection.current = selectionData; }}/>
    <TextField label="我的补充" value={fields.note} rows={4} placeholder="老师讲解、例子、易错点……（独立于教材答案，AI 与搜索都能看到）"
      onChange={next => update("note", next)}
      textareaRef={node => { if (node) activeField.current = "note"; }}
      onFocus={() => { activeField.current = "note"; }}
      onSelect={selectionData => { selection.current = selectionData; }}/>

    <div className="card-edit-preview" aria-label="实时预览">
      <small>预览</small>
      <div className="card-edit-preview-card" style={fields.bg ? { backgroundColor: fields.bg } : undefined}>
        <strong><RichTextView text={previewFront} runs={fields.q.runs} renderTextbook={false}/></strong>
        <div className="card-edit-preview-answer"><RichTextView text={previewBack} runs={fields.a.runs}/></div>
        {fields.note.text.trim() && <div className="card-edit-preview-note"><b>我的补充</b><RichTextView text={fields.note.text} runs={fields.note.runs}/></div>}
      </div>
    </div>

    <p className={status.error ? "error" : "card-edit-status"} role={status.error ? "alert" : "status"}>{status.text}</p>

    <div className="next-actions">
      {target.kind === "textbook" && <button className="primary" onClick={saveTextbook}>保存修改</button>}
      {target.kind !== "textbook" && <button className="primary" onClick={() => savePersonalCard(false)}>仅保存</button>}
      {target.kind === "new" && <button className="secondary" onClick={() => savePersonalCard(true)}>保存并加入今日新学</button>}
      {target.kind === "textbook" && overlay && (overlay.q || overlay.a) && <button className="secondary" onClick={() => {
        if (!window.confirm("恢复教材原文？问题和答案会还原，我的补充与整卡背景保留。")) return;
        const result = saveOverlay(subject, target.cardId, { q: null, a: null }, target.originalFront, target.originalBack, overlay.rev);
        if (!result.ok) { setStatus({ error: true, text: result.reason === "conflict" ? "另一标签页刚修改了这张卡，请关闭后重试。" : "恢复失败：存储不可用。" }); return; }
        setStatus({ text: "已恢复教材原文（我的补充保留）。" });
        setTimeout(finish, 600);
      }}><RotateCcw size={14}/>恢复原文</button>}
      {target.kind === "textbook" && <label className="card-edit-reset"><input type="checkbox" checked={resetAsNew} onChange={(event) => setResetAsNew(event.target.checked)}/>保存时清除此卡学习记录，重新作为新卡学习（题目已改成全新知识点时使用）</label>}
      <button className="secondary" onClick={cancel}>{dirty ? "取消（保留草稿）" : "关闭"}</button>
    </div>
  </section>;
}
