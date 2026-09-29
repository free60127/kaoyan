import { cards, questions, type Question } from "./study-data";

type Mode = "plan" | "feedback" | "quiz";
type Context = { subject?: string; book?: string; bookId?: string; chapterNo?: number; chapter?: string; done?: number; due?: number; date?: string; exam?: string };

export async function askDeepSeek(key: string, mode: Mode, prompt: string, ctx: Context): Promise<{ text?: string; question?: Question }> {
  if (!key.trim() || !prompt.trim()) throw new Error("请填写 API Key 和学习内容。");
  if (prompt.length > 8000) throw new Error("输入内容过长，请缩短后重试。");
  const relevantCards = cards.filter(x => x.book === ctx.bookId && x.chapter === ctx.chapterNo && !x.id.startsWith("outline-"));
  const relevantQuestions = questions.filter(x => x.book === ctx.bookId && x.chapter === ctx.chapterNo);
  if (mode === "quiz" && !relevantCards.length && !relevantQuestions.length) throw new Error("该章暂缺可核对资料，暂不能生成可靠的模拟题。");
  const system = mode === "feedback"
    ? "你是333教育综合考研的严谨辅导老师。用户使用费曼学习法复述知识。请给出100分制评分（只评所提供内容）、准确点、缺漏或错误、一个具体改进示范、下一步复习建议。若无法核对具体教材事实，明确说明不确定，不要编造页码或真题。使用简洁中文。"
    : mode === "quiz" ? "你是333教育综合考研命题练习助手。根据用户提供的已核对知识点和真题风格，出一道全新的单项选择模拟题。只能考查给定资料中能支持的事实。输出严格JSON对象：{\"stem\":\"题干\",\"options\":[\"A选项文字\",\"B选项文字\",\"C选项文字\",\"D选项文字\"],\"answer\":0,\"explanation\":\"解释\"}。answer为0到3的整数。不要称它为真题，不要编造真题出处。"
    : "你是东北师范大学学科英语考研学习规划助手。考试四科为英语二、政治、333教育综合、825英语专业基础，初试目标为2027年12月。请根据用户可用时间和当前进度列出今天可执行的计划，包含时长、学习内容、主动回忆、真题和复盘。不要编造官方考试安排或未提供的825资料。使用简洁中文。";
  const context = `今天：${ctx.date || ""}；目标：${ctx.exam || ""}；科目：${ctx.subject || ""}；333当前书：${ctx.book || ""}；章节：${ctx.chapter || ""}；已学章节：${ctx.done || 0}；待复习卡片：${ctx.due || 0}。`;
  const facts = mode === "plan" ? "" : "\n已核对的本章学习要点（可能仅覆盖部分内容）：" + JSON.stringify(relevantCards.map(x => ({ front: x.front, back: x.back }))) + (mode === "quiz" ? "\n同章节真题风格：" + JSON.stringify(relevantQuestions.map(x => ({ stem: x.stem, options: x.options, answer: x.answer }))) : "");
  let response: Response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key.trim()}` },
      body: JSON.stringify({ model: "deepseek-flash", messages: [{ role: "system", content: system }, { role: "user", content: context + facts + "\n\n用户输入：" + prompt }], stream: false, max_tokens: 1200, ...(mode === "quiz" ? { response_format: { type: "json_object" } } : {}) }),
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error("连接 DeepSeek 超时或网络不可用。"); }
  if (!response.ok) throw new Error(response.status === 401 ? "API Key 无效，请检查后重试。" : `DeepSeek 请求失败（${response.status}），请稍后重试。`);
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("DeepSeek 未返回内容，请重试。");
  if (mode !== "quiz") return { text };
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw new Error("生成题目格式有误，请重试。"); }
  if (!result || typeof result !== "object") throw new Error("生成题目格式有误，请重试。");
  const q = result as { stem?: unknown; options?: unknown; answer?: unknown; explanation?: unknown };
  if (typeof q.stem !== "string" || !Array.isArray(q.options) || q.options.length !== 4 || q.options.some(x => typeof x !== "string") || !Number.isInteger(q.answer) || Number(q.answer) < 0 || Number(q.answer) > 3 || typeof q.explanation !== "string") throw new Error("生成题目格式有误，请重试。");
  return { question: { id: "generated", year: 0, book: ctx.bookId || "", chapter: ctx.chapterNo || 1, stem: q.stem, options: q.options, answer: Number(q.answer), explanation: q.explanation, source: "AI 模拟题 · 基于已核对闪卡与真题风格生成，非历年真题" } };
}
