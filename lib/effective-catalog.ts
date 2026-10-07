/** AI 有效卡库: 费曼/计划/模拟卷的笔记来源统一走这里——
 *  个人修改后的答案与补充必须让 AI 看到, 而不是读内置旧资料。
 *  page 在合并卡库变化时调用 setEffectiveCards; 未设置时回退到内置资料。 */
import { loadKnowledgeCards } from "./study-data";
import { stripHighlightMarkers } from "./highlight-markers";

export type EffectiveCard = {
  id: string;
  book: string;
  chapter: number;
  section?: string;
  front: string;
  back: string;
  source: string;
  /** 我的补充(独立字段): AI 侧以【个人补充】标注, 不冒充教材原文 */
  note?: string;
};

export type EffectiveSubject = "333" | "825" | "politics";

const overrides: Partial<Record<EffectiveSubject, EffectiveCard[]>> = {};

export function setEffectiveCards(subject: EffectiveSubject, cards: readonly EffectiveCard[]): void {
  overrides[subject] = [...cards];
}

export function getEffectiveCards(subject: EffectiveSubject): EffectiveCard[] | undefined {
  return overrides[subject];
}

/** 把 UI 卡(可能带教材标记与 note)转成 AI 用的有效卡: 剥离标记, 补充单独成字段。 */
export function toEffectiveCards(cards: readonly { id: string; book: string; chapter: number; section?: string; front: string; back: string; source?: string }[], noteOf?: (cardId: string) => string | undefined): EffectiveCard[] {
  return cards.map(card => {
    const note = noteOf?.(card.id);
    return {
      id: card.id,
      book: card.book,
      chapter: card.chapter,
      ...(card.section ? { section: card.section } : {}),
      front: stripHighlightMarkers(card.front),
      back: stripHighlightMarkers(card.back),
      source: card.source || "",
      ...(note ? { note } : {}),
    };
  });
}

/** 333 内置知识卡(无覆盖时的回退), 与 study-data 懒加载共用缓存。 */
export async function loadEffective333Fallback(): Promise<EffectiveCard[]> {
  const knowledge = await loadKnowledgeCards() as unknown as EffectiveCard[];
  return knowledge;
}
