import { useEffect, useMemo, useState } from "react";
import { choiceBookName, choiceIsCorrect, drillPool, drillRequizQuestions, fromSavedQuestion, loadChoiceBank, loadPoliticsChoiceBank, pickChoices, politicsChoiceBookName, shuffleOptions, stripOptionLabel, toSavedQuestion, type ChoiceQuestion } from "@/lib/choice-bank";
import { clearPracticeRound, loadPracticeRound, savePracticeRound } from "@/lib/practice-draft";
import { recordMistake } from "@/lib/mistakes";
import { readMcqExcluded, resetMcqExcluded } from "@/lib/mcq-excluded";
import { recordActivity } from "@/lib/activity";
import { recordStat, type StatStore } from "@/lib/stats";

type Round = { questions: ChoiceQuestion[]; index: number; choice: number | null; right: number; wrongIds: string[]; done: boolean; chosen: Record<number, number | number[]> };

/** 选择题练习: 333=丹丹1000题/阶段测试/丹丹卷, 政治=肖1000题(含考研多选)。
 *  按书/来源/章筛选, 交互式作答, 错题重练(R4)与每日一练(F2)。题数支持自定义(F)。 */
export function ChoiceDrill({ subject, storage, requizIds, onRequizDone, onQuitRequiz }: { subject: "333" | "politics"; storage: StatStore; requizIds?: string[]; onRequizDone?: (masteredIds: string[]) => void; onQuitRequiz?: () => void }) {
  const requiz = !!requizIds?.length;
  const [questions, setQuestions] = useState<ChoiceQuestion[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [book, setBook] = useState<"all" | string>("all");
  const [origin, setOrigin] = useState<"all" | string>("all");
  const [countDraft, setCountDraft] = useState("20");
  const count = Math.max(1, Math.min(100, Math.floor(Number(countDraft) || 0) || 20));
  const [round, setRound] = useState<Round | null>(null);
  // 多选: 勾选暂存, 确认后进入 chosen
  const [multiPicks, setMultiPicks] = useState<number[]>([]);
  const [excluded, setExcluded] = useState(() => readMcqExcluded(subject));
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  // C: 按章筛选(题库 chapter 字段为章名标签); D: 打乱选项(防背选项位置), 持久化
  const [chapter, setChapter] = useState<string>("all");
  const [shuffle, setShuffle] = useState(() => { try { return localStorage.getItem("yantu-shuffle-options-v1") === "1"; } catch { return false; } });
  function setShufflePersisted(value: boolean) {
    setShuffle(value);
    try { localStorage.setItem("yantu-shuffle-options-v1", value ? "1" : "0"); } catch { /* ignore */ }
  }
  const [resumable, setResumable] = useState<ReturnType<typeof loadPracticeRound> | null>(null);
  // F2: 概览"每日一练"按钮 → sessionStorage 标记, 题库就绪后自动开考
  const [pendingDaily, setPendingDaily] = useState(() => { try { return sessionStorage.getItem("yantu-daily-autostart") === "1"; } catch { return false; } });
  // B06: 续做保存失败(存储空间不足)时明示, 不再静默丢进度
  const [saveWarn, setSaveWarn] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (subject === "politics" ? loadPoliticsChoiceBank() : loadChoiceBank()).then(data => { if (!cancelled) setQuestions(data); }).catch(() => { if (!cancelled) setLoadError("选择题库加载失败，请刷新重试。"); });
    return () => { cancelled = true; };
  }, [subject]);
  useEffect(() => {
    // R5: 未完成试卷(同科目)三天内可续做; 重练是即时模式不持久化
    if (!requiz) setResumable(loadPracticeRound(subject, "practice"));
  }, [requiz, subject]);

  const bookNames: Record<string, string> = subject === "politics" ? politicsChoiceBookName : choiceBookName;
  const origins = useMemo(() => [...new Set((questions || []).map(q => q.origin))], [questions]);
  const chapterOptions = useMemo(() => [...new Set((questions || []).filter(q => book === "all" || q.book === book).map(q => q.chapter).filter(Boolean))], [questions, book]);
  // R3: "可用N题"、抽题、再来一组共用同一个过滤掉人工排除项的最终池
  const pool = useMemo(() => (questions ? drillPool(questions, { book, origin }, excluded).filter(q => chapter === "all" || q.chapter === chapter) : []), [questions, book, origin, excluded, chapter]);

  function persist(target: Round) {
    if (target.done || requiz) return;
    const saved = savePracticeRound({
      subject,
      mode: "practice",
      meta: { bookId: book, bookName: "", chapter: 1, scope: "chapter", drill: { book, origin, count } },
      questions: target.questions.map(question => toSavedQuestion(question, question.id)),
      index: target.index,
      choice: typeof target.choice === "number" ? target.choice : null,
      right: target.right,
      wrongIds: [...target.wrongIds],
      answers: Object.fromEntries(Object.entries(target.chosen).map(([key, value]) => [key, value])),
    });
    if (!saved) setSaveWarn(true);
  }
  function start(source?: readonly ChoiceQuestion[]) {
    const pickedRaw = requiz ? drillRequizQuestions(questions || [], requizIds || []) : pickChoices(source || pool, count, seed);
    const picked = shuffle && !requiz ? shuffleOptions(pickedRaw, seed ^ 0x9e3779b9) : pickedRaw;
    if (!picked.length) return;
    const fresh: Round = { questions: picked, index: 0, choice: null, right: 0, wrongIds: [], done: false, chosen: {} };
    persist(fresh);
    setSeed(Math.floor(Math.random() * 2 ** 31));
    setResumable(null);
    setMultiPicks([]);
    setRound(fresh);
  }
  function resume() {
    if (!resumable) return;
    const restored = resumable.questions.map(fromSavedQuestion);
    if (resumable.meta.drill) {
      setBook(resumable.meta.drill.book as typeof book);
      setOrigin(resumable.meta.drill.origin);
      setCountDraft(String(resumable.meta.drill.count));
    }
    const index = Math.min(resumable.index, restored.length - 1);
    const rawChoice = resumable.answers[String(index)];
    setRound({
      questions: restored,
      index,
      choice: rawChoice === undefined ? null : Array.isArray(rawChoice) ? -1 : rawChoice,
      right: resumable.right,
      wrongIds: [...resumable.wrongIds],
      done: false,
      chosen: Object.fromEntries(Object.entries(resumable.answers).map(([key, value]) => [Number(key), value])),
    });
    setResumable(null);
  }
  // F2: 每日一练——固定 20 题混合卷, 同一天用同一份题(种子=日期), 排除项不出现
  function startDaily() {
    const today = new Date();
    const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    let seed = 0;
    for (let i = 0; i < dayKey.length; i += 1) seed = (seed * 31 + dayKey.charCodeAt(i)) | 0;
    const poolAll = questions ? drillPool(questions, { book: "all", origin: "all" }, excluded) : [];
    const pickedRaw = pickChoices(poolAll, 20, Math.abs(seed));
    const picked = shuffleOptions(pickedRaw, Math.abs(seed) ^ 0x9e3779b9);
    if (!picked.length) return;
    const fresh: Round = { questions: picked, index: 0, choice: null, right: 0, wrongIds: [], done: false, chosen: {} };
    persist(fresh);
    setResumable(null);
    setMultiPicks([]);
    setRound(fresh);
  }
  useEffect(() => {
    if (!questions || !pendingDaily || round || requiz) return;
    try { sessionStorage.removeItem("yantu-daily-autostart"); } catch { /* ignore */ }
    setPendingDaily(false);
    startDaily();
  }, [questions, pendingDaily]);

  function settle(picked: number | number[]) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    const firstAttempt = round.chosen[round.index] === undefined;
    const correct = choiceIsCorrect(question, picked);
    // R6: 首次作答才写活动/统计/错题, 续做恢复的题不重复计
    if (firstAttempt) {
      recordActivity(storage, subject, "practice", question.stem, correct ? "答对" : "答错");
      recordStat(storage, subject, { quiz: 1, quizCorrect: correct ? 1 : 0 });
      recordStat(storage, "choice", { quiz: 1, quizCorrect: correct ? 1 : 0 });
      if (!correct) recordMistake(subject, "practice", question.id, question.stem);
    }
    setRound(previous => {
      if (!previous) return previous;
      const wrongIds = correct ? previous.wrongIds : (previous.wrongIds.includes(question.id) ? previous.wrongIds : [...previous.wrongIds, question.id]);
      const next = { ...previous, choice: Array.isArray(picked) ? -1 : picked, right: previous.right + (correct && firstAttempt ? 1 : 0), wrongIds, chosen: { ...previous.chosen, [previous.index]: picked } };
      persist(next);
      return next;
    });
  }
  function answer(index: number) {
    if (!round || round.choice !== null) return;
    const question = round.questions[round.index];
    if (question.multi && question.answers) {
      // 多选: 勾选/取消, 确认才判定
      setMultiPicks(previous => previous.includes(index) ? previous.filter(item => item !== index) : [...previous, index]);
      return;
    }
    settle(index);
  }
  function confirmMulti() {
    if (!round || round.choice !== null || multiPicks.length < 2) return;
    settle([...multiPicks].sort((a, b) => a - b));
  }
  function next() {
    if (!round) return;
    if (round.index + 1 >= round.questions.length) {
      const done = { ...round, done: true };
      if (requiz) {
        const mastered = round.questions.map(question => question.id).filter(id => !round.wrongIds.includes(id));
        onRequizDone?.(mastered);
      } else clearPracticeRound(subject, "practice");
      setRound(done);
      return;
    }
    const advanced = { ...round, index: round.index + 1, choice: null };
    persist(advanced);
    setMultiPicks([]);
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
    const answered = round.choice !== null;
    const pickedSet = new Set<number>(Array.isArray(round.chosen[round.index]) ? round.chosen[round.index] as number[] : typeof round.choice === "number" && round.choice >= 0 ? [round.choice] : multiPicks);
    return <section className="panel quiz-card">
      <div className="quiz-top"><span>选择题 · {question.bookName}{question.examTag ? ` · ${question.examTag}` : ` · ${question.origin}`}</span><small>第 {round.index + 1} / {round.questions.length} 题</small></div>
      {question.chapter && <small className="practice-hint">{question.chapter}</small>}
      <h2>{question.stem}{question.multi ? <span className="multi-tag">多选</span> : null}</h2>
      <div className="options">{question.options.map((option, index) => {
        const picked = pickedSet.has(index);
        const correctIndex = answered && (question.multi && question.answers ? question.answers.includes(index) : index === question.answer);
        const wrongPick = answered && picked && !correctIndex;
        return <button key={index} disabled={answered} className={correctIndex ? "correct" : wrongPick ? "wrong" : picked ? "picked" : ""} onClick={() => answer(index)}><span>{picked ? "✓ " : ""}{"ABCD"[index]}</span>{stripOptionLabel(option)}</button>;
      })}</div>
      {question.multi && !answered && <div className="mock-multi-actions">
        <button className="primary" disabled={multiPicks.length < 2} onClick={confirmMulti}>确认答案（2–4 项，全对才得分）</button>
        <small>考研多选：漏选、错选均不得分。</small>
      </div>}
      {answered && analysis.length ? <div className="explanation"><b>正确答案：{question.multi && question.answers ? question.answers.map(item => "ABCD"[item]).join("") : "ABCD"[question.answer]}{choiceIsCorrect(question, Array.isArray(round.chosen[round.index]) ? round.chosen[round.index] as number[] : typeof round.choice === "number" ? round.choice : -1) ? " · 答对了" : " · 答错了"}</b><p>{analysis.map((line, i) => <span key={i}>{line}<br/></span>)}</p></div>
        : answered ? <div className="explanation"><b>正确答案：{question.multi && question.answers ? question.answers.map(item => "ABCD"[item]).join("") : "ABCD"[question.answer]}</b></div>
        : analysis.length ? <p className="mock-help">逐选项辨析将在作答后显示。</p> : null}
      <div className="quiz-footer"><span>本组 {round.right} / {round.index + (answered ? 1 : 0)} 题正确</span><button className="primary" disabled={!answered} onClick={next}>{round.index + 1 >= round.questions.length ? (requiz ? "完成重练" : "查看结果") : "下一题"}</button></div>
    </section>;
  }

  return <section className="panel practice-panel">
    <div className="panel-heading"><div><span className="eyebrow">CHOICE DRILL</span><h2>选择题练习</h2></div></div>
    <p className="mock-help">{subject === "politics"
      ? `真实题库：肖秀荣1000题（试题分册与解析分册逐题对齐），含考研单选与多选题型，共 ${questions.length} 题。逐选项辨析随答案展示；答错自动进入错题本，可续做未完成的题组。`
      : `真实题库精选：丹丹1000题（含历年311真题典例）、阶段测试卷与丹丹中秋国庆卷，共 ${questions.length} 题。逐选项辨析随答案展示；答错自动进入错题本，可续做未完成的题组。`}</p>
    <div className="practice-config">
      <label>书目<select value={book} onChange={(event) => {
        const next = event.target.value as typeof book;
        // B09: 切书后校验章节筛选——旧章不在新书章节列表时重置为全部, 避免"全部章节"却 0 题
        const nextChapters = new Set((questions || []).filter(q => next === "all" || q.book === next).map(q => q.chapter));
        setChapter(prev => (prev !== "all" && nextChapters.has(prev) ? prev : "all"));
        setBook(next);
      }}>
        <option value="all">{subject === "politics" ? "五科全部" : "四书全部"}</option>
        {Object.entries(bookNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>来源<select value={origin} onChange={(event) => setOrigin(event.target.value)}>
        <option value="all">全部来源</option>
        {origins.map(o => <option key={o} value={o}>{o}</option>)}
      </select></label>
      <label>章节<select value={chapter} onChange={(event) => setChapter(event.target.value)}>
        <option value="all">全部章节</option>
        {chapterOptions.map(o => <option key={o} value={o}>{o}</option>)}
      </select></label>
      <label>题数<input type="number" min="1" max="100" step="1" inputMode="numeric" list="drill-count-presets" value={countDraft} onChange={(event) => setCountDraft(event.target.value)} onBlur={() => setCountDraft(String(count))} aria-label="每次练习题数（1-100 自定义）"/>
        <datalist id="drill-count-presets">{[10, 20, 30, 50].map(n => <option key={n} value={n}/>)}{}</datalist>
      </label>
      <label className="practice-shuffle"><input type="checkbox" checked={shuffle} onChange={(event) => setShufflePersisted(event.target.checked)}/>打乱选项顺序</label>
    </div>
    {saveWarn && <p className="error" role="alert">浏览器存储暂时不可用或空间不足：本组作答进度无法保存，刷新后会丢失。请保留当前页面完成本组题目。</p>}
    <p className="mock-selection">当前范围可用：{pool.length} 题{excludedCount > 0 ? `（已排除 ${excludedCount} 题，不参与组卷）` : ""}</p>
    {excludedCount > 0 && <p className="mock-selection"><button type="button" className="text-button" onClick={() => setExcluded(resetMcqExcluded(subject))}>恢复全部已排除（{excludedCount}）</button></p>}
    {resumable && <div className="practice-resume" role="status">
      <span>有一组未完成练习（{resumable.questions.length} 题 · 第 {resumable.index + 1} 题 · 已答对 {resumable.right} 题）。</span>
      <div className="next-actions">
        <button className="primary" onClick={resume}>继续作答</button>
        <button className="secondary" onClick={() => { clearPracticeRound(subject, "practice"); setResumable(null); }}>放弃</button>
      </div>
    </div>}
    <div className="next-actions">
      <button className="primary" disabled={!pool.length} onClick={() => start()}>开始练习</button>
      {!requiz && <button className="secondary" onClick={startDaily}>每日一练 · 20 题混合卷</button>}
    </div>
  </section>;
}
