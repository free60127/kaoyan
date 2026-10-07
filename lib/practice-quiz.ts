/** 从既有闪卡生成选择题自测: 题干用卡正面, 正确项取卡背首句, 干扰项取同章其他卡的答案。 */

export type PracticeCard = { id: string; book: string; chapter: number; front: string; back: string };
/** 人工"不适合选择题"排除标记(由用户在答题界面设置)。 */
export let mcqExcludedIds: ReadonlySet<string> = new Set();
export function setMcqExcluded(ids: ReadonlySet<string>) { mcqExcludedIds = ids; }
export type PracticeQuestion = { cardId: string; stem: string; hint: string; options: string[]; answer: number; source: string };

const LABEL = /^〔.+?〕\s*/;
const PIN_LINE = /^📌.*$/gm;
/** 卡背可能带教材重点标记(⟦g|…⟧), 生成选项前还原为纯文字。 */
const MARKER = /⟦[gbrys]\|([^⟧]*)⟧/g;

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 取卡背的开头若干句作为选项文本: 逐句累加直到达到最小长度, 再按上限截断。
 *  判断式卡片(如“不对。原因是…”)的首句太短, 单独用作选项没有区分度。
 *  英文按句号/问号/叹号切句; 超长截断在词边界完成, 不产生"半个单词"的选项。 */
export function firstAnswerClause(back: string, max = 110): string {
  const cleaned = back.replace(MARKER, "$1").replace(PIN_LINE, "").trim();
  const hasCjk = /[\u4e00-\u9fff]/.test(cleaned);
  const min = hasCjk ? 12 : 30;
  const parts = hasCjk ? cleaned.split(/(?<=[。；;\n])/) : cleaned.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const part of parts) {
    if (out && !hasCjk && !/\s$/.test(out)) out += " ";
    out += part;
    if (out.replace(/\s/g, "").length >= min) break;
  }
  out = out.trim() || cleaned.slice(0, max);
  // 丹丹模式: 选项取首个完整句子(≤64字), 避免长段落选项; 英文必须截在句末标点, 否则保留整句
  if (out.length > 64) {
    const m = hasCjk ? out.match(/^[^。；;]{8,60}[。；;]?/) : out.match(/^[^.!?]{8,60}[.!?]+/);
    if (m && m[0].replace(/\s/g, "").length >= (hasCjk ? 8 : 18)) out = m[0].trim();
  }
  if (out.length > max) {
    if (hasCjk) return out.slice(0, max - 1) + "…";
    const cut = out.slice(0, max - 1);
    const space = cut.lastIndexOf(" ");
    return (space >= max * 0.5 ? cut.slice(0, space) : cut).trimEnd() + "…";
  }
  return out;
}

function shuffled<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** 多点列举/比较类问题不适合"选出一项"的选择题形态(正确项只是部分要点, 选对不等于掌握)。
 *  这些卡仍走闪卡复习与费曼, 不进自动选择自测。 */
const MULTI_POINT_STEM = /(列举|有哪些|包括哪些|哪几[个种项条点]|分别[是说指是]|各自|异同|比较一下|对比一|关系如何|区别.{0,6}联系|几个方面|哪些方面|哪些要求|哪些特点|哪些因素|哪些措施|哪些主张|哪些贡献|哪些内容|哪些任务|哪些条件|哪些原则|哪些方法|哪些类型|哪些形式|哪些特征)/;

export function isMcqSuitable(front: string): boolean {
  return !MULTI_POINT_STEM.test(front.replace(/^〔.+?〕\s*/, ""));
}

/** 判断题/选择题整卷的答案串(如 "T F T F F")不是可用的选项文本。 */
export function looksLikeAnswerKey(text: string): boolean {
  const cleaned = text.replace(MARKER, "$1").replace(PIN_LINE, "").trim();
  return cleaned.length >= 4 && /^(?:[TtFf][\s,，、.·]*){4,}$/.test(cleaned) && /[Tt][\s,，、.·]*[Ff]|[Ff][\s,，、.·]*[Tt]/.test(cleaned);
}

