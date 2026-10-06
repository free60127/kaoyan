import { useMemo, useState } from "react";
import { ChevronDown, TriangleAlert } from "lucide-react";

export type EssayEntry = { id: string; category: string; topic: string; stem: string; referenceAnswer: string; ocrWarning: string; source: string };

const BOOK_LABEL: Record<string, string> = { principles: "教育学原理", china: "中国教育史", foreign: "外国教育史", psychology: "教育心理学" };

export function EssayBank({ entries }: { entries: { id: string; book: string; category: string; topic: string; stem: string; referenceAnswer: string; ocrWarning: string; source: string }[] }) {
  const [book, setBook] = useState("all");
  const [category, setCategory] = useState("all");
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const categories = useMemo(() => [...new Set(entries.filter(entry => book === "all" || entry.book === book).map(entry => entry.category))], [entries, book]);
  const filtered = useMemo(() => entries.filter(entry => (book === "all" || entry.book === book) && (category === "all" || entry.category === category)), [entries, book, category]);
  const toggle = (id: string) => setOpen(previous => ({ ...previous, [id]: !previous[id] }));
  return <section className="panel essay-panel">
    <div className="panel-heading"><div><span className="eyebrow">ESSAY BANK</span><h2>333 主观题库 · {entries.length} 题</h2></div>
      <div className="mistake-filters">
        <button className={book === "all" ? "mode-button active" : "mode-button"} onClick={() => { setBook("all"); setCategory("all"); }}>四书全部 ({entries.length})</button>
        {Object.entries(BOOK_LABEL).map(([id, name]) => <button key={id} className={book === id ? "mode-button active" : "mode-button"} onClick={() => { setBook(id); setCategory("all"); }}>{name} ({entries.filter(entry => entry.book === id).length})</button>)}
      </div></div>
    <div className="essay-subfilters">{categories.map(cat => <button key={cat} className={category === cat ? "mode-button active" : "mode-button"} onClick={() => setCategory(cat)}>{cat} ({entries.filter(entry => entry.category === cat && (book === "all" || entry.book === book)).length})</button>)}</div>
    <p className="mock-help">题目与参考答案完整复用自《高效答题手册》（202 页，84 道完整主观题），保留材料、全部设问与分点答案；部分题带 OCR 校对标注。先自己组织答案，再展开对照。</p>
    <div className="essay-list">
      {filtered.map(entry => <div key={entry.id} className="essay-row">
        <button className="essay-head" onClick={() => toggle(entry.id)}>
          <small>{entry.category} · {BOOK_LABEL[entry.book] || entry.book} · {entry.source}</small>
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
