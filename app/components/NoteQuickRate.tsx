import { useState } from "react";
import { readPersonal, saveOverlay, updatePersonalCard, overlayKey, type PersonalSubject } from "../../lib/personal-cards";
import { adjustRuns, emptyRich, type RichContent } from "../../lib/rich-text";
import { applyNoteStars, applyNoteTag, NOTE_TAGS, parseNoteRating } from "../../lib/note-rating";

/** 快捷评分条(闪卡答案面): 网购式五星(hover 预览、点击即存) + 题型标签(#选/#简…)一键增删。
 *  写入"我的补充"的评级行 "⭐⭐⭐ #选 #简", 与手写内容共存; 编辑器里改的正文不受影响。 */
export function NoteQuickRate({ subject, cardId, note, isPersonalCard, originalFront, originalBack }: {
  subject: PersonalSubject;
  cardId: string;
  note?: RichContent;
  isPersonalCard: boolean;
  originalFront: string;
  originalBack: string;
}) {
  const current = parseNoteRating(note?.text || "");
  const stars = current?.stars ?? 0;
  const tags = current?.tags ?? [];
  const [hover, setHover] = useState(0);
  const [status, setStatus] = useState<"" | "saving" | "saved" | "conflict">("");
  const shown = hover || stars;

  function commit(nextText: string) {
    setStatus("saving");
    const base = note ?? emptyRich("");
    const next: RichContent = { text: nextText, runs: adjustRuns(base.runs || [], base.text, nextText) };
    if (isPersonalCard) {
      const mine = readPersonal().cards.find(item => item.id === cardId);
      if (!mine) { setStatus("conflict"); return; }
      const result = updatePersonalCard(cardId, { note: next }, mine.rev);
      setStatus(result.ok ? "saved" : "conflict");
    } else {
      const store = readPersonal();
      const rev = store.overlays[overlayKey(subject, cardId)]?.rev ?? null;
      const result = saveOverlay(subject, cardId, { note: next }, originalFront, originalBack, rev);
      setStatus(result.ok ? "saved" : "conflict");
    }
  }

  return <div className="note-quick-rate" role="group" aria-label="星级与题型快捷标注">
    <span className="nqr-label">星级</span>
    <span className="nqr-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(value => <button
        key={value}
        type="button"
        className={value <= shown ? "nqr-star on" : "nqr-star"}
        aria-label={value === stars ? `清除${stars}星` : `${value} 星`}
        onMouseEnter={() => setHover(value)}
        onFocus={() => setHover(value)}
        onBlur={() => setHover(0)}
        onClick={() => { commit(applyNoteStars(note?.text || "", value === stars && stars > 0 ? 0 : value)); }}
      >{value <= shown ? "★" : "☆"}</button>)}
      <small className="nqr-hint">{hover ? `${hover} 星` : stars ? `${stars} 星` : "点击评分"}</small>
    </span>
    <span className="nqr-sep"/>
    <span className="nqr-tags">
      {NOTE_TAGS.map(tag => <button
        key={tag}
        type="button"
        className={tags.includes(tag) ? "nqr-tag on" : "nqr-tag"}
        aria-pressed={tags.includes(tag)}
        onClick={() => { commit(applyNoteTag(note?.text || "", tag)); }}
      >{tag}</button>)}
    </span>
    <small className={status === "conflict" ? "nqr-status conflict" : "nqr-status"} role="status">
      {status === "saved" ? "已记入我的补充" : status === "saving" ? "保存中…" : status === "conflict" ? "另一标签页已修改，请重试" : ""}
    </small>
  </div>;
}