/** 文本的主导文字: 中英混排资料(825)里, 同义的中英两张卡不能互为干扰项。 */
export function dominantScript(text: string): "cjk" | "latin" {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cjk >= latin ? "cjk" : "latin";
}

/** 显著词元: 4 字母以上的英文实词, 用于识别"同一术语的两张卡"(翻译对应/中英同义)。 */
export function salientTokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z]{4,}/g) || []));
}

export type PracticeOptions = { bookId: string; chapters?: number[]; count: number; seed: number };

export function buildPracticeQuestions(cards: readonly PracticeCard[], options: PracticeOptions): PracticeQuestion[] {
  const { bookId, count, seed } = options;
  const pool = cards.filter(card =>
    card.book === bookId
    && isMcqSuitable(card.front)
    && !mcqExcludedIds.has(card.id)
    && !looksLikeAnswerKey(card.back)
    && (!options.chapters || options.chapters.length === 0 || options.chapters.includes(card.chapter)));
  const rng = mulberry32(seed);
  const chosen = shuffled(pool, rng).slice(0, Math.max(0, Math.min(count, pool.length)));
  type Candidate = { text: string; card: PracticeCard };
  const byChapter = new Map<number, Candidate[]>();
  for (const card of pool) {
    const text = firstAnswerClause(card.back);
    if (!text) continue;
    const list = byChapter.get(card.chapter) || [];
    list.push({ text, card });
    byChapter.set(card.chapter, list);
  }
  const bookCandidates = pool.map(card => ({ text: firstAnswerClause(card.back), card })).filter(item => item.text);
  return chosen.map(card => {
    const hintMatch = card.front.match(LABEL);
    const stem = card.front.replace(LABEL, "");
    const correct = firstAnswerClause(card.back);
    const stemTokens = salientTokens(`${card.front} ${card.back}`);
    const correctScript = dominantScript(correct);
    const sameChapter = (byChapter.get(card.chapter) || []).filter(item => item.card.id !== card.id);
    const source = sameChapter.length >= 3 ? sameChapter : bookCandidates.filter(item => item.card.id !== card.id);
    const distractors: string[] = [];
    const picked: Candidate[] = [];
    for (const candidate of shuffled(source, rng)) {
      if (distractors.length >= 3) break;
      // 归一化去重: 大小写/空白/末尾省略号视为同一条
      if (distractors.some(existing => normalizeOption(existing) === normalizeOption(candidate.text))) continue;
      if (normalizeOption(candidate.text) === normalizeOption(correct)) continue;
      // 同义保护(R1): 干扰项必须与正确项同一主导文字——825 双语资料里中文解释与英文原文互为翻译, 不能同卷
      if (dominantScript(candidate.text) !== correctScript) continue;
      // 同一术语的两张卡(翻译对应卡/中英 sibling)不得互为干扰项: 共享英文实词即视为同一知识点
      const candidateTokens = salientTokens(`${candidate.card.front} ${candidate.text}`);
      if ([...candidateTokens].some(token => stemTokens.has(token))) continue;
      // 截断残渣不进选项: 以悬空单词结尾的英文片段没有判分价值
      if (/[A-Za-z]$/.test(candidate.text) && candidate.text.length >= 40 && !/[")\]']$/.test(candidate.text)) continue;
      distractors.push(candidate.text);
      picked.push(candidate);
    }
    // 凑不满 3 个不同干扰项的题不能构成有效四选一, 直接丢弃
    if (distractors.length < 3) return null;
    const options = shuffled([correct, ...distractors], rng);
    return {
      cardId: card.id,
      stem,
      hint: hintMatch ? hintMatch[0].replace(/[〔〕\s]/g, "").slice(0, 30) : "",
      options,
      answer: options.indexOf(correct),
      source: `闪卡自测 · ${card.book} 第${card.chapter}章`,
    };
  }).filter((question): question is PracticeQuestion => question !== null);
}

/** 选项归一化: 小写、去空白与尾部省略号, 用于同义重复判定。 */
export function normalizeOption(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "").replace(/…$/, "").replace(/[。；;]/g, "");
}
