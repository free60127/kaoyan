import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Brain, CalendarDays, Check, ChevronRight, CircleHelp, KeyRound, Layers3, Menu, Mic, Send, Settings2, Sparkles, Target, X } from "lucide-react";
import { books as books333, cards as cards333, questions } from "@/lib/study-data";
import { outlines } from "@/lib/outlines";
import { askDeepSeek, cleanApiKey } from "@/lib/deepseek-browser";
import { load825StudyData, type Question825, type StudyData825 } from "@/lib/825/study-data";
import { loadPoliticsStudyData, type StudyDataPolitics } from "@/lib/politics/study-data";
import { useStudyReview } from "@/lib/use-study-review";
import { StudyReviewCards } from "./components/StudyReview";
import { MockPractice } from "./components/MockPractice";
import { SpeechInputControls } from "./components/SpeechInputControls";

type View = "overview" | "chapters" | "cards" | "quiz" | "mock" | "feynman" | "planner";
type Progress<T> = { "333": T; "825": T; politics: T };
type Chapter = { title: string; sections: string[] };
type Book = { id: string; name: string; short: string; tone: string; chapters: Chapter[] };
type Card = { id: string; book: string; chapter: number; section?: string; front: string; back: string; source: string; sourceFile?: string; sourcePage?: number; sourcePages?: number[] };
const subjects = [{ id: "english", name: "英语二", mark: "EN" }, { id: "politics", name: "政治", mark: "PO" }, { id: "333", name: "333 教育综合", mark: "33" }, { id: "825", name: "825 英语专业基础", mark: "82" }];
// 刷新后回到上次学习的科目与位置；book 先按静态表校验，避免数据未载入时落到无效值。
const subjectBookIds: Record<string, string[]> = { "333": books333.map((book) => book.id), "825": ["linguistics", "literature"], politics: ["mayuan", "maozhongte", "xinsixiang", "shigang", "sixiu"] };
const nav: { id: View; label: string; Icon: typeof BookOpen }[] = [{ id: "overview", label: "今日概览", Icon: Target }, { id: "chapters", label: "章节学习", Icon: BookOpen }, { id: "cards", label: "Anki 闪卡", Icon: Layers3 }, { id: "quiz", label: "真题练习", Icon: CircleHelp }, { id: "mock", label: "AI 模拟卷", Icon: Sparkles }, { id: "feynman", label: "费曼复述", Icon: Mic }, { id: "planner", label: "AI 学习计划", Icon: Sparkles }];
const books333Model: Book[] = books333.map((book) => ({ id: book.id, name: book.name, short: book.short, tone: book.tone, chapters: book.chapters.map((title, index) => ({ title, sections: outlines[book.id]?.[index] || [] })) }));
const sectionLabel = (front: string) => { const match = /^〔(.+?)〕/.exec(front); return match ? match[1] : ""; };
const plainFront = (front: string) => front.replace(/^〔.+?〕\s*/, "");
// 333 的小节目录取自知识点卡的〔节/考点〕标签：粒度更细，也覆盖目录未列节的章节。
const cards333Model: Card[] = (cards333 as unknown as Card[]).map((card) => ({ ...card, section: sectionLabel(card.front) || undefined }));
for (const modelBook of books333Model) {
  modelBook.chapters.forEach((chapterItem, index) => {
    const labels = [...new Set(cards333Model.filter((item) => item.book === modelBook.id && item.chapter === index + 1 && item.section).map((item) => item.section as string))];
    if (labels.length) chapterItem.sections = labels;
  });
}
const emptyCards: Card[] = [];
const total333 = books333.reduce((sum, book) => sum + book.chapters.length, 0);
// 政治五本书的小节目录同样取自卡的〔考点/要点〕标签（section 字段即标签）。
function buildPoliticsModels(data: StudyDataPolitics | null) {
  const cardsP: Card[] = (data?.cards || []).map((card) => ({ ...card }));
  const booksP: Book[] = (data?.books || []).map((item) => ({ id: item.id, name: item.name, short: item.short, tone: item.tone, chapters: item.chapters.map((title) => ({ title, sections: [] })) }));
  for (const modelBook of booksP) {
    modelBook.chapters.forEach((chapterItem, index) => {
      const labels = [...new Set(cardsP.filter((item) => item.book === modelBook.id && item.chapter === index + 1 && item.section).map((item) => item.section as string))];
      if (labels.length) chapterItem.sections = labels;
    });
  }
  return { books: booksP, cards: cardsP };
}
const statusLabel: Record<Question825["status"], string> = { verified: "verified · 已核对（数据标注）", recalled: "recalled · 回忆版", "question-only": "question-only · 仅有题目记录" };
const questionType: Record<string, string> = { "short-answer": "简答题", definition: "名词解释", essay: "论述题", other: "其他题型" };
const localDate = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const today = () => localDate(new Date());
function readStorage<T>(key: string): T {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : {} as T; } catch { return {} as T; }
}

