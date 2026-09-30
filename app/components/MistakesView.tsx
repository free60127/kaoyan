import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { clearMistakes, readMistakes, removeMistakes, selectRequizList, type Mistake } from "@/lib/mistakes";
import { PracticeView } from "./PracticeView";
import type { StatStore } from "@/lib/stats";

const kindLabel: Record<Mistake["kind"], string> = { card: "闪卡", quiz: "真题", practice: "自测" };
const subjectName: Record<string, string> = { "333": "333 教育综合", "825": "825 英语专业基础", politics: "政治" };

export function MistakesView({ subject, onReviewCard, cards, storage }: { subject: string; onReviewCard: (cardId: string) => void; cards: Record<string, { id: string; book: string; chapter: number; section?: string; front: string; back: string }[]>; storage: StatStore }) {
  const [items, setItems] = useState<Mistake[]>(() => readMistakes());
  const [only, setOnly] = useState<string>(subject);
  const [requiz, setRequiz] = useState(false);
  useEffect(() => {
    const sync = () => setItems(readMistakes());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => { setOnly(subject); setRequiz(false); }, [subject]);
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
  const requizList = useMemo(() => (requiz ? selectRequizList(items, requizSubject) : []), [requiz, items, requizSubject]);
  const requizAvailable = useMemo(() => selectRequizList(items, requizSubject).filter(entry => (cards[requizSubject] || []).some(card => card.id === entry.refId)), [items, requizSubject, cards]);
  const requizCards = cards[requizSubject] || [];

  function handleRequizDone(masteredIds: string[]) {
    if (masteredIds.length) setItems(removeMistakes(masteredIds));
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
  return <section className="panel mistakes-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">REVIEW FAILURES</span><h2>错题本</h2></div>
      <div className="mistake-filters">{["333", "politics", "825", "all"].map((id) => (
        <button key={id} className={only === id ? "mode-button active" : "mode-button"} onClick={() => setOnly(id)}>{id === "all" ? "全部" : subjectName[id]}</button>
      ))}</div>
    </div>
    <p className="mock-help">评分“重来”的闪卡、答错的真题与自测题会自动收集到这里。可整组重练（答对自动移出），也可逐条移除或跳回闪卡复习。真题类错题不参与重练，请在真题练习页重做。</p>
    {!items.length && <div className="empty">还没有错题记录。评分或答题后自动收集。</div>}
    {items.length > 0 && groups.length === 0 && <div className="empty">该科目暂无错题。</div>}
    {items.length > 0 && <button className="primary mistake-quiz-button" disabled={!requizAvailable.length} onClick={() => setRequiz(true)}><RefreshCw size={16}/>错题重练（{requizAvailable.length} 张可重练）</button>}
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
          <button className="icon-button" aria-label="移除该错题" onClick={() => setItems(removeMistakes([item.id]))}><Trash2 size={16}/></button>
        </div>
      </div>)}
    </div>)}
  </section>;
}
