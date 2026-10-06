import { useMemo, useState } from "react";
import { buildPracticeQuestions, firstAnswerClause, type PracticeQuestion } from "@/lib/practice-quiz";
import { recordMistake } from "@/lib/mistakes";
import { recordStat, type StatStore } from "@/lib/stats";

type Book = { id: string; name: string; chapters: { title: string }[] };
type Card = { id: string; book: string; chapter: number; section?: string; front: string; back: string };
type RequizEntry = { refId: string; wrongCount: number };

/** Four-choice self-quiz built from flashcards; reused by all three subjects.
 *  Requiz mode: when entries are provided, only cards matching those ids are used. */
export function PracticeView({ subject, subjectName, books, cards, bookId, chapter, storage, requizEntries, onRequizDone, onQuitRequiz }: {
  subject: string;
  subjectName: string;
  books: Book[];
  cards: Card[];
  bookId: string;
  chapter: number;
  storage: StatStore;
  requizEntries?: RequizEntry[];
  onRequizDone?: (removedIds: string[]) => void;
  onQuitRequiz?: () => void;
}) {
  const requiz = !!requizEntries?.length;
  const [scope, setScope] = useState<"chapter" | "book">("chapter");
  const [count, setCount] = useState(10);
  const [round, setRound] = useState<{ questions: PracticeQuestion[]; index: number; choice: number | null; right: number; done: boolean; wrongIds: string[]; meta: { bookId: string; bookName: string; chapter: number; scope: "chapter" | "book" } } | null>(null);

  const requizPool = useMemo(() => {
    if (!requiz) return [];
    const ids = new Set(requizEntries!.map(entry => entry.refId));
    return cards.filter(card => ids.has(card.id));
  }, [requiz, requizEntries, cards]);

  const available = useMemo(() => {
    if (requiz) return requizPool;
    const activeBook = books.find(item => item.id === bookId);
    return activeBook ? cards.filter(card => card.book === activeBook.id && (scope === "book" || card.chapter === chapter)) : [];
  }, [requiz, requizPool, books, cards, bookId, chapter, scope]);

  function start() {
    if (!available.length) return;
    let questions: PracticeQuestion[];
    if (requiz) {
      const byId = new Map(cards.map(card => [card.id, card]));
      // 干扰项借用同科目全部卡，正确项固定为错题卡
      questions = requizEntries!
        .map(entry => byId.get(entry.refId))
        .filter((card): card is Card => !!card)
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
      questions = buildPracticeQuestions(cards, { bookId, chapters: scope === "chapter" ? [chapter] : [], count, seed: Math.floor(Math.random() * 2 ** 31) });
    }
    setRound({
      questions, index: 0, choice: null, right: 0, done: false, wrongIds: [],
      meta: { bookId, bookName: activeBook?.name || subjectName, chapter, scope },
    });
  }
  function answer(index: number) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    const correct = index === question.answer;
    recordStat(storage, subject, { quiz: 1, quizCorrect: correct ? 1 : 0 });
    if (!correct) {
      recordMistake(subject, "practice", question.cardId, question.stem);
      setRound(previous => previous ? { ...previous, wrongIds: [...previous.wrongIds, question.cardId] } : previous);
    }
    setRound(previous => previous ? { ...previous, choice: index, right: previous.right + (correct ? 1 : 0) } : previous);
  }
  function next() {
    if (!round) return;
    if (round.index + 1 >= round.questions.length) {
      if (requiz) {
        const mastered = round.questions.map(question => question.cardId).filter(id => !round.wrongIds.includes(id));
        onRequizDone?.(mastered);
      }
      setRound({ ...round, done: true });
      return;
    }
    setRound({ ...round, index: round.index + 1, choice: null });
  }

  const activeBook = books.find(item => item.id === bookId);
  if (!round) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">SELF QUIZ</span><h2>{requiz ? "错题重练" : `${subjectName}选择题自测`}</h2></div></div>
    <p className="mock-help">{requiz
      ? `从错题本生成四选一：共 ${available.length} 张错题卡参与，答对的会自动移出错题本，答错的继续保留（并累计错误次数）。`
      : "题目由闪卡自动生成：题干来自考点提问，正确项是该卡的核心答案，干扰项取自同章其他考点。答错的题自动进入错题本。"}</p>
    {!requiz && <div className="practice-config">
      <label>书目<select value={activeBook?.id || ""} disabled><option>{activeBook?.name || "未选择"}</option></select></label>
      <label>范围<div className="mode-group"><button className={scope === "chapter" ? "mode-button active" : "mode-button"} onClick={() => setScope("chapter")}>当前章</button><button className={scope === "book" ? "mode-button active" : "mode-button"} onClick={() => setScope("book")}>整本书</button></div></label>
      <label>题数<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[10, 20, 30].map(n => <option key={n} value={n}>{n} 题</option>)}</select></label>
    </div>}
    <p className="mock-selection">当前范围可用卡片：{available.length} 张{!requiz && available.length < 4 ? " · 至少需要 4 张才能组卷" : ""}</p>
    <button className="primary" disabled={!available.length || (!requiz && available.length < 4)} onClick={start}>{requiz ? "开始重练" : "开始自测"}</button>
  </section>;

  const question = round.questions[round.index];
  const scopeChanged = !requiz && !round.done && (round.meta.bookId !== bookId || (round.meta.scope === "chapter" && round.meta.chapter !== chapter));
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
    <div className="quiz-top"><span>{requiz ? "错题重练" : `${subjectName}自测`} · {round.meta.bookName}{round.meta.scope === "chapter" ? ` 第${round.meta.chapter}章` : ""}</span><small>第 {round.index + 1} / {round.questions.length} 题</small></div>
    {scopeChanged && <div className="practice-scope-notice" role="status">命题范围已切换到“{activeBook?.name}{scope === "chapter" ? ` 第${chapter}章` : ""}”，当前试卷仍是 {round.meta.bookName}{round.meta.scope === "chapter" ? ` 第${round.meta.chapter}章` : ""} 的题目。<button type="button" className="text-button" onClick={start}>按新范围重新开始</button></div>}
    {question.hint && <small className="practice-hint">{question.hint}</small>}
    <h2>{question.stem}</h2>
    <div className="options">{question.options.map((item, index) => <button key={index} disabled={round.choice !== null} className={round.choice === null ? "" : index === question.answer ? "correct" : round.choice === index ? "wrong" : ""} onClick={() => answer(index)}><span>{"ABCD"[index]}</span>{item}</button>)}</div>
    {round.choice !== null && <div className="explanation"><b>{round.choice === question.answer ? "答对了" : "正确答案：" + "ABCD"[question.answer]}</b><p>对应闪卡：{cards.find(card => card.id === question.cardId)?.back.slice(0, 160) || question.source}</p></div>}
    <div className="quiz-footer"><span>本组 {round.right} / {round.index + (round.choice !== null ? 1 : 0)} 题正确</span><button className="primary" disabled={round.choice === null} onClick={next}>{round.index + 1 >= round.questions.length ? (requiz ? "完成重练" : "查看结果") : "下一题"}</button></div>
  </section>;
}
