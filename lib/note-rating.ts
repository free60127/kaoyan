/** "我的补充"星级与题型标签: 把 note.text 里的"评级行"(仅由 ⭐ 与 #标签 组成的行)
 *  解析出来, 供快捷评分 UI 一键改写。评级行约定形如 "⭐⭐⭐ #选 #简"。 */

export const NOTE_TAGS = ["#选", "#多", "#填", "#判", "#解", "#简", "#论", "#分", "#案"] as const;
export type NoteTag = (typeof NOTE_TAGS)[number];

const STAR = "⭐";
const RATING_LINE = /^[\u2B50\u2605]{0,5}\s*(?:#[^\s#]{1,4}\s*)*$/;

export type ParsedRating = { stars: number; tags: string[]; lineIndex: number };

/** 找到评级行(整行只由星级与标签构成); 没有返回 null。 */
export function parseNoteRating(text: string): ParsedRating | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;
    const hasMark = /\u2B50|\u2605/.test(line) || line.includes("#");
    if (!hasMark || !RATING_LINE.test(line)) continue;
    const stars = (line.match(/\u2B50|\u2605/g) || []).length;
    const tags = line.match(/#[^\s#]{1,4}/g) || [];
    return { stars, tags: [...new Set(tags)], lineIndex: i };
  }
  return null;
}

const formatLine = (stars: number, tags: string[]) => {
  const body = [STAR.repeat(stars), tags.join(" ")].filter(Boolean).join(" ");
  return body.trim();
};

/** 设定星级(0=清除星级, 保留标签); 无评级行时插入到文本开头。 */
export function applyNoteStars(text: string, stars: number): string {
  if (!Number.isInteger(stars) || stars < 0 || stars > 5) throw new RangeError("stars must be 0-5");
  const parsed = parseNoteRating(text);
  if (!parsed) {
    if (stars === 0) return text;
    return text ? `${formatLine(stars, [])}\n${text}` : formatLine(stars, []);
  }
  const lines = text.split("\n");
  const merged = formatLine(stars, parsed.tags);
  if (!merged) lines.splice(parsed.lineIndex, 1);
  else lines[parsed.lineIndex] = merged;
  return lines.join("\n");
}

/** 切换一个题型标签; 无评级行时在文本开头创建。 */
export function applyNoteTag(text: string, tag: string): string {
  if (!(NOTE_TAGS as readonly string[]).includes(tag)) throw new RangeError(`unknown tag: ${tag}`);
  const parsed = parseNoteRating(text);
  if (!parsed) return text ? `${formatLine(0, [tag])}\n${text}` : formatLine(0, [tag]);
  const tags = parsed.tags.includes(tag) ? parsed.tags.filter(item => item !== tag) : [...parsed.tags, tag];
  const lines = text.split("\n");
  const merged = formatLine(parsed.stars, tags);
  if (!merged) lines.splice(parsed.lineIndex, 1);
  else lines[parsed.lineIndex] = merged;
  return lines.join("\n");
}
