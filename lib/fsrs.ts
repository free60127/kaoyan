/** FSRS 调度引擎 —— 严格按 open-spaced-repetition/py-fsrs（FSRS-6, 21 参数）官方实现移植。
 *  只负责记忆状态数学与间隔计算；到期时刻的本地日历约定（6:30 早复习）由 study-scheduler 统一处理。
 *  不做官方默认的随机 fuzz：调度必须可复现，同步与撤销才能对账。 */

export type FsrsGrade = 1 | 2 | 3 | 4; // 1=重记(again) 2=困难(hard) 3=良好(good) 4=轻松(easy)
export type FsrsStage = "learning" | "review" | "relearning";

/** 每卡记忆状态（存储在 ReviewState.fsrs，键名取短以省同步体积） */
export type FsrsMemory = {
  s: number; // 稳定性 stability（天）：保留率 90% 时的间隔
  d: number; // 难度 difficulty（1-10）
  st: FsrsStage;
  step: number | null; // learning/relearning 阶段的步数
  lr: string; // lastReview ISO
};

export type FsrsConfig = { parameters: readonly number[]; retention: number };

/** 官方默认参数（py-fsrs DEFAULT_PARAMETERS，FSRS-6） */
export const FSRS_DEFAULT_PARAMETERS = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
  0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658,
  0.1542,
] as const;

export const FSRS_RETENTION_MIN = 0.7;
export const FSRS_RETENTION_MAX = 0.98;
export const STABILITY_MIN = 0.001;
export const DIFFICULTY_MIN = 1;
export const DIFFICULTY_MAX = 10;

/** 与官方一致的默认短步长（分钟）：learning [1m, 1d]、relearning [10m]。
 *  第二步取 1 天而非官方示例的 10 分钟——本应用新卡「良好」次日复习的既有体验保持不变。 */
export const FSRS_LEARNING_STEPS_MINUTES = [1, 1440] as const;
export const FSRS_RELEARNING_STEPS_MINUTES = [10] as const;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const clampStability = (value: number) => Math.max(value, STABILITY_MIN);
const clampDifficulty = (value: number) => clamp(value, DIFFICULTY_MIN, DIFFICULTY_MAX);

function configOf(retention: number, parameters: readonly number[] = FSRS_DEFAULT_PARAMETERS) {
  const decay = -parameters[20];
  const factor = 0.9 ** (1 / decay) - 1;
  return { parameters, retention, decay, factor };
}

/** 可提取率 R(t) = (1 + FACTOR·t/S)^DECAY —— 官方 get_card_retrievability */
export function fsrsRetrievability(elapsedDays: number, stability: number, retention = 0.9): number {
  const { decay, factor } = configOf(retention);
  if (!(stability > 0)) return 0;
  return (1 + factor * Math.max(0, elapsedDays) / stability) ** decay;
}

/** I(R) = (S/FACTOR)·(r^(1/DECAY) − 1)，整天、≥1、封顶 —— 官方 _next_interval */
export function fsrsIntervalDays(stability: number, retention: number, maxInterval = 36_500): number {
  const { parameters, decay } = configOf(retention);
  const interval = (stability / (0.9 ** (1 / decay) - 1)) * (retention ** (1 / -parameters[20]) - 1);
  return Math.min(Math.max(Math.round(interval), 1), maxInterval);
}

/** S₀(r) = w_{r−1} —— 官方 _initial_stability */
export function fsrsInitialStability(grade: FsrsGrade): number {
  return clampStability(FSRS_DEFAULT_PARAMETERS[grade - 1]);
}

/** D₀(r) = w4 − e^{w5·(r−1)} + 1 —— 官方 _initial_difficulty（钳制版） */
export function fsrsInitialDifficulty(grade: FsrsGrade): number {
  return clampDifficulty(initialDifficultyRaw(grade));
}

/** 官方均值回归用未钳制的 D₀(easy)（可为负） */
function initialDifficultyRaw(grade: FsrsGrade): number {
  return FSRS_DEFAULT_PARAMETERS[4] - Math.exp(FSRS_DEFAULT_PARAMETERS[5] * (grade - 1)) + 1;
}

