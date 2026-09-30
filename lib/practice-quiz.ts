/** 从既有闪卡生成选择题自测: 题干用卡正面, 正确项取卡背首句, 干扰项取同章其他卡的答案。 */

export type PracticeCard = { id: string; book: string; chapter: number; front: string; back: string };
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

export function firstAnswerClause(back: string, max = 96): string {
  const cleaned = back.replace(PIN_LINE, "").trim();
  const firstLine = cleaned.split(/[\n。；;]/)[0].trim() || cleaned.slice(0, max);
  return firstLine.length > max ? firstLine.slice(0, max - 1) + "…" : firstLine;
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type PracticeOptions = { bookId: string; chapters?: number[]; count: number; seed: number };

export function buildPracticeQuestions(cards: readonly PracticeCard[], options: PracticeOptions): PracticeQuestion[] {
  const { bookId, count, seed } = options;
  const pool = cards.filter(card => card.book === bookId && (!options.chapters || options.chapters.length === 0 || options.chapters.includes(card.chapter)));
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
