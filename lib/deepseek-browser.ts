import { cards, questions, type Question } from "./study-data";
import { load825StudyData, type Card825 } from "./825/study-data";

type Mode = "plan" | "feedback" | "quiz";
type Context = { subject?: string; book?: string; bookId?: string; chapterNo?: number; chapter?: string; section?: string; done?: number; due?: number; date?: string; exam?: string };
export type GeneratedOpenQuestion = { type: string; stem: string; referenceAnswer: string; rationale: string };
type Result = { text?: string; question?: Question; openQuestion?: GeneratedOpenQuestion };
const FACT_LIMIT = 3800;
export const cleanApiKey = (value: string) => value.replace(/[\s\u200b-\u200f\uFEFF"'“”‘’]+/g, "");
const trimText = (value: string, max: number) => value.length > max ? value.slice(0, max) + "…" : value;

function chooseCards(rows: { front: string; back: string; section?: string }[], mode: Mode, section?: string) {
  const sectionRows = section ? rows.filter((row) => row.section === section) : rows;
  const candidates = section ? sectionRows : rows;
  const maxCards = mode === "plan" ? 4 : mode === "quiz" ? 7 : 6;
  let used = 0;
  const picked: { front: string; back: string }[] = [];
  for (const card of candidates) {
    if (picked.length >= maxCards || used >= FACT_LIMIT) break;
    const front = trimText(card.front, 320), back = trimText(card.back, 420);
    const cost = front.length + back.length;
    if (used + cost > FACT_LIMIT) break;
    picked.push({ front, back }); used += cost;
  }
  return picked;
}

export async function askDeepSeek(key: string, mode: Mode, prompt: string, ctx: Context): Promise<Result> {
  // 去掉复制时可能混入的空白、零宽字符和引号，避免 Key 被无谓判为无效。
  const cleanKey = cleanApiKey(key);
  if (!cleanKey || !prompt.trim()) throw new Error("请填写 API Key 和学习内容。");
  if (prompt.length > 8000) throw new Error("输入内容过长，请缩短后重试。");
  const is825 = ctx.subject === "825";
  let notes: { front: string; back: string }[] = [];
  let pastStyle: { year: number; type: string; stem: string }[] = [];
  let currentBook = ctx.book || "";
  if (is825) {
    const data = await load825StudyData();
    currentBook = data.books.find((item) => item.id === ctx.bookId)?.name || currentBook;
    const relevantCards = data.cards.filter((item) => item.book === ctx.bookId && (!ctx.chapterNo || item.chapter === ctx.chapterNo)) as Card825[];
    notes = chooseCards(relevantCards, mode, ctx.section);
    if (mode === "quiz") {
      if (!notes.length) throw new Error("当前书目和小节没有可供命题的笔记知识点。");
      pastStyle = data.questions.filter((item) => item.book === ctx.bookId && item.practiceReady).slice(0, 7).map((item) => ({ year: item.year, type: item.type, stem: trimText(item.stem, 280) }));
    }
  } else {
    const relevantCards = cards.filter((item) => item.book === ctx.bookId && item.chapter === ctx.chapterNo && !item.id.startsWith("outline-"));
    notes = chooseCards(relevantCards, mode);
    if (mode === "quiz" && !relevantCards.length && !questions.some((item) => item.book === ctx.bookId && item.chapter === ctx.chapterNo)) throw new Error("该章暂缺可核对资料，暂不能生成可靠的模拟题。");
  }

  const system = mode === "feedback"
    ? is825
      ? "你是东北师范大学英语专业基础考研的严谨复习辅导老师。根据用户复述与提供的笔记给出练习性反馈：可给出建议性分数、准确点、遗漏或待核实处、一个改进示例和复习建议。分数不是官方或权威评分。参考材料不充分时说明不确定，不补造教材页码、章节归属或官方答案。语言可随用户复述切换中文或英文。"
      : "你是333教育综合考研的严谨辅导老师。给出100分制练习性评分（只评所提供内容）、准确点、缺漏或错误、一个具体改进示范、下一步建议。若无法核对具体教材事实，说明不确定，不编造页码或真题。使用简洁中文。"
    : mode === "quiz"
      ? is825
        ? "你是东北师范大学英语专业基础命题练习助手。根据用户给出的当前笔记知识点和题型样例，写一道全新的开放题；题型可为名词解释、简答或论述。它必须与历年真题清楚区分，不能声称来自任何年份、真题或章节映射。只能考查给定笔记支持的内容。输出严格JSON：{\"type\":\"题型\",\"stem\":\"新题题干\",\"referenceAnswer\":\"AI生成的参考思路，不保证权威或完整\",\"rationale\":\"简要说明考查的笔记知识点\"}。"
        : "你是333教育综合考研命题练习助手。根据提供的已核对知识点与真题风格，出一道全新的单项选择模拟题。只能考查给定资料支持的事实。严格JSON：{\"stem\":\"题干\",\"options\":[\"A选项\",\"B选项\",\"C选项\",\"D选项\"],\"answer\":0,\"explanation\":\"解释\"}。answer为0到3的整数。不要称为真题，不编造出处。"
      : "你是东北师范大学考研学习规划助手。结合用户当前科目、进度和提供的少量相关笔记，给出今天可执行的计划，包含时长、主动回忆、练习和复盘。只在上下文包含资料时使用具体知识点；不要编造官方考试安排、章节归属或标准答案。使用简洁中文。";

  const context = "日期：" + (ctx.date || "") + "；目标：" + (ctx.exam || "") + "；科目：" + (ctx.subject || "") + "；当前书目：" + currentBook + "；当前章节：" + (ctx.chapter || "") + "；小节：" + (ctx.section || "") + "；已学章节：" + (ctx.done || 0) + "；待复习卡片：" + (ctx.due || 0) + "。";
  const facts = notes.length ? "\n相关笔记摘录（限量，可能不完整）：" + JSON.stringify(notes) : "";
  const questionStyle = mode === "quiz" && is825 && pastStyle.length ? "\n同书历年题型样例，仅用于了解题型，不构成新题出处或章节归属：" + JSON.stringify(pastStyle) : "";
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cleanKey },
      body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "system", content: system }, { role: "user", content: context + facts + questionStyle + "\n\n用户输入：" + prompt }], stream: false, max_tokens: 1200, ...(mode === "quiz" ? { response_format: { type: "json_object" } } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error("连接 DeepSeek 超时或网络不可用。"); }
  if (!response.ok) {
    let detail = "";
    try { const body = await response.json() as { error?: { message?: string }; message?: string }; detail = body?.error?.message || body?.message || ""; } catch { /* 保留空 detail */ }
    if (response.status === 401) throw new Error("DeepSeek 拒绝了这个 Key（401" + (detail ? "：" + detail : "") + "）。请到 platform.deepseek.com 重新完整复制以 sk- 开头的 Key，注意不要混入多余字符。");
    throw new Error("DeepSeek 请求失败（" + response.status + (detail ? "：" + detail : "") + "），请稍后重试。");
  }
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek 未返回内容，请重试。");
  if (mode !== "quiz") return { text };

  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("生成题目格式有误，请重试。"); }
  if (!value || typeof value !== "object") throw new Error("生成题目格式有误，请重试。");
  const result = value as Record<string, unknown>;
  if (is825) {
    if (typeof result.type !== "string" || typeof result.stem !== "string" || typeof result.referenceAnswer !== "string" || typeof result.rationale !== "string") throw new Error("开放题格式有误，请重试。");
    return { openQuestion: { type: trimText(result.type, 80), stem: trimText(result.stem, 1600), referenceAnswer: trimText(result.referenceAnswer, 2400), rationale: trimText(result.rationale, 800) } };
  }
  if (typeof result.stem !== "string" || !Array.isArray(result.options) || result.options.length !== 4 || result.options.some((item) => typeof item !== "string") || !Number.isInteger(result.answer) || Number(result.answer) < 0 || Number(result.answer) > 3 || typeof result.explanation !== "string") throw new Error("生成题目格式有误，请重试。");
  return { question: { id: "generated", year: 0, book: ctx.bookId || "", chapter: ctx.chapterNo || 1, stem: result.stem, options: result.options as string[], answer: Number(result.answer), explanation: result.explanation, source: "AI 模拟题 · 基于已核对闪卡与真题风格生成，非历年真题" } };
}