/** D' = meanReversion(D₀(easy)未钳制, D + linearDamping(−w6·(r−3))) —— 官方 _next_difficulty */
export function fsrsNextDifficulty(difficulty: number, grade: FsrsGrade): number {
  const w7 = FSRS_DEFAULT_PARAMETERS[7];
  const arg1 = initialDifficultyRaw(4);
  const delta = -(FSRS_DEFAULT_PARAMETERS[6] * (grade - 3));
  const arg2 = difficulty + ((10 - difficulty) * delta) / 9;
  return clampDifficulty(w7 * arg1 + (1 - w7) * arg2);
}

/** S' = S·(1 + e^{w8}·(11−D)·S^{−w9}·(e^{(1−R)·w10}−1)·hardPenalty·easyBonus) —— 官方 _next_recall_stability */
export function fsrsNextRecallStability(difficulty: number, stability: number, retrievability: number, grade: FsrsGrade): number {
  const hardPenalty = grade === 2 ? FSRS_DEFAULT_PARAMETERS[15] : 1;
  const easyBonus = grade === 4 ? FSRS_DEFAULT_PARAMETERS[16] : 1;
  return stability * (
    1
    + Math.exp(FSRS_DEFAULT_PARAMETERS[8])
    * (11 - difficulty)
    * stability ** -FSRS_DEFAULT_PARAMETERS[9]
    * (Math.exp((1 - retrievability) * FSRS_DEFAULT_PARAMETERS[10]) - 1)
    * hardPenalty
    * easyBonus
  );
}

/** S_forget = min(长项式, S/e^{w17·w18}) —— 官方 _next_forget_stability */
export function fsrsNextForgetStability(difficulty: number, stability: number, retrievability: number): number {
  const longTerm = FSRS_DEFAULT_PARAMETERS[11]
    * difficulty ** -FSRS_DEFAULT_PARAMETERS[12]
    * ((stability + 1) ** FSRS_DEFAULT_PARAMETERS[13] - 1)
    * Math.exp((1 - retrievability) * FSRS_DEFAULT_PARAMETERS[14]);
  const shortTerm = stability / Math.exp(FSRS_DEFAULT_PARAMETERS[17] * FSRS_DEFAULT_PARAMETERS[18]);
  return Math.min(longTerm, shortTerm);
}

/** 同日重评的短项稳定度 —— 官方 _short_term_stability */
export function fsrsShortTermStability(stability: number, grade: FsrsGrade): number {
  let increase = Math.exp(FSRS_DEFAULT_PARAMETERS[17] * (grade - 3 + FSRS_DEFAULT_PARAMETERS[18])) * stability ** -FSRS_DEFAULT_PARAMETERS[19];
  if (grade >= 2) increase = Math.max(increase, 1);
  return clampStability(stability * increase);
}

export type FsrsOutcome = { memory: FsrsMemory; intervalMinutes: number; intervalDays: number; stage: FsrsStage };

/** FSRS 状态机（官方 review_card 的移植；短步长配置见 FSRS_*_STEPS_MINUTES）。
 *  返回 intervalMinutes（短步长用）或 intervalDays（毕业/复习用），二者恰有一个有效。 */
