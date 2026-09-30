import { useMemo, useState } from "react";
import { buildPracticeQuestions, type PracticeQuestion } from "@/lib/practice-quiz";
import { recordMistake } from "@/lib/mistakes";
import { recordStat, type StatStore } from "@/lib/stats";

type Book = { id: string; name: string; chapters: { title: string }[] };
type Card = { id: string; book: string; chapter: number; front: string; back: string };

export function PoliticsPractice({ books, cards, bookId, chapter, storage }: { books: Book[]; cards: Card[]; bookId: string; chapter: number; storage: StatStore }) {
  const [scope, setScope] = useState<"chapter" | "book">("chapter");
  const [count, setCount] = useState(10);
  const [round, setRound] = useState<{ questions: PracticeQuestion[]; index: number; choice: number | null; right: number; done: boolean } | null>(null);
  const activeBook = books.find((item) => item.id === bookId) || books[0];
  const available = useMemo(() => (activeBook ? cards.filter((card) => card.book === activeBook.id && (scope === "book" || card.chapter === chapter)) : []), [activeBook, cards, chapter, scope]);

  function start() {
    if (!activeBook || !available.length) return;
    const questions = buildPracticeQuestions(cards, { bookId: activeBook.id, chapters: scope === "chapter" ? [chapter] : [], count, seed: Math.floor(Math.random() * 2 ** 31) });
    setRound({ questions, index: 0, choice: null, right: 0, done: false });
  }
  function answer(index: number) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    const correct = index === question.answer;
    recordStat(storage, "politics", { quiz: 1, quizCorrect: correct ? 1 : 0 });
    if (!correct) recordMistake("politics", "practice", question.cardId, question.stem);
    setRound({ ...round, choice: index, right: round.right + (correct ? 1 : 0) });
  }
  function next() {
    if (!round) return;
    if (round.index + 1 >= round.questions.length) { setRound({ ...round, done: true }); return; }
    setRound({ ...round, index: round.index + 1, choice: null });
  }

  if (!round) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">SELF QUIZ</span><h2>政治选择题自测</h2></div></div>
    <p className="mock-help">题目由政治闪卡自动生成：题干来自考点提问，正确项是该卡的核心答案，干扰项取自同章其他考点。答错的题自动进入错题本。</p>
    <div className="practice-config">
      <label>书目<select value={activeBook?.id || ""} disabled><option>{activeBook?.name || "未选择"}</option></select></label>
      <label>范围<div className="mode-group"><button className={scope === "chapter" ? "mode-button active" : "mode-button"} onClick={() => setScope("chapter")}>当前章</button><button className={scope === "book" ? "mode-button active" : "mode-button"} onClick={() => setScope("book")}>整本书</button></div></label>
      <label>题数<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[10, 20, 30].map((n) => <option key={n} value={n}>{n} 题</option>)}</select></label>
    </div>
    <p className="mock-selection">当前范围可用卡片：{available.length} 张{available.length < 4 ? " · 至少需要 4 张才能组卷" : ""}</p>
    <button className="primary" disabled={available.length < 4} onClick={start}>开始自测</button>
  </section>;

  const question = round.questions[round.index];
  if (round.done) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">RESULT</span><h2>本组正确率 {Math.round(100 * round.right / round.questions.length)}%</h2></div></div>
    <p className="mock-selection">答对 {round.right} / {round.questions.length} 题 · 错题已记入错题本</p>
    <div className="practice-result">
      {round.questions.map((item, index) => <div key={item.cardId} className="mistake-row"><div className="mistake-info"><small>第 {index + 1} 题</small><b>{item.stem}</b></div></div>)}
    </div>
    <div className="next-actions"><button className="primary" onClick={start}>再来一组</button><button className="secondary" onClick={() => setRound(null)}>调整设置</button></div>
  </section>;

  return <section className="panel quiz-card">
    <div className="quiz-top"><span>政治自测 · {activeBook?.name}</span><small>第 {round.index + 1} / {round.questions.length} 题</small></div>
    {question.hint && <small className="practice-hint">{question.hint}</small>}
    <h2>{question.stem}</h2>
    <div className="options">{question.options.map((item, index) => <button key={index} disabled={round.choice !== null} className={round.choice === null ? "" : index === question.answer ? "correct" : round.choice === index ? "wrong" : ""} onClick={() => answer(index)}><span>{"ABCD"[index]}</span>{item}</button>)}</div>
    {round.choice !== null && <div className="explanation"><b>{round.choice === question.answer ? "答对了" : "正确答案：" + "ABCD"[question.answer]}</b><p>对应闪卡：{cards.find((card) => card.id === question.cardId)?.back.slice(0, 160) || question.source}</p></div>}
    <div className="quiz-footer"><span>本组 {round.right} / {round.index + (round.choice !== null ? 1 : 0)} 题正确</span><button className="primary" disabled={round.choice === null} onClick={next}>{round.index + 1 >= round.questions.length ? "查看结果" : "下一题"}</button></div>
  </section>;
}
