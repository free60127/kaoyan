import { useMemo, type ReactNode } from "react";
import { renderRichSegments, type RichRun } from "../../lib/rich-text";

/** 结构化富文本渲染: 教材标记与个人样式组合成连续同样式段。
 *  无样式的段必须返回裸字符串——.flash-card span 是来源行样式(12px 灰),
 *  任何包出来的空 span 都会把正文连带成灰色; 只有带色/带样式的段才是 span。 */
export function RichTextView({ text, runs = [], renderTextbook = true }: { text: string; runs?: RichRun[]; renderTextbook?: boolean }): ReactNode {
  const segments = useMemo(() => renderRichSegments(text, runs), [text, runs]);
  return <>{segments.map((segment, index) => {
    const styled = renderTextbook ? !!segment.textbook : false;
    const hasOwn = !!(segment.color || segment.hl || segment.b || segment.u || (renderTextbook && segment.textbook));
    if (!hasOwn) return segment.text;
    const className = ["rich-seg", styled ? segment.textbook : "", segment.b ? "rich-b" : "", segment.u ? "rich-u" : ""].filter(Boolean).join(" ");
    const style: { color?: string; backgroundColor?: string; borderRadius?: number; padding?: string } = {};
    if (segment.color) style.color = segment.color;
    if (segment.hl) { style.backgroundColor = segment.hl; style.borderRadius = 3; style.padding = "0 1px"; }
    return <span key={index} className={className} style={style}>{segment.text}</span>;
  })}</>;
}
