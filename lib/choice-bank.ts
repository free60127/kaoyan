/** 333 选择题库: 丹丹1000题、阶段测试卷、丹丹中秋国庆卷的结构化选择题, 按四书分类。 */
import type { SavedQuestion } from "./practice-draft";

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

/** 组卷池(R3): 书目/来源筛选之后必须再过滤人工排除项——"可用N题"、抽题、重练共用同一最终池。 */
export function drillPool(questions: readonly ChoiceQuestion[], filter: { book: string; origin: string }, excluded: ReadonlySet<string>): ChoiceQuestion[] {
  return questions.filter(question =>
    (filter.book === "all" || question.book === filter.book)
    && (filter.origin === "all" || question.origin === filter.origin)
    && !excluded.has(question.id));
}

/** 错题重练(R4): 按错题本 refId 取回原题(原选项/原解析), 顺序按传入的 refId(错题本最新优先)。 */
export function drillRequizQuestions(bank: readonly ChoiceQuestion[], refIds: readonly string[]): ChoiceQuestion[] {
  const byId = new Map(bank.map(question => [question.id, question]));
  const seen = new Set<string>();
  const out: ChoiceQuestion[] = [];
  for (const refId of refIds) {
    const question = byId.get(refId);
    if (!question || seen.has(question.id)) continue;
    seen.add(question.id);
    out.push(question);
  }
  return out;
}

export const choiceOptionKeys = undefined as never; // placeholder removal marker

/** 题库题 -> 可持久化草稿题(解析等附加字段放 extra, 刷新续做后仍能显示完整辨析)。 */
export function toSavedQuestion(question: ChoiceQuestion, cardId: string): SavedQuestion {
  return {
    cardId,
    stem: question.stem,
    hint: question.examTag || "",
    options: question.options,
    answer: question.answer,
    source: question.source,
    extra: {
      id: question.id,
      optionAnalysis: question.optionAnalysis,
      referenceAnswer: question.referenceAnswer,
      bookName: question.bookName,
      origin: question.origin,
      examTag: question.examTag,
      chapter: question.chapter,
      number: question.number,
    },
  };
}

/** 草稿题 -> 题库题(恢复 extra; 非题库题如闪卡自测题退化为基础形态)。 */
export function fromSavedQuestion(saved: SavedQuestion): ChoiceQuestion {
  const extra = (saved.extra || {}) as Record<string, unknown>;
  return {
    id: typeof extra.id === "string" ? extra.id : saved.cardId,
    book: (typeof extra.book === "string" ? extra.book : "principles") as ChoiceQuestion["book"],
    bookName: typeof extra.bookName === "string" ? extra.bookName : "",
    origin: typeof extra.origin === "string" ? extra.origin : "",
    examTag: typeof extra.examTag === "string" ? extra.examTag : saved.hint,
    number: typeof extra.number === "number" ? extra.number : 0,
    chapter: typeof extra.chapter === "string" ? extra.chapter : "",
    stem: saved.stem,
    options: saved.options,
    answer: saved.answer,
    optionAnalysis: Array.isArray(extra.optionAnalysis) ? extra.optionAnalysis.map(String) : [],
    referenceAnswer: typeof extra.referenceAnswer === "string" ? extra.referenceAnswer : "",
    source: saved.source,
  };
}

/** 选项展示前去掉数据里已带的 "A." 前缀(R9), 避免组件标签叠加成 "A A."。 */
export function stripOptionLabel(text: string): string {
  return text.replace(/^\s*([A-D])[.、．)]\s*/, "");
}
