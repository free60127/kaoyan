export type EssayQuestion = {
  id: string;
  book: string;
  /** 跨书标签(R8): 中外比较等横跨多书的题, 主分类之外还关联的书。 */
  tags?: string[];
  category: string;
  number: number;
  topic: string;
  stem: string;
  referenceAnswer: string;
  ocrWarning: string;
  source: string;
};

/** Called only after the learner opens 主观题库; Vite keeps this JSON out of the initial bundle. */
export async function loadEssayQuestions(): Promise<EssayQuestion[]> {
  const module = await import("./essay-questions.json");
  const data = module.default as EssayQuestion[];
  if (!data.length) throw new Error("essay data empty");
  return data;
}
