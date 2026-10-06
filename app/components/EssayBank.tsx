import { useMemo, useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";

export type EssayEntry = { id: string; category: string; topic: string; stem: string; referenceAnswer: string; ocrWarning: string; source: string };

export function EssayBank({ entries, onJumpCard }: { entries: { id: string; category: string; topic: string; stem: string; referenceAnswer: string; ocrWarning: string; source: string }[]; onJumpCard?: never }) {
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const categories = useMemo(() => [...new Set(entries.map(entry => entry.category))], [entries]);
  const filtered = useMemo(() => (category === "all" ? entries : entries.filter(entry => entry.category === category)), [entries, category]);
  const toggle = (id: string) => setOpen(previous => ({ ...previous, [id]: !previous[id] }));
  return <section className="panel essay-panel">
    <div className="panel-heading"><div><span className="eyebrow">ESSAY BANK</span><h2>333 主观题库 · 84 道完整题</h2></div>
      <div className="mistake-filters"><button className={category === "all" ? "mode-button active" : "mode-button"} onClick={() => setCategory("all")}>全部 ({entries.length})</button>
        {categories.map(cat => <button key={cat} className={category === cat ? "mode-button active" : "mode-button"} onClick={() => setCategory(cat)}>{cat.replace(/（.*）/, "").replace(/教育学原理|教育心理学/, m => m.slice(0, 4))} ({entries.filter(entry => entry.category === cat).length})</button>)}
      </div></div>
    <p className="mock-help">题目与参考答案完整复用自《高效答题手册》（202 页，84 道完整主观题），保留材料、全部设问与分点答案；部分题带 OCR 校对标注。先自己组织答案，再展开对照。</p>
    <div className="essay-list">
      {filtered.map(entry => <div key={entry.id} className="essay-row">
        <button className="essay-head" onClick={() => toggle(entry.id)}>
          <small>{entry.category} · {entry.source}</small>
          <b>{entry.topic || entry.stem.slice(0, 30)}</b>
          <span className="essay-stem">{entry.stem}</span>
          {entry.ocrWarning && <span className="essay-warn"><TriangleAlert size={13}/> OCR 校对标注：此题文本可能不完整，已按上下文补全</span>}
        </button>
        {open[entry.id] && <div className="essay-answer">
          <b>参考答案</b>
          <p>{entry.referenceAnswer}</p>
          <small>来源：{entry.source} · 答案为教辅参考，非官方评分标准；多种有依据的作答路径均应接受。</small>
        </div>}
      </div>)}
    </div>
  </section>;
}
