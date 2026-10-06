/** 从既有闪卡生成选择题自测: 题干用卡正面, 正确项取卡背首句, 干扰项取同章其他卡的答案。 */

export type PracticeCard = { id: string; book: string; chapter: number; front: string; back: string };
/** 人工"不适合选择题"排除标记(由用户在答题界面设置)。 */
export let mcqExcludedIds: ReadonlySet<string> = new Set();
export function setMcqExcluded(ids: ReadonlySet<string>) { mcqExcludedIds = ids; }
export type PracticeQuestion = { cardId: string; stem: string; hint: string; options: string[]; answer: number; source: string };

const LABEL = /^〔.+?〕\s*/;
const PIN_LINE = /^📌.*$/gm;

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 取卡背的开头若干句作为选项文本: 逐句累加直到达到最小长度, 再按上限截断。
 *  判断式卡片(如“不对。原因是…”)的首句太短, 单独用作选项没有区分度。 */
export function firstAnswerClause(back: string, max = 110): string {
  const cleaned = back.replace(PIN_LINE, "").trim();
  const hasCjk = /[\u4e00-\u9fff]/.test(cleaned);
  const min = hasCjk ? 12 : 30;
  const parts = cleaned.split(/(?<=[。；;\n])/);
  let out = "";
  for (const part of parts) {
    out += part;
    if (out.replace(/\s/g, "").length >= min) break;
  }
  out = out.trim() || cleaned.slice(0, max);
  // 丹丹模式: 选项取首个完整句子(≤64字), 避免长段落选项
  if (out.length > 64) {
    const m = out.match(/^[^。；;]{8,60}[。；;]?/);
    if (m && m[0].replace(/\s/g, "").length >= (hasCjk ? 8 : 18)) out = m[0].trim();
  }
  return out.length > max ? out.slice(0, max - 1) + "…" : out;
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 多点列举/比较类问题不适合"选出一项"的选择题形态(正确项只是部分要点, 选对不等于掌握)。
 *  这些卡仍走闪卡复习与费曼, 不进自动选择自测。 */
const MULTI_POINT_STEM = /(列举|有哪些|包括哪些|哪几[个种项条点]|分别[是说指是]|各自|异同|比较一下|对比一|关系如何|区别.{0,6}联系|几个方面|哪些方面|哪些要求|哪些特点|哪些因素|哪些措施|哪些主张|哪些贡献|哪些内容|哪些任务|哪些条件|哪些原则|哪些方法|哪些类型|哪些形式|哪些特征)/;

export function isMcqSuitable(front: string): boolean {
  return !MULTI_POINT_STEM.test(front.replace(/^〔.+?〕\s*/, ""));
}

export type PracticeOptions = { bookId: string; chapters?: number[]; count: number; seed: number };

export function buildPracticeQuestions(cards: readonly PracticeCard[], options: PracticeOptions): PracticeQuestion[] {
  const { bookId, count, seed } = options;
  const pool = cards.filter(card => card.book === bookId && isMcqSuitable(card.front) && !mcqExcludedIds.has(card.id) && (!options.chapters || options.chapters.length === 0 || options.chapters.includes(card.chapter)));
  const rng = mulberry32(seed);
  const chosen = shuffled(pool, rng).slice(0, Math.max(0, Math.min(count, pool.length)));
  const answersByChapter = new Map<number, string[]>();
  for (const card of pool) {
    const list = answersByChapter.get(card.chapter) || [];
    list.push(firstAnswerClause(card.back));
    answersByChapter.set(card.chapter, list);
  }
  const bookAnswers = pool.map(card => firstAnswerClause(card.back));
  return chosen.map(card => {
    const hintMatch = card.front.match(LABEL);
    const stem = card.front.replace(LABEL, "");
    const correct = firstAnswerClause(card.back);
    const sameChapter = (answersByChapter.get(card.chapter) || []).filter(text => text && text !== correct);
    const source = sameChapter.length >= 3 ? sameChapter : bookAnswers.filter(text => text && text !== correct);
    const distractors: string[] = [];
    for (const candidate of shuffled(source, rng)) {
      if (distractors.length >= 3) break;
      if (!distractors.includes(candidate) && candidate !== correct) distractors.push(candidate);
    }
    const options = shuffled([correct, ...distractors], rng);
    return {
      cardId: card.id,
      stem,
      hint: hintMatch ? hintMatch[0].replace(/[〔〕\s]/g, "").slice(0, 30) : "",
      options,
      answer: options.indexOf(correct),
      source: `闪卡自测 · ${card.book} 第${card.chapter}章`,
    };
  });
}