export function fsrsReview(memory: FsrsMemory | undefined, grade: FsrsGrade, nowMs: number, retention: number): FsrsOutcome {
  const now = new Date(nowMs);
  const nowIso = now.toISOString();
  const state = memory?.st ?? "learning";
  const step = memory?.step ?? null;
  const stability = memory?.s;
  const difficulty = memory?.d;
  const lastReview = memory?.lr ? Date.parse(memory.lr) : null;
  const elapsedDays = lastReview === null ? null : Math.max(0, Math.floor((nowMs - lastReview) / 86_400_000));
  const sameDay = elapsedDays !== null && elapsedDays < 1;

  if (state === "review") {
    // 复习态：稳定度按同日/跨日分支更新，难度始终更新
    const s = stability!;
    const d = difficulty!;
    const nextStability = sameDay
      ? fsrsShortTermStability(s, grade)
      : grade === 1
        ? fsrsNextForgetStability(d, s, fsrsRetrievability(elapsedDays!, s, retention))
        : fsrsNextRecallStability(d, s, fsrsRetrievability(elapsedDays!, s, retention), grade);
    const nextDifficulty = fsrsNextDifficulty(d, grade);
    const clamped = clampStability(nextStability);
    if (grade === 1) {
      // 重记 → 进入重学习第一步
      return { memory: { s: clamped, d: nextDifficulty, st: "relearning", step: 0, lr: nowIso }, intervalMinutes: FSRS_RELEARNING_STEPS_MINUTES[0], intervalDays: 0, stage: "relearning" };
    }
    const intervalDays = fsrsIntervalDays(clamped, retention);
    return { memory: { s: clamped, d: nextDifficulty, st: "review", step: null, lr: nowIso }, intervalMinutes: 0, intervalDays, stage: "review" };
  }

  // learning / relearning：先补记忆状态，再走步长或毕业
  let s: number;
  let d: number;
  if (stability === undefined || difficulty === undefined) {
    s = fsrsInitialStability(grade);
    d = fsrsInitialDifficulty(grade);
  } else if (sameDay) {
    s = fsrsShortTermStability(stability, grade);
    d = fsrsNextDifficulty(difficulty, grade);
  } else {
    const r = fsrsRetrievability(elapsedDays!, stability, retention);
    s = grade === 1 ? fsrsNextForgetStability(difficulty, stability, r) : fsrsNextRecallStability(difficulty, stability, r, grade);
    d = fsrsNextDifficulty(difficulty, grade);
  }
  s = clampStability(s);
  d = clampDifficulty(d);

  const steps = state === "relearning" ? FSRS_RELEARNING_STEPS_MINUTES : FSRS_LEARNING_STEPS_MINUTES;
  const currentStep = state === "relearning" ? (step ?? 0) : (step ?? 0);
  // 步长越界（配置收缩过）或毕业评分 → 直接按 FSRS 间隔排期
  const graduate = currentStep >= steps.length && grade >= 2;
  if (graduate) {
    const intervalDays = fsrsIntervalDays(s, retention);
    return { memory: { s, d, st: "review", step: null, lr: nowIso }, intervalMinutes: 0, intervalDays, stage: "review" };
  }
  if (grade === 1) {
    return { memory: { s, d, st: state, step: 0, lr: nowIso }, intervalMinutes: steps[0], intervalDays: 0, stage: state };
  }
  if (grade === 2) {
    const intervalMinutes = currentStep === 0
      ? (steps.length === 1 ? Math.round(steps[0] * 1.5) : steps.length >= 2 ? Math.round((steps[0] + steps[1]) / 2) : steps[currentStep])
      : steps[currentStep];
    return { memory: { s, d, st: state, step: currentStep, lr: nowIso }, intervalMinutes, intervalDays: 0, stage: state };
  }
  if (grade === 3 && currentStep + 1 < steps.length) {
    return { memory: { s, d, st: state, step: currentStep + 1, lr: nowIso }, intervalMinutes: steps[currentStep + 1], intervalDays: 0, stage: state };
  }
  // 良好到最后一步 / 轻松 → 毕业
  const intervalDays = fsrsIntervalDays(s, retention);
  return { memory: { s, d, st: "review", step: null, lr: nowIso }, intervalMinutes: 0, intervalDays, stage: "review" };
}

/** 由旧 SM-2 复习状态粗略换算 FSRS 记忆状态：算法切换后首次评分不打断历史。 */
export function fsrsMemoryFromLegacy(review: { intervalDays: number; ease: number; stage: FsrsStage; lastReviewedAt: string }): FsrsMemory {
  return {
    s: clampStability(Math.max(0.1, review.intervalDays || 0.1)),
    d: clampDifficulty(review.ease),
    st: review.stage,
    step: null,
    lr: review.lastReviewedAt,
  };
}

export function isFsrsMemory(value: unknown): value is FsrsMemory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.s === "number" && Number.isFinite(row.s) && row.s >= STABILITY_MIN && row.s <= 36_500
    && typeof row.d === "number" && Number.isFinite(row.d) && row.d >= DIFFICULTY_MIN && row.d <= DIFFICULTY_MAX
    && (row.st === "learning" || row.st === "review" || row.st === "relearning")
    && (row.step === null || (typeof row.step === "number" && Number.isSafeInteger(row.step) && row.step >= 0 && row.step < 16))
    && typeof row.lr === "string" && Number.isFinite(Date.parse(row.lr));
}

export function normalizeFsrsRetention(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.9;
  return clamp(Math.round(value * 100) / 100, FSRS_RETENTION_MIN, FSRS_RETENTION_MAX);
}
