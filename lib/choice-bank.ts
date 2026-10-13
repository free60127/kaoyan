/** 333 选择题库: 丹丹1000题、阶段测试卷、丹丹中秋国庆卷的结构化选择题, 按四书分类。 */
import type { SavedQuestion } from "./practice-draft";

export type ChoiceQuestion = {
  id: string;
  /** 333 四书或政治五科的书目 id。 */
  book: string;
  bookName: string;
  origin: string;
  examTag: string;
  number: number;
  chapter: string;
  stem: string;
  options: string[];
  answer: number;
  /** 多选题正确项(升序); 存在即多选题(考研政治多选)。 */
  answers?: number[];
  multi?: boolean;
  optionAnalysis: string[];
  referenceAnswer: string;
  source: string;
};

/** 统一判分: 单选按 answer, 多选全对才对(漏选/错选不得分)。 */
export function choiceIsCorrect(question: ChoiceQuestion, picked: number | number[]): boolean {
  if (question.multi && question.answers) {
    const chosen = Array.isArray(picked) ? picked : [picked];
    if (chosen.length !== question.answers.length) return false;
    const sorted = [...chosen].sort((a, b) => a - b);
    return question.answers.every((item, index) => item === sorted[index]);
  }
  return !Array.isArray(picked) && picked === question.answer;
}

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

/** 肖1000题政治题库(试题分册+解析分册对齐), 结构与 333 题库一致 + 多选字段。 */
export async function loadPoliticsChoiceBank(): Promise<ChoiceQuestion[]> {
  const module = await import("./politics/choice-bank-politics.json");
  const data = module.default as ChoiceQuestion[];
  if (!data.length) throw new Error("politics choice bank empty");
  return data;
}

export const politicsChoiceBookName: Record<string, string> = {
  mayuan: "马克思主义基本原理",
  maozhongte: "毛泽东思想和中国特色社会主义理论体系概论",
  xinsixiang: "习近平新时代中国特色社会主义思想概论",
  shigang: "中国近现代史纲要",
  sixiu: "思想道德与法治",
};

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
      book: question.book,
      optionAnalysis: question.optionAnalysis,
      referenceAnswer: question.referenceAnswer,
      bookName: question.bookName,
      origin: question.origin,
      examTag: question.examTag,
      chapter: question.chapter,
      number: question.number,
      ...(question.multi && question.answers ? { multi: true, answers: question.answers } : {}),
    },
  };
}

/** 草稿题 -> 题库题(恢复 extra; 非题库题如闪卡自测题退化为基础形态)。 */
export function fromSavedQuestion(saved: SavedQuestion): ChoiceQuestion {
  const extra = (saved.extra || {}) as Record<string, unknown>;
  const answers = Array.isArray(extra.answers) && extra.answers.every((item) => typeof item === "number") ? (extra.answers as number[]) : undefined;
  const multi = extra.multi === true && !!answers && answers.length > 1;
  return {
    id: typeof extra.id === "string" ? extra.id : saved.cardId,
    book: typeof extra.book === "string" ? extra.book : "principles",
    bookName: typeof extra.bookName === "string" ? extra.bookName : "",
    origin: typeof extra.origin === "string" ? extra.origin : "",
    examTag: typeof extra.examTag === "string" ? extra.examTag : saved.hint,
    number: typeof extra.number === "number" ? extra.number : 0,
    chapter: typeof extra.chapter === "string" ? extra.chapter : "",
    stem: saved.stem,
    options: saved.options,
    answer: saved.answer,
    ...(multi && answers ? { multi: true, answers } : {}),
    optionAnalysis: Array.isArray(extra.optionAnalysis) ? extra.optionAnalysis.map(String) : [],
    referenceAnswer: typeof extra.referenceAnswer === "string" ? extra.referenceAnswer : "",
    source: saved.source,
  };
}

/** 选项展示前去掉数据里已带的 "A." 前缀(R9), 避免组件标签叠加成 "A A."。 */
export function stripOptionLabel(text: string): string {
  return text.replace(/^\s*([A-D])[.、．)]\s*/, "");
}

/** 打乱一道题的选项顺序(C): 防止"背 A 素材"式记忆; answer 下标同步重映射。真题选项顺序有意义时默认关闭。 */
/** 乱序后同步逐项解析的段首字母: 解析段以 "A正确/B错误/D说法…" 开头, 按旧字母→新字母
 *  只替换段首标记, 不碰正文(避免误改英文内容); 无段首字母的段原样保留。 */
function remapOptionAnalysis(analysis: readonly string[], mapping: Record<string, string>): string[] {
  return analysis.map(segment => {
    const match = /^([A-D])(\s*[、.，,：:]\s*|\s*(?=正确|错误|说法|项))/.exec(segment);
    if (!match) return segment;
    const mapped = mapping[match[1]];
    return mapped ? mapped + segment.slice(1) : segment;
  });
}

export function shuffleQuestionOptions(question: ChoiceQuestion, rng: () => number): ChoiceQuestion {
  const indices = question.options.map((_, index) => index);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const options = indices.map(index => question.options[index]);
  const answer = indices.indexOf(question.answer);
  // 多选题: 正确项集合同步重映射(乱序后答案位置跟随选项)
  const answers = question.multi && question.answers ? question.answers.map(item => indices.indexOf(item)).sort((a, b) => a - b) : undefined;
  // 逐项解析的字母跟随选项: 新位置 i 显示的是旧选项 indices[i]
  const mapping: Record<string, string> = {};
  indices.forEach((oldIndex, newPosition) => { mapping["ABCD"[oldIndex]] = "ABCD"[newPosition]; });
  const optionAnalysis = question.optionAnalysis.length ? remapOptionAnalysis(question.optionAnalysis, mapping) : question.optionAnalysis;
  return { ...question, options, answer, ...(answers ? { answers } : {}), optionAnalysis };
}

/** 全卷乱序: 同一 seed 下确定性重排。 */
export function shuffleOptions(questions: readonly ChoiceQuestion[], seed: number): ChoiceQuestion[] {
  const rng = mulberry32(seed);
  return questions.map(question => shuffleQuestionOptions(question, rng));
}
