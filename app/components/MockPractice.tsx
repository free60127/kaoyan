import { useEffect, useReducer, useRef, useState } from "react";
import { generateMockQuiz, MOCK_QUIZ_TYPES, MOCK_QUIZ_TYPE_LABELS, type MockQuizQuestion } from "@/lib/mock-quiz";
import { getApplicableMockPaperTemplate, type MockPaperTemplateId } from "@/lib/mock-paper-templates";
import { countsToStrings, initialMockCounts, initialMockPracticeState, mockPracticeReducer, mockPracticeScore, mockRangesFromSelection, snapshotMockSettings, type MockPracticeBook, type MockResponse, type MockSnapshot } from "@/lib/mock-practice-state";
import { readMockPractice, writeMockPractice, type MockSettings } from "@/lib/mock-practice-storage";
import { CopyAnswerButton } from "./CopyAnswerButton";
import { selectedAnswer } from "@/lib/copy-answer";

type Props = { subject: "333" | "825"; books: MockPracticeBook[]; active: boolean; apiKey: string; onNeedKey: () => void; onOpenBackup: () => void; onStatusChange: (subject: "333" | "825", status: { pending: boolean; error: boolean }) => void; current: { bookId: string; chapter: number; section: string } };
export function MockPractice({ subject, books, active, apiKey, onNeedKey, onOpenBackup, onStatusChange, current }: Props) {
  const [counts, setCounts] = useState(() => initialMockCounts(subject));
  const [selection, setSelection] = useState<Record<string, number[]>>(() => ({ [books[0]?.id || ""]: [1] }));
  const [sectionScope, setSectionScope] = useState<{ bookId: string; chapter: number; name: string }>();
  const [templateId, setTemplateId] = useState<MockPaperTemplateId>();
  const [state, dispatch] = useReducer(mockPracticeReducer, undefined, initialMockPracticeState);
  const [hydratedSubject, setHydratedSubject] = useState<typeof subject | null>(null);
  const [storageStatus, setStorageStatus] = useState({ error: false, message: "本地保存加载中…" });
  const [confirmClear, setConfirmClear] = useState(false);
  const [replacement, setReplacement] = useState<MockSnapshot>();
  const storedFingerprint = useRef("");
  const latestBooks = useRef(books); latestBooks.current = books;
  const request = useRef<{ id: number; controller?: AbortController }>({ id: 0 });
  const visible = useRef(active); visible.current = active;
  const templateOption: MockPaperTemplateId = subject === "333" ? "333-2026" : "825-2026";
  const ranges = mockRangesFromSelection(books, selection, sectionScope);
  const scopeLabel = ranges.map((range) => {
    const book = books.find((row) => row.id === range.bookId)!;
    return `${book.name} · ${range.chapters?.length === book.chapters.length ? "整本书" : "第 " + range.chapters?.join("、") + " 章"}${range.section ? " · " + range.section : ""}`;
  }).join("；");
  const template = templateId && ranges.length ? getApplicableMockPaperTemplate(templateId, subject, ranges.map((range) => range.bookId)) : undefined;
  const total = MOCK_QUIZ_TYPES.reduce((sum, type) => sum + (Number(counts[type]) || 0), 0);
  const session = state.session;
  const score = session ? mockPracticeScore(session) : null;
  const snapshotTemplate = session?.snapshot.templateId ? getApplicableMockPaperTemplate(session.snapshot.templateId, subject, session.snapshot.ranges.map((range) => range.bookId)) : undefined;
  const question = session?.result.questions[session.cursor];
  useEffect(() => { onStatusChange(subject, { pending: state.pending, error: storageStatus.error }); }, [subject, state.pending, storageStatus.error, onStatusChange]);

  useEffect(() => {
    const defaults: MockSettings = { counts: initialMockCounts(subject), selection: books[0] ? { [books[0].id]: [1] } : {} };
    let restored: ReturnType<typeof readMockPractice>;
    try { restored = readMockPractice(window.localStorage, subject, latestBooks.current); }
    catch { restored = { status: "error", message: "浏览器本地存储不可用；当前页面可继续使用，刷新后无法恢复。" }; }
    const settings = restored.status === "loaded" ? restored.record.settings : defaults;
    const restoredSession = restored.status === "loaded" ? restored.record.session : null;
    setCounts(settings.counts); setSelection(settings.selection); setSectionScope(settings.sectionScope); setTemplateId(settings.templateId);
    dispatch({ type: "restore", session: restoredSession });
    // Establish the loaded baseline before enabling autosave. Never overwrite a record on startup.
    storedFingerprint.current = JSON.stringify({ settings, session: restoredSession });
    setStorageStatus(restored.status === "error" ? { error: true, message: restored.message } : { error: false, message: restored.status === "loaded" ? "已恢复本地设置、模拟卷与作答。" : "设置、模拟卷与作答将自动保存到当前浏览器。" });
    setHydratedSubject(subject);
  }, [subject]);
  useEffect(() => {
    if (hydratedSubject !== subject) return;
    const settings: MockSettings = { counts, selection, ...(sectionScope ? { sectionScope } : {}), ...(templateId ? { templateId } : {}) };
    const fingerprint = JSON.stringify({ settings, session });
    if (storedFingerprint.current === fingerprint) return;
    let saved: ReturnType<typeof writeMockPractice>;
    try { saved = writeMockPractice(window.localStorage, { version: 1, subject, settings, session }, latestBooks.current); }
    catch { saved = { ok: false, message: "浏览器本地存储不可用；当前修改尚未保存，刷新后无法恢复。" }; }
    if (saved.ok) storedFingerprint.current = fingerprint;
    setStorageStatus(saved.ok ? { error: false, message: "当前设置、模拟卷与作答已保存到本地。" } : { error: true, message: saved.message });
  }, [hydratedSubject, subject, counts, selection, sectionScope, templateId, session]);

  function cancel(message = "已取消生成；已完成的模拟卷和作答仍保留。") {
    request.current.id++;
    request.current.controller?.abort(); request.current.controller = undefined;
    dispatch({ type: "stop", error: message });
  }
  useEffect(() => {
    if (!active && request.current.controller) {
      request.current.id++; request.current.controller.abort(); request.current.controller = undefined;
      dispatch({ type: "stop", error: "离开模拟卷页面，生成已取消；原模拟卷和作答仍保留。" });
    }
  }, [active]);
  useEffect(() => () => { request.current.id++; request.current.controller?.abort(); }, []);

  function changeScope(next: Record<string, number[]>, section?: typeof sectionScope) {
    setReplacement(undefined); dispatch({ type: "stop", error: "" });
    setSelection(next); setSectionScope(section);
    const selectedBooks = books.filter((book) => next[book.id]?.length).map((book) => book.id);
    if (templateId && selectedBooks.length) setCounts(countsToStrings(getApplicableMockPaperTemplate(templateId, subject, selectedBooks).config));
  }
  function useTemplate(next?: MockPaperTemplateId) {
    setReplacement(undefined); dispatch({ type: "stop", error: "" });
    setTemplateId(next);
    if (next) {
      // Preserve explicit book choices; an empty scope starts with all books.
      const nextSelection = ranges.length ? selection : Object.fromEntries(books.map((book) => [book.id, book.chapters.map((_, index) => index + 1)]));
      changeScope(nextSelection, sectionScope);
      setCounts(countsToStrings(getApplicableMockPaperTemplate(next, subject, books.filter((book) => nextSelection[book.id]?.length).map((book) => book.id)).config));
    }
  }
  async function generate() {
    if (!active || state.pending || request.current.controller) return;
    let snapshot;
    try { snapshot = snapshotMockSettings(subject, counts, ranges, scopeLabel, templateId); }
    catch (error) { dispatch({ type: "stop", error: error instanceof Error ? error.message : "请检查模拟卷设置。" }); return; }
    if (!apiKey.trim()) { onNeedKey(); return; }
    if (session && Object.values(session.responses).some((response) => response.choice !== undefined || response.text?.trim())) { setReplacement(snapshot); return; }
    await generateSnapshot(snapshot);
  }
  async function generateSnapshot(snapshot: MockSnapshot) {
    if (!active || state.pending || request.current.controller) return;
    if (!apiKey.trim()) { onNeedKey(); return; }
    setReplacement(undefined); setConfirmClear(false);
    const controller = new AbortController(), id = ++request.current.id;
    request.current.controller = controller;
    dispatch({ type: "start", total: Object.values(snapshot.config).reduce((sum, count) => sum + count, 0) });
    try {
      const result = await generateMockQuiz(apiKey, snapshot.config, { subject: snapshot.subject, ranges: snapshot.ranges }, {
        signal: controller.signal, templateId: snapshot.templateId,
        onProgress: (done, total) => { if (id === request.current.id && visible.current) dispatch({ type: "progress", done, total }); },
      });
      if (id === request.current.id && visible.current && !controller.signal.aborted) dispatch({ type: "success", result, snapshot });
    } catch (error) {
      if (id === request.current.id && visible.current) dispatch({ type: "stop", error: error instanceof Error ? error.message : "模拟卷生成失败，请重试。" });
    } finally { if (id === request.current.id) request.current.controller = undefined; }
  }

  return <div className="mock-practice" hidden={!active}>
    <div className="page-head"><span className="eyebrow">AI MOCK PAPER · {subject}</span><h1>{subject} · AI 模拟卷</h1><p>选择书目、章节与题型数量，生成独立模拟卷。AI 模拟卷非历年真题，参考答案非官方答案。</p></div>
    <section className="panel mock-form">
      <p className={storageStatus.error ? "error" : "mock-help"} role={storageStatus.error ? "alert" : "status"}>{storageStatus.message}</p>
      <fieldset disabled={state.pending || hydratedSubject !== subject}>
        <legend>命题范围与试卷构成</legend>
        <div className="mock-quick"><button className="secondary" onClick={() => changeScope({ [current.bookId]: [current.chapter] })}>使用当前章</button><button className="secondary" disabled={!current.section} onClick={() => changeScope({ [current.bookId]: [current.chapter] }, { bookId: current.bookId, chapter: current.chapter, name: current.section })}>使用当前小节</button><button className="secondary" onClick={() => changeScope(Object.fromEntries(books.map((book) => [book.id, book.chapters.map((_, index) => index + 1)])))}>全部书目 · 综合范围</button><button className="text-button" onClick={() => changeScope({})}>清空范围</button></div>
        <p className="mock-help">可勾选第 1、2 章，整本书或多个书目。范围只影响本模拟卷。</p>
        <div className="mock-books">{books.map((book) => {
          const chosen = selection[book.id] || [], all = chosen.length === book.chapters.length;
          return <details key={book.id} open={chosen.length > 0}><summary>{book.name}<small>{chosen.length} / {book.chapters.length} 章</small></summary><label className="mock-check mock-whole"><input type="checkbox" checked={all} onChange={(event) => changeScope({ ...selection, [book.id]: event.target.checked ? book.chapters.map((_, index) => index + 1) : [] })}/>整本书 / 全选章节</label><div className="mock-chapters">{book.chapters.map((chapter, index) => <label className="mock-check" key={index}><input type="checkbox" checked={chosen.includes(index + 1)} onChange={(event) => changeScope({ ...selection, [book.id]: event.target.checked ? [...chosen, index + 1] : chosen.filter((number) => number !== index + 1) })}/><span>第 {index + 1} 章 · {chapter.title}</span></label>)}</div></details>;
        })}</div>
        <p className="mock-selection"><b>已选范围：</b>{scopeLabel || "尚未选择"}</p>
        <label className="mock-template">试卷构成<select value={templateId || "custom"} onChange={(event) => useTemplate(event.target.value === "custom" ? undefined : templateOption)}><option value="custom">自定义题型数量</option><option value={templateOption}>{subject === "333" ? "按 2026 333 真题构成" : "按 2026 825 回忆版构成"}</option></select></label>
        {template && <TemplateSource template={template}/>}<div className="mock-counts">{MOCK_QUIZ_TYPES.map((type) => <label key={type}>{MOCK_QUIZ_TYPE_LABELS[type]}<input type="number" min="0" max="60" step="1" inputMode="numeric" value={counts[type]} onChange={(event) => { setCounts((previous) => ({ ...previous, [type]: event.target.value })); setTemplateId(undefined); setReplacement(undefined); dispatch({ type: "stop", error: "" }); }}/></label>)}</div>
        <p className="mock-help">共 {total} 题 · 每种题型 0–60 道，总数 1–60 道。{template ? `构成参考共 ${template.totalPoints} 分；开放题不自动判分。` : "自定义卷未设考试分值。"}</p>
        <button className="primary" onClick={generate}>{session ? "按以上设置生成新卷" : "生成 AI 模拟卷"}</button>
        {replacement && <div className="mock-source" role="alert"><b>生成成功后将替换本卷并清除本卷作答。</b><p>新卷范围：{replacement.scopeLabel}。取消或生成失败会保留当前卷与作答。</p><button className="primary" onClick={() => generateSnapshot(replacement)}>确认生成并在成功后替换</button><button className="secondary" onClick={() => setReplacement(undefined)}>保留本卷</button></div>}
      </fieldset>
      {state.pending && <div className="mock-progress" role="status"><progress value={state.progress.done} max={state.progress.total}/><span>生成中 · {state.progress.done} / {state.progress.total} 题 · 全部完成后显示</span><button className="secondary" onClick={() => cancel()}>取消生成</button></div>}
      {state.error && <p className="error" role="alert">{state.error}</p>}
    </section>
    {session && <section className="panel mock-session"><fieldset className="mock-session-controls" disabled={state.pending}>
      <div className="mock-session-head"><div><span className="eyebrow">已生成 · {subject} AI 模拟卷</span><h2>{session.result.questions.length} 题{snapshotTemplate ? ` · 构成参考 ${snapshotTemplate.totalPoints} 分` : " · 自定义构成"}</h2></div><button className="secondary" disabled={state.pending || storageStatus.error} onClick={onOpenBackup}>备份与导出</button><button className="text-button" disabled={state.pending} onClick={() => setConfirmClear(true)}>清除本卷与作答</button></div>
      {confirmClear && <div className="mock-source" role="alert"><b>确认清除这套 {session.result.questions.length} 题模拟卷与全部作答？</b><p>清除后无法恢复。本科目的命题设置会保留。</p><button className="secondary" onClick={() => { dispatch({ type: "clear" }); setConfirmClear(false); setReplacement(undefined); }}>确认清除本卷与作答</button><button className="secondary" onClick={() => setConfirmClear(false)}>保留本卷</button></div>}
      <p className="mock-help">生成时间：{session.snapshot.createdAt}</p><p className="mock-selection"><b>本卷范围：</b>{session.snapshot.scopeLabel}</p><p className="mock-help">本卷题型：{MOCK_QUIZ_TYPES.filter((type) => session.snapshot.config[type]).map((type) => `${MOCK_QUIZ_TYPE_LABELS[type]} ${session.snapshot.config[type]} 题`).join(" · ")}</p>
      {snapshotTemplate && <TemplateSource template={snapshotTemplate}/>}
      <div className="mock-coverage"><b>范围覆盖说明</b><p>{session.result.coverage.note}</p>{session.result.coverage.uncoveredUnits.length > 0 && <details open><summary>未抽到题的章节 / 小节（{session.result.coverage.uncoveredUnits.length}）</summary><ul>{session.result.coverage.uncoveredUnits.map((unit) => <li key={`${unit.bookId}-${unit.chapterNo}-${unit.section || ""}`}>{unit.bookName} · 第 {unit.chapterNo} 章 · {unit.chapterName}{unit.section ? " · " + unit.section : ""}</li>)}</ul></details>}</div>
      <div className="mock-score"><span>选择题：{score!.right} / {score!.answered} 题符合 AI 参考答案（已答 {score!.answered} / {score!.choiceTotal}）</span><span>开放题：已文字作答 {score!.written} / {score!.openTotal} · 不自动判分</span></div>
      <div className="study-mode-tabs"><button className={session.mode === "practice" ? "active" : ""} onClick={() => dispatch({ type: "mode", mode: "practice" })}>逐题练习</button><button className={session.mode === "paper" ? "active" : ""} onClick={() => dispatch({ type: "mode", mode: "paper" })}>整卷预览</button></div>
      {session.mode === "practice" && question ? <><div className="mock-number-nav" aria-label="模拟卷题号">{session.result.questions.map((row, index) => <button key={row.id} aria-label={`第 ${index + 1} 题`} aria-current={session.cursor === index ? "step" : undefined} className={(session.cursor === index ? "active " : "") + (session.responses[row.id]?.choice !== undefined || session.responses[row.id]?.text?.trim() ? "answered" : "")} onClick={() => dispatch({ type: "cursor", cursor: index })}>{index + 1}</button>)}</div><MockQuestion subject={subject} question={question} number={session.cursor + 1} response={session.responses[question.id] || {}} onResponse={(response) => dispatch({ type: "response", id: question.id, response })}/><div className="mock-page-nav"><button className="secondary" disabled={session.cursor === 0} onClick={() => dispatch({ type: "cursor", cursor: session.cursor - 1 })}>上一题</button><span>第 {session.cursor + 1} / {session.result.questions.length} 题</span><button className="primary" disabled={session.cursor === session.result.questions.length - 1} onClick={() => dispatch({ type: "cursor", cursor: session.cursor + 1 })}>下一题</button></div></> : <div className="mock-paper"><p className="ai-caveat">AI 模拟卷 · 非历年真题。题目按构成分组，分值仅沿用所选构成参考，答案为 AI 练习参考。</p>{session.result.questions.map((row, index, all) => <div key={row.id}>{index === 0 || row.groupLabel !== all[index - 1].groupLabel ? <h3 className="mock-group">{row.groupLabel || MOCK_QUIZ_TYPE_LABELS[row.type]}{snapshotTemplate ? `（${all.filter((item) => item.groupLabel === row.groupLabel).reduce((sum, item) => sum + (item.points || 0), 0)} 分）` : ""}</h3> : null}<MockQuestion subject={subject} question={row} number={index + 1} response={session.responses[row.id] || {}} onResponse={(response) => dispatch({ type: "response", id: row.id, response })} preview/></div>)}</div>}
    </fieldset></section>}
  </div>;
}

