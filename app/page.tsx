import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type SetStateAction } from "react";
import { BookOpen, Brain, CalendarDays, Check, ChevronRight, KeyRound, Layers3, Menu, Send, Settings2, Sparkles, Target, X } from "lucide-react";
import { books as books333, cards as cards333Base, loadKnowledgeCards, questions } from "@/lib/study-data";
import { outlines } from "@/lib/outlines";
import { askDeepSeek } from "@/lib/deepseek-browser";
import { load825StudyData, type Question825, type StudyData825 } from "@/lib/825/study-data";
import { loadPoliticsStudyData, type StudyDataPolitics } from "@/lib/politics/study-data";
import { useStudyReview } from "@/lib/use-study-review";
import { readMistakes, recordMistake, removeMistakes } from "@/lib/mistakes";
import { listStats, studyDate } from "@/lib/stats";
import { recordStat } from "@/lib/stats";
import { dropLastActivity, recordActivity, todayActivities } from "@/lib/activity";
import { forecastLoad } from "@/lib/study-scheduler";
import { StudyReviewCards } from "./components/StudyReview";
import { MockPractice } from "./components/MockPractice";
import { SpeechInputControls } from "./components/SpeechInputControls";
import { ApiKeySettings } from "./components/ApiKeySettings";
import { CopyAnswerButton } from "./components/CopyAnswerButton";
import { MistakesView } from "./components/MistakesView";
import { PracticeView } from "./components/PracticeView";
import { StatsView } from "./components/StatsView";
import { SearchView, type SearchEntry } from "./components/SearchView";
import { EssayBank } from "./components/EssayBank";
import { ChoiceDrill } from "./components/ChoiceDrill";
import { loadEssayQuestions, type EssayQuestion } from "@/lib/essay-questions";
import { Overview333, Overview825, OverviewPolitics } from "./components/OverviewPanels";
import { selectedAnswer } from "@/lib/copy-answer";
import { createLearningSession, defaultPlannerPrompt, feynmanDraftKey, isStudySubject, learningSessionKey, pastAnswerKey, restoreLearningSession, validateLocation, type LearningLocation, type StudySubject, type StudyView } from "@/lib/learning-session";
import { sidebarViews, subjects, subjectBooks, views } from "@/lib/subject-capabilities";

type View = StudyView;
const BackupPanel = lazy(() => import("./components/BackupPanel"));
type Progress<T> = { "333": T; "825": T; politics: T };
type Chapter = { title: string; sections: string[] };
type Book = { id: string; name: string; short: string; tone: string; chapters: Chapter[] };
type Card = { id: string; book: string; chapter: number; section?: string; front: string; back: string; source: string; sourceFile?: string; sourcePage?: number; sourcePages?: number[] };
// 科目/页面能力统一来自 lib/subject-capabilities(导航过滤、资料加载、备份校验共用)。
const subjectBookIds = subjectBooks;
const books333Model: Book[] = books333.map((book) => ({ id: book.id, name: book.name, short: book.short, tone: book.tone, chapters: book.chapters.map((title, index) => ({ title, sections: outlines[book.id]?.[index] || [] })) }));
const sectionLabel = (front: string) => { const match = /^〔(.+?)〕/.exec(front); return match ? match[1] : ""; };
const plainFront = (front: string) => front.replace(/^〔.+?〕\s*/, "");
// 基础卡(目录/知识框架)静态可用; 1682 张知识点卡由 loadKnowledgeCards 懒加载, 加载后补全小节目录。
const cards333BaseModel: Card[] = (cards333Base as unknown as Card[]).map((card) => ({ ...card, section: sectionLabel(card.front) || undefined }));
function withSectionLabels(cards: Card[], base: Book[]): { cards: Card[]; books: Book[] } {
  const booksOut = base.map((book) => ({ ...book, chapters: book.chapters.map((chapterItem) => ({ ...chapterItem })) }));
  for (const modelBook of booksOut) {
    modelBook.chapters.forEach((chapterItem, index) => {
      const labels = [...new Set(cards.filter((item) => item.book === modelBook.id && item.chapter === index + 1 && item.section).map((item) => item.section as string))];
      if (labels.length) chapterItem.sections = labels;
    });
  }
  return { cards, books: booksOut };
}
const base333 = withSectionLabels(cards333BaseModel, books333Model);
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
function readStorage(key: string): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).filter(([, value]) => typeof value === "boolean")) : {};
  } catch { return {}; }
}

