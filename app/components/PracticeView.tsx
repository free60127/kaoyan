import { useEffect, useMemo, useState } from "react";
import { buildPracticeQuestions, firstAnswerClause, isMcqSuitable, type PracticeQuestion } from "@/lib/practice-quiz";
import { recordMistake } from "@/lib/mistakes";
import { recordStat, type StatStore } from "@/lib/stats";
import { recordActivity } from "@/lib/activity";
import { clearPracticeRound, loadPracticeRound, savePracticeRound } from "@/lib/practice-draft";
import { addMcqExcluded, readMcqExcluded } from "@/lib/mcq-excluded";
import { setMcqExcluded } from "@/lib/practice-quiz";
import { stripHighlightMarkers } from "@/lib/highlight-markers";

type Book = { id: string; name: string; chapters: { title: string }[] };
type Card = { id: string; book: string; chapter: number; section?: string; front: string; back: string };
type RequizEntry = { refId: string; wrongCount: number };

/** Four-choice self-quiz built from flashcards; reused by all three subjects.
 *  Requiz mode: when entries are provided, only cards matching those ids are used. */
export function PracticeView({ subject, subjectName, books, cards, bookId, chapter, section, storage, requizEntries, onRequizDone, onQuitRequiz }: {
  subject: string;
  subjectName: string;
  books: Book[];
  cards: Card[];
  bookId: string;
  chapter: number;
  section?: string;
  storage: StatStore;
  requizEntries?: RequizEntry[];
  onRequizDone?: (removedIds: string[]) => void;
  onQuitRequiz?: () => void;
}) {
  const requiz = !!requizEntries?.length;
  const [scope, setScope] = useState<"section" | "chapter" | "book">("chapter");
  const [count, setCount] = useState(10);
  const [round, setRound] = useState<{ questions: PracticeQuestion[]; index: number; choice: number | null; right: number; done: boolean; wrongIds: string[]; chosenByIndex: Record<number, number>; meta: { bookId: string; bookName: string; chapter: number; scope: "section" | "chapter" | "book"; section?: string } } | null>(null);
  const [resumable, setResumable] = useState<ReturnType<typeof loadPracticeRound> | null>(null);
  const [excluded, setExcluded] = useState(() => readMcqExcluded());
  useEffect(() => { setMcqExcluded(excluded); }, [excluded]);
  useEffect(() => {
    // 同科目同模式的三天内未完成试卷可续做; 换科目自动失效
    setResumable(loadPracticeRound(subject, requiz ? "requiz" : "practice"));
  }, [subject, requiz]);

  const requizPool = useMemo(() => {
    if (!requiz) return [];
    const ids = new Set(requizEntries!.map(entry => entry.refId));
    // 重练与普通自测共用题目资格规则: 不适合选择题形态的卡不进卷(错题本里保留, 走闪卡复习)
    return cards.filter(card => ids.has(card.id) && isMcqSuitable(card.front));
  }, [requiz, requizEntries, cards]);

  const available = useMemo(() => {
    if (requiz) return requizPool.filter(card => !excluded.has(card.id));
    const activeBook = books.find(item => item.id === bookId);
    // R7: 小节范围真实过滤——选了小节就只出该小节的卡, 不再静默回退到整章
    const inScope = (card: Card) => scope === "book"
      ? true
      : scope === "section"
        ? card.chapter === chapter && card.section === section
        : card.chapter === chapter;
    return activeBook ? cards.filter(card => card.book === activeBook.id && !excluded.has(card.id) && inScope(card)) : [];
  }, [requiz, requizPool, books, cards, bookId, chapter, section, scope, excluded]);


  function start() {
    if (!available.length) return;
    let questions: PracticeQuestion[];
    if (requiz) {
      const byId = new Map(cards.map(card => [card.id, card]));
      // 与"可用N张"一致: 从过滤后的合格池出题(不适合选择题形态的卡已排除)
      questions = available
        .slice(0, Math.max(count, 5))
        .map(card => {
          const hintMatch = card.front.match(/^〔(.+?)〕/);
          const correct = firstAnswerClause(card.back);
          const source = cards
            .filter(other => other.book === card.book && other.id !== card.id)
            .map(other => firstAnswerClause(other.back))
            .filter(text => text && text !== correct);
          const picks: string[] = [];
          for (let i = source.length - 1; i > 0 && picks.length < 3; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [source[i], source[j]] = [source[j], source[i]];
          }
          for (const candidate of source) {
            if (picks.length >= 3) break;
            if (!picks.includes(candidate)) picks.push(candidate);
          }
          const options = [correct, ...picks];
          for (let i = options.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [options[i], options[j]] = [options[j], options[i]];
          }
          return { cardId: card.id, stem: card.front.replace(/^〔.+?〕\s*/, ""), hint: hintMatch ? hintMatch[1].slice(0, 30) : "", options, answer: options.indexOf(correct), source: `${subjectName} · 错题重练` };
        });
    } else {
      // 与 available 计数同一资格规则(含人工排除标记), 保证"可用N题"与实际组卷一致
      questions = buildPracticeQuestions(available, { bookId, chapters: [], count, seed: Math.floor(Math.random() * 2 ** 31) });
    }
    const initial = {
      questions, index: 0, choice: null as number | null, right: 0, done: false, wrongIds: [] as string[], chosenByIndex: {} as Record<number, number>,
      meta: { bookId, bookName: activeBook?.name || subjectName, chapter, scope, ...(scope === "section" && section ? { section } : {}) },
    };
    savePracticeRound({
      subject, mode: requiz ? "requiz" : "practice", meta: initial.meta, questions,
      index: 0, choice: null, right: 0, wrongIds: [], answers: {},
    });
    setResumable(null);
    setRound(initial);
  }
  function answer(index: number) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    const firstAttempt = round.chosenByIndex[round.index] === undefined;
    const correct = index === question.answer;
    recordActivity(storage, subject, "practice", question.stem, correct ? "答对" : "答错");
    // 只在首次作答时计分/记错题: 续做恢复的题不会重复计分
    if (firstAttempt) {
      recordStat(storage, subject, { quiz: 1, quizCorrect: correct ? 1 : 0 });
      if (!correct) recordMistake(subject, "practice", question.cardId, question.stem);
    }
    setRound(previous => {
      if (!previous) return previous;
      // 答对永不进入错题集合(即使这道题是续做恢复前答过的); 答错只补记一次
      const wrongIds = correct
        ? previous.wrongIds
        : (previous.wrongIds.includes(question.cardId) ? previous.wrongIds : [...previous.wrongIds, question.cardId]);
      const nextRound = { ...previous, wrongIds, choice: index, right: previous.right + (correct && firstAttempt ? 1 : 0), chosenByIndex: { ...previous.chosenByIndex, [previous.index]: index } };
      persistRound(nextRound);
      return nextRound;
    });
  }
  function persistRound(target: NonNullable<typeof round>) {
    if (target.done) return;
    savePracticeRound({
      subject, mode: requiz ? "requiz" : "practice",
      meta: target.meta,
      questions: target.questions,
      index: target.index,
      choice: target.choice,
      right: target.right,
      wrongIds: target.wrongIds,
      answers: Object.fromEntries(Object.entries(target.chosenByIndex).map(([key, value]) => [key, value])),
    });
  }
  function next() {
    if (!round) return;
    if (round.index + 1 >= round.questions.length) {
      if (requiz) {
        const mastered = round.questions.map(question => question.cardId).filter(id => !round.wrongIds.includes(id));
        onRequizDone?.(mastered);
      }
      clearPracticeRound(subject, requiz ? "requiz" : "practice");
      setRound({ ...round, done: true });
      return;
    }
    const advanced = { ...round, index: round.index + 1, choice: null };
    persistRound(advanced);
    setRound(advanced);
  }

  const activeBook = books.find(item => item.id === bookId);
  if (!round) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">SELF QUIZ</span><h2>{requiz ? "错题重练" : `${subjectName}选择题自测`}</h2></div></div>
    <p className="mock-help">{requiz
      ? `从错题本生成四选一：共 ${available.length} 张错题卡参与，答对的会自动移出错题本，答错的继续保留（并累计错误次数）。`
      : "题目由闪卡自动生成：题干来自考点提问，正确项是该卡的核心答案，干扰项取自同章其他考点。答错的题自动进入错题本。"}</p>
    {!requiz && <div className="practice-config">
      <label>书目<select value={activeBook?.id || ""} disabled><option>{activeBook?.name || "未选择"}</option></select></label>
      <label>范围<div className="mode-group">{section && <button className={scope === "section" ? "mode-button active" : "mode-button"} onClick={() => setScope("section")}>当前小节</button>}<button className={scope === "chapter" ? "mode-button active" : "mode-button"} onClick={() => setScope("chapter")}>当前章</button><button className={scope === "book" ? "mode-button active" : "mode-button"} onClick={() => setScope("book")}>整本书</button></div></label>
      <label>题数<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[10, 20, 30].map(n => <option key={n} value={n}>{n} 题</option>)}</select></label>
    </div>}
    <p className="mock-selection">当前范围可用卡片：{available.length} 张{!requiz && available.length < 4 ? " · 至少需要 4 张才能组卷" : ""}</p>
    {resumable && <div className="practice-resume" role="status">
      <span>有一组未完成{resumable.mode === "requiz" ? "重练" : "自测"}（{resumable.meta.bookName || subjectName}{resumable.meta.scope === "chapter" ? ` 第${resumable.meta.chapter}章` : ""} · 第 {resumable.index + 1} / {resumable.questions.length} 题 · 已答对 {resumable.right} 题）。</span>
      <div className="next-actions">
        <button className="primary" onClick={() => {
          const byId = new Map(cards.map(card => [card.id, card]));
          // 卡库中已找不到的卡(数据更新后)剔除; 全部失效则放弃续做
          const questions = resumable.questions.filter(q => byId.has(q.cardId));
          if (!questions.length) { clearPracticeRound(subject, requiz ? "requiz" : "practice"); setResumable(null); return; }
          const chosenByIndex = Object.fromEntries(Object.entries(resumable.answers).map(([k, v]) => [Number(k), v]));
          const resumeIndex = Math.min(resumable.index, questions.length - 1);
          setRound({
            questions, index: resumeIndex,
            // 恢复当前题的已选状态: 该题若已作答过, 选项显示原选择与判定, 且不可重选(计分已在首次作答时完成)
            choice: chosenByIndex[resumeIndex] !== undefined ? chosenByIndex[resumeIndex] : null,
            right: resumable.right, done: false,
            wrongIds: [...resumable.wrongIds], chosenByIndex,
            meta: resumable.meta,
          });
          setResumable(null);
        }}>继续作答</button>
        <button className="secondary" onClick={() => { clearPracticeRound(subject, requiz ? "requiz" : "practice"); setResumable(null); }}>放弃</button>
      </div>
    </div>}
    <button className="primary" disabled={!available.length || (!requiz && available.length < 4)} onClick={start}>{requiz ? "开始重练" : "开始自测"}</button>
  </section>;

  const question = round.questions[round.index];
  const scopeChanged = !requiz && !round.done && (round.meta.bookId !== bookId
    || (round.meta.scope === "chapter" && round.meta.chapter !== chapter)
    || (round.meta.scope === "section" && (round.meta.chapter !== chapter || round.meta.section !== section)));
  if (round.done) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">RESULT</span><h2>本组正确率 {Math.round(100 * round.right / round.questions.length)}%</h2></div></div>
    <p className="mock-selection">{requiz
      ? `答对 ${round.right} / ${round.questions.length} 题 · 答对的已移出错题本，仍错的 ${round.wrongIds.length} 题继续保留`
      : `答对 ${round.right} / ${round.questions.length} 题 · 错题已记入错题本`}</p>
    <div className="practice-result">
      {round.questions.map((item, index) => <div key={item.cardId} className="mistake-row"><div className="mistake-info"><small>第 {index + 1} 题</small><b>{item.stem}</b></div></div>)}
    </div>
    <div className="next-actions"><button className="primary" onClick={start}>{requiz ? "再练一轮" : "再来一组"}</button><button className="secondary" onClick={() => { setRound(null); if (requiz) onQuitRequiz?.(); }}>{requiz ? "返回错题本" : "调整设置"}</button></div>
  </section>;

  return <section className="panel quiz-card">
    <div className="quiz-top"><span>{requiz ? "错题重练" : `${subjectName}自测`} · {round.meta.bookName}{round.meta.scope === "section" ? ` 第${round.meta.chapter}章${round.meta.section ? " · " + round.meta.section : ""}` : round.meta.scope === "chapter" ? ` 第${round.meta.chapter}章` : ""}</span><small>第 {round.index + 1} / {round.questions.length} 题</small></div>
    {scopeChanged && <div className="practice-scope-notice" role="status">命题范围已切换到“{activeBook?.name}{scope === "section" ? ` 第${chapter}章${section ? " · " + section : ""}` : scope === "chapter" ? ` 第${chapter}章` : ""}”，当前试卷仍是 {round.meta.bookName} 的题目。<button type="button" className="text-button" onClick={start}>按新范围重新开始</button></div>}
    {question.hint && <small className="practice-hint">{question.hint}</small>}
    <h2>{question.stem}</h2>
    <div className="options">{question.options.map((item, index) => <button key={index} disabled={round.choice !== null} className={round.choice === null ? "" : index === question.answer ? "correct" : round.choice === index ? "wrong" : ""} onClick={() => answer(index)}><span>{"ABCD"[index]}</span>{item}</button>)}</div>
    {round.choice !== null && <div className="explanation"><b>{round.choice === question.answer ? "答对了" : "正确答案：" + "ABCD"[question.answer]}</b><p>对应闪卡：{stripHighlightMarkers(cards.find(card => card.id === question.cardId)?.back || "").slice(0, 160) || question.source}</p><div className="practice-meta-actions"><button type="button" className={excluded.has(question.cardId) ? "mode-button active" : "mode-button"} onClick={() => setExcluded(addMcqExcluded(question.cardId))}>{excluded.has(question.cardId) ? "已排除出自动组卷" : "不适合选择题，排除出自动组卷"}</button></div></div>}
    <div className="quiz-footer"><span>本组 {round.right} / {round.index + (round.choice !== null ? 1 : 0)} 题正确</span><button className="primary" disabled={round.choice === null} onClick={next}>{round.index + 1 >= round.questions.length ? (requiz ? "完成重练" : "查看结果") : "下一题"}</button></div>
  </section>;
}
