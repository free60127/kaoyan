import { useMemo } from "react";
import { Archive, RotateCcw } from "lucide-react";
import { type PersonalStore, type PersonalSubject } from "../../lib/personal-cards";
import type { StudyReviewController } from "../../lib/use-study-review";

type Card = { id: string; book: string; chapter: number; section?: string; front: string };

/** 移出队列管理: 列出被移出复习队列的卡(教材卡 overlay.hidden 与个人卡 hidden),
 *  显示章节与保留的学习进度; 可随时加回队列——学习记录一直保留, 加回即恢复排期。 */
export function ReviewAdminView({ subject, personal, baseCards, books, review, onRestoreOverlay, onRestoreCard }: {
  subject: PersonalSubject;
  personal: PersonalStore;
  baseCards: Card[];
  books: { id: string; name: string }[];
  review: StudyReviewController;
  onRestoreOverlay: (cardId: string) => void;
  onRestoreCard: (cardId: string) => void;
}) {
  const baseById = useMemo(() => new Map(baseCards.map(card => [card.id, card])), [baseCards]);
  const hiddenOverlays = useMemo(() => Object.entries(personal.overlays)
    .filter(([key, overlay]) => key.startsWith(subject + ":") && overlay.hidden)
    .map(([key]) => key.slice(subject.length + 1))
    .map(cardId => ({ cardId, card: baseById.get(cardId) })), [personal, subject, baseById]);
  const hiddenPersonal = useMemo(() => personal.cards.filter(card => card.subject === subject && card.hidden)
    .map(card => ({ cardId: card.id, front: card.front.text, book: card.book, chapter: card.chapter, section: card.section || "" })), [personal, subject]);
  const total = hiddenOverlays.length + hiddenPersonal.length;
  const bookName = (id: string) => books.find(book => book.id === id)?.name || id;
  const progressLine = (cardId: string) => {
    const state = review.progress.cards[cardId];
    if (!state) return "尚未进入复习排期（学习记录为空）";
    const due = new Date(state.dueAt);
    return `学习记录保留中 · 原下次到期 ${new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(due)}`;
  };

  if (!total) return <section className="panel empty">
    <Archive size={30}/>
    <h2>没有移出复习队列的卡</h2>
    <p>在闪卡答案面的操作行点「移出复习队列」，被移出的卡会集中在这里；学习记录始终保留，随时可以加回队列并恢复原来的排期。</p>
  </section>;

  return <section className="panel review-admin">
    <div className="panel-heading"><div><span className="eyebrow">REVIEW QUEUE</span><h2>移出队列管理 · {total} 张</h2></div></div>
    <p className="mock-help">移出不删除学习记录：加回队列后按原来的进度继续排期。被移出的卡不进入复习队列，也不再出现在浏览、搜索与自测中。</p>
    {hiddenOverlays.length > 0 && <>
      <h3 className="favorites-heading">教材卡 · {hiddenOverlays.length}</h3>
      <div className="mistake-group">
        {hiddenOverlays.map(({ cardId, card }) => <div key={cardId} className="mistake-row">
          <div className="mistake-info">
            <small>{card ? `${bookName(card.book)} · 第 ${card.chapter} 章${card.section ? ` · ${card.section}` : ""}` : cardId}</small>
            <b>{card ? card.front.slice(0, 80) : cardId}</b>
            <small>{progressLine(cardId)}</small>
          </div>
          <div className="mistake-actions">
            <button className="secondary" onClick={() => onRestoreOverlay(cardId)}><RotateCcw size={14}/>加回队列</button>
          </div>
        </div>)}
      </div>
    </>}
    {hiddenPersonal.length > 0 && <>
      <h3 className="favorites-heading">个人卡 · {hiddenPersonal.length}</h3>
      <div className="mistake-group">
        {hiddenPersonal.map(row => <div key={row.cardId} className="mistake-row">
          <div className="mistake-info">
            <small>{bookName(row.book)} · 第 {row.chapter} 章{row.section ? ` · ${row.section}` : ""}</small>
            <b>{row.front.slice(0, 80)}</b>
            <small>{progressLine(row.cardId)}</small>
          </div>
          <div className="mistake-actions">
            <button className="secondary" onClick={() => onRestoreCard(row.cardId)}><RotateCcw size={14}/>加回队列</button>
          </div>
        </div>)}
      </div>
    </>}
  </section>;
}
