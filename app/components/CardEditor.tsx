import { useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import {
  addPersonalCard, deletePersonalCard,
  saveOverlay, updatePersonalCard,
  type PersonalCard, type PersonalOverlay, type PersonalSubject,
} from "@/lib/personal-cards";
import { adjustRuns, RICH_COLORS, RICH_HIGHLIGHTS, reinjectTextbookMarkers, sanitizeRuns, textbookEditContent, type RichRun, type RichRunKind } from "@/lib/rich-text";
import { stripHighlightMarkers } from "@/lib/highlight-markers";
import { RichTextView } from "./RichTextView";

const DRAFT_KEY = "yantu-card-edit-draft-v2";
type FieldState = { text: string; runs: RichRun[] };
type Fields = { q: FieldState; a: FieldState; note: FieldState; bg: string | undefined };
type EditLocation = { book: string; chapter: number; section: string };
type Draft = { fields: Fields; location?: EditLocation; baselineRev: number | null };
type Target =
  | { kind: "textbook"; cardId: string; originalFront: string; originalBack: string }
  | { kind: "personal"; card: PersonalCard }
  | { kind: "new"; book: string; chapter: number; section: string };

type Book = { id: string; name: string; chapters: { title: string; sections?: string[] }[] };

const BG_SWATCHES = ["#fff7d6", "#e8f1ff", "#e9f9ee"];
const MAX_TEXT = 20_000;

const emptyField = (text = ""): FieldState => ({ text, runs: [] });

const draftId = (subject: string, target: Target) =>
  target.kind === "textbook" ? `${subject}:t:${target.cardId}`
    : target.kind === "personal" ? `${subject}:p:${target.card.id}`
    : `${subject}:new`; // 新建卡的归属保存在草稿内, 不随初始位置变化(F13)

function loadDraft(id: string): Draft | null {
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
    const location = row.location && typeof row.location === "object"
      ? (() => {
          const loc = row.location as Record<string, unknown>;
          if (typeof loc.book !== "string" || !loc.book) return undefined;
          return { book: loc.book, chapter: Number(loc.chapter) || 1, section: typeof loc.section === "string" ? loc.section : "" };
        })()
      : undefined;
    const baselineRev = typeof row.baselineRev === "number" || row.baselineRev === null ? row.baselineRev as number | null : null;
    return {
      fields: { q: field(row.q), a: field(row.a), note: field(row.note), bg: typeof row.bg === "string" ? row.bg : undefined },
      ...(location ? { location } : {}),
      baselineRev,
    };
  } catch { return null; }
}

function writeDraft(id: string, draft: Draft | null): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") as Record<string, unknown>;
    if (draft) all[id] = draft;
    else delete all[id];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(all));
    return true;
  } catch { return false; }
}

