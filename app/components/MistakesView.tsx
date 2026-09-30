import { useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { clearMistakes, readMistakes, removeMistake, type Mistake } from "@/lib/mistakes";

const kindLabel: Record<Mistake["kind"], string> = { card: "闪卡", quiz: "真题", practice: "自测" };
const subjectName: Record<string, string> = { "333": "333 教育综合", "825": "825 英语专业基础", politics: "政治" };

export function MistakesView({ subject, onReviewCard }: { subject: string; onReviewCard: (cardId: string) => void }) {
  const [items, setItems] = useState<Mistake[]>(() => readMistakes());
  const [only, setOnly] = useState<string>(subject);
  useEffect(() => {
    const sync = () => setItems(readMistakes());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  useEffect(() => { setOnly(subject); }, [subject]);
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
  return <section className="panel mistakes-panel">
    <div className="panel-heading">
      <div><span className="eyebrow">REVIEW FAILURES</span><h2>错题本</h2></div>
      <div className="mistake-filters">{["333", "politics", "825", "all"].map((id) => (
        <button key={id} className={only === id ? "mode-button active" : "mode-button"} onClick={() => setOnly(id)}>{id === "all" ? "全部" : subjectName[id]}</button>
      ))}</div>
    </div>
    <p className="mock-help">评分“重来”的闪卡、答错的真题与政治自测题会自动收集到这里。掌握后可移除，或点“去复习”回到对应闪卡。</p>
    {!items.length && <div className="empty">还没有错题记录。评分或答题后自动收集。</div>}
    {items.length > 0 && groups.length === 0 && <div className="empty">该科目暂无错题。</div>}
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
          <button className="icon-button" aria-label="移除该错题" onClick={() => setItems(removeMistake(item.id))}><Trash2 size={16}/></button>
        </div>
      </div>)}
    </div>)}
  </section>;
}