export default function Home() {
  const [session, setSession] = useState(() => createLearningSession(subjectBookIds));
  const subject = session.subject;
  const { book, chapter, section, view, pastMode, pastYear, pastIndex } = session.locations[subject];
  const [sessionStorageError, setSessionStorageError] = useState(""), [keyStorageError, setKeyStorageError] = useState("");
  const [backupOpen, setBackupOpen] = useState(false), [backupBusy, setBackupBusy] = useState(false);
  const backupDialogRef = useRef<HTMLDivElement | null>(null), backupTriggerRef = useRef<HTMLElement | null>(null);
  const [mockStatus, setMockStatus] = useState<Record<"333" | "825", { pending: boolean; error: boolean }>>({ "333": { pending: false, error: false }, "825": { pending: false, error: false } });
  const onMockStatus = useCallback((subject: "333" | "825", status: { pending: boolean; error: boolean }) => {
    setMockStatus(previous => previous[subject].pending === status.pending && previous[subject].error === status.error ? previous : { ...previous, [subject]: status });
  }, []);
  const [data825, setData825] = useState<StudyData825 | null>(null), [dataError, setDataError] = useState(""), [loadAttempt, setLoadAttempt] = useState(0);
  const [dataPolitics, setDataPolitics] = useState<StudyDataPolitics | null>(null);
  const [knowledge333, setKnowledge333] = useState<Card[] | null>(null);
  const [essayQuestions, setEssayQuestions] = useState<EssayQuestion[] | null>(null);
  useEffect(() => {
    if (essayQuestions) return;
    let cancelled = false;
    loadEssayQuestions().then(data => { if (!cancelled) setEssayQuestions(data); }).catch(() => { /* 主观题库加载失败不影响其他功能 */ });
    return () => { cancelled = true; };
  }, [essayQuestions]);
  const [jumpCard, setJumpCard] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    loadKnowledgeCards().then((cards) => { if (!cancelled) setKnowledge333((cards as unknown as Card[]).map((card) => ({ ...card, section: sectionLabel(card.front) || undefined }))); }).catch(() => { if (!cancelled) setDataError("333 知识点闪卡加载失败，请刷新页面后重试。"); });
    return () => { cancelled = true; };
  }, []);
  const politicsModels = useMemo(() => buildPoliticsModels(dataPolitics), [dataPolitics]);
  const cards333Model = useMemo(() => knowledge333 ? [...base333.cards, ...knowledge333] : base333.cards, [knowledge333]);
  const books333WithSections = useMemo(() => knowledge333 ? withSectionLabels(cards333Model, books333Model).books : base333.books, [knowledge333, cards333Model]);
  const [quizIndex, setQuizIndex] = useState(0);
  const [wrongOnly, setWrongOnly] = useState(false);
  // 持久化错题本中的真题错题 + 本次会话新增, 合并为"只练错题"范围
  const [wrongQuizIds, setWrongQuizIds] = useState<Set<string>>(() => new Set(readMistakes().filter(item => item.subject === "333" && item.kind === "quiz").map(item => item.refId)));
  const [markedOnly825, setMarkedOnly825] = useState(false);
  const [marked825, setMarked825] = useState<Set<string>>(() => new Set(readMistakes().filter(item => item.subject === "825" && item.kind === "quiz").map(item => item.refId)));
  const pendingQuizJump = useRef<string | null>(null);
  // 各科分别保留最近一次评分的副作用; 撤销只回滚当前科目, 不会误伤其他科目的统计
  const ratingSideEffects = useRef<Record<string, {
    subject: string;
    date: string;
    stats: { ratings: number; again: number; newCards: number };
    mistakeRefId: string | null;
    mistakeExistedBefore: boolean;
    mistakePreviousCount: number;
  }>>({});
  const [choice, setChoice] = useState<number | null>(null), [score, setScore] = useState({ right: 0, total: 0 });
  const [doneStorageError, setDoneStorageError] = useState("");
  const [recordSaveErrors, setRecordSaveErrors] = useState<Record<string, boolean>>({});
  const [doneBySubject, setDoneBySubject] = useState<Progress<Record<string, boolean>>>({ "333": {}, "825": {}, politics: {} }), [progressReady, setProgressReady] = useState(false);
  const [feedback, setFeedback] = useState(""), [reply, setReply] = useState("");
  const draftKey = feynmanDraftKey(subject, { book, chapter, section });
  const answer = session.feynmanDrafts[draftKey] || "";
  const setAnswer = useCallback((next: SetStateAction<string>) => {
    setSession(previous => ({ ...previous, feynmanDrafts: { ...previous.feynmanDrafts, [draftKey]: typeof next === "function" ? next(previous.feynmanDrafts[draftKey] || "") : next } }));
  }, [draftKey]);
  const prompt = session.plannerPrompts[subject] ?? defaultPlannerPrompt;
  function setPrompt(value: string) { setSession(previous => ({ ...previous, plannerPrompts: { ...previous.plannerPrompts, [subject]: value } })); }
  const [key, setKey] = useState(""), [keyOpen, setKeyOpen] = useState(false), [loading, setLoading] = useState(false), [speechLanguage, setSpeechLanguage] = useState("zh-CN"), [menuOpen, setMenuOpen] = useState(false);
  const [pastRevealed, setPastRevealed] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  const sidebarRef = useRef<HTMLElement | null>(null), mobileMenuRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const onChange = () => { setMobileLayout(media.matches); if (!media.matches) setMenuOpen(false); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!mobileLayout || !menuOpen) return;
    sidebarRef.current?.querySelector<HTMLButtonElement>(".mobile-close")?.focus();
    return () => { if (window.matchMedia("(max-width: 720px)").matches) mobileMenuRef.current?.focus(); };
  }, [menuOpen, mobileLayout]);
  const answerRef = useRef<HTMLTextAreaElement | null>(null);
  const pastAnswerRef = useRef<HTMLTextAreaElement | null>(null);
  function openBackup() {
    backupTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuOpen(false); setBackupOpen(true);
  }
  function closeBackup() { if (!backupBusy) setBackupOpen(false); }
  useEffect(() => {
    if (!backupOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    backupDialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        const target = backupTriggerRef.current;
        if (target?.isConnected && !target.closest("[inert]")) target.focus(); else mobileMenuRef.current?.focus();
      });
    };
  }, [backupOpen]);
  function backupKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); closeBackup(); }
    if (event.key !== "Tab") return;
    const controls = Array.from(backupDialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex="0"]') || []).filter(control => control.getClientRects().length > 0 && !control.closest("[inert]"));
    const first = controls[0], last = controls.at(-1);
    if (!first) { event.preventDefault(); backupDialogRef.current?.focus(); return; }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === backupDialogRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || document.activeElement === backupDialogRef.current)) { event.preventDefault(); first.focus(); }
  }
  const requestId = useRef(0), requestController = useRef<AbortController | null>(null);
  const subjectRef = useRef(subject);
  const quizzes = useRef<Record<string, { quizIndex: number; choice: number | null; score: { right: number; total: number } }>>({});
  function cancelRequest() {
    requestId.current += 1; requestController.current?.abort(); requestController.current = null; setLoading(false);
  }
  function updateLocation(patch: Partial<LearningLocation>) {
    cancelRequest(); setFeedback(""); setReply("");
    setSession(previous => ({ ...previous, locations: { ...previous.locations, [previous.subject]: { ...previous.locations[previous.subject], ...patch } } }));
  }
  const setView = (next: View) => updateLocation({ view: next });
  const setPastMode = (next: "practice" | "index") => updateLocation({ pastMode: next });
  const setPastYear = (next: number) => updateLocation({ pastYear: next });
  const setPastIndex = (next: SetStateAction<number>) => {
    cancelRequest();
    setSession(previous => ({ ...previous, locations: { ...previous.locations, [previous.subject]: { ...previous.locations[previous.subject], pastIndex: typeof next === "function" ? next(previous.locations[previous.subject].pastIndex) : next } } }));
  };

  useEffect(() => {
    setDoneBySubject({ "333": readStorage("yantu-done"), "825": readStorage("yantu-done-825"), politics: readStorage("yantu-done-politics") });
    try {
      const restored = restoreLearningSession(localStorage.getItem(learningSessionKey), subjectBookIds, localStorage.getItem("yantu-last-place"));
      subjectRef.current = restored.subject;
      setSession(restored);
    } catch { setSessionStorageError("浏览器未能读取学习位置和草稿，请允许本地存储。"); }
    try { setKey(sessionStorage.getItem("yantu-key") || ""); } catch { setKeyStorageError("浏览器未能读取已保存的密钥，请允许会话存储后重新设置。"); }
    setProgressReady(true);
  }, []);
  useEffect(() => {
    if (!progressReady) return;
    try { localStorage.setItem(learningSessionKey, JSON.stringify(session)); setSessionStorageError(""); }
    catch { setSessionStorageError("浏览器未能保存学习位置和草稿；刷新前请复制需要保留的文字。"); }
  }, [session, progressReady]);
  useEffect(() => () => { requestId.current += 1; requestController.current?.abort(); }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);
  useEffect(() => {
    const onSaved = (event: Event) => {
      const store = (event as CustomEvent).detail?.store as string | undefined;
      setRecordSaveErrors(previous => {
        if (!store) return Object.keys(previous).length ? {} : previous;
        if (!(store in previous)) return previous;
        const next = { ...previous }; delete next[store]; return next;
      });
    };
    const onError = (event: Event) => {
      const store = (event as CustomEvent).detail?.store as string | undefined;
      setRecordSaveErrors(previous => ({ ...previous, [store || "unknown"]: true }));
    };
    window.addEventListener("yantu-storage-saved", onSaved);
    window.addEventListener("yantu-storage-error", onError);
    return () => { window.removeEventListener("yantu-storage-saved", onSaved); window.removeEventListener("yantu-storage-error", onError); };
  }, []);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-done", JSON.stringify(doneBySubject["333"])); } catch { setDoneStorageError("浏览器未能保存章节标记，请允许本地存储。"); } } }, [doneBySubject["333"], progressReady]);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-done-825", JSON.stringify(doneBySubject["825"])); } catch { setDoneStorageError("浏览器未能保存章节标记，请允许本地存储。"); } } }, [doneBySubject["825"], progressReady]);
  useEffect(() => { if (progressReady) { try { localStorage.setItem("yantu-done-politics", JSON.stringify(doneBySubject.politics)); } catch { setDoneStorageError("浏览器未能保存章节标记，请允许本地存储。"); } } }, [doneBySubject.politics, progressReady]);
  useEffect(() => {
    if ((subject !== "825" && view !== "search") || data825) return;
    let cancelled = false; setDataError("");
    load825StudyData().then((data) => { if (!cancelled) setData825(data); }).catch(() => { if (!cancelled) setDataError("825 资料加载失败，请刷新页面后重试。"); });
    return () => { cancelled = true; };
  }, [subject, view, data825, loadAttempt]);
  useEffect(() => {
    if ((subject !== "politics" && view !== "search") || dataPolitics) return;
    let cancelled = false; setDataError("");
    loadPoliticsStudyData().then((data) => { if (!cancelled) setDataPolitics(data); }).catch(() => { if (!cancelled) setDataError("政治资料加载失败，请刷新页面后重试。"); });
    return () => { cancelled = true; };
  }, [subject, view, dataPolitics, loadAttempt]);

  const dateLabel = useMemo(() => new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date()), []);
  const books: Book[] = subject === "825"
    ? (data825?.books || []).map((item) => ({ id: item.id, name: item.name, short: item.id === "linguistics" ? "语言" : "文学", tone: item.id === "linguistics" ? "#4976b6" : "#9478ad", chapters: item.chapters.map((part) => ({ title: part.title, sections: part.sections })) }))
    : subject === "politics" ? politicsModels.books
    : subject === "333" ? books333WithSections : [];
  const activeBook = books.find((item) => item.id === book) || books[0], chapterInfo = activeBook?.chapters[chapter - 1], chapterName = chapterInfo?.title || "";
  // 数据到达前保留恢复的位置；到达后按当前目录校验，避免错章或无效小节。
  useEffect(() => {
    // 333 的完整小节目录来自异步加载的知识卡, 加载完成前不校验(否则真实小节会被误判清空)。
    if (!progressReady || !books.length || (subject === "333" && !knowledge333)) return;
    const normalized = validateLocation(session.locations[subject], books);
    if (normalized === session.locations[subject]) return;
    cancelRequest(); setFeedback(""); setReply("");
    setSession(previous => previous.subject === subject ? { ...previous, locations: { ...previous.locations, [subject]: normalized } } : previous);
  }, [subject, book, chapter, section, data825, dataPolitics, knowledge333, progressReady]);
  const allCards: Card[] = subject === "825" ? (data825?.cards || []) : subject === "politics" ? politicsModels.cards : subject === "333" ? cards333Model : [];
  const chapterCards = allCards.filter((item) => item.book === book && item.chapter === chapter);
  const cardsInScope = section ? chapterCards.filter((item) => item.section === section) : chapterCards;
  const review333 = useStudyReview("333", cards333Model, knowledge333 !== null);
  const review825 = useStudyReview("825", data825?.cards || emptyCards, data825 !== null);
  const reviewPolitics = useStudyReview("politics", politicsModels.cards, dataPolitics !== null);
  const review = subject === "825" ? review825 : subject === "politics" ? reviewPolitics : review333;
  const backupBlockedReason = sessionStorageError || doneStorageError || review333.storageError || review825.storageError || reviewPolitics.storageError || Object.values(mockStatus).some(status => status.error)
    ? "当前有学习记录尚未成功保存，请先解决本地保存错误；导出与导入暂不可用，避免丢失当前修改。"
    : loading || Object.values(mockStatus).some(status => status.pending) ? "AI 正在生成内容，请等待完成或取消生成后再导出、导入。" : !progressReady ? "学习记录正在加载，请稍候。" : "";
  const chapterQuestions = questions.filter((item) => item.book === book && item.chapter === chapter), bookQuestions = questions.filter((item) => item.book === book);
  // 章节映射题不足 4 道时改用同书题库, 避免小池循环; meta 会说明来源。
  const useBookPool = chapterQuestions.length < 4 && bookQuestions.length > chapterQuestions.length;
  const basePool = useBookPool ? bookQuestions : chapterQuestions;
  const wrongPool = wrongOnly ? basePool.filter(item => wrongQuizIds.has(item.id)) : basePool;
  const pool = wrongPool.length ? wrongPool : basePool, quiz = pool.length ? pool[quizIndex % pool.length] : null;
  // 换章/换书后当前题若不在新池中, 光标自动移到新池开头(修复"换章后题目停留在上一章")
  useEffect(() => {
    if (!quiz || !pool.length) return;
    if (pool.some(item => item.id === quiz.id)) return;
    setQuizIndex(0); setChoice(null);
  }, [pool]);
  const progressSubject: "333" | "825" | "politics" = subject === "825" ? "825" : subject === "politics" ? "politics" : "333";
  const done = doneBySubject[progressSubject];
  const due = review.queue.counts.reviewDue, newToday = review.queue.counts.newToday;
  const completed = books.reduce((sum, item) => sum + item.chapters.filter((_, index) => done[item.id + "-" + (index + 1)]).length, 0);
  const totalChapters = subject === "333" ? total333 : books.reduce((sum, item) => sum + item.chapters.length, 0);
  const pastQuestions = data825?.questions || [];
  const years = [...new Set(pastQuestions.filter((item) => item.book === book).map((item) => item.year))].sort((a, b) => b - a);
  const activeYear = years.includes(pastYear) ? pastYear : years[0];
  const yearQuestions = pastQuestions.filter((item) => item.book === book && item.year === activeYear);
  const pastPool = yearQuestions.filter((item) => pastMode === "practice" ? item.practiceReady : !item.practiceReady)
    .filter((item) => !markedOnly825 || marked825.has(item.id));
  const pastPosition = pastPool.length ? pastIndex % pastPool.length : 0;
  const pastQuestion = pastPool[pastPosition];
  const pastDraftKey = pastQuestion ? pastAnswerKey(pastQuestion.book, pastQuestion.id) : "";
  const pastAnswer = session.pastAnswers[pastDraftKey] || "";
  function setPastAnswer(value: string) {
    if (pastDraftKey) setSession(previous => ({ ...previous, pastAnswers: { ...previous.pastAnswers, [pastDraftKey]: value } }));
  }
  // "去重做"定位: 题池就绪后把光标移到目标题
  useEffect(() => {
    if (!pendingQuizJump.current || !pool.length) return;
    const position = pool.findIndex(item => item.id === pendingQuizJump.current);
    if (position >= 0) setQuizIndex(position);
    pendingQuizJump.current = null;
  }, [pool]);
  const sectionHints = (section ? cardsInScope : chapterCards).slice(0, 8).map((item) => plainFront(item.front));

  function chooseChapter(nextBook: string, nextChapter: number, nextView: View = "chapters") {
    updateLocation({ book: nextBook, chapter: nextChapter, section: "", view: nextView, pastIndex: 0 });
    setQuizIndex(0); setChoice(null); setPastRevealed(false);
  }
  function switchSubject(next: string) {
    if (!isStudySubject(next) || next === subjectRef.current) { setMenuOpen(false); return; }
    if (subjectRef.current === subject) quizzes.current[subject] = { quizIndex, choice, score };
    const saved = quizzes.current[next];
    cancelRequest(); subjectRef.current = next;
    setSession(previous => ({ ...previous, subject: next }));
    setMenuOpen(false); setQuizIndex(saved?.quizIndex || 0); setChoice(saved?.choice ?? null);
    setPastRevealed(false); setScore(saved?.score || { right: 0, total: 0 }); setFeedback(""); setReply("");
  }
  function chooseSection(nextSection: string) { updateLocation({ section: nextSection }); }
  const localStorageStore = useMemo(() => ({ getItem: (key: string) => localStorage.getItem(key), setItem: (key: string, value: string) => localStorage.setItem(key, value) }), []);
  function handleRated(card: Card, grade: string, wasNew: boolean) {
    recordActivity(localStorageStore, subject, "rating", card.front, grade === "again" ? "重来" : grade === "hard" ? "困难" : grade === "easy" ? "很熟悉" : "记住了");
    // 记录本次评分的统计与错题副作用, 供撤销时一并回滚
    const existingMistake = grade === "again" ? readMistakes().find(item => item.subject === subject && item.refId === card.id && item.kind === "card") : undefined;
    if (!ratingSideEffects.current) ratingSideEffects.current = {};
    ratingSideEffects.current[subject] = {
      subject,
      date: today(),
      stats: { ratings: 1, again: grade === "again" ? 1 : 0, newCards: wasNew ? 1 : 0 },
      mistakeRefId: grade === "again" ? card.id : null,
      mistakeExistedBefore: !!existingMistake,
      mistakePreviousCount: existingMistake?.wrongCount ?? 0,
    };
    recordStat(localStorageStore, subject, ratingSideEffects.current[subject].stats);
    if (grade === "again") recordMistake(subject, "card", card.id, card.front);
  }
  function undoLastRating() {
    const effects = ratingSideEffects.current?.[subject];
    if (!effects) return;
    dropLastActivity(localStorageStore, subject, "rating");
    recordActivity(localStorageStore, subject, "undo", "撤销了一次闪卡评分");
    review.undoLastRating();
    delete ratingSideEffects.current![subject];
    // 统计回滚: 按评分当日的日期扣回(支持跨日撤销), 只动本科目
    const stored = JSON.parse(localStorage.getItem("yantu-stats-v1-" + effects.subject) || "{}");
    const current = stored[effects.date];
    if (current) {
      stored[effects.date] = {
        date: effects.date,
        ratings: Math.max(0, current.ratings - effects.stats.ratings),
        again: Math.max(0, current.again - effects.stats.again),
        newCards: Math.max(0, current.newCards - effects.stats.newCards),
        quiz: current.quiz,
        quizCorrect: current.quizCorrect,
      };
      try {
        localStorage.setItem("yantu-stats-v1-" + effects.subject, JSON.stringify(stored));
        window.dispatchEvent(new CustomEvent("yantu-storage-saved"));
      } catch {
        window.dispatchEvent(new CustomEvent("yantu-storage-error", { detail: { store: "stats", subject: effects.subject } }));
      }
    }
    // 错题回滚: 本次新建的移除; 已存在的恢复原错误次数
    if (effects.mistakeRefId) {
      const list = readMistakes();
      const target = list.find(item => item.subject === effects.subject && item.refId === effects.mistakeRefId && item.kind === "card");
      if (target && !effects.mistakeExistedBefore) removeMistakes([target.id]);
      else if (target && effects.mistakeExistedBefore) {
        const rolled = list.map(item => item.id === target.id ? { ...item, wrongCount: effects.mistakePreviousCount } : item);
        try {
          localStorage.setItem("yantu-mistakes-v1", JSON.stringify(rolled));
          window.dispatchEvent(new CustomEvent("yantu-storage-saved"));
        } catch {
          window.dispatchEvent(new CustomEvent("yantu-storage-error", { detail: { store: "mistakes" } }));
        }
      }
    }
  }
  function handleQuizAnswer(index: number) {
    if (!quiz) return;
    // 计分在选项点击后统一进行; 活动记录在答案判定处
    const correct = index === quiz.answer;
    recordStat(localStorageStore, "333", { quiz: 1, quizCorrect: correct ? 1 : 0 });
    recordActivity(localStorageStore, "333", "quiz", quiz.stem, correct ? "答对" : "答错");
    if (!correct) {
      recordMistake("333", "quiz", quiz.id, quiz.stem);
      setWrongQuizIds(previous => new Set(previous).add(quiz.id));
    }
    setChoice(index);
    setScore((previous) => ({ right: previous.right + Number(correct), total: previous.total + 1 }));
  }
  function redoQuiz(quizId: string) {
    // 825 真题: 跳到对应年份/书目, 只看标记题并定位该题
    const target825 = pastQuestions.find(item => item.id === quizId);
    if (target825) {
      if (subject !== "825") switchSubject("825");
      setMarked825(previous => new Set(previous).add(target825.id));
      const pool = pastQuestions.filter(item => item.book === target825.book && item.year === target825.year && item.practiceReady === !!target825.practiceReady);
      const position = Math.max(0, pool.findIndex(item => item.id === target825.id));
      updateLocation({ book: target825.book, chapter: 1, section: "", view: "quiz", pastYear: target825.year, pastIndex: position, pastMode: target825.practiceReady ? "practice" : "index" });
      setPastRevealed(false);
      setMenuOpen(false);
      return;
    }
    const target = questions.find(item => item.id === quizId);
    if (!target) return;
    const targetSubject = isStudySubject(target.book) && subjectBooks[target.book as StudySubject]?.length ? target.book as StudySubject : "333";
    // 跨科目先切换; switchSubject 会重置视图为 overview, 之后再定位
    if (targetSubject !== subject) switchSubject(targetSubject);
    updateLocation({ book: target.book, chapter: target.chapter || 1, section: "", view: "quiz" });
    // 预置错题集并打开"只练错题", 记录目标题, 渲染后由 effect 精确定位光标
    setWrongQuizIds(previous => new Set(previous).add(target.id));
    setWrongOnly(true);
    setChoice(null);
    pendingQuizJump.current = target.id;
    setMenuOpen(false);
  }
  function toggleMark825(questionId: string) {
    if (marked825.has(questionId)) {
      const entry = readMistakes().find(item => item.subject === "825" && item.kind === "quiz" && item.refId === questionId);
      if (entry) removeMistakes([entry.id]);
      const next = new Set(marked825);
      next.delete(questionId);
      setMarked825(next);
      setMarkedOnly825(false);
      return;
    }
    const target = pastQuestions.find(item => item.id === questionId);
    if (target) recordMistake("825", "quiz", target.id, target.stem);
    setMarked825(previous => new Set(previous).add(questionId));
  }
  function jumpToCard(cardId: string) {
    const all: Card[] = [...cards333Model, ...politicsModels.cards, ...(data825?.cards || [])];
    const target = all.find((card) => card.id === cardId);
    if (!target) return;
    const targetSubject = cards333Model.includes(target) ? "333" : politicsModels.cards.includes(target) ? "politics" : "825";
    if (targetSubject !== subject) switchSubject(targetSubject);
    updateLocation({ book: target.book, chapter: target.chapter, section: "", view: "cards" });
    setJumpCard(cardId);
    setMenuOpen(false);
  }
  const searchEntries = useMemo<SearchEntry[]>(() => {
    if (view !== "search" || !knowledge333 || !dataPolitics || !data825) return [];
    const toEntry = (subjectId: string, subjectName: string, bookList: Book[], card: Card): SearchEntry => ({ subject: subjectId, subjectName, bookId: card.book, bookName: bookList.find((item) => item.id === card.book)?.name || card.book, chapter: card.chapter, section: card.section || "", id: card.id, front: card.front });
    return [
      ...cards333Model.map((card) => toEntry("333", "333 教育综合", books333WithSections, card)),
      ...politicsModels.cards.map((card) => toEntry("politics", "政治", politicsModels.books, card)),
      ...(data825.cards as unknown as Card[]).map((card) => toEntry("825", "825 英语专业基础", books, card)),
    ];
  }, [view, knowledge333, dataPolitics, data825, cards333Model, politicsModels]);
  async function ask(mode: "plan" | "feedback") {
    if (!key.trim()) { setKeyOpen(true); return; }
    const input = mode === "plan" ? prompt : answer; if (!input.trim()) return;
    cancelRequest();
    const controller = new AbortController(); requestController.current = controller;
    const currentRequest = ++requestId.current;
    setLoading(true); mode === "plan" ? setReply("") : setFeedback("");
    try {
      const data = await askDeepSeek(key, mode, `${input}\n\n今日学习状态：已学到期 ${due} 张（含短间隔回顾 ${review.queue.counts.learningDue} 张）；今日新学 ${newToday} 张；每日新卡上限 ${review.progress.dailyNewLimit} 张。复习覆盖持续学习范围，新卡仅来自今天所选范围。`, { subject, bookId: book, chapterNo: chapter, book: activeBook?.name || "", chapter: chapterName, section, done: completed, due, date: today(), exam: "2027年12月初试" }, { signal: controller.signal });
      if (currentRequest !== requestId.current) return;
      mode === "plan" ? setReply(data.text || "") : setFeedback(data.text || "");
    } catch (error) { if (currentRequest === requestId.current) { const message = error instanceof Error ? error.message : "连接失败"; mode === "plan" ? setReply(message) : setFeedback(message); } }
    finally {
      if (!requestController.current) document.documentElement.removeAttribute("data-ai-busy");
      if (currentRequest === requestId.current) { requestController.current = null; setLoading(false); }
    }
  }

  const overviewProps = {
    subjectLabel: subjects.find((item) => item.id === subject)?.name || subject,
    books, done, completed,
    totalChapters: totalChapters as number,
    total333,
    due, newToday,
    dailyLimit: review.progress.dailyNewLimit,
    score,
    pastQuestionCount: pastQuestions.length,
    cardCount: allCards.length,
    perBookCards: Object.fromEntries(books.map((item) => [item.id, allCards.filter((card) => card.book === item.id).length])),
    chapter, chapterName,
    activeBookName: activeBook?.name || "",
    onChooseBook: (bookId: string) => chooseChapter(bookId, 1),
    onSetView: (next: "cards" | "quiz" | "chapters" | "feynman" | "choice") => setView(next as View),
  };
  const picker = activeBook ? <div className="pickers"><label>书目<select value={book} onChange={(event) => chooseChapter(event.target.value, 1, view)}>{books.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>章节<select value={chapter} onChange={(event) => chooseChapter(book, Number(event.target.value), view)}>{activeBook.chapters.map((item, index) => <option key={item.title} value={index + 1}>第 {index + 1} 章 · {item.title}</option>)}</select></label>{!(subject === "333" && view === "quiz") && (chapterInfo?.sections || []).length > 0 && <label>小节<select value={section} onChange={(event) => chooseSection(event.target.value)}><option value="">本章全部小节</option>{(chapterInfo?.sections || []).map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}</div> : null;
  const heading = (label: string, title: string, description: string) => <div className="page-head"><span className="eyebrow">{label}</span><h1>{title}</h1><p>{description}</p></div>;

  return <div className="shell">
    <aside ref={sidebarRef} id="study-sidebar" className={"sidebar " + (menuOpen ? "open" : "")} inert={backupOpen || (mobileLayout && !menuOpen)} aria-hidden={mobileLayout && !menuOpen ? true : undefined}>
      <div className="brand"><span className="brand-logo"><Layers3 size={21}/></span><div><b>研途</b><small>考研全科备考台</small></div><button className="mobile-close" aria-label="关闭导航菜单" onClick={() => setMenuOpen(false)}><X size={20}/></button></div>
      <div className="side-caption">考试科目</div><nav className="side-nav">{subjects.map((item) => <button key={item.id} className={subject === item.id ? "selected" : ""} onClick={() => switchSubject(item.id)}><span className="subject-mark">{item.mark}</span>{item.name}<small>{item.id === "english" ? "未接入" : "已接入"}</small></button>)}</nav>
      {subject !== "english" && (() => {
  const grouped = sidebarViews(subject as StudySubject);
  const groups = ["学习", "练习", "工具"] as const;
  return groups.map((group) => {
    const items = grouped.filter(item => item.group === group);
    if (!items.length) return null;
    return <Fragment key={group}><div className="side-line"/><div className="side-caption">{group}</div><nav className="side-nav tools">{items.map(({ id, label, Icon }) => <button key={id} className={view === id ? "selected" : ""} onClick={() => { setView(id); setMenuOpen(false); }}><Icon size={18}/>{label}</button>)}</nav></Fragment>;
  });
})()}
      <div className="side-bottom"><button className="key-link" onClick={openBackup}><Layers3 size={17}/>备份与导出</button><div className="target-date"><CalendarDays size={18}/><span><b>2027 年 12 月</b><small>目标初试</small></span></div><button className="key-link" onClick={() => setKeyOpen(true)}><KeyRound size={17}/> DeepSeek 密钥 <small>{key ? "已配置" : "未配置"}</small></button></div>
    </aside>
    {menuOpen && <div className="menu-shade" onClick={() => setMenuOpen(false)}/>}
    <main className="main" inert={backupOpen || (mobileLayout && menuOpen)}>
      <header className="topbar"><button ref={mobileMenuRef} className="mobile-menu" aria-label="打开导航菜单" aria-expanded={menuOpen} aria-controls="study-sidebar" onClick={() => setMenuOpen(true)}><Menu size={22}/></button><span>研途 <ChevronRight size={15}/> {subjects.find((item) => item.id === subject)?.name} <ChevronRight size={15}/> <b>{subject === "english" ? "资料区未接入" : views.find((item) => item.id === view)?.label}</b></span><div><span className="date-chip"><CalendarDays size={15}/>{dateLabel}</span><button className="icon-button" onClick={() => setKeyOpen(true)} aria-label="设置密钥"><Settings2 size={18}/></button></div></header>
      <div className="content">
        {doneStorageError && <p className="error" role="alert">{doneStorageError}</p>}
        {Object.keys(recordSaveErrors).length > 0 && <p className="error" role="alert">错题或学习统计刚未能写入本地存储（存储空间不足或被禁用）。当前页面仍可继续使用，但刷新后这些记录会丢失；请检查浏览器存储设置后重试。</p>}
        {sessionStorageError && <p className="error" role="alert">{sessionStorageError}</p>}
        {keyStorageError && <p className="error" role="alert">{keyStorageError}</p>}
        <MockPractice subject="333" books={books333WithSections} active={subject === "333" && view === "mock"} apiKey={key} onNeedKey={() => setKeyOpen(true)} onOpenBackup={openBackup} onStatusChange={onMockStatus} current={{ bookId: book, chapter, section }}/>
        {data825 && <MockPractice subject="825" books={data825.books.map((item) => ({ id: item.id, name: item.name, chapters: item.chapters.map((part) => ({ title: part.title, sections: part.sections })) }))} active={subject === "825" && view === "mock"} apiKey={key} onNeedKey={() => setKeyOpen(true)} onOpenBackup={openBackup} onStatusChange={onMockStatus} current={{ bookId: book, chapter, section }}/>}
        {(subject === "333" || subject === "825" || subject === "politics") && view !== "cards" && review.storageError && <p className="error" role="alert">{review.storageError}</p>}
        {subject === "english" ? <div className="subject-empty"><BookOpen size={34}/><span className="eyebrow">英语二</span><h1>这一科的资料区已预留</h1><p>当前可使用政治、333 教育综合与 825 英语专业基础的资料、闪卡和真题流程。</p><button className="primary" onClick={() => switchSubject("333")}>先学习 333</button></div>
        : (subject === "825" && !data825) ? <div className="subject-empty"><BookOpen size={34}/><span className="eyebrow">825 英语专业基础</span><h1>{dataError ? "资料加载遇到问题" : "正在载入 825 资料"}</h1><p>{dataError || "语言学、英美文学笔记和真题索引正从资料包载入。"}</p><button className="secondary" onClick={() => { setDataError(""); setLoadAttempt((attempt) => attempt + 1); }}>重新加载</button></div>
        : (subject === "politics" && !dataPolitics) ? <div className="subject-empty"><BookOpen size={34}/><span className="eyebrow">政治</span><h1>{dataError ? "资料加载遇到问题" : "正在载入政治资料"}</h1><p>{dataError || "五科考点闪卡正从资料包载入。"}</p><button className="secondary" onClick={() => { setDataError(""); setLoadAttempt((attempt) => attempt + 1); }}>重新加载</button></div>
        : <>
          {view === "overview" && subject === "333" && <Overview333 {...overviewProps}/>}
          {view === "overview" && subject === "825" && <Overview825 {...overviewProps}/>}
          {view === "overview" && subject === "politics" && <OverviewPolitics {...overviewProps}/>}
          {view === "chapters" && <>{heading("BOOK BY BOOK", "从章节开始，形成自己的知识地图", subject === "825" ? "查看原书章节与小节；历年真题已按章节归档为真题卡，选择小节即含对应真题。真题练习按书目和年份筛选。" : subject === "politics" ? "查看五科教材章节与考点小节；选择考点后背诵对应闪卡，或用费曼复述讲出来。" : "选书、选章；完成学习后标记进度，并进入闪卡或真题。")}<div className="book-tabs">{books.map((item) => <button key={item.id} className={book === item.id ? "active" : ""} onClick={() => chooseChapter(item.id, 1)}><i style={{ background: item.tone }}/>{item.name}</button>)}</div><div className="chapter-layout"><section className="panel chapter-list"><span className="eyebrow">{activeBook?.chapters.length || 0} CHAPTERS</span><h2>{activeBook?.name}</h2>{activeBook?.chapters.map((item, index) => <button key={item.title} className={chapter === index + 1 ? "chapter-row active" : "chapter-row"} onClick={() => chooseChapter(book, index + 1)}><span>{String(index + 1).padStart(2, "0")}</span><b>{item.title}</b>{done[book + "-" + (index + 1)] ? <Check size={17}/> : <ChevronRight size={17}/>}</button>)}</section><section className="panel chapter-detail"><span className="eyebrow">{activeBook?.name} / 第 {chapter} 章</span><h2>{chapterName}</h2>{subject === "825" ? <p>选择小节查看笔记闪卡与历年真题卡；真题已按章节归档，也可在真题练习按书目与年份筛选。</p> : subject === "politics" ? <p>本章考点小节来自闪卡标签；先背考点，再用费曼复述串讲本章。</p> : <p>先浏览教材，再用闪卡主动回忆，最后用真题检验；复述反馈会结合当前章节。</p>}<div className="detail-count"><div><b>{chapterCards.length}</b><small>{subject === "333" ? "已校对闪卡" : "考点闪卡"}</small></div><div><b>{subject === "politics" ? (chapterInfo?.sections.length || 0) : subject === "825" ? "书目 / 年份" : chapterQuestions.length}</b><small>{subject === "politics" ? "考点小节" : subject === "825" ? "真题筛选" : "匹配真题"}</small></div></div>{(chapterInfo?.sections || []).length > 0 && <div className="section-outline"><strong>{subject === "825" ? "本章小节" : subject === "politics" ? "本章考点" : "本章目录"}</strong>{chapterInfo?.sections.map((item, index) => <button key={item} onClick={() => { chooseSection(item); setView("cards"); }}><span>{String(index + 1).padStart(2, "0")}</span>{item}<ChevronRight size={15}/></button>)}</div>}{subject === "333" && !chapterCards.length && <p className="notice">该章尚无人工核对闪卡。可先阅读原书，再进行费曼复述。</p>}<div className="detail-buttons"><button className="primary" onClick={() => setView("cards")}>背诵闪卡</button><button className="secondary" onClick={() => setView("feynman")}>口述本章</button></div><button className="mark-done" onClick={() => setDoneBySubject((previous) => ({ ...previous, [progressSubject]: { ...previous[progressSubject], [book + "-" + chapter]: !done[book + "-" + chapter] } }))}><Check size={16}/>{done[book + "-" + chapter] ? "已完成 · 点击撤销" : "标记本章已学习"}</button></section></div></>}
          {view === "cards" && <>{heading("ACTIVE RECALL", "闪卡学习与复习", "空格翻面、1-4 评分（浏览模式 ←/→ 翻卡）。选择新学范围；先主动回忆，再按掌握程度安排下次复习。")}<StudyReviewCards key={subject} review={review} cards={allCards} books={books} bookId={book} chapter={chapter} section={section} picker={picker} jumpCardId={jumpCard} onRated={handleRated} onUndoRating={undoLastRating}/></>}
          {view === "quiz" && subject === "333" && <>{heading("PAST PAPERS", "333 真题练习", "答完立即查看正确答案、解析与出处。")}{picker}<div className="study-meta">{wrongOnly ? `只练错题：${wrongPool.length} 道` : useBookPool ? `本章映射题 ${chapterQuestions.length} 道较少 · 展示同书全部 ${bookQuestions.length} 道` : `当前章节匹配题 ${chapterQuestions.length} 道`}</div><div className="quiz-mode-row"><button className={wrongOnly ? "mode-button active" : "mode-button"} disabled={wrongQuizIds.size === 0} onClick={() => { setWrongOnly(value => !value); setQuizIndex(0); setChoice(null); }}>{wrongOnly ? "返回全部题目" : `只练错题 (${wrongQuizIds.size})`}</button></div>{wrongOnly && !wrongPool.length && <div className="empty">当前章节没有已记录的错题。<button className="secondary" onClick={() => setWrongOnly(false)}>练全部真题</button></div>}
          {quiz && <section className="panel quiz-card"><div className="quiz-top"><span>{quiz.year + " 真题"}</span><small>{"第 " + (quizIndex % pool.length + 1) + " / " + pool.length + " 题"}</small></div><h2>{quiz.stem}</h2><div className="options">{quiz.options.map((item, index) => <button key={index} disabled={choice !== null} className={choice === null ? "" : index === quiz.answer ? "correct" : choice === index ? "wrong" : ""} onClick={() => handleQuizAnswer(index)}><span>{"ABCD"[index]}</span>{item}</button>)}</div><CopyAnswerButton text={selectedAnswer(quiz.options, choice)}/>{choice !== null && <div className="explanation"><b>{choice === quiz.answer ? "答对了" : "正确答案：" + "ABCD"[quiz.answer]}</b><p>{quiz.explanation}</p><small>来源：{quiz.source}</small></div>}<div className="quiz-footer"><span>{score.total ? "本次 " + score.right + " / " + score.total + " 题正确" : "先选一个答案"}</span><button className="primary" onClick={() => { setQuizIndex((index) => index + 1); setChoice(null); }}>下一题</button></div></section>}</>}
          {view === "choice" && subject === "politics" && <>{heading("SELF QUIZ", "政治 · 选择题自测", "由政治闪卡自动生成的四选一练习：题干是考点提问，干扰项来自同章其他考点。")}{picker}<PracticeView subject="politics" subjectName="政治" books={books} cards={politicsModels.cards} bookId={book} chapter={chapter} section={section} storage={localStorageStore}/></>}
          {view === "essay" && subject === "333" && <>{heading("ESSAY BANK", "333 主观题库", "《高效答题手册》84 道完整主观题：材料、设问与分点参考答案原样保留；先自己作答再展开对照。")}<EssayBank entries={(essayQuestions || []).map(q => ({ id: q.id, book: q.book || "principles", category: q.category, topic: q.topic, stem: q.stem, referenceAnswer: q.referenceAnswer, ocrWarning: q.ocrWarning, source: q.source }))}/></>}
          {view === "choice" && subject === "333" && <>{heading("CHOICE DRILL", "333 · 选择题练习", "真实题库：丹丹1000题（含历年311真题典例）、阶段测试卷与丹丹卷，按四书筛选，逐选项辨析；答错自动进错题本。")}<ChoiceDrill storage={localStorageStore}/></>}
          {view === "choice" && subject === "825" && <>{heading("SELF QUIZ", "825 · 选择题自测", "由语言学与英美文学闪卡自动生成的四选一练习；术语定义与作家作品适合此模式。答错自动进入错题本。")}{picker}<PracticeView subject="825" subjectName="825 英语专业基础" books={books} cards={(data825?.cards || []) as unknown as { id: string; book: string; chapter: number; front: string; back: string }[]} bookId={book} chapter={chapter} section={section} storage={localStorageStore}/></>}
          {view === "mistakes" && <>{heading("MISTAKE BOOK", "错题本", "自动收集评分“重来”的闪卡与答错的题目；整组重练（答对移出）、逐条移除或跳回闪卡复习。")}<MistakesView subject={subject} onReviewCard={jumpToCard} onRedoQuiz={redoQuiz} cards={{ "333": cards333Model, politics: politicsModels.cards, "825": (data825?.cards || []) as unknown as { id: string; book: string; chapter: number; front: string; back: string }[] }} storage={localStorageStore}/></>}
          {view === "stats" && <>{heading("STUDY STATS", "学习统计", "每日评分、练习与连续学习天数；数据保存在本浏览器，可用“备份与导出”迁移。")}<StatsView subject={subject} subjectLabel={subjects.find((item) => item.id === subject)?.name || subject} books={books} done={done} due={due} activities={todayActivities(localStorageStore, subject)} learnedCards={Object.keys(review.progress.cards || {}).length} totalCards={allCards.length} storage={localStorageStore} forecast={forecastLoad(allCards, review.progress, Date.now(), 14)}/></>}
          {view === "search" && <>{heading("GLOBAL SEARCH", "搜索全部闪卡", "跨科目搜索 3600+ 张闪卡，点击结果直达对应章节与卡片。")}{!searchEntries.length ? <div className="panel empty">正在汇总三科卡片索引…</div> : <SearchView entries={searchEntries} onJump={(entry) => jumpToCard(entry.id)}/>}</>}
          {view === "quiz" && subject === "825" && <>{heading("PAST PAPERS", "825 真题 · 开放题练习与索引", "按书目和年份筛选；真题已按章节归档（章节学习中可看本章真题卡），可文字作答并查看参考答案，不自动判分。")}<div className="past-filters"><label>书目<select value={book} onChange={(event) => { chooseChapter(event.target.value, 1, "quiz"); setPastYear(2026); }}><option value="linguistics">语言学</option><option value="literature">英美文学</option></select></label><label>年份<select value={activeYear || ""} onChange={(event) => { setPastYear(Number(event.target.value)); setPastIndex(0); setPastRevealed(false); }} disabled={!years.length}>{years.map((year) => <option key={year} value={year}>{year} 年</option>)}</select></label><button className={pastMode === "practice" ? "mode-button active" : "mode-button"} onClick={() => { setPastMode("practice"); setPastIndex(0); setPastRevealed(false); }}>可练习题 ({yearQuestions.filter((item) => item.practiceReady).length})</button><button className={pastMode === "index" ? "mode-button active" : "mode-button"} onClick={() => { setPastMode("index"); setPastIndex(0); setPastRevealed(false); }}>索引浏览 ({yearQuestions.filter((item) => !item.practiceReady).length})</button><button className={markedOnly825 ? "mode-button active" : "mode-button"} disabled={marked825.size === 0} onClick={() => { setMarkedOnly825(value => !value); setPastIndex(0); setPastRevealed(false); }}>只看标记题 ({marked825.size})</button></div><section className="panel quiz-card"><div className="past-question-heading"><div className="quiz-top"><span>{pastMode === "practice" ? "可练习真题" : "仅索引浏览"}</span><small>{pastPool.length ? "第 " + (pastPosition + 1) + " / " + pastPool.length + " 条" : "当前年份没有该类记录"}</small></div></div>{pastQuestion ? <><div className="question-meta"><span>{pastQuestion.year} 年</span><span>{questionType[pastQuestion.type] || "其他题型"} ({pastQuestion.type})</span><span>{statusLabel[pastQuestion.status]}</span></div><h2>{pastQuestion.stem}</h2>{pastMode === "practice" ? <><p className="not-scored">文字作答练习 · 不自动判分</p><label className="answer-label" htmlFor="past-answer">我的作答</label><textarea id="past-answer" ref={pastAnswerRef} className="past-answer" value={pastAnswer} onChange={(event) => setPastAnswer(event.target.value)} placeholder="组织答案；完成后可查看资料中的参考答案。"/><CopyAnswerButton text={pastAnswer} answerRef={pastAnswerRef}/><button className="primary reveal-button" onClick={() => setPastRevealed((value) => !value)}>{pastRevealed ? "收起参考信息" : "查看参考答案与解析"}</button>{pastRevealed && <div className="explanation past-explanation">{pastQuestion.referenceAnswer ? <><b>参考答案 · 非官方资料，仅供对照</b><p>{pastQuestion.referenceAnswer}</p></> : <><b>该题没有参考答案</b><p>当前资料没有可用参考答案；系统不会对你的文字作答评分。</p></>}{pastQuestion.analysis ? <><strong>解析</strong><p>{pastQuestion.analysis}</p></> : <p>当前记录没有单独的解析文本。</p>}{pastQuestion.answerSource && <small>答案来源：{pastQuestion.answerSource}</small>}</div>}</> : <div className="limitation-box"><b>索引浏览 · 不进入练习</b><p>{pastQuestion.limitation || "该记录未通过可练习校验，仅供目录和出处浏览。"}</p></div>}<div className="source-details"><p><b>来源状态：</b>{statusLabel[pastQuestion.status]}</p><p><b>原题来源：</b>{pastQuestion.source}</p><p><b>原 PDF：</b>{pastQuestion.sourceFile} · 第 {pastQuestion.sourcePage} 页</p></div><div className="mark-review-row"><button className={marked825.has(pastQuestion.id) ? "mode-button active" : "mode-button"} onClick={() => toggleMark825(pastQuestion.id)}>{marked825.has(pastQuestion.id) ? "已标记待复习 · 点击取消" : "标记待复习"}</button></div><div className="quiz-footer"><span>按书目和年份整理 · 真题已按章节归档，可在章节学习查看本章真题卡</span><button className="secondary" disabled={pastPosition === 0 || !pastPool.length} onClick={() => { setPastIndex((index) => Math.max(0, index % pastPool.length - 1)); setPastRevealed(false); }}>上一题</button><button className="primary" disabled={pastPool.length < 2} onClick={() => { setPastIndex((index) => (index + 1) % pastPool.length); setPastRevealed(false); }}>下一题</button></div></> : <div className="empty">当前年份没有记录，请切换年份或书目。</div>}</section></>}
          {view === "feynman" && <>{heading("TEACH IT BACK", subject === "825" ? "用自己的话讲清一个知识点" : "把知识讲给“别人”听", "可打字或使用浏览器语音转文字。DeepSeek 的评分和反馈仅是学习建议，不是标准答案。")}{picker}<div className="feynman-layout"><section className="panel speaking"><span className="eyebrow">CURRENT TOPIC</span><h2>{section || chapterName}</h2><p>{subject === "825" ? "AI 会参考当前书目中有限的相关笔记；可选择章节或小节。" : subject === "politics" ? "建议按“是什么 → 为什么 → 有哪些要点 → 易混点”讲述，可选择考点小节。尽量不照着闪卡念。" : "建议按“是什么 → 为什么 → 举一个课堂例子 → 易混点”讲述，可选择小节。尽量不用照着教材念。"}</p>{sectionHints.length > 0 && <div className="section-outline topic-hints"><strong>本节知识点（来自笔记卡，供复述自查）</strong>{sectionHints.map((item, index) => <div key={index}><span>{String(index + 1).padStart(2, "0")}</span>{item}</div>)}</div>}<SpeechInputControls key={JSON.stringify([subject, book, chapter, section])} language={speechLanguage} onLanguageChange={setSpeechLanguage} setAnswer={setAnswer} answerRef={answerRef}/></section><section className="panel writing"><label htmlFor="answer">我的复述</label><textarea id="answer" ref={answerRef} value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="例如：我会这样向同学解释这个概念……"/><div className="write-footer"><small>{answer.length} 字</small><CopyAnswerButton text={answer} answerRef={answerRef}/><button className="primary" disabled={!answer.trim() || loading} onClick={() => ask("feedback")}><Sparkles size={17}/>{loading ? "分析中…" : "让 DeepSeek 评分并反馈"}</button>{loading && <button className="secondary" onClick={cancelRequest}>取消生成</button>}</div>{feedback && <><div className="ai-caveat">AI 反馈是练习参考，不能替代教材或权威评分。</div><div className="ai-result"><b><Brain size={18}/> DeepSeek 反馈</b><p>{feedback}</p></div></>}</section></div></>}
          {view === "planner" && <>{heading("AI STUDY COACH", "为今天定一个可执行的计划", "DeepSeek 会结合当前科目、书目、章节和少量相关笔记规划；请补充可用时间与状态。")}<div className="planner-layout"><section className="panel planner"><div className="planner-title"><span><Sparkles size={21}/></span><div><h2>今天想怎么学？</h2><p>可以直接修改下面的问题，再发送给 DeepSeek。</p></div></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} aria-label="学习计划要求"/><div className="write-footer"><small>当前：{activeBook?.name} · 第 {chapter} 章{section ? " · " + section : ""}</small><button className="primary" disabled={loading || !prompt.trim()} onClick={() => ask("plan")}><Send size={17}/>{loading ? "生成中…" : "生成学习计划"}</button>{loading && <button className="secondary" onClick={cancelRequest}>取消生成</button>}</div>{reply && <><div className="ai-caveat">AI 生成内容仅作学习建议，不是标准答案或官方考试安排。</div><div className="ai-result"><b><Sparkles size={18}/> 今日计划</b><p>{reply}</p></div></>}</section><section className="panel context"><span className="eyebrow">CONTEXT</span><h2>计划会参考</h2><p><BookOpen size={18}/>当前科目与章节 <b>{activeBook?.name || "未选择"} · {chapterName || "未选择"}</b></p><p><Layers3 size={18}/>已学到期 <b>{due} 张</b></p><p><Layers3 size={18}/>今日新学 <b>{newToday} 张</b></p><p><Target size={18}/>目标初试 <b>2027 年 12 月</b></p><div className="tip">告诉 AI “今天只有 2 小时”“想重点整理浪漫主义”，计划会更贴合你。</div></section></div></>}
        </>}
      </div>
    </main>
    {backupOpen && <div className="backup-shade"><div ref={backupDialogRef} className="backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-title" aria-busy={backupBusy} tabIndex={-1} onKeyDown={backupKeys}><div className="backup-heading"><h2 id="backup-title">备份与导出</h2><button className="icon-button" disabled={backupBusy} aria-label="关闭备份与导出" onClick={closeBackup}><X size={20}/></button></div><Suspense fallback={<p role="status">正在打开备份工具…</p>}><BackupPanel blockedReason={backupBlockedReason} onBusyChange={setBackupBusy}/></Suspense></div></div>}
    {keyOpen && <ApiKeySettings apiKey={key} onCommit={(value) => { cancelRequest(); setKey(value); setKeyStorageError(""); }} onClose={() => setKeyOpen(false)}/>}
  </div>;
}