function TextField({ label, value, onChange, nodeRef, onFocus, onSelect, placeholder, rows }: {
  label: string; value: FieldState; onChange: (next: FieldState) => void; nodeRef: (node: HTMLTextAreaElement | null) => void;
  onFocus: () => void; onSelect: (selection: { start: number; end: number }) => void; placeholder: string; rows: number;
}) {
  return <label className="card-edit-field">
    <span>{label}</span>
    <textarea
      ref={nodeRef}
      rows={rows}
      value={value.text}
      placeholder={placeholder}
      onFocus={onFocus}
      onSelect={(event) => onSelect({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}
      onChange={(event) => onChange({ text: event.target.value, runs: adjustRuns(value.runs, value.text, event.target.value) })}
    />
  </label>;
}

/** 闪卡个人编辑器。F02: 打开时冻结覆盖层版本基线(草稿也保存它), 保存以其比对,
 *  另一标签的并发修改会被检出而不是静默覆盖。F05: 编辑区是纯文本, 教材标记在保存时重注入。
 *  F06: 取消只关闭面板(草稿保留), 仅成功提交与明确放弃才清稿。F13: 归属随草稿持久化。 */
export function CardEditor({ subject, subjectName, books, target, overlay, onDone, onAddScope, onResetCard }: {
  subject: PersonalSubject;
  subjectName: string;
  books: Book[];
  target: Target;
  overlay?: PersonalOverlay;
  onDone: () => void;
  onAddScope: (scope: { bookId: string; chapters: number[]; section?: string }) => void;
  onResetCard: (cardId: string) => void;
}) {
  // F02: 基线在打开时冻结; 草稿恢复时以草稿里保存的基线为准
  const storedDraft = useMemo(() => loadDraft(draftId(subject, target)), [subject, target]);
  const baselineRev = useRef<number | null>(storedDraft ? storedDraft.baselineRev : overlay ? overlay.rev : null);
  const initialLocation = useMemo<EditLocation | null>(() => {
    if (storedDraft?.location) return storedDraft.location;
    if (target.kind === "personal") return { book: target.card.book, chapter: target.card.chapter, section: target.card.section };
    if (target.kind === "new") return { book: target.book, chapter: target.chapter, section: target.section };
    return null;
  }, [storedDraft, target]);
  const initial = useMemo<Fields>(() => {
    if (storedDraft) return target.kind === "textbook" ? { ...storedDraft.fields, q: textbookEditContent(storedDraft.fields.q, true), a: textbookEditContent(storedDraft.fields.a, true) } : storedDraft.fields;
    if (target.kind === "textbook") {
      // F05: 编辑区是纯文本——教材标记剥掉, 保存时按原文重注入; 个人样式区间以纯文本偏移存储
      const q = overlay?.q;
      const a = overlay?.a;
      return {
        q: textbookEditContent(q || emptyField(target.originalFront)),
        a: textbookEditContent(a || emptyField(target.originalBack)),
        note: overlay?.note ? { ...overlay.note } : emptyField(),
        bg: overlay?.bg,
      };
    }
    if (target.kind === "personal") {
      return { q: { ...target.card.front }, a: { ...target.card.back }, note: target.card.note ? { ...target.card.note } : emptyField(), bg: target.card.bg };
    }
    return { q: emptyField(), a: emptyField(), note: emptyField(), bg: undefined };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [fields, setFields] = useState<Fields>(initial);
  const [location, setLocation] = useState<EditLocation | null>(initialLocation);
  const [status, setStatus] = useState<{ error?: boolean; text: string }>(() => ({ text: storedDraft ? "已恢复上次未保存的草稿。" : "" }));
  const [showOriginal, setShowOriginal] = useState(false);
  const [resetAsNew, setResetAsNew] = useState(false);
  const activeField = useRef<"q" | "a" | "note" | null>(null);
  const selection = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
  const fieldNodes = useRef<Partial<Record<"q" | "a" | "note", HTMLTextAreaElement | null>>>({});
  const dirty = useMemo(() => JSON.stringify(fields) !== JSON.stringify(initial) || JSON.stringify(location) !== JSON.stringify(initialLocation), [fields, location, initial, initialLocation]);

  // 草稿自动保存: 文本与归属都是草稿的一部分(F13)
  useEffect(() => {
    if (!dirty) return;
    const ok = writeDraft(draftId(subject, target), { fields, location: location ?? undefined, baselineRev: baselineRev.current });
    setStatus({ text: ok ? "草稿已保存（关闭面板后下次可恢复）。" : "草稿保存失败，请复制保留内容。", error: !ok });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fields, location]);

  const update = (field: "q" | "a" | "note", next: FieldState) => setFields(previous => ({ ...previous, [field]: next }));

  function applyStyle(kind: RichRunKind, value?: string) {
    const field = activeField.current;
    if (!field) { setStatus({ error: true, text: "请先在输入框里选中要设置样式的文字。" }); return; }
    const current = fields[field];
    let { start, end } = selection.current;
    if (end <= start) { start = 0; end = current.text.length; }
    if (end <= start) { setStatus({ error: true, text: "这个输入框还没有内容。" }); return; }
    const runs = sanitizeRuns([...current.runs, { start, end, kind, ...(value ? { value } : {}) }], current.text.length);
    update(field, { ...current, runs });
    setStatus({ text: "样式已应用到选中文字。" });
    // 保持字段与选区上下文, 连续动作不错位(F04)
    const node = fieldNodes.current[field];
    if (node) { node.focus(); node.setSelectionRange(start, end); selection.current = { start, end }; }
  }

  function clearStyle() {
    const field = activeField.current;
    if (!field) return;
    const current = fields[field];
    let { start, end } = selection.current;
    if (end <= start) { start = 0; end = current.text.length; }
    // 只拆掉选区内的部分, 保留选区外的区间(F04)
    const runs: RichRun[] = [];
    for (const run of current.runs) {
      if (run.end <= start || run.start >= end) { runs.push(run); continue; }
      if (run.start < start) runs.push({ ...run, end: start });
      if (run.end > end) runs.push({ ...run, start: end });
    }
    update(field, { ...current, runs });
    const node = fieldNodes.current[field];
    if (node) { node.focus(); node.setSelectionRange(start, end); }
  }

  function closeKeepingDraft() { onDone(); } // F06: 关闭/取消永远保留草稿
  function discardDraftAndClose() {
    if (window.confirm("确定放弃这份草稿？关闭后这些未保存的修改无法找回。")) { writeDraft(draftId(subject, target), null); onDone(); }
  }
  function finishAfterSuccess() { writeDraft(draftId(subject, target), null); onDone(); }

  function cancel() {
    if (dirty && !window.confirm("有未保存的修改。关闭并保留草稿？（下次打开可恢复）")) return;
    closeKeepingDraft();
  }

  function reportSave(result: { ok: boolean; reason?: string; message?: string }, successText: string) {
    if (!result.ok) {
      setStatus({ error: true, text: result.reason === "conflict"
        ? "另一标签页刚修改了这张卡。你的输入仍保留在编辑器和草稿里；请关闭面板重新打开，在最新版本上继续编辑。"
        : result.reason === "invalid" ? (result.message || "内容未通过校验。")
        : "保存失败：浏览器存储不可用或已满。请复制保留内容。" });
      return false;
    }
    setStatus({ text: successText });
    return true;
  }

  function saveTextbook() {
    if (target.kind !== "textbook") return;
    if (!fields.q.text.trim() || !fields.a.text.trim()) { setStatus({ error: true, text: "问题和答案不能为空。" }); return; }
    if (fields.a.text.length > MAX_TEXT || fields.q.text.length > MAX_TEXT || fields.note.text.length > MAX_TEXT) {
      setStatus({ error: true, text: `内容超过 ${MAX_TEXT} 字上限，请删减后再保存。` });
      return;
    }
    // F05: 输入是纯文本, 注入前无编码, 重复保存不会嵌套
    const aText = reinjectTextbookMarkers(target.originalBack, fields.a.text);
    const patch = {
      q: fields.q.text === stripHighlightMarkers(target.originalFront) && !fields.q.runs.length ? null : { text: fields.q.text, runs: sanitizeRuns(fields.q.runs, fields.q.text.length) },
      a: fields.a.text === stripHighlightMarkers(target.originalBack) && !fields.a.runs.length ? null : { text: aText, runs: sanitizeRuns(fields.a.runs, fields.a.text.length) },
      note: fields.note.text.trim() ? { text: fields.note.text, runs: sanitizeRuns(fields.note.runs, fields.note.text.length) } : null,
      bg: fields.bg ?? null,
    };
    if (!reportSave(saveOverlay(subject, target.cardId, patch, target.originalFront, target.originalBack, baselineRev.current), "修改已保存。复习排期与学习记录保持不变。")) return;
    if (resetAsNew && window.confirm("将同时清除此卡的学习记录，重新作为新卡学习。确定？")) onResetCard(target.cardId);
    setTimeout(finishAfterSuccess, 600);
  }

  function savePersonalCard(joinScope: boolean) {
    const loc = target.kind === "personal" ? (location ?? { book: target.card.book, chapter: target.card.chapter, section: target.card.section }) : (location ?? { book: books[0]?.id || "", chapter: 1, section: "" });
    if (!loc.book) { setStatus({ error: true, text: "请选择书目。" }); return; }
    if (!fields.q.text.trim() || !fields.a.text.trim()) { setStatus({ error: true, text: "问题和答案不能为空。" }); return; }
    const front = { text: fields.q.text, runs: sanitizeRuns(fields.q.runs, fields.q.text.length) };
    const back = { text: fields.a.text, runs: sanitizeRuns(fields.a.runs, fields.a.text.length) };
    const note = fields.note.text.trim() ? { text: fields.note.text, runs: sanitizeRuns(fields.note.runs, fields.note.text.length) } : undefined;
    if (target.kind === "personal") {
      // 归属可迁移(F11): 保存采用编辑器里的位置; 卡 ID 与已有学习记录不变
      if (!reportSave(updatePersonalCard(target.card.id, { front, back, note, bg: fields.bg, book: loc.book, chapter: loc.chapter, section: loc.section }, target.card.rev), "修改已保存。")) return;
      setTimeout(finishAfterSuccess, 500);
      return;
    }
    if (!reportSave(addPersonalCard({ subject, book: loc.book, chapter: loc.chapter, section: loc.section, front, back, note, bg: fields.bg }), joinScope ? "个人卡已保存并加入今日新学（受每日新卡上限约束）。" : "个人卡已保存。可在「设置学习范围」里把它加入学习。")) return;
    if (joinScope) onAddScope({ bookId: loc.book, chapters: [loc.chapter], ...(loc.section ? { section: loc.section } : {}) });
    setTimeout(finishAfterSuccess, 700);
  }

  const originalText = target.kind === "textbook" ? { front: target.originalFront, back: target.originalBack } : null;
  const previewBack = target.kind === "textbook" ? reinjectTextbookMarkers(target.originalBack, fields.a.text) : fields.a.text;
  const activeBook = books.find(book => book.id === (location?.book || ""));
  const sectionOptions = activeBook?.chapters[(location?.chapter || 1) - 1]?.sections || [];
  const locationDirty = JSON.stringify(location) !== JSON.stringify(initialLocation);

  return <section className="panel card-editor" aria-label="闪卡编辑器">
    <div className="panel-heading"><div><span className="eyebrow">EDIT CARD</span><h2>{target.kind === "new" ? "新建个人闪卡" : target.kind === "personal" ? "编辑个人卡" : "编辑闪卡"}</h2></div>
      <div className="card-edit-actions-head">{originalText && <button className="text-button" onClick={() => setShowOriginal(value => !value)}>{showOriginal ? "返回编辑" : "查看原文"}</button>}
        {target.kind === "personal" && <button className="text-button" onClick={() => { if (window.confirm("删除这张个人卡？（学习记录保留在历史中，可从备份恢复）")) { deletePersonalCard(target.card.id); finishAfterSuccess(); } }}><Trash2 size={14}/>删除</button>}
      </div></div>
    <p className="mock-help">{target.kind === "textbook"
      ? "修改会与教材原文分开保存：不清空学习记录、不改变下次复习时间，也不增加今日新学。随时可恢复原文；「我的补充」独立于教材答案。"
      : target.kind === "personal" ? "编辑你的个人卡，可调整归属（卡 ID 与已有学习记录不变，更改归属会改变它出现的章节）。" : "个人卡与教材卡一起进入复习，带「个人补充」标记；归属保存为独立字段。选择保存后是否加入今日新学。"}</p>

    {showOriginal && originalText && <div className="card-edit-original">
      <b>教材原文</b>
      <p><small>问题</small>{originalText.front}</p>
      <p><small>答案</small><RichTextView text={originalText.back} /></p>
    </div>}

    {target.kind !== "textbook" && <div className="practice-config card-edit-location">
      <label>书目<select value={location?.book || ""} onChange={(event) => setLocation({ book: event.target.value, chapter: 1, section: "" })}>
        {books.map(book => <option key={book.id} value={book.id}>{book.name}</option>)}
      </select></label>
      <label>章节<select value={location?.chapter || 1} onChange={(event) => setLocation(previous => ({ book: previous?.book || "", chapter: Number(event.target.value), section: "" }))}>
        {(activeBook?.chapters || []).map((chapter, index) => <option key={index} value={index + 1}>第 {index + 1} 章 · {chapter.title}</option>)}
      </select></label>
      {sectionOptions.length > 0 && <label>小节<select value={location?.section || ""} onChange={(event) => setLocation(previous => previous ? { ...previous, section: event.target.value } : previous)}>
        <option value="">本章全部小节</option>
        {sectionOptions.map(section => <option key={section} value={section}>{section}</option>)}
      </select></label>}
      {locationDirty && <small className="card-edit-loc-note">归属已调整，将随本次保存生效</small>}
    </div>}

    <div className="card-edit-toolbar" role="toolbar" aria-label="文字样式">
      <span className="card-edit-toolbar-label">文字颜色</span>
      {RICH_COLORS.map(color => <button key={color} type="button" className="rich-swatch" style={{ backgroundColor: color }} aria-label={`文字颜色 ${color}`} onMouseDown={event => event.preventDefault()} onClick={() => applyStyle("color", color)}/>)}
      <span className="card-edit-toolbar-label">高亮</span>
      {RICH_HIGHLIGHTS.map(color => <button key={color} type="button" className="rich-swatch rich-swatch-hl" style={{ backgroundColor: color }} aria-label={`高亮 ${color}`} onMouseDown={event => event.preventDefault()} onClick={() => applyStyle("hl", color)}/>)}
      <button type="button" className="mode-button" onMouseDown={event => event.preventDefault()} onClick={() => applyStyle("b")}>加粗</button>
      <button type="button" className="mode-button" onMouseDown={event => event.preventDefault()} onClick={() => applyStyle("u")}>下划线</button>
      <button type="button" className="mode-button" onMouseDown={event => event.preventDefault()} onClick={clearStyle}>清除所选格式</button>
      <span className="card-edit-toolbar-label">整卡背景</span>
      <button type="button" className={"mode-button" + (fields.bg ? "" : " active")} onClick={() => setFields(previous => ({ ...previous, bg: undefined }))}>默认</button>
      {BG_SWATCHES.map(color => <button key={color} type="button" className={"rich-swatch" + (fields.bg === color ? " active-ring" : "")} style={{ backgroundColor: color }} aria-label={`背景 ${color}`} onClick={() => setFields(previous => ({ ...previous, bg: color }))}/>)}
    </div>

    <TextField label="问题" value={fields.q} rows={3} placeholder="问题（保留原卡 ID 与复习排期）"
      onChange={next => update("q", next)}
      nodeRef={node => { fieldNodes.current.q = node; }}
      onFocus={() => { activeField.current = "q"; }}
      onSelect={selectionData => { selection.current = selectionData; }}/>
    <TextField label="答案" value={fields.a} rows={7} placeholder="答案。教材重点颜色在保存后自动保留"
      onChange={next => update("a", next)}
      nodeRef={node => { fieldNodes.current.a = node; }}
      onFocus={() => { activeField.current = "a"; }}
      onSelect={selectionData => { selection.current = selectionData; }}/>
    <TextField label="我的补充" value={fields.note} rows={4} placeholder="老师讲解、例子、易错点……（独立于教材答案，AI 与搜索都能看到）"
      onChange={next => update("note", next)}
      nodeRef={node => { fieldNodes.current.note = node; }}
      onFocus={() => { activeField.current = "note"; }}
      onSelect={selectionData => { selection.current = selectionData; }}/>

    <div className="card-edit-preview" aria-label="实时预览">
      <small>预览</small>
      <div className="card-edit-preview-card" style={fields.bg ? { backgroundColor: fields.bg } : undefined}>
        <strong><RichTextView text={fields.q.text} runs={fields.q.runs} renderTextbook={false}/></strong>
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
        if (!reportSave(saveOverlay(subject, target.cardId, { q: null, a: null }, target.originalFront, target.originalBack, baselineRev.current), "已恢复教材原文（我的补充保留）。")) return;
        setTimeout(finishAfterSuccess, 600);
      }}><RotateCcw size={14}/>恢复原文</button>}
      {target.kind === "textbook" && <label className="card-edit-reset"><input type="checkbox" checked={resetAsNew} onChange={(event) => setResetAsNew(event.target.checked)}/>保存时清除此卡学习记录，重新作为新卡学习（题目已改成全新知识点时使用）</label>}
      {storedDraft && dirty && <button className="secondary" onClick={discardDraftAndClose}>放弃草稿并关闭</button>}
      <button className="secondary" onClick={cancel}>{dirty ? "取消（保留草稿）" : "关闭"}</button>
    </div>
  </section>;
}
