import { useState } from "react";
import { readPersonalOverlayNote, type PersonalSubject } from "../../lib/personal-cards";
import { adjustRuns, emptyRich, type RichContent } from "../../lib/rich-text";
import { applyNoteStars, applyNoteTag, NOTE_TAGS, parseNoteRating } from "../../lib/note-rating";

/** 快捷评分条(闪卡答案面): 网购式五星(hover 预览、点击即存) + 题型标签(#选/#简…)一键增删。
 *  写入"我的补充"的评级行 "⭐⭐⭐ #选 #简", 与手写内容共存。
 *  保存基于存储中的实时 note 重算(而非可能过期的 props), 冲突自动重试——多标签页/云同步
 *  并发写入时无损合并, 不打断用户。 */
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

  /** 意图 = "把星级设为 n" / "切换标签 t"; 每次尝试基于存储实时 note 重新应用, 冲突重试。 */
  function commit(intent: (text: string) => string, attempt = 0) {
    setStatus("saving");
    const live = readPersonalOverlayNote(subject, cardId, isPersonalCard);
    const base = live?.content ?? emptyRich("");
    const nextText = intent(base.text);
    const next: RichContent = { text: nextText, runs: adjustRuns(base.runs || [], base.text, nextText) };
    const result = live?.save(next, originalFront, originalBack);
    if (result?.ok) {
      setStatus("saved");
      return;
    }
    // conflict: 另一标签/云同步刚写入——稍候基于新状态重试; 多次失败才报告
    if (!result || (result.reason === "conflict" && attempt < 3)) {
      setTimeout(() => commit(intent, attempt + 1), 350);
      return;
    }
    setStatus(result.reason === "storage" ? "conflict" : "conflict");
  }

  return <div className="note-quick-rate" role="group" aria-label="星级与题型快捷标注">
    <span className="nqr-label">星级</span>
    <span className="nqr-stars" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map(value => <button
        key={value}
        type="button"
        className={value <= shown ? "nqr-star on" : "nqr-star"}
        aria-label={value === stars && stars > 0 ? `清除${stars}星` : `${value} 星`}
        onMouseEnter={() => setHover(value)}
        onFocus={() => setHover(value)}
        onBlur={() => setHover(0)}
        onClick={() => commit(text => applyNoteStars(text, value === stars && stars > 0 ? 0 : value))}
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
        onClick={() => commit(text => applyNoteTag(text, tag))}
      >{tag}</button>)}
    </span>
    <small className={status === "conflict" ? "nqr-status conflict" : "nqr-status"} role="status">
      {status === "saved" ? "已记入我的补充" : status === "saving" ? "保存中…" : status === "conflict" ? "保存失败（存储不可用），请稍后重试" : ""}
    </small>
  </div>;
}