export default function Home() {
  const [subject, setSubject] = useState("333"), [view, setView] = useState<View>("overview");
  const [book, setBook] = useState("principles"), [chapter, setChapter] = useState(1), [section, setSection] = useState("");
  const [data825, setData825] = useState<StudyData825 | null>(null), [dataError, setDataError] = useState(""), [loadAttempt, setLoadAttempt] = useState(0);
  const [dataPolitics, setDataPolitics] = useState<StudyDataPolitics | null>(null);
  const politicsModels = useMemo(() => buildPoliticsModels(dataPolitics), [dataPolitics]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [choice, setChoice] = useState<number | null>(null), [score, setScore] = useState({ right: 0, total: 0 });
  const [doneStorageError, setDoneStorageError] = useState("");
  const [doneBySubject, setDoneBySubject] = useState<Progress<Record<string, boolean>>>({ "333": {}, "825": {}, politics: {} }), [progressReady, setProgressReady] = useState(false);
  const [answer, setAnswer] = useState(""), [feedback, setFeedback] = useState(""), [prompt, setPrompt] = useState("请结合当前科目的书目和进度，为我安排今天可执行的学习计划，包含主动回忆、练习和复盘。"), [reply, setReply] = useState("");
  const [key, setKey] = useState(""), [keyOpen, setKeyOpen] = useState(false), [loading, setLoading] = useState(false), [speechLanguage, setSpeechLanguage] = useState("zh-CN"), [menuOpen, setMenuOpen] = useState(false);
  const [pastMode, setPastMode] = useState<"practice" | "index">("practice"), [pastYear, setPastYear] = useState(2026), [pastIndex, setPastIndex] = useState(0), [pastAnswer, setPastAnswer] = useState(""), [pastRevealed, setPastRevealed] = useState(false);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const requestId = useRef(0);
  // React 批处理下连续快速切换科目时，闭包里的 subject 是旧值；用 ref 保证“最后一次点击生效”。
  const subjectRef = useRef(subject);
  const locations = useRef<Record<string, { book: string; chapter: number; section: string; quizIndex: number; choice: number | null; score: { right: number; total: number }; pastIndex: number; pastAnswer: string; pastRevealed: boolean; pastMode: "practice" | "index"; pastYear: number }>>({});

  useEffect(() => {
    setDoneBySubject({ "333": readStorage("yantu-done"), "825": readStorage("yantu-done-825"), politics: readStorage("yantu-done-politics") });
    try {
      const saved = readStorage<{ subject?: string; book?: string; chapter?: number }>("yantu-last-place");
      if (saved && subjects.some((item) => item.id === saved.subject)) {
        setSubject(saved.subject as string);
        if (saved.book && subjectBookIds[saved.subject as string]?.includes(saved.book)) setBook(saved.book);
        if (Number.isInteger(saved.chapter) && (saved.chapter as number) >= 1) setChapter(Math.min(saved.chapter as number, 60));
      }
    } catch { /* 损坏的记录直接忽略，回到默认科目 */ }
    try { setKey(sessionStorage.getItem("yantu-key") || ""); } catch { setKey(""); }
    setProgressReady(true);
  }, []);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-last-place", JSON.stringify({ subject, book, chapter })); } catch { /* 无法写入时静默，不影响学习 */ } } }, [subject, book, chapter, progressReady]);
  useEffect(() => {
    if (!keyOpen && !menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setKeyOpen(false); setMenuOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyOpen, menuOpen]);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-done", JSON.stringify(doneBySubject["333"])); } catch { setDoneStorageError("浏览器未能保存章节标记，请允许本地存储。"); } } }, [doneBySubject["333"], progressReady]);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-done-825", JSON.stringify(doneBySubject["825"])); } catch { setDoneStorageError("浏览器未能保存章节标记，请允许本地存储。"); } } }, [doneBySubject["825"], progressReady]);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-done-politics", JSON.stringify(doneBySubject.politics)); } catch { setDoneStorageError("浏览器未能保存章节标记，请允许本地存储。"); } } }, [doneBySubject.politics, progressReady]);
  useEffect(() => {
    if (subject !== "825" || data825) return;
    let cancelled = false; setDataError("");
    load825StudyData().then((data) => { if (!cancelled) setData825(data); }).catch(() => { if (!cancelled) setDataError("825 资料加载失败，请刷新页面后重试。"); });
    return () => { cancelled = true; };
  }, [subject, data825, loadAttempt]);
  useEffect(() => {
    if (subject !== "politics" || dataPolitics) return;
    let cancelled = false; setDataError("");
    loadPoliticsStudyData().then((data) => { if (!cancelled) setDataPolitics(data); }).catch(() => { if (!cancelled) setDataError("政治资料加载失败，请刷新页面后重试。"); });
    return () => { cancelled = true; };
  }, [subject, dataPolitics, loadAttempt]);

  const dateLabel = useMemo(() => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()), []);
  const books: Book[] = subject === "825"
    ? (data825?.books || []).map((item) => ({ id: item.id, name: item.name, short: item.id === "linguistics" ? "语言" : "文学", tone: item.id === "linguistics" ? "#4976b6" : "#9478ad", chapters: item.chapters.map((part) => ({ title: part.title, sections: part.sections })) }))
    : subject === "politics" ? politicsModels.books
    : subject === "333" ? books333Model : [];
  const activeBook = books.find((item) => item.id === book) || books[0], chapterInfo = activeBook?.chapters[chapter - 1], chapterName = chapterInfo?.title || "";
  // 过期记录（如数据更新后书变薄）会让章号超出书目实际章数；回到第 1 章避免空白章节。
  useEffect(() => { if (activeBook && chapter > activeBook.chapters.length) setChapter(1); }, [activeBook, chapter]);
  const allCards: Card[] = subject === "825" ? (data825?.cards || []) : subject === "politics" ? politicsModels.cards : subject === "333" ? cards333Model : [];
  const chapterCards = allCards.filter((item) => item.book === book && item.chapter === chapter);
  const cardsInScope = section ? chapterCards.filter((item) => item.section === section) : chapterCards;
  const review333 = useStudyReview("333", cards333Model, true);
  const review825 = useStudyReview("825", data825?.cards || emptyCards, data825 !== null);
  const reviewPolitics = useStudyReview("politics", politicsModels.cards, dataPolitics !== null);
  const review = subject === "825" ? review825 : subject === "politics" ? reviewPolitics : review333;
  const chapterQuestions = questions.filter((item) => item.book === book && item.chapter === chapter), bookQuestions = questions.filter((item) => item.book === book);
  const pool = chapterQuestions.length ? chapterQuestions : bookQuestions, quiz = pool.length ? pool[quizIndex % pool.length] : null;
  const progressSubject: "333" | "825" | "politics" = subject === "825" ? "825" : subject === "politics" ? "politics" : "333";
  const done = doneBySubject[progressSubject];
  const due = review.queue.counts.reviewDue, newToday = review.queue.counts.newToday;
  const completed = books.reduce((sum, item) => sum + item.chapters.filter((_, index) => done[item.id + "-" + (index + 1)]).length, 0);
  const totalChapters = subject === "333" ? total333 : books.reduce((sum, item) => sum + item.chapters.length, 0);
  const pastQuestions = data825?.questions || [];
  const years = [...new Set(pastQuestions.filter((item) => item.book === book).map((item) => item.year))].sort((a, b) => b - a);
  const activeYear = years.includes(pastYear) ? pastYear : years[0];
  const yearQuestions = pastQuestions.filter((item) => item.book === book && item.year === activeYear);
  const pastPool = yearQuestions.filter((item) => pastMode === "practice" ? item.practiceReady : !item.practiceReady);
  const pastQuestion = pastPool.length ? pastPool[pastIndex % pastPool.length] : undefined;
  const sectionHints = (section ? cardsInScope : chapterCards).slice(0, 8).map((item) => plainFront(item.front));

  function chooseChapter(nextBook: string, nextChapter: number, nextView: View = "chapters") {
    requestId.current += 1; setLoading(false);
    setBook(nextBook); setChapter(nextChapter); setSection(""); setView(nextView); setQuizIndex(0); setChoice(null); setPastIndex(0); setPastAnswer(""); setPastRevealed(false); setAnswer(""); setFeedback(""); setReply("");
  }
  function switchSubject(next: string) {
    if (next === subjectRef.current) { setMenuOpen(false); return; }
    locations.current[subject] = { book, chapter, section, quizIndex, choice, score, pastIndex, pastAnswer, pastRevealed, pastMode, pastYear };
    const saved = locations.current[next];
    requestId.current += 1; setLoading(false);
    subjectRef.current = next;
    setSubject(next); setBook(saved?.book || (next === "825" ? "linguistics" : next === "politics" ? "mayuan" : "principles")); setChapter(saved?.chapter || 1); setSection(saved?.section || ""); setView("overview"); setMenuOpen(false); setQuizIndex(saved?.quizIndex || 0); setChoice(saved?.choice ?? null); setPastIndex(saved?.pastIndex || 0); setPastAnswer(saved?.pastAnswer || ""); setPastRevealed(saved?.pastRevealed || false); setPastMode(saved?.pastMode || "practice"); setPastYear(saved?.pastYear || 2026); setScore(saved?.score || { right: 0, total: 0 }); setAnswer(""); setFeedback(""); setReply("");
  }
  function chooseSection(nextSection: string) { requestId.current += 1; setLoading(false); setSection(nextSection); setAnswer(""); setFeedback(""); setReply(""); }
  async function ask(mode: "plan" | "feedback") {
    if (!key.trim()) { setKeyOpen(true); return; }
    const input = mode === "plan" ? prompt : answer; if (!input.trim()) return;
    const currentRequest = ++requestId.current;
    setLoading(true); mode === "plan" ? setReply("") : setFeedback("");
    try {
      const data = await askDeepSeek(key, mode, `${input}\n\n今日学习状态：已学到期 ${due} 张（含短间隔回顾 ${review.queue.counts.learningDue} 张）；今日新学 ${newToday} 张；每日新卡上限 ${review.progress.dailyNewLimit} 张。复习覆盖持续学习范围，新卡仅来自今天所选范围。`, { subject, bookId: book, chapterNo: chapter, book: activeBook?.name || "", chapter: chapterName, section, done: completed, due, date: today(), exam: "2027年12月初试" });
      if (currentRequest !== requestId.current) return;
      mode === "plan" ? setReply(data.text || "") : setFeedback(data.text || "");
    } catch (error) { if (currentRequest === requestId.current) { const message = error instanceof Error ? error.message : "连接失败"; mode === "plan" ? setReply(message) : setFeedback(message); } }
    finally { if (currentRequest === requestId.current) setLoading(false); }
  }

  const picker = activeBook ? <div className="pickers"><label>书目<select value={book} onChange={(event) => chooseChapter(event.target.value, 1, view)}>{books.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>章节<select value={chapter} onChange={(event) => chooseChapter(book, Number(event.target.value), view)}>{activeBook.chapters.map((item, index) => <option key={item.title} value={index + 1}>第 {index + 1} 章 · {item.title}</option>)}</select></label>{(chapterInfo?.sections || []).length > 0 && <label>小节<select value={section} onChange={(event) => chooseSection(event.target.value)}><option value="">本章全部小节</option>{(chapterInfo?.sections || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}</div> : null;
  const heading = (label: string, title: string, description: string) => <div className="page-head"><span className="eyebrow">{label}</span><h1>{title}</h1><p>{description}</p></div>;

  return <div className="shell">
    <aside className={"sidebar " + (menuOpen ? "open" : "")}>
      <div className="brand"><span className="brand-logo"><Layers3 size={21}/></span><div><b>研途</b><small>考研全科备考台</small></div><button className="mobile-close" onClick={() => setMenuOpen(false)}><X size={20}/></button></div>
      <div className="side-caption">考试科目</div><nav className="side-nav">{subjects.map((item) => <button key={item.id} className={subject === item.id ? "selected" : ""} onClick={() => switchSubject(item.id)}><span className="subject-mark">{item.mark}</span>{item.name}{(item.id === "333" || item.id === "825" || item.id === "politics") && <small>已接入</small>}</button>)}</nav>
      <div className="side-line"/><div className="side-caption">学习工具</div><nav className="side-nav tools">{nav.filter(({ id }) => subject !== "politics" || (id !== "quiz" && id !== "mock")).map(({ id, label, Icon }) => <button key={id} className={view === id ? "selected" : ""} onClick={() => { setView(id); setMenuOpen(false); }}><Icon size={18}/>{label}</button>)}</nav>
      <div className="side-bottom"><div className="target-date"><CalendarDays size={18}/><span><b>2027 年 12 月</b><small>目标初试</small></span></div><button className="key-link" onClick={() => setKeyOpen(true)}><KeyRound size={17}/> DeepSeek 密钥 <small>{key ? "已配置" : "未配置"}</small></button></div>
    </aside>
    {menuOpen && <div className="menu-shade" onClick={() => setMenuOpen(false)}/>}
    <main className="main">
      <header className="topbar"><button className="mobile-menu" onClick={() => setMenuOpen(true)}><Menu size={22}/></button><span>研途 <ChevronRight size={15}/> {subjects.find((item) => item.id === subject)?.name} <ChevronRight size={15}/> <b>{nav.find((item) => item.id === view)?.label}</b></span><div><span className="date-chip"><CalendarDays size={15}/>{dateLabel}</span><button className="icon-button" onClick={() => setKeyOpen(true)} aria-label="设置密钥"><Settings2 size={18}/></button></div></header>
      <div className="content">
        {doneStorageError && <p className="error" role="alert">{doneStorageError}</p>}
        <MockPractice subject="333" books={books333Model} active={subject === "333" && view === "mock"} apiKey={key} onNeedKey={() => setKeyOpen(true)} current={{ bookId: book, chapter, section }}/>
        {data825 && <MockPractice subject="825" books={data825.books.map((item) => ({ id: item.id, name: item.name, chapters: item.chapters.map((part) => ({ title: part.title, sections: part.sections })) }))} active={subject === "825" && view === "mock"} apiKey={key} onNeedKey={() => setKeyOpen(true)} current={{ bookId: book, chapter, section }}/>}
        {(subject === "333" || subject === "825" || subject === "politics") && view !== "cards" && review.storageError && <p className="error" role="alert">{review.storageError}</p>}
        {subject === "english" ? <div className="subject-empty"><BookOpen size={34}/><span className="eyebrow">英语二</span><h1>这一科的资料区已预留</h1><p>当前可使用政治、333 教育综合与 825 英语专业基础的资料、闪卡和真题流程。</p><button className="primary" onClick={() => switchSubject("333")}>先学习 333</button></div>
        : (subject === "825" && !data825) ? <div className="subject-empty"><BookOpen size={34}/><span className="eyebrow">825 英语专业基础</span><h1>{dataError ? "资料加载遇到问题" : "正在载入 825 资料"}</h1><p>{dataError || "语言学、英美文学笔记和真题索引正从资料包载入。"}</p><button className="secondary" onClick={() => { setDataError(""); setLoadAttempt((attempt) => attempt + 1); }}>重新加载</button></div>
        : (subject === "politics" && !dataPolitics) ? <div className="subject-empty"><BookOpen size={34}/><span className="eyebrow">政治</span><h1>{dataError ? "资料加载遇到问题" : "正在载入政治资料"}</h1><p>{dataError || "五科考点闪卡正从资料包载入。"}</p><button className="secondary" onClick={() => { setDataError(""); setLoadAttempt((attempt) => attempt + 1); }}>重新加载</button></div>
        : <>
          {view === "overview" && subject === "333" && <>{heading("GOOD TO SEE YOU", "今天，继续向目标靠近。", "从一个章节开始，学一点、讲出来、再用真题检验。")}<div className="stats study-stats"><Stat Icon={BookOpen} label="333 已学章节" value={completed + " / " + total333} note="四本应试解析"/><Stat Icon={Layers3} label="已学到期" value={String(due)} note="持续复习范围内的已学卡"/><Stat Icon={Layers3} label="今日新学" value={String(newToday)} note={"每日上限 " + review.progress.dailyNewLimit + " 张 · 所选新学范围"}/><Stat Icon={Target} label="练习正确率" value={score.total ? Math.round(score.right / score.total * 100) + "%" : "—"} note={score.total ? "本次已答 " + score.total + " 题" : "开始真题练习"}/></div><div className="dashboard"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">FOUR BOOKS</span><h2>333 · 四本书</h2></div><button className="text-button" onClick={() => setView("chapters")}>查看全部 <ChevronRight size={16}/></button></div><div className="book-list">{books.map((item) => { const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length; return <button key={item.id} className="book-row" onClick={() => chooseChapter(item.id, 1)}><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{item.chapters.length} 章 · {count} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div><ChevronRight size={17}/></button>; })}</div></section><section className="panel next-panel"><span className="eyebrow">YOUR NEXT STEP</span><h2>继续上次的节奏</h2><div className="next-chapter"><span>{String(chapter).padStart(2, "0")}</span><div><small>{activeBook?.name} · 第 {chapter} 章</small><b>{chapterName}</b></div></div><div className="next-actions"><button className="primary" onClick={() => setView("cards")}>开始闪卡复习</button><button className="secondary" onClick={() => setView("quiz")}>做一道真题</button></div><small className="source-status"><Check size={15}/> 题目附有年份、题号与来源页码</small></section></div><section className="panel source-panel"><div><span className="eyebrow">SOURCE LIBRARY</span><h2>资料与真题</h2><p>四本《27KC 333 应试解析》建立章节目录；练习题来自 2024、2025、2026 年 333 真题。扫描页经 OCR 校对后使用。</p></div><div className="year-chips"><span>2024 真题</span><span>2025 真题</span><span>2026 真题</span></div></section></>}
          {view === "overview" && subject === "825" && <>{heading("TODAY'S STUDY", "825 · 英语专业基础", "按两本书的章节、小节和历年题索引推进；真题不绑定章节。")}<div className="stats study-stats"><Stat Icon={BookOpen} label="已学章节" value={completed + " / " + totalChapters} note="语言学与英美文学"/><Stat Icon={Layers3} label="已学到期" value={String(due)} note="持续复习范围内的已学卡"/><Stat Icon={Layers3} label="今日新学" value={String(newToday)} note={"每日上限 " + review.progress.dailyNewLimit + " 张 · 所选新学范围"}/><Stat Icon={CircleHelp} label="历年题" value={String(pastQuestions.length)} note="94 道可练习 · 74 条索引"/></div><div className="dashboard"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">TWO BOOKS</span><h2>825 · 两本书</h2></div><button className="text-button" onClick={() => setView("chapters")}>查看章节 <ChevronRight size={16}/></button></div><div className="book-list">{books.map((item) => { const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length; const cardCount = allCards.filter((entry) => entry.book === item.id).length; return <button key={item.id} className="book-row" onClick={() => chooseChapter(item.id, 1)}><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{item.chapters.length} 章 · {cardCount} 张卡 · {count} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div><ChevronRight size={17}/></button>; })}</div></section><section className="panel next-panel"><span className="eyebrow">NEXT STEP</span><h2>继续学习</h2><div className="next-chapter"><span>{String(chapter).padStart(2, "0")}</span><div><small>{activeBook?.name} · 第 {chapter} 章</small><b>{chapterName}</b></div></div><div className="next-actions"><button className="primary" onClick={() => setView("cards")}>打开今日复习队列</button><button className="secondary" onClick={() => setView("quiz")}>练习历年题</button></div><small className="source-status"><Check size={15}/> 按书目与年份筛选；原题未提供章节归属</small></section></div><section className="panel source-panel"><div><span className="eyebrow">SOURCE LIBRARY</span><h2>笔记和真题索引</h2><p>语言学与英美文学共 909 张闪卡；题目显示来源状态、PDF 文件和页码。</p></div><div className="year-chips"><span>94 道可练习</span><span>74 条索引</span><span>2010—2026</span></div></section></>}
          {view === "overview" && subject === "politics" && <>{heading("TODAY'S STUDY", "政治 · 五科考点", "按马原、毛中特、新思想、史纲、思修的教材章节推进，闪卡覆盖全部考点。")}<div className="stats study-stats"><Stat Icon={BookOpen} label="已学章节" value={completed + " / " + totalChapters} note="五科教材章节"/><Stat Icon={Layers3} label="已学到期" value={String(due)} note="持续复习范围内的已学卡"/><Stat Icon={Layers3} label="今日新学" value={String(newToday)} note={"每日上限 " + review.progress.dailyNewLimit + " 张 · 所选新学范围"}/><Stat Icon={Layers3} label="考点闪卡" value={String(allCards.length)} note="徐涛强化笔记 + 肖1000背诵要点"/></div><div className="dashboard"><section className="panel"><div className="panel-heading"><div><span className="eyebrow">FIVE BOOKS</span><h2>政治 · 五本书</h2></div><button className="text-button" onClick={() => setView("chapters")}>查看章节 <ChevronRight size={16}/></button></div><div className="book-list">{books.map((item) => { const count = Object.keys(done).filter((name) => name.startsWith(item.id + "-") && done[name]).length; const cardCount = allCards.filter((entry) => entry.book === item.id).length; return <button key={item.id} className="book-row" onClick={() => chooseChapter(item.id, 1)}><span className="book-cover" style={{ background: item.tone }}>{item.short}</span><span><b>{item.name}</b><small>{item.chapters.length} 章 · {cardCount} 张卡 · {count} 章已学</small></span><div className="mini-progress"><i style={{ width: 100 * count / item.chapters.length + "%", background: item.tone }}/></div><ChevronRight size={17}/></button>; })}</div></section><section className="panel next-panel"><span className="eyebrow">NEXT STEP</span><h2>继续学习</h2><div className="next-chapter"><span>{String(chapter).padStart(2, "0")}</span><div><small>{activeBook?.name} · 第 {chapter} 章</small><b>{chapterName}</b></div></div><div className="next-actions"><button className="primary" onClick={() => setView("cards")}>打开今日复习队列</button><button className="secondary" onClick={() => setView("feynman")}>口述本章考点</button></div><small className="source-status"><Check size={15}/> 每张卡附资料出处与 PDF 页码</small></section></div><section className="panel source-panel"><div><span className="eyebrow">SOURCE LIBRARY</span><h2>资料说明</h2><p>《27徐涛强化笔记（完整版）》提供考点体系（选择/分析题重点标注），《肖1000题背诵要点（汇总版）》补充易错辨析；章节按 2027 教材目录组织，共 {allCards.length} 张闪卡。</p></div><div className="year-chips"><span>马原</span><span>毛中特</span><span>新思想</span><span>史纲</span><span>思修</span></div></section></>}
          {view === "chapters" && <>{heading("BOOK BY BOOK", "从章节开始，形成自己的知识地图", subject === "825" ? "查看原书章节与小节；选择小节后，闪卡和 AI 反馈会尽量使用对应笔记。真题按书目和年份练习。" : subject === "politics" ? "查看五科教材章节与考点小节；选择考点后背诵对应闪卡，或用费曼复述讲出来。" : "选书、选章；完成学习后标记进度，并进入闪卡或真题。")}<div className="book-tabs">{books.map((item) => <button key={item.id} className={book === item.id ? "active" : ""} onClick={() => chooseChapter(item.id, 1)}><i style={{ background: item.tone }}/>{item.name}</button>)}</div><div className="chapter-layout"><section className="panel chapter-list"><span className="eyebrow">{activeBook?.chapters.length || 0} CHAPTERS</span><h2>{activeBook?.name}</h2>{activeBook?.chapters.map((item, index) => <button key={item.title} className={chapter === index + 1 ? "chapter-row active" : "chapter-row"} onClick={() => chooseChapter(book, index + 1)}><span>{String(index + 1).padStart(2, "0")}</span><b>{item.title}</b>{done[book + "-" + (index + 1)] ? <Check size={17}/> : <ChevronRight size={17}/>}</button>)}</section><section className="panel chapter-detail"><span className="eyebrow">{activeBook?.name} / 第 {chapter} 章</span><h2>{chapterName}</h2>{subject === "825" ? <p>选择小节查看笔记闪卡；历年题没有章节映射，会按书目与年份筛选。</p> : subject === "politics" ? <p>本章考点小节来自闪卡标签；先背考点，再用费曼复述串讲本章。</p> : <p>先浏览教材，再用闪卡主动回忆，最后用真题检验；复述反馈会结合当前章节。</p>}<div className="detail-count"><div><b>{chapterCards.length}</b><small>{subject === "333" ? "已校对闪卡" : "考点闪卡"}</small></div><div><b>{subject === "politics" ? (chapterInfo?.sections.length || 0) : subject === "825" ? "书目 / 年份" : chapterQuestions.length}</b><small>{subject === "politics" ? "考点小节" : subject === "825" ? "真题筛选" : "匹配真题"}</small></div></div>{(chapterInfo?.sections || []).length > 0 && <div className="section-outline"><strong>{subject === "825" ? "本章小节" : subject === "politics" ? "本章考点" : "本章目录"}</strong>{chapterInfo?.sections.map((item, index) => <button key={item} onClick={() => { chooseSection(item); setView("cards"); }}><span>{String(index + 1).padStart(2, "0")}</span>{item}<ChevronRight size={15}/></button>)}</div>}{subject === "333" && !chapterCards.length && <p className="notice">该章尚无人工核对闪卡。可先阅读原书，再进行费曼复述。</p>}<div className="detail-buttons"><button className="primary" onClick={() => setView("cards")}>背诵闪卡</button><button className="secondary" onClick={() => setView("feynman")}>口述本章</button></div><button className="mark-done" onClick={() => setDoneBySubject((previous) => ({ ...previous, [progressSubject]: { ...previous[progressSubject], [book + "-" + chapter]: !done[book + "-" + chapter] } }))}><Check size={16}/>{done[book + "-" + chapter] ? "已完成 · 点击撤销" : "标记本章已学习"}</button></section></div></>}
          {view === "cards" && <>{heading("ACTIVE RECALL", "闪卡学习与复习", "选择新学范围；先主动回忆，再按掌握程度安排下次复习。自由浏览可查看当前章内容。")}<StudyReviewCards key={subject} review={review} cards={allCards} books={books} bookId={book} chapter={chapter} section={section} picker={picker}/></>}
          {view === "quiz" && subject === "333" && <>{heading("PAST PAPERS", "333 真题练习", "答完立即查看正确答案、解析与出处。")}{picker}<div className="study-meta">{chapterQuestions.length ? "当前章节匹配题" : "当前章暂无已映射题 · 展示同书真题"}</div>{quiz && <section className="panel quiz-card"><div className="quiz-top"><span>{quiz.year + " 真题"}</span><small>{"第 " + (quizIndex % pool.length + 1) + " / " + pool.length + " 题"}</small></div><h2>{quiz.stem}</h2><div className="options">{quiz.options.map((item, index) => <button key={index} disabled={choice !== null} className={choice === null ? "" : index === quiz.answer ? "correct" : choice === index ? "wrong" : ""} onClick={() => { setChoice(index); setScore((previous) => ({ right: previous.right + Number(index === quiz.answer), total: previous.total + 1 })); }}><span>{"ABCD"[index]}</span>{item}</button>)}</div>{choice !== null && <div className="explanation"><b>{choice === quiz.answer ? "答对了" : "正确答案：" + "ABCD"[quiz.answer]}</b><p>{quiz.explanation}</p><small>来源：{quiz.source}</small></div>}<div className="quiz-footer"><span>{score.total ? "本次 " + score.right + " / " + score.total + " 题正确" : "先选一个答案"}</span><button className="primary" onClick={() => { setQuizIndex((index) => index + 1); setChoice(null); }}>下一题</button></div></section>}</>}
          {view === "quiz" && subject === "825" && <>{heading("PAST PAPERS", "825 真题 · 开放题练习与索引", "按书目和年份筛选。题目没有章节归属；可文字作答并查看可用参考答案，不自动判分。")}<div className="past-filters"><label>书目<select value={book} onChange={(event) => { chooseChapter(event.target.value, 1, "quiz"); setPastYear(2026); }}><option value="linguistics">语言学</option><option value="literature">英美文学</option></select></label><label>年份<select value={activeYear || ""} onChange={(event) => { setPastYear(Number(event.target.value)); setPastIndex(0); setPastAnswer(""); setPastRevealed(false); }} disabled={!years.length}>{years.map((year) => <option key={year} value={year}>{year} 年</option>)}</select></label><button className={pastMode === "practice" ? "mode-button active" : "mode-button"} onClick={() => { setPastMode("practice"); setPastIndex(0); setPastAnswer(""); setPastRevealed(false); }}>可练习题 ({yearQuestions.filter((item) => item.practiceReady).length})</button><button className={pastMode === "index" ? "mode-button active" : "mode-button"} onClick={() => { setPastMode("index"); setPastIndex(0); setPastAnswer(""); setPastRevealed(false); }}>索引浏览 ({yearQuestions.filter((item) => !item.practiceReady).length})</button></div><section className="panel quiz-card"><div className="past-question-heading"><div className="quiz-top"><span>{pastMode === "practice" ? "可练习真题" : "仅索引浏览"}</span><small>{pastPool.length ? "第 " + (pastIndex % pastPool.length + 1) + " / " + pastPool.length + " 条" : "当前年份没有该类记录"}</small></div></div>{pastQuestion ? <><div className="question-meta"><span>{pastQuestion.year} 年</span><span>{questionType[pastQuestion.type] || "其他题型"} ({pastQuestion.type})</span><span>{statusLabel[pastQuestion.status]}</span></div><h2>{pastQuestion.stem}</h2>{pastMode === "practice" ? <><p className="not-scored">文字作答练习 · 不自动判分</p><label className="answer-label" htmlFor="past-answer">我的作答</label><textarea id="past-answer" className="past-answer" value={pastAnswer} onChange={(event) => setPastAnswer(event.target.value)} placeholder="组织答案；完成后可查看资料中的参考答案。"/><button className="primary reveal-button" onClick={() => setPastRevealed((value) => !value)}>{pastRevealed ? "收起参考信息" : "查看参考答案与解析"}</button>{pastRevealed && <div className="explanation past-explanation">{pastQuestion.referenceAnswer ? <><b>参考答案 · 非官方资料，仅供对照</b><p>{pastQuestion.referenceAnswer}</p></> : <><b>该题没有参考答案</b><p>当前资料没有可用参考答案；系统不会对你的文字作答评分。</p></>}{pastQuestion.analysis ? <><strong>解析</strong><p>{pastQuestion.analysis}</p></> : <p>当前记录没有单独的解析文本。</p>}{pastQuestion.answerSource && <small>答案来源：{pastQuestion.answerSource}</small>}</div>}</> : <div className="limitation-box"><b>索引浏览 · 不进入练习</b><p>{pastQuestion.limitation || "该记录未通过可练习校验，仅供目录和出处浏览。"}</p></div>}<div className="source-details"><p><b>来源状态：</b>{statusLabel[pastQuestion.status]}</p><p><b>原题来源：</b>{pastQuestion.source}</p><p><b>原 PDF：</b>{pastQuestion.sourceFile} · 第 {pastQuestion.sourcePage} 页</p></div><div className="quiz-footer"><span>按书目和年份整理 · 未提供章节映射</span><button className="primary" disabled={pastPool.length < 2} onClick={() => { setPastIndex((index) => (index + 1) % pastPool.length); setPastAnswer(""); setPastRevealed(false); }}>下一题</button></div></> : <div className="empty">当前年份没有记录，请切换年份或书目。</div>}</section></>}
          {view === "feynman" && <>{heading("TEACH IT BACK", subject === "825" ? "用自己的话讲清一个知识点" : "把知识讲给“别人”听", "可打字或使用浏览器语音转文字。DeepSeek 的评分和反馈仅是学习建议，不是标准答案。")}{picker}<div className="feynman-layout"><section className="panel speaking"><span className="eyebrow">CURRENT TOPIC</span><h2>{section || chapterName}</h2><p>{subject === "825" ? "AI 会参考当前书目中有限的相关笔记；可选择章节或小节。" : subject === "politics" ? "建议按“是什么 → 为什么 → 有哪些要点 → 易混点”讲述，可选择考点小节。尽量不照着闪卡念。" : "建议按“是什么 → 为什么 → 举一个课堂例子 → 易混点”讲述，可选择小节。尽量不用照着教材念。"}</p>{sectionHints.length > 0 && <div className="section-outline topic-hints"><strong>本节知识点（来自笔记卡，供复述自查）</strong>{sectionHints.map((item, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span>{item}</div>)}</div>}<SpeechInputControls key={JSON.stringify([subject, book, chapter, section])} language={speechLanguage} onLanguageChange={setSpeechLanguage} setAnswer={setAnswer} answerRef={answerRef}/></section><section className="panel writing"><label htmlFor="answer">我的复述</label><textarea id="answer" ref={answerRef} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="例如：我会这样向同学解释这个概念……"/><div className="write-footer"><small>{answer.length} 字</small><button className="primary" disabled={!answer.trim() || loading} onClick={() => ask("feedback")}><Sparkles size={17}/>{loading ? "分析中…" : "让 DeepSeek 评分并反馈"}</button></div>{feedback && <><div className="ai-caveat">AI 反馈是练习参考，不能替代教材或权威评分。</div><div className="ai-result"><b><Brain size={18}/> DeepSeek 反馈</b><p>{feedback}</p></div></>}</section></div></>}
          {view === "planner" && <>{heading("AI STUDY COACH", "为今天定一个可执行的计划", "DeepSeek 会结合当前科目、书目、章节和少量相关笔记规划；请补充可用时间与状态。")}<div className="planner-layout"><section className="panel planner"><div className="planner-title"><span><Sparkles size={21}/></span><div><h2>今天想怎么学？</h2><p>可以直接修改下面的问题，再发送给 DeepSeek。</p></div></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="学习计划要求"/><div className="write-footer"><small>当前：{activeBook?.name} · 第 {chapter} 章{section ? " · " + section : ""}</small><button className="primary" disabled={loading || !prompt.trim()} onClick={() => ask("plan")}><Send size={17}/>{loading ? "生成中…" : "生成学习计划"}</button></div>{reply && <><div className="ai-caveat">AI 生成内容仅作学习建议，不是标准答案或官方考试安排。</div><div className="ai-result"><b><Sparkles size={18}/> 今日计划</b><p>{reply}</p></div></>}</section><section className="panel context"><span className="eyebrow">CONTEXT</span><h2>计划会参考</h2><p><BookOpen size={18}/>当前科目与章节 <b>{activeBook?.name || "未选择"} · {chapterName || "未选择"}</b></p><p><Layers3 size={18}/>已学到期 <b>{due} 张</b></p><p><Layers3 size={18}/>今日新学 <b>{newToday} 张</b></p><p><Target size={18}/>目标初试 <b>2027 年 12 月</b></p><div className="tip">告诉 AI “今天只有 2 小时”“想重点整理浪漫主义”，计划会更贴合你。</div></section></div></>}
        </>}
      </div>
    </main>
    {keyOpen && <div className="yantu-key-overlay" onClick={() => setKeyOpen(false)}><div className="key-modal" role="dialog" aria-modal="true" aria-labelledby="key-title" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setKeyOpen(false)} aria-label="关闭密钥设置"><X size={20}/></button><span className="key-icon"><KeyRound size={23}/></span><h2 id="key-title">连接 DeepSeek</h2><p>填入自己的 API Key 后生成计划和反馈。密钥只保存在 sessionStorage，请求由浏览器直接发送给 DeepSeek。</p><label htmlFor="api-key">API Key</label><input id="api-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-..." autoComplete="off"/><div className="modal-actions"><button className="secondary" onClick={() => { setKey(""); sessionStorage.removeItem("yantu-key"); setKeyOpen(false); }}>清除</button><button className="primary" onClick={() => { const cleaned = cleanApiKey(key); setKey(cleaned); sessionStorage.setItem("yantu-key", cleaned); setKeyOpen(false); }}>保存并继续</button></div></div></div>}
  </div>;
}
function Stat({ Icon, label, value, note }: { Icon: typeof BookOpen; label: string; value: string; note: string }) { return <div className="stat"><span className="stat-icon"><Icon size={20}/></span><small>{label}</small><strong>{value}</strong><span>{note}</span></div>; }