function TemplateSource({ template }: { template: ReturnType<typeof getApplicableMockPaperTemplate> }) {
  return <div className="mock-source"><b>{template.template.title}</b><p>构成来源：{template.template.sourceFile} · 第 {template.template.sourcePages.join("、")} 页</p><p>{template.template.recall ? "回忆版资料，非官方发布；仅参考题型、题数与分值。" : "本地资料整理，非官方发布；仅参考题型、题数与分值。"}所选书目适用 {template.totalQuestions} 题 / {template.totalPoints} 分，生成题目均为 AI 模拟题。</p></div>;
}
function MockQuestion({ subject, question, number, response, onResponse, preview = false }: { subject: string; question: MockQuizQuestion; number: number; response: MockResponse; onResponse: (response: MockResponse) => void; preview?: boolean }) {
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const ownAnswer = question.type === "single-choice" ? selectedAnswer(question.options, response.choice) : response.text || "";
  return <article className="mock-question"><div className="question-meta"><span>{question.groupLabel || MOCK_QUIZ_TYPE_LABELS[question.type]}</span>{question.points !== undefined && <span>本题 {question.points} 分</span>}<span>{question.bookName} · 第 {question.chapterNo} 章{question.section ? " · " + question.section : ""}</span></div><h2>{number}. {question.stem}</h2>
    {question.type === "single-choice" ? <>
      <div className="options">{question.options.map((option, index) => preview ? <p className="mock-preview-option" key={index}>{"ABCD"[index]}. {option}</p> : <button key={index} disabled={response.choice !== undefined} className={response.choice === undefined ? "" : index === question.answer ? "correct" : response.choice === index ? "wrong" : ""} onClick={() => onResponse({ choice: index })}><span>{"ABCD"[index]}</span>{option}</button>)}</div>
      <div className="mock-own-answer"><b>我的选择</b><p>{ownAnswer || "尚未选择"}</p><CopyAnswerButton text={ownAnswer}/></div>
      {preview ? <button className="secondary reveal-button" onClick={() => onResponse({ revealed: !response.revealed })}>{response.revealed ? "收起 AI 参考答案" : "显示 AI 参考答案"}</button> : null}
      {(preview ? response.revealed : response.choice !== undefined) && <div className="explanation"><b>AI 参考答案：{"ABCD"[question.answer]}{!preview ? response.choice === question.answer ? " · 与你的选择一致" : " · 与你的选择不同" : ""}</b><p>{question.explanation}</p></div>}
    </> : <>
      {preview ? <div className="mock-own-answer"><b>我的作答</b><p>{ownAnswer || "尚未作答"}</p></div> : <><label className="answer-label" htmlFor={`mock-answer-${subject}-${question.id}`}>我的作答（最多 20,000 字符）</label><textarea ref={answerRef} className="past-answer" id={`mock-answer-${subject}-${question.id}`} maxLength={20000} value={response.text || ""} onChange={(event) => onResponse({ text: event.target.value })} placeholder="写下答案；开放题不自动判分。"/></>}
      <CopyAnswerButton text={ownAnswer} answerRef={preview ? undefined : answerRef}/>
      <button className="secondary reveal-button" onClick={() => onResponse({ revealed: !response.revealed })}>{response.revealed ? "收起 AI 参考答案" : "查看 AI 参考答案"}</button>{response.revealed && <div className="explanation"><b>AI 参考答案 · 非官方标准答案</b><p>{question.referenceAnswer}</p><small>{question.rationale}</small></div>}
    </>}
    <p className="mock-help">{question.source}</p>
  </article>;
}
