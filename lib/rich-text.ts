/** 结构化富文本: 个人编辑层的文字样式。保存为 纯文本 + 样式区间(runs)，
 *  绝不存任意 HTML；教材重点标记 ⟦k|…⟧ 与个人 runs 叠加渲染。
 *  runs 的 start/end 以"剥离教材标记后的纯文本"偏移为准——编辑器与存储两侧一致。 */

import { parseHighlightMarkers } from "./highlight-markers";

export type RichRunKind = "color" | "hl" | "b" | "u";
export type RichRun = { start: number; end: number; kind: RichRunKind; value?: string };
export type RichContent = { text: string; runs: RichRun[] };

export const RICH_COLORS = ["#cf3b2e", "#1a66c8", "#0c8a4d", "#7b3fb5"] as const;
export const RICH_HIGHLIGHTS = ["#ffe98a", "#c9e5ff", "#cdeecd"] as const;
const HEX = /^#[0-9a-fA-F]{6}$/;
export const RICH_RUN_LIMIT = 400;

export function isRichColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export const emptyRich = (text = ""): RichContent => ({ text, runs: [] });
export const richPlain = (content: RichContent | undefined): string => (content ? content.text : "");

/** 校验并净化 runs(来自草稿/备份/导入的数据不可信): 区间夹紧、去空、去重叠、限制数量。 */
export function sanitizeRuns(runs: RichRun[], textLength: number): RichRun[] {
  const cleaned: RichRun[] = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run !== "object") continue;
    if (!["color", "hl", "b", "u"].includes(String(run.kind))) continue;
    const start = Math.max(0, Math.min(textLength, Math.floor(Number(run.start) || 0)));
    const end = Math.max(start, Math.min(textLength, Math.floor(Number(run.end) || 0)));
    if (end - start < 1) continue;
    const value = run.value === undefined ? undefined : isRichColor(run.value) ? run.value.toLowerCase() : undefined;
    if ((run.kind === "color" || run.kind === "hl") && !value) continue;
    cleaned.push({ start, end, kind: run.kind, ...(value ? { value } : {}) });
    if (cleaned.length >= RICH_RUN_LIMIT) break;
  }
  return cleaned;
}

