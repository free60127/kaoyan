import { useEffect, useMemo, useState } from "react";
import { loadChoiceBank, pickChoices, choiceBookName, type ChoiceQuestion } from "@/lib/choice-bank";
import { recordMistake } from "@/lib/mistakes";
import { addMcqExcluded, readMcqExcluded } from "@/lib/mcq-excluded";
import { recordStat, type StatStore } from "@/lib/stats";

/** 333 选择题练习: 真实题库(丹丹1000题/阶段测试/丹丹卷)按四书筛选, 交互式作答。 */
export function ChoiceDrill({ storage, onNeedKey }: { storage: StatStore; onNeedKey?: () => void }) {
  const [questions, setQuestions] = useState<ChoiceQuestion[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [book, setBook] = useState<"all" | ChoiceQuestion["book"]>("all");
  const [origin, setOrigin] = useState<"all" | string>("all");
  const [round, setRound] = useState<{ questions: ChoiceQuestion[]; index: number; choice: number | null; right: number; wrongIds: string[]; done: boolean; chosen: Record<number, number> } | null>(null);
  const [excluded, setExcluded] = useState(() => readMcqExcluded());
  const [count, setCount] = useState(20);
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));

  useEffect(() => {
    let cancelled = false;
    loadChoiceBank().then(data => { if (!cancelled) setQuestions(data); }).catch(() => { if (!cancelled) setLoadError("选择题库加载失败，请刷新重试。"); });
    return () => { cancelled = true; };
  }, []);

  const origins = useMemo(() => [...new Set((questions || []).map(q => q.origin))], [questions]);
  const pool = useMemo(() => (questions || []).filter(q => (book === "all" || q.book === book) && (origin === "all" || q.origin === origin)), [questions, book, origin]);

  function start() {
    const picked = pickChoices(pool, count, seed);
    if (!picked.length) return;
    setRound({ questions: picked, index: 0, choice: null, right: 0, wrongIds: [], done: false, chosen: {} });
    setSeed(Math.floor(Math.random() * 2 ** 31));
  }
  function answer(index: number) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    const correct = index === question.answer;
    recordStat(storage, "333", { quiz: 1, quizCorrect: correct ? 1 : 0 });
    recordStat(storage, "choice", { quiz: 1, quizCorrect: correct ? 1 : 0 });
    if (!correct) recordMistake("333", "practice", question.id, question.stem);
    setRound(previous => previous ? { ...previous, choice: index, right: previous.right + (correct ? 1 : 0), wrongIds: correct ? previous.wrongIds : [...previous.wrongIds, question.id], chosen: { ...previous.chosen, [previous.index]: index } } : previous);
  }
  function next() {
    if (!round) return;
    if (round.index + 1 >= round.questions.length) { setRound({ ...round, done: true }); return; }
    setRound({ ...round, index: round.index + 1, choice: null });
  }

  if (loadError) return <section className="panel"><p className="error" role="alert">{loadError}</p></section>;
  if (!questions) return <section className="panel empty">正在载入选择题库…</section>;

  if (round?.done) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">RESULT</span><h2>本组正确率 {Math.round(100 * round.right / round.questions.length)}%</h2></div></div>
    <p className="mock-selection">答对 {round.right} / {round.questions.length} 题 · 错题已记入错题本</p>
    <div className="next-actions"><button className="primary" onClick={start}>再来一组</button><button className="secondary" onClick={() => setRound(null)}>调整范围</button></div>
  </section>;

  if (round) {
    const question = round.questions[round.index];
    const analysis = question.optionAnalysis.filter(Boolean);
    return <section className="panel quiz-card">
      <div className="quiz-top"><span>选择题 · {question.bookName}{question.examTag ? ` · ${question.examTag}` : ` · ${question.origin}`}</span><small>第 {round.index + 1} / {round.questions.length} 题</small></div>
      {question.chapter && <small className="practice-hint">{question.chapter}</small>}
      <h2>{question.stem}</h2>
      <div className="options">{question.options.map((item, index) => <button key={index} disabled={round.choice !== null} className={round.choice === null ? "" : index === question.answer ? "correct" : round.choice === index ? "wrong" : ""} onClick={() => answer(index)}><span>{"ABCD"[index]}</span>{item}</button>)}</div>
      {round.choice !== null && <div className="explanation"><b>{round.choice === question.answer ? "答对了" : "正确答案：" + "ABCD"[question.answer]}</b>
        {analysis.length > 0 ? <p>{analysis.map((line, i) => <span key={i}>{line}<br /></span>)}</p> : question.referenceAnswer ? <p>{question.referenceAnswer.slice(0, 300)}</p> : null}
        <div className="practice-meta-actions"><button type="button" className={excluded.has(question.id) ? "mode-button active" : "mode-button"} onClick={() => setExcluded(addMcqExcluded(question.id))}>{excluded.has(question.id) ? "已排除出自动组卷" : "不适合选择题，排除出自动组卷"}</button></div>
      </div>}
      <div className="quiz-footer"><span>本组 {round.right} / {round.index + (round.choice !== null ? 1 : 0)} 题正确</span><button className="primary" disabled={round.choice === null} onClick={next}>{round.index + 1 >= round.questions.length ? "查看结果" : "下一题"}</button></div>
    </section>;
  }

  return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">CHOICE DRILL</span><h2>选择题练习</h2></div></div>
    <p className="mock-help">真实题库精选：丹丹1000题（含历年311真题典例）、阶段测试卷与丹丹中秋国庆卷，共 {questions.length} 题。逐选项辨析随答案展示；答错自动进入错题本。</p>
    <div className="practice-config">
      <label>书目<select value={book} onChange={(event) => setBook(event.target.value as typeof book)}>
        <option value="all">四书全部</option>
        {Object.entries(choiceBookName).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>来源<select value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option value="all">全部来源</option>
        {origins.map(o => <option key={o} value={o}>{o}</option>)}
      </select></label>
      <label>题数<select value={count} onChange={(event) => setCount(Number(event.target.value))}>{[10, 20, 30, 50].map(n => <option key={n} value={n}>{n} 题</option>)}</select></label>
    </div>
    <p className="mock-selection">当前范围可用：{pool.length} 题</p>
    <button className="primary" disabled={!pool.length} onClick={start}>开始练习</button>
  </section>;
}
