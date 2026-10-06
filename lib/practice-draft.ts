/** 自测/重练进行中试卷的持久化: 题目、作答与位置随学习会话保存, 刷新后可续做。
 *  存储在独立的轻量键(不走 learning-session 的草稿结构), 与备份系统解耦——
 *  试卷是临时状态, 备份不含它; 丢了的代价只是重做一组题。 */

export type SavedRound = {
  version: 1;
  subject: string;
  mode: "practice" | "requiz";
  meta: { bookId: string; bookName: string; chapter: number; scope: "chapter" | "book" };
  questions: { cardId: string; stem: string; hint: string; options: string[]; answer: number; source: string }[];
  index: number;
  choice: number | null;
  right: number;
  /** 已作答的 {cardId: 所选index}; index-1 及之前各题。最后一题未确认不计。 */
  answers: Record<string, number>;
  savedAt: string;
};

export const practiceDraftKey = "yantu-practice-round-v1";
const MAX_QUESTIONS = 60;
const MAX_AGE_MS = 3 * 86400000;

export function savePracticeRound(round: Omit<SavedRound, "version" | "savedAt">): boolean {
  if (round.questions.length > MAX_QUESTIONS) return false;
  const payload: SavedRound = { ...round, version: 1, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(practiceDraftKey, JSON.stringify(payload));
    return true;
  } catch { return false; }
}

export function clearPracticeRound(): void {
  try { localStorage.removeItem(practiceDraftKey); } catch { /* ignore */ }
}

/** 读取可续做的试卷: 同科目同模式且三天内才有效; 损坏/过期返回 null。 */
export function loadPracticeRound(subject: string, mode: "practice" | "requiz"): SavedRound | null {
  try {
    const raw = localStorage.getItem(practiceDraftKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<SavedRound>;
    if (row.version !== 1 || row.subject !== subject || row.mode !== mode) return null;
    if (!Array.isArray(row.questions) || !row.questions.length || row.questions.length > MAX_QUESTIONS) return null;
    if (!row.questions.every(q => q && typeof q.cardId === "string" && Array.isArray(q.options) && typeof q.answer === "number" && q.answer >= 0 && q.answer < (q.options.length || 0))) return null;
    if (typeof row.savedAt !== "string" || !Number.isFinite(Date.parse(row.savedAt)) || Date.now() - Date.parse(row.savedAt) > MAX_AGE_MS) return null;
    const index = typeof row.index === "number" && Number.isInteger(row.index) && row.index >= 0 && row.index < row.questions.length ? row.index : 0;
    const answers = row.answers && typeof row.answers === "object" && !Array.isArray(row.answers)
      ? Object.fromEntries(Object.entries(row.answers).filter(([, v]) => typeof v === "number" && v >= 0 && v < 4))
      : {};
    return {
      version: 1,
      subject: String(row.subject),
      mode: row.mode === "requiz" ? "requiz" : "practice",
      meta: row.meta && typeof row.meta === "object" ? { ...row.meta } as SavedRound["meta"] : { bookId: "", bookName: "", chapter: 1, scope: "chapter" },
      questions: row.questions.map(q => ({ cardId: q.cardId, stem: String(q.stem || ""), hint: String(q.hint || ""), options: q.options.map(String), answer: q.answer, source: String(q.source || "") })),
      index,
      choice: typeof row.choice === "number" ? row.choice : null,
      right: typeof row.right === "number" ? row.right : 0,
      answers,
      savedAt: row.savedAt,
    };
  } catch { return null; }
}
