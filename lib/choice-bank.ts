/** 333 选择题库: 丹丹1000题、阶段测试卷、丹丹中秋国庆卷的结构化选择题, 按四书分类。 */
export type ChoiceQuestion = {
  id: string;
  book: "principles" | "china" | "foreign" | "psychology";
  bookName: string;
  origin: string;
  examTag: string;
  number: number;
  chapter: string;
  stem: string;
  options: string[];
  answer: number;
  optionAnalysis: string[];
  referenceAnswer: string;
  source: string;
};

export const choiceBookName: Record<ChoiceQuestion["book"], string> = {
  principles: "教育学原理",
  china: "中国教育史",
  foreign: "外国教育史",
  psychology: "教育心理学",
};

/** Called only after the learner opens the choice bank; Vite keeps this JSON out of the initial bundle. */
export async function loadChoiceBank(): Promise<ChoiceQuestion[]> {
  const module = await import("./choice-bank.json");
  const data = module.default as ChoiceQuestion[];
  if (!data.length) throw new Error("choice bank empty");
  return data;
}

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 洗牌一份题(随机种子), 选项顺序保持原样(真题选项顺序有意义)。 */
export function pickChoices(pool: readonly ChoiceQuestion[], count: number, seed: number): ChoiceQuestion[] {
  const rng = mulberry32(seed);
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, Math.max(0, Math.min(count, out.length)));
}
