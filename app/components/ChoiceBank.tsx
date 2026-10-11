import { useEffect, useMemo, useState } from "react";
import { Star } from "lucide-react";
import { choiceBookName, loadChoiceBank, type ChoiceQuestion } from "@/lib/choice-bank";
import { readFavorites, toggleFavorite } from "@/lib/favorites";
import { stripHighlightMarkers } from "@/lib/highlight-markers";

/** 题库浏览页(F): 全量 1471+ 题的可筛选列表——搜索题干/选项、按书/来源/章筛选、
 *  收藏星标、展开看选项与解析。数据与"选择题练习"同源(loadChoiceBank)。 */
export function ChoiceBank({ subject }: { subject: string }) {
  const [questions, setQuestions] = useState<ChoiceQuestion[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [book, setBook] = useState("all");
  const [origin, setOrigin] = useState("all");
  const [chapter, setChapter] = useState("all");
  const [favOnly, setFavOnly] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(() => readFavorites(subject, "choice"));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [limit, setLimit] = useState(30);

  useEffect(() => {
    let cancelled = false;
    loadChoiceBank().then(data => { if (!cancelled) setQuestions(data); }).catch(() => { if (!cancelled) setLoadError("选择题库加载失败，请刷新重试。"); });
    return () => { cancelled = true; };
  }, []);

  const origins = useMemo(() => [...new Set((questions || []).map(q => q.origin))], [questions]);
  const chapterOptions = useMemo(() => [...new Set((questions || []).filter(q => book === "all" || q.book === book).map(q => q.chapter).filter(Boolean))], [questions, book]);
  const filtered = useMemo(() => {
    if (!questions) return [];
    const q = query.trim().toLowerCase();
    return questions.filter(question =>
      (book === "all" || question.book === book)
      && (origin === "all" || question.origin === origin)
      && (chapter === "all" || question.chapter === chapter)
      && (!favOnly || favorites.has(question.id))
      && (!q || question.stem.toLowerCase().includes(q) || question.options.some(option => option.toLowerCase().includes(q)) || (question.optionAnalysis.join("|") + question.referenceAnswer).toLowerCase().includes(q)));
  }, [questions, query, book, origin, chapter, favOnly, favorites]);

  if (loadError) return <section className="panel"><p className="error" role="alert">{loadError}</p></section>;
  if (!questions) return <section className="panel empty">正在载入选择题库…</section>;

  return <section className="panel choice-bank">
    <div className="panel-heading"><div><span className="eyebrow">QUESTION BANK</span><h2>题库浏览 · {filtered.length} 题</h2></div></div>
    <div className="search-box"><input value={query} onChange={(event) => { setQuery(event.target.value); setLimit(30); }} placeholder="搜索题干 / 选项 / 解析…"/><button className="secondary" onClick={() => setQuery("")}>清空</button></div>
    <div className="practice-config">
      <label>书目<select value={book} onChange={(event) => { setBook(event.target.value); setChapter("all"); setLimit(30); }}>
        <option value="all">四书全部</option>
        {Object.entries(choiceBookName).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
      <label>来源<select value={origin} onChange={(event) => { setOrigin(event.target.value); setLimit(30); }}>
        <option value="all">全部来源</option>
        {origins.map(o => <option key={o} value={o}>{o}</option>)}
      </select></label>
      <label>章节<select value={chapter} onChange={(event) => { setChapter(event.target.value); setLimit(30); }}>
        <option value="all">全部章节</option>
        {chapterOptions.map(c => <option key={c} value={c}>{c}</option>)}
      </select></label>
      <label>状态<div className="mode-group"><button className={favOnly ? "mode-button active" : "mode-button"} onClick={() => { setFavOnly(value => !value); setLimit(30); }}>只看收藏（{favorites.size}）</button></div></label>
    </div>
    {!filtered.length && <div className="empty">没有匹配的题目。换个关键词或减少筛选。</div>}
    <div className="essay-list">
      {filtered.slice(0, limit).map(question => {
        const answerLetter = "ABCD"[question.answer];
        return <div key={question.id} className="essay-row">
          <button className="essay-head" onClick={() => setOpen(previous => ({ ...previous, [question.id]: !previous[question.id] }))}>
            <small>{question.bookName} · {question.origin}{question.chapter ? ` · ${question.chapter}` : ""}{question.examTag ? ` · ${question.examTag}` : ""}</small>
            <span className="essay-stem">{stripHighlightMarkers(question.stem)}</span>
            {favorites.has(question.id) && <span className="personal-tag">已收藏</span>}
          </button>
          {open[question.id] && <div className="essay-answer">
            <div className="options">{question.options.map((option, index) => <p key={index} className={index === question.answer ? "bank-option correct" : "bank-option"}><span>{"ABCD"[index]}</span>{stripOptionText(option)}</p>)}</div>
            <b>正确答案：{answerLetter}</b>
            {question.optionAnalysis.filter(Boolean).length
              ? <p>{question.optionAnalysis.map((line, i) => <span key={i}>{stripHighlightMarkers(line)}<br /></span>)}</p>
              : question.referenceAnswer ? <p>{stripHighlightMarkers(question.referenceAnswer)}</p>
              : <p>此题暂无逐项解析。</p>}
            <small>来源：{question.source}</small>
          </div>}
          <button className={"bank-star" + (favorites.has(question.id) ? " active" : "")} aria-label={favorites.has(question.id) ? "取消收藏" : "收藏此题"} onClick={(event) => { event.stopPropagation(); setFavorites(toggleFavorite(subject, question.id, "choice")); }}>
            <Star size={15}/>{favorites.has(question.id) ? "已收藏" : "收藏"}
          </button>
        </div>;
      })}
    </div>
    {filtered.length > limit && <button className="secondary" onClick={() => setLimit(value => value + 60)}>显示更多（剩余 {filtered.length - limit} 题）</button>}
  </section>;
}

function stripOptionText(text: string): string {
  return text.replace(/^\s*([A-D])[.、．)]\s*/, "");
}
