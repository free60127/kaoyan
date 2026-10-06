import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { EssayQuestion } from "../../lib/essay-questions";

export type EssayEntry = EssayQuestion;

export function EssayBank({ entries }: { entries: EssayEntry[] }) {
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const categories = useMemo(() => [...new Set(entries.map(entry => entry.category))], [entries]);
  const filtered = useMemo(() => (category === "all" ? entries : entries.filter(entry => entry.category === category)), [entries, category]);
  const toggle = (id: string) => setOpen(previous => ({ ...previous, [id]: !previous[id] }));
  const choiceCount = entries.filter(entry => entry.category === "丹丹中秋国庆卷" && entry.number >= 1 && entry.number <= 30).length;
  const extendedCount = entries.filter(entry => entry.id.startsWith("mu-教育研究(扩展)-")).length;
  const subjectiveCount = entries.length - choiceCount - extendedCount;
  return <section className="panel essay-panel">
    <div className="panel-heading"><div><span className="eyebrow">ESSAY BANK</span><h2>原资料题库 · {entries.length} 条记录</h2></div>
      <div className="mistake-filters"><button className={category === "all" ? "mode-button active" : "mode-button"} onClick={() => setCategory("all")}>全部 ({entries.length})</button>
        {categories.map(cat => <button key={cat} className={category === cat ? "mode-button active" : "mode-button"} onClick={() => setCategory(cat)}>{cat} ({entries.filter(entry => entry.category === cat).length})</button>)}
      </div></div>
    <p className="mock-help">保留全部 {entries.length} 条原资料记录：{subjectiveCount} 条 333 主观题、{choiceCount} 条选择题、{extendedCount} 条教育研究扩展题。资料包括《高效答题手册》、丹丹中秋国庆卷与母题资料；保留材料、设问、参考答案及原 OCR 校对提示。先自己组织答案，再展开对照。</p>
    <div className="essay-list">
      {filtered.map(entry => <div key={entry.id} className="essay-row">
        <button className="essay-head" aria-expanded={!!open[entry.id]} onClick={() => toggle(entry.id)}>
          <small>{entry.category} · {entry.source}</small>
          <b>{entry.topic || entry.stem.slice(0, 30)}</b>
          <span className="essay-stem">{entry.stem}</span>
          {entry.ocrWarning && <span className="essay-warn"><TriangleAlert size={13}/> 原 OCR 校对提示：{entry.ocrWarning}</span>}
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
