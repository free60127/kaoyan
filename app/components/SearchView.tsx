import { useMemo, useState } from "react";
import { Search } from "lucide-react";

export type SearchEntry = { subject: string; subjectName: string; bookId: string; bookName: string; chapter: number; section: string; id: string; front: string };

export function SearchView({ entries, onJump }: { entries: SearchEntry[]; onJump: (entry: SearchEntry) => void }) {
  const [query, setQuery] = useState("");
  const normalized = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (normalized.length < 2) return [];
    return entries
      .filter((entry) => entry.front.toLowerCase().includes(normalized))
      .slice(0, 40);
  }, [entries, normalized]);
  return <section className="panel search-panel">
    <div className="panel-heading"><div><span className="eyebrow">FIND A CARD</span><h2>搜索全部闪卡</h2></div></div>
    <div className="search-box"><Search size={18}/><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入关键词，如“苏格拉底”“deixis”“实践与认识”…（至少 2 个字）" aria-label="搜索闪卡"/><button className="secondary" onClick={() => setQuery("")}>清空</button></div>
    {normalized.length >= 2 && <p className="mock-selection">匹配 {results.length} 张{results.length >= 40 ? "（仅显示前 40）" : ""}</p>}
    {normalized.length >= 2 && !results.length && <div className="empty">没有匹配的闪卡。试试别的关键词，或换更短的说法。</div>}
    <div className="search-results">
      {results.map((entry) => <button key={entry.subject + entry.id} className="search-row" onClick={() => onJump(entry)}>
        <small>{entry.subjectName} · {entry.bookName} · 第 {entry.chapter} 章{entry.section ? " · " + entry.section : ""}</small>
        <b>{entry.front}</b>
      </button>)}
    </div>
  </section>;
}
