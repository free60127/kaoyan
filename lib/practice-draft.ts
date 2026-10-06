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
  /** 已确认作答: {题号: 所选选项index}。 */
  answers: Record<string, number>;
  /** 试卷内答错的卡(重练的"移出错题本"判定与自测的错题入库都以恢复后的集合为准)。 */
  wrongIds: string[];
  savedAt: string;
};

/** 每个科目×模式独立草稿键: 开始另一套题不会覆盖别科的未完成卷。 */
export const practiceDraftKey = (subject: string, mode: string) => `yantu-practice-round-v1-${subject}-${mode}`;
const MAX_QUESTIONS = 60;
const MAX_AGE_MS = 3 * 86400000;

export function savePracticeRound(round: Omit<SavedRound, "version" | "savedAt">): boolean {
  if (round.questions.length > MAX_QUESTIONS) return false;
  const payload: SavedRound = { ...round, version: 1, savedAt: new Date().toISOString() };
  try {
    localStorage.setItem(practiceDraftKey(round.subject, round.mode), JSON.stringify(payload));
    return true;
  } catch { return false; }
}

export function clearPracticeRound(subject?: string, mode?: "practice" | "requiz"): void {
  try {
    if (subject && mode) { localStorage.removeItem(practiceDraftKey(subject, mode)); return; }
    // 未指定时清理全部科目的自测草稿(仅自测与重练两族前缀)
    for (const subjectId of ["333", "825", "politics"]) {
      localStorage.removeItem(practiceDraftKey(subjectId, "practice"));
      localStorage.removeItem(practiceDraftKey(subjectId, "requiz"));
    }
  } catch { /* ignore */ }
}

/** 读取可续做的试卷: 同科目同模式且三天内才有效; 损坏/过期返回 null。 */
export function loadPracticeRound(subject: string, mode: "practice" | "requiz"): SavedRound | null {
  try {
    const raw = localStorage.getItem(practiceDraftKey(subject, mode));
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
    const wrongIds = Array.isArray(row.wrongIds) ? row.wrongIds.filter((id): id is string => typeof id === "string" && id.length <= 200) : [];
    return {
      version: 1,
      subject: String(row.subject),
      mode: row.mode === "requiz" ? "requiz" : "practice",
      meta: row.meta && typeof row.meta === "object" ? { ...row.meta } as SavedRound["meta"] : { bookId: "", bookName: "", chapter: 1, scope: "chapter" },
      questions: row.questions.map(q => ({ cardId: q.cardId, stem: String(q.stem || ""), hint: String(q.hint || ""), options: q.options.map(String), answer: q.answer, source: String(q.source || "") })),
      index,
      choice: typeof row.choice === "number" ? row.choice : null,
      right: typeof row.right === "number" ? row.right : 0,
      wrongIds,
      answers,
      savedAt: row.savedAt,
    };
  } catch { return null; }
}
