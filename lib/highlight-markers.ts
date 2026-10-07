/** 教材重点标注标记: 卡片文本里的 ⟦k|文字⟧ 片段(k = g 绿/b 蓝/r 红/y 黄底/s 黑体加粗)。
 *  由 flashcards-src/map_highlights_to_cards.py 从原书彩色/黑体标注提取注入;
 *  渲染层转为带色 span, 非渲染路径(自测选项/复制/检索)一律还原为纯文字。 */

export type HighlightKind = "g" | "b" | "r" | "y" | "s";
export type MarkerSegment = { kind: "text" | HighlightKind; text: string };

const MARKER = /⟦([gbrys])\|([^⟧]*)⟧/g;

export function parseHighlightMarkers(text: string): MarkerSegment[] {
  const segments: MarkerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ kind: "text", text: text.slice(last, index) });
    segments.push({ kind: match[1] as HighlightKind, text: match[2] });
    last = index + match[0].length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/** 还原为纯文字(保留内容本身): 自测选项、统计、复制等路径用。 */
export function stripHighlightMarkers(text: string): string {
  return text.replace(MARKER, (_all, _kind: string, inner: string) => inner);
}

export function hasHighlightMarkers(text: string): boolean {
  return text.includes("⟦");
}
