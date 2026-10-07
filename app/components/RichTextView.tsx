import { useMemo, type ReactNode } from "react";
import { renderRichSegments, type RichRun } from "../../lib/rich-text";

/** 结构化富文本渲染: 教材标记与个人样式组合成连续同样式段。
 *  所有段都挂在 .rich-seg 下(继承正文字号字重), 个人颜色/底纹用内联样式。 */
export function RichTextView({ text, runs = [], renderTextbook = true }: { text: string; runs?: RichRun[]; renderTextbook?: boolean }): ReactNode {
  const segments = useMemo(() => renderRichSegments(text, runs), [text, runs]);
  const plain = segments.length === 1 && !segments[0].textbook && !segments[0].color && !segments[0].hl && !segments[0].b && !segments[0].u;
  if (plain) return segments[0].text;
  return <>{segments.map((segment, index) => {
    const className = ["rich-seg", renderTextbook && segment.textbook ? segment.textbook : "", segment.b ? "rich-b" : "", segment.u ? "rich-u" : ""].filter(Boolean).join(" ");
    const style: { color?: string; backgroundColor?: string; borderRadius?: number; padding?: string } = {};
    if (segment.color) style.color = segment.color;
    if (segment.hl) { style.backgroundColor = segment.hl; style.borderRadius = 3; style.padding = "0 1px"; }
    const hasStyle = segment.color || segment.hl;
    return <span key={index} className={className} {...(hasStyle ? { style } : {})}>{segment.text}</span>;
  })}</>;
}
