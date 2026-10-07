import { useEffect, useMemo, useState } from "react";
import { choiceBookName, drillPool, drillRequizQuestions, fromSavedQuestion, loadChoiceBank, pickChoices, stripOptionLabel, toSavedQuestion, type ChoiceQuestion } from "@/lib/choice-bank";
import { clearPracticeRound, loadPracticeRound, savePracticeRound } from "@/lib/practice-draft";
import { recordMistake, removeMistakesByRef } from "@/lib/mistakes";
import { addMcqExcluded, readMcqExcluded, resetMcqExcluded } from "@/lib/mcq-excluded";
import { recordActivity } from "@/lib/activity";
import { recordStat, type StatStore } from "@/lib/stats";

type Round = { questions: ChoiceQuestion[]; index: number; choice: number | null; right: number; wrongIds: string[]; done: boolean; chosen: Record<number, number> };

/** 333 选择题练习: 真实题库(丹丹1000题/阶段测试/丹丹卷)按四书筛选, 交互式作答。
 *  错题重练模式(R4): 传入 requizIds(错题本里题库题的 refId), 用原题选项与解析重做。 */
export function ChoiceDrill({ storage, requizIds, onRequizDone, onQuitRequiz }: { storage: StatStore; requizIds?: string[]; onRequizDone?: (masteredIds: string[]) => void; onQuitRequiz?: () => void }) {
  const requiz = !!requizIds?.length;
  const [questions, setQuestions] = useState<ChoiceQuestion[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [book, setBook] = useState<"all" | ChoiceQuestion["book"]>("all");
  const [origin, setOrigin] = useState<"all" | string>("all");
  const [count, setCount] = useState(20);
  const [round, setRound] = useState<Round | null>(null);
  const [excluded, setExcluded] = useState(() => readMcqExcluded());
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [resumable, setResumable] = useState<ReturnType<typeof loadPracticeRound> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadChoiceBank().then(data => { if (!cancelled) setQuestions(data); }).catch(() => { if (!cancelled) setLoadError("选择题库加载失败，请刷新重试。"); });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    // R5: 未完成试卷(同科目)三天内可续做; 重练是即时模式不持久化
    if (!requiz) setResumable(loadPracticeRound("333", "practice"));
  }, [requiz]);

  const origins = useMemo(() => [...new Set((questions || []).map(q => q.origin))], [questions]);
  // R3: "可用N题"、抽题、再来一组共用同一个过滤掉人工排除项的最终池
  const pool = useMemo(() => (questions ? drillPool(questions, { book, origin }, excluded) : []), [questions, book, origin, excluded]);

  function persist(target: Round) {
    if (target.done || requiz) return;
    savePracticeRound({
      subject: "333",
      mode: "practice",
      meta: { bookId: book, bookName: "", chapter: 1, scope: "chapter", drill: { book, origin, count } },
      questions: target.questions.map(question => toSavedQuestion(question, question.id)),
      index: target.index,
      choice: target.choice,
      right: target.right,
      wrongIds: [...target.wrongIds],
      answers: Object.fromEntries(Object.entries(target.chosen).map(([key, value]) => [key, value])),
    });
  }
  function start(source?: readonly ChoiceQuestion[]) {
    const picked = requiz ? drillRequizQuestions(questions || [], requizIds || []) : pickChoices(source || pool, count, seed);
    if (!picked.length) return;
    const fresh: Round = { questions: picked, index: 0, choice: null, right: 0, wrongIds: [], done: false, chosen: {} };
    persist(fresh);
    setSeed(Math.floor(Math.random() * 2 ** 31));
    setResumable(null);
    setRound(fresh);
  }
  function resume() {
    if (!resumable) return;
    const restored = resumable.questions.map(fromSavedQuestion);
    if (resumable.meta.drill) {
      setBook(resumable.meta.drill.book as typeof book);
      setOrigin(resumable.meta.drill.origin);
      setCount(resumable.meta.drill.count);
    }
    const index = Math.min(resumable.index, restored.length - 1);
    setRound({
      questions: restored,
      index,
      choice: resumable.answers[String(index)] !== undefined ? resumable.answers[String(index)] : null,
      right: resumable.right,
      wrongIds: [...resumable.wrongIds],
      done: false,
      chosen: Object.fromEntries(Object.entries(resumable.answers).map(([key, value]) => [Number(key), value])),
    });
    setResumable(null);
  }
  function answer(index: number) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    const firstAttempt = round.chosen[round.index] === undefined;
    const correct = index === question.answer;
    // R6: 首次作答才写活动/统计/错题, 续做恢复的题不重复计
    if (firstAttempt) {
      recordActivity(storage, "333", "practice", question.stem, correct ? "答对" : "答错");
      recordStat(storage, "333", { quiz: 1, quizCorrect: correct ? 1 : 0 });
      recordStat(storage, "choice", { quiz: 1, quizCorrect: correct ? 1 : 0 });
      if (!correct) recordMistake("333", "practice", question.id, question.stem);
    }
    setRound(previous => {
      if (!previous) return previous;
      const wrongIds = correct ? previous.wrongIds : (previous.wrongIds.includes(question.id) ? previous.wrongIds : [...previous.wrongIds, question.id]);
      const next = { ...previous, choice: index, right: previous.right + (correct && firstAttempt ? 1 : 0), wrongIds, chosen: { ...previous.chosen, [previous.index]: index } };
      persist(next);
      return next;
    });
  }
  function next() {
    if (!round) return;
    if (round.index + 1 >= round.questions.length) {
      const done = { ...round, done: true };
      if (requiz) {
        const mastered = round.questions.map(question => question.id).filter(id => !round.wrongIds.includes(id));
        onRequizDone?.(mastered);
      } else clearPracticeRound("333", "practice");
      setRound(done);
      return;
    }
    const advanced = { ...round, index: round.index + 1, choice: null };
    persist(advanced);
    setRound(advanced);
  }

  if (loadError) return <section className="panel"><p className="error" role="alert">{loadError}</p></section>;
  if (!questions) return <section className="panel empty">正在载入选择题库…</section>;

  const excludedCount = questions.length - drillPool(questions, { book: "all", origin: "all" }, excluded).length;

  if (round?.done) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">RESULT</span><h2>本组正确率 {Math.round(100 * round.right / round.questions.length)}%</h2></div></div>
    <p className="mock-selection">{requiz
      ? `答对 ${round.right} / ${round.questions.length} 题 · 答对的已移出错题本，仍错的 ${round.wrongIds.length} 题继续保留`
      : `答对 ${round.right} / ${round.questions.length} 题 · 错题已记入错题本`}</p>
    <div className="next-actions">{requiz
      ? <button className="secondary" onClick={() => { setRound(null); onQuitRequiz?.(); }}>返回错题本</button>
      : <><button className="primary" onClick={() => start()}>再来一组</button><button className="secondary" onClick={() => setRound(null)}>调整范围</button></>}</div>
  </section>;

  if (round) {
    const question = round.questions[round.index];
    const analysis = question.optionAnalysis.filter(Boolean);
    return <section className="panel quiz-card">
      <div className="quiz-top"><span>选择题 · {question.bookName}{question.examTag ? ` · ${question.examTag}` : ` · ${question.origin}`}</span><small>第 {round.index + 1} / {round.questions.length} 题</small></div>
      {question.chapter && <small className="practice-hint">{question.chapter}</small>}
      <h2>{question.stem}</h2>
      <div className="options">{question.options.map((item, index) => <button key={index} disabled={round.choice !== null} className={round.choice === null ? "" : index === question.answer ? "correct" : round.choice === index ? "wrong" : ""} onClick={() => answer(index)}><span>{"ABCD"[index]}</span>{stripOptionLabel(item)}</button>)}</div>
      {round.choice !== null && <div className="explanation"><b>{round.choice === question.answer ? "答对了" : "正确答案：" + "ABCD"[question.answer]}</b>
        {analysis.length > 0
          ? <p>{analysis.map((line, i) => <span key={i}>{line}<br /></span>)}</p>
          : question.referenceAnswer
            ? <p>{question.referenceAnswer}</p>
            : <p>此题暂无逐项解析。</p>}
        <small>来源：{question.source}</small>
        <div className="practice-meta-actions"><button type="button" className={excluded.has(question.id) ? "mode-button active" : "mode-button"} onClick={() => setExcluded(addMcqExcluded(question.id))}>{excluded.has(question.id) ? "已排除出自动组卷" : "不适合选择题，排除出自动组卷"}</button></div>
      </div>}
      <div className="quiz-footer"><span>本组 {round.right} / {round.index + (round.choice !== null ? 1 : 0)} 题正确</span><button className="primary" disabled={round.choice === null} onClick={next}>{round.index + 1 >= round.questions.length ? (requiz ? "完成重练" : "查看结果") : "下一题"}</button></div>
    </section>;
  }

  if (requiz) return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">REQUIZ</span><h2>选择题错题重练</h2></div></div>
    <p className="mock-help">从错题本取回原题（原选项与逐项辨析）：共 {(drillRequizQuestions(questions, requizIds || [])).length} 题参与，答对的会自动移出错题本，答错的继续保留（并累计错误次数）。</p>
    <button className="primary" disabled={!drillRequizQuestions(questions, requizIds || []).length} onClick={() => start()}>开始重练</button>
  </section>;

  return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">CHOICE DRILL</span><h2>选择题练习</h2></div></div>
    <p className="mock-help">真实题库精选：丹丹1000题（含历年311真题典例）、阶段测试卷与丹丹中秋国庆卷，共 {questions.length} 题。逐选项辨析随答案展示；答错自动进入错题本，可续做未完成的题组。</p>
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
    <p className="mock-selection">当前范围可用：{pool.length} 题{excludedCount > 0 ? `（已排除 ${excludedCount} 题，不参与组卷）` : ""}</p>
    {excludedCount > 0 && <p className="mock-selection"><button type="button" className="text-button" onClick={() => setExcluded(resetMcqExcluded())}>恢复全部已排除（{excludedCount}）</button></p>}
    {resumable && <div className="practice-resume" role="status">
      <span>有一组未完成练习（{resumable.questions.length} 题 · 第 {resumable.index + 1} 题 · 已答对 {resumable.right} 题）。</span>
      <div className="next-actions">
        <button className="primary" onClick={resume}>继续作答</button>
        <button className="secondary" onClick={() => { clearPracticeRound("333", "practice"); setResumable(null); }}>放弃</button>
      </div>
    </div>}
    <button className="primary" disabled={!pool.length} onClick={() => start()}>开始练习</button>
  </section>;
}
