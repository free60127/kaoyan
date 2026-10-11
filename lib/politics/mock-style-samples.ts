/** 肖1000题出题模式范本: 从试题分册精选的真实题目, 作为政治 AI 模拟卷的 few-shot 样例。
 *  样例由 OCR 提取管线生成 mock-style-samples.json（按书目分组, 每书单选/多选各若干题）。 */
export type PoliticsStyleSample = { type: string; stem: string; options?: string[]; answers?: number[]; answer?: number; referenceAnswer?: string; source: string };

let cache: Record<string, PoliticsStyleSample[]> | null = null;
let loaded = false;

async function loadSamples(): Promise<Record<string, PoliticsStyleSample[]>> {
  if (loaded) return cache ?? {};
  loaded = true;
  try {
    const module = await import("./mock-style-samples.json");
    const data = module.default as Record<string, PoliticsStyleSample[]>;
    cache = data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch { cache = {}; }
  return cache ?? {};
}

/** 该书目的出题模式样例（每书最多 6 题: 单选在前多选在后, 分析题 1 题）。 */
export async function politicsStyleSamples(bookId: string): Promise<PoliticsStyleSample[]> {
  const data = await loadSamples();
  const samples = data[bookId];
  if (Array.isArray(samples)) return samples.slice(0, 6);
  // 未生成样例时兜底: 从肖1000题库取该章真实题当风格样例（同样来自肖1000）
  try {
    const { loadPoliticsChoiceBank } = await import("../choice-bank");
    const bank: Awaited<ReturnType<typeof loadPoliticsChoiceBank>> = await loadPoliticsChoiceBank();
    const { stripHighlightMarkers } = await import("../highlight-markers");
    return bank.filter((row) => row.book === bookId).slice(0, 4).map((row) => {
      const answers = row.multi && row.answers ? row.answers : [row.answer];
      return {
        type: answers.length > 1 ? "multiple-choice" : "single-choice",
        stem: stripHighlightMarkers(row.stem),
        options: row.options.map(stripHighlightMarkers),
        answers: answers.length > 1 ? answers : undefined,
        answer: answers.length > 1 ? undefined : answers[0],
        source: row.source,
      };
    });
  } catch { return []; }
}
