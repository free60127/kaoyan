import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { clearMistakes, readVisibleMistakes, removeMistakes, removeMistakesByRef, selectRequizList, type Mistake } from "@/lib/mistakes";
import { loadChoiceBank } from "@/lib/choice-bank";
import { PracticeView } from "./PracticeView";
import { ChoiceDrill } from "./ChoiceDrill";
import type { StatStore } from "@/lib/stats";

const kindLabel: Record<Mistake["kind"], string> = { card: "闪卡", quiz: "真题", practice: "自测" };
const subjectName: Record<string, string> = { "333": "333 教育综合", "825": "825 英语专业基础", politics: "政治" };

export function MistakesView({ subject, onReviewCard, onRedoQuiz, cards, storage }: { subject: string; onReviewCard: (cardId: string) => void; onRedoQuiz: (quizId: string) => void; cards: Record<string, { id: string; book: string; chapter: number; section?: string; front: string; back: string }[]>; storage: StatStore }) {
  const [items, setItems] = useState<Mistake[]>(() => readVisibleMistakes());
  const [only, setOnly] = useState<string>(subject);
  const [requiz, setRequiz] = useState(false);
  const [choiceRequiz, setChoiceRequiz] = useState(false);
  const [choiceBankIds, setChoiceBankIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    const sync = () => setItems(readVisibleMistakes());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => { setOnly(subject); setRequiz(false); setChoiceRequiz(false); }, [subject]);
  // R4: 选择题库错题重练——需要知道哪些错题 refId 命中题库
  useEffect(() => {
    let cancelled = false;
    loadChoiceBank().then(bank => { if (!cancelled) setChoiceBankIds(new Set(bank.map(question => question.id))); }).catch(() => { if (!cancelled) setChoiceBankIds(new Set()); });
    return () => { cancelled = true; };
  }, []);
  const groups = useMemo(() => {
    const filtered = only === "all" ? items : items.filter((item) => item.subject === only);
    const bySubject = new Map<string, Mistake[]>();
    for (const item of filtered) {
      const list = bySubject.get(item.subject) || [];
      list.push(item);
      bySubject.set(item.subject, list);
    }
    return [...bySubject.entries()];
  }, [items, only]);
  const requizSubject = only === "all" ? subject : only;
  // F08: 候选始终计算——模式状态只决定显示哪个练习, 不能反过来决定入口候选
  const requizCandidates = useMemo(() => selectRequizList(items, requizSubject), [items, requizSubject]);
  // 闪卡错题: refId 命中闪卡库才能重练; 题库错题: refId 命中选择题库
  const requizList = useMemo(() => requizCandidates.filter(entry => (cards[requizSubject] || []).some(card => card.id === entry.refId)), [requizCandidates, cards, requizSubject]);
  const choiceRequizList = useMemo(() => (
    requizSubject === "333" && choiceBankIds ? requizCandidates.filter(entry => choiceBankIds.has(entry.refId)) : []
  ), [requizCandidates, requizSubject, choiceBankIds]);
  const requizCards = cards[requizSubject] || [];

  function handleRequizDone(masteredIds: string[]) {
    if (masteredIds.length) setItems(removeMistakesByRef(requizSubject, masteredIds));
  }

  if (requiz && requizList.length) {
    return <PracticeView
      subject={requizSubject}
      subjectName={subjectName[requizSubject] || requizSubject}
      books={[]}
      cards={requizCards}
      bookId=""
      chapter={1}
      storage={storage}
      requizEntries={requizList.map(entry => ({ refId: entry.refId, wrongCount: entry.wrongCount }))}
      onRequizDone={handleRequizDone}
      onQuitRequiz={() => setRequiz(false)}
    />;
  }
  if (choiceRequiz && choiceRequizList.length) {
    return <ChoiceDrill
      storage={storage}
      requizIds={choiceRequizList.map(entry => entry.refId)}
      onRequizDone={handleRequizDone}
      onQuitRequiz={() => setChoiceRequiz(false)}
    />;
  }
  return <section className="panel mistakes-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">REVIEW FAILURES</span><h2>错题本</h2></div>
      <div className="mistake-filters">{["333", "politics", "825", "all"].map((id) => (
        <button key={id} className={only === id ? "mode-button active" : "mode-button"} onClick={() => setOnly(id)}>{id === "all" ? "全部" : subjectName[id]}</button>
      ))}</div>
    </div>
    <p className="mock-help">评分“重来”的闪卡、答错的真题与自测题会自动收集到这里。闪卡错题与选择题库错题可整组重练（答对自动移出）；真题类错题请在真题练习页重做。</p>
    {!items.length && <div className="empty">还没有错题记录。评分或答题后自动收集。</div>}
    {items.length > 0 && groups.length === 0 && <div className="empty">该科目暂无错题。</div>}
    {items.length > 0 && <div className="mistake-quiz-actions">
      <button className="primary mistake-quiz-button" disabled={!requizList.length} onClick={() => { setChoiceRequiz(false); setRequiz(true); }}><RefreshCw size={16}/>错题重练（{requizList.length} 张可重练）</button>
      {requizSubject === "333" && <button className="secondary mistake-quiz-button" disabled={!choiceRequizList.length} onClick={() => { setRequiz(false); setChoiceRequiz(true); }}><RefreshCw size={16}/>选择题错题重练（{choiceRequizList.length} 题可重练）</button>}
    </div>}
    {groups.map(([groupSubject, list]) => <div key={groupSubject} className="mistake-group">
      <div className="mistake-group-head">
        <strong>{subjectName[groupSubject] || groupSubject} · {list.length} 条</strong>
        <button className="text-button" onClick={() => setItems(clearMistakes(groupSubject))}>清空本科目</button>
      </div>
      {list.map((item) => <div key={item.id} className="mistake-row">
        <div className="mistake-info">
          <small>{kindLabel[item.kind]} · 错 {item.wrongCount} 次 · {new Date(item.lastAt).toLocaleDateString("zh-CN")}</small>
          <b>{item.label}</b>
        </div>
        <div className="mistake-actions">
          {item.kind === "card" && item.refId && <button className="secondary" onClick={() => onReviewCard(item.refId)}>去复习</button>}
          {item.kind === "quiz" && <button className="secondary" onClick={() => onRedoQuiz(item.refId)}>去重做</button>}
          <button className="icon-button" aria-label="移除该错题" onClick={() => setItems(removeMistakes([item.id]))}><Trash2 size={16}/></button>
        </div>
      </div>)}
    </div>)}
  </section>;
}
