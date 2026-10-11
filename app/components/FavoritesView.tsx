import { useEffect, useMemo, useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { loadChoiceBank, loadPoliticsChoiceBank, stripOptionLabel, type ChoiceQuestion } from "@/lib/choice-bank";
import { readFavorites, toggleFavorite } from "@/lib/favorites";
import { stripHighlightMarkers } from "@/lib/highlight-markers";

type Card = { id: string; book: string; chapter: number; section?: string; front: string; back: string };

/** 收藏视图: 本科目收藏的闪卡与(333)选择题, 跨章清单; 可跳转复习或取消收藏。 */
export function FavoritesView({ subject, books, cards, onReviewCard }: {
  subject: string;
  books: { id: string; name: string }[];
  cards: Card[];
  onReviewCard: (cardId: string) => void;
}) {
  const [cardFavs, setCardFavs] = useState<Set<string>>(() => readFavorites(subject, "card"));
  const [choiceFavs, setChoiceFavs] = useState<Set<string>>(() => readFavorites(subject, "choice"));
  const [bank, setBank] = useState<ChoiceQuestion[] | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setCardFavs(readFavorites(subject, "card"));
    setChoiceFavs(readFavorites(subject, "choice"));
  }, [subject]);
  useEffect(() => {
    if (subject !== "333" && subject !== "politics") return;
    let cancelled = false;
    (subject === "333" ? loadChoiceBank() : loadPoliticsChoiceBank()).then(data => { if (!cancelled) setBank(data); }).catch(() => { if (!cancelled) setBank([]); });
    return () => { cancelled = true; };
  }, [subject]);

  const favCards = useMemo(() => cards.filter(card => cardFavs.has(card.id)), [cards, cardFavs]);
  const favChoices = useMemo(() => (bank || []).filter(question => choiceFavs.has(question.id)), [bank, choiceFavs]);
  const bookName = (id: string) => books.find(book => book.id === id)?.name || id;

  if (!cardFavs.size && !choiceFavs.size) {
    return <section className="panel empty">
      <Star size={30}/>
      <h2>还没有收藏</h2>
      <p>闪卡下方点「☆ 收藏这张卡」，选择题作答后或题库浏览里点星标，收藏会集中出现在这里。</p>
    </section>;
  }

  return <section className="panel favorites-panel">
    <div className="panel-heading"><div><span className="eyebrow">FAVORITES</span><h2>我的收藏 · {favCards.length + ((subject === "333" || subject === "politics") ? favChoices.length : 0)} 项</h2></div></div>

    {favCards.length > 0 && <>
      <h3 className="favorites-heading">收藏的闪卡 · {favCards.length}</h3>
      <div className="mistake-group">
        {favCards.map(card => <div key={card.id} className="mistake-row">
          <div className="mistake-info">
            <small>{bookName(card.book)} · 第 {card.chapter} 章{card.section ? ` · ${card.section}` : ""}</small>
            <b>{card.front}</b>
          </div>
          <div className="mistake-actions">
            <button className="secondary" onClick={() => onReviewCard(card.id)}>去复习</button>
            <button className="icon-button" aria-label="取消收藏" onClick={() => setCardFavs(toggleFavorite(subject, card.id, "card"))}><Star size={15}/></button>
          </div>
        </div>)}
      </div>
    </>}

    {(subject === "333" || subject === "politics") && favChoices.length > 0 && <>
      <h3 className="favorites-heading">收藏的选择题 · {favChoices.length}</h3>
      <div className="essay-list">
        {favChoices.map(question => <div key={question.id} className="essay-row">
          <button className="essay-head" onClick={() => setOpen(previous => ({ ...previous, [question.id]: !previous[question.id] }))}>
            <small>{question.bookName} · {question.origin}{question.chapter ? ` · ${question.chapter}` : ""}</small>
            <span className="essay-stem">{stripHighlightMarkers(question.stem)}</span>
          </button>
          {open[question.id] && <div className="essay-answer">
            <div className="options">{question.options.map((option, index) => {
              const correctIndex = question.multi && question.answers ? question.answers.includes(index) : index === question.answer;
              return <p key={index} className={correctIndex ? "bank-option correct" : "bank-option"}><span>{question.multi && question.answers && question.answers.includes(index) ? "✓ " : ""}{"ABCD"[index]}</span>{stripOptionLabel(option)}</p>;
            })}</div>
            <b>正确答案：{question.multi && question.answers ? question.answers.map(item => "ABCD"[item]).join("") : "ABCD"[question.answer]}{question.multi ? "（多选）" : ""}</b>
            {question.optionAnalysis.filter(Boolean).length
              ? <p>{question.optionAnalysis.map((line, i) => <span key={i}>{stripHighlightMarkers(line)}<br /></span>)}</p>
              : question.referenceAnswer ? <p>{stripHighlightMarkers(question.referenceAnswer)}</p>
              : <p>此题暂无逐项解析。</p>}
            <small>来源：{question.source}</small>
          </div>}
          <button className="bank-star" aria-label="取消收藏" onClick={(event) => { event.stopPropagation(); setChoiceFavs(toggleFavorite("333", question.id, "choice")); }}><Trash2 size={14}/>取消收藏</button>
        </div>)}
      </div>
    </>}
  </section>;
}