/** 用户编辑文本后调整 runs: 按公共前后缀差分平移/截断/丢弃受影响区间。 */
export function adjustRuns(runs: RichRun[], previous: string, next: string): RichRun[] {
  if (previous === next) return runs;
  let prefix = 0;
  const maxPrefix = Math.min(previous.length, next.length);
  while (prefix < maxPrefix && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  const maxSuffix = Math.min(previous.length - prefix, next.length - prefix);
  while (suffix < maxSuffix && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  // previous[prefix, len-suffix) 被替换为 next[prefix, len-suffix)
  const delta = next.length - previous.length;
  const adjusted: RichRun[] = [];
  for (const run of runs) {
    let start = run.start, end = run.end;
    if (end <= prefix) {
      // 完全在编辑点之前
    } else if (start >= previous.length - suffix) {
      start += delta; end += delta;
    } else {
      // 与编辑区重叠: 保留编辑点之前的部分
      end = Math.min(end, prefix);
      if (start >= prefix) start = prefix;
      if (end - start < 1) continue;
    }
    adjusted.push({ ...run, start, end });
  }
  return adjusted;
}

export type StyledSegment = { text: string; textbook?: string; color?: string; hl?: string; b?: boolean; u?: boolean };

/** 组合渲染: 教材标记 ⟦k|…⟧(绿/蓝/红/黄底/黑体) 与个人 runs(color/hl/b/u, 纯文本偏移)叠加,
 *  输出连续同样式段。正文默认字号由渲染端保证——这里不产生任何字号差异。 */
export function renderRichSegments(text: string, runs: RichRun[] = []): StyledSegment[] {
  const segments: { content: string; textbook?: string; plainStart: number }[] = [];
  let plainStart = 0, last = 0;
  for (const match of text.matchAll(/⟦([gbrys])\|([^⟧]*)⟧/g)) {
    const index = match.index ?? 0;
    if (index > last) {
      segments.push({ content: text.slice(last, index), plainStart });
      plainStart += index - last;
    }
    const inner = match[2];
    segments.push({ content: inner, textbook: match[1], plainStart });
    plainStart += inner.length;
    last = index + match[0].length;
  }
  if (last < text.length) {
    segments.push({ content: text.slice(last), plainStart });
    plainStart += text.length - last;
  }
  if (!segments.length) return [];
  // 每个纯文本字符叠加命中的 runs
  const charStyle: (Record<string, string | boolean> | null)[] = new Array(plainStart).fill(null);
  for (const run of sanitizeRuns(runs, plainStart)) {
    for (let i = run.start; i < run.end; i += 1) {
      const style = charStyle[i] || (charStyle[i] = {});
      if (run.kind === "color" && run.value) style.color = run.value;
      else if (run.kind === "hl" && run.value) style.hl = run.value;
      else if (run.kind === "b") style.b = true;
      else style.u = true;
    }
  }
  const TEXTBOOK_CLASS: Record<string, string> = { g: "hl-g", b: "hl-b", r: "hl-r", y: "hl-y", s: "hl-s" };
  const out: StyledSegment[] = [];
  let current: StyledSegment | null = null;
  const signature = (segment: { textbook?: string }, index: number) => {
    const style = charStyle[index];
    return JSON.stringify([segment.textbook || "", style ? Object.entries(style).sort() : []]);
  };
  let runningSignature: string | null = null;
  for (const segment of segments) {
    for (let i = 0; i < segment.content.length; i += 1) {
      const sign = signature(segment, segment.plainStart + i);
      if (current && sign === runningSignature) current.text += segment.content[i];
      else {
        const style = charStyle[segment.plainStart + i] || {};
        current = {
          text: segment.content[i],
          ...(segment.textbook ? { textbook: TEXTBOOK_CLASS[segment.textbook] || segment.textbook } : {}),
          ...(typeof style.color === "string" ? { color: style.color } : {}),
          ...(typeof style.hl === "string" ? { hl: style.hl } : {}),
          ...(style.b === true ? { b: true } : {}),
          ...(style.u === true ? { u: true } : {}),
        };
        out.push(current);
        runningSignature = sign;
      }
    }
  }
  return out;
}

/** 把原文本的教材标记 ⟦k|…⟧ 重新注入到编辑后的文本: 归一化子串匹配, 互不重叠, 先到先得。 */
export function reinjectTextbookMarkers(original: string, edited: string, cap = 12): string {
  const phrases: { key: string; kind: string }[] = [];
  for (const segment of parseHighlightMarkers(original)) {
    if (segment.kind !== "text") {
      const key = segment.text.replace(/[^0-9a-z\u4e00-\u9fff]/gi, "").toLowerCase();
      if (key.length >= 4) phrases.push({ key, kind: segment.kind });
    }
  }
  if (!phrases.length) return edited;
  const KEEP = /[^0-9a-z\u4e00-\u9fff]/i;
  const normalized: { char: string; index: number }[] = [];
  for (let i = 0; i < edited.length; i += 1) {
    const low = edited[i].toLowerCase();
    if (KEEP.test(low)) continue;
    normalized.push({ char: low, index: i });
  }
  const haystack = normalized.map(item => item.char).join("");
  const used: { start: number; end: number; kind: string }[] = [];
  for (const phrase of phrases) {
    if (used.length >= cap) break;
    let start = 0;
    while (true) {
      const hit = haystack.indexOf(phrase.key, start);
      if (hit < 0) break;
      const oStart = normalized[hit].index;
      const oEnd = normalized[hit + phrase.key.length - 1].index + 1;
      if (used.every(hit2 => oEnd <= hit2.start || oStart >= hit2.end)) {
        used.push({ start: oStart, end: oEnd, kind: phrase.kind });
        break;
      }
      start = hit + 1;
    }
  }
  let result = edited;
  for (const hit of [...used].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, hit.start) + `⟦${hit.kind}|${result.slice(hit.start, hit.end)}⟧` + result.slice(hit.end);
  }
  return result;
}

/** 与原内容对比是否实质修改(剥离空白), 用于"未保存修改"判定与冲突展示。 */
export function richEqualsText(a: RichContent | undefined, plain: string): boolean {
  const left = (a?.text || "").replace(/\s+/g, "");
  const right = plain.replace(/\s+/g, "");
  return left === right && !(a?.runs || []).length;
}
