import type { EssayQuestion } from "./essay-questions";
import type { Card } from "./study-data";

export type TrainingBook = "principles" | "china" | "foreign" | "psychology";

/** Section is the exact content inside a knowledge card's leading 〔…〕. */
export type TrainingEntry = {
  id: string;
  book: TrainingBook;
  chapter: number;
  section: string;
  topic: string;
  questionType: "short-answer" | "essay" | "material";
  origin: "source-question" | "adapted";
  source: string;
  originalQuestionId?: string;
  stem?: string;
  referenceAnswer?: string;
  analysis: string;
  knowledgeCardIds: string[];
};

export type ResolvedTrainingEntry = TrainingEntry & {
  stem: string;
  referenceAnswer: string;
  /** Carried from the original; an empty warning does not certify every source. */
  ocrWarning: string;
};

export type TrainingScope = { book: TrainingBook; chapter: number; section?: string };

const trainingBooks: readonly string[] = ["principles", "china", "foreign", "psychology"];
const questionTypes: readonly string[] = ["short-answer", "essay", "material"];
const sectionOf = (card: Card) => card.front.match(/^〔([^〕]+)〕/)?.[1];
const hasText = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function fail(id: string, reason: string): never {
  throw new Error(`Training entry ${id}: ${reason}`);
}

/** Resolve references without loading data or changing original questions/cards. */
export function resolveTrainingEntries(
  entries: readonly TrainingEntry[],
  essays: readonly EssayQuestion[],
  cards: readonly Card[],
): ResolvedTrainingEntry[] {
  const essayById = new Map<string, EssayQuestion>();
  for (const essay of essays) {
    if (essayById.has(essay.id)) throw new Error(`Duplicate original question id: ${essay.id}`);
    essayById.set(essay.id, essay);
  }
  const cardById = new Map<string, Card>();
  for (const card of cards) {
    if (cardById.has(card.id)) throw new Error(`Duplicate knowledge card id: ${card.id}`);
    cardById.set(card.id, card);
  }
  const entryIds = new Set<string>();

  return entries.map(entry => {
    if (!hasText(entry.id)) fail(String(entry.id), "id is required");
    if (entryIds.has(entry.id)) fail(entry.id, "duplicate id");
    entryIds.add(entry.id);
    if (!trainingBooks.includes(entry.book) || !Number.isInteger(entry.chapter) || entry.chapter < 1) {
      fail(entry.id, "invalid book/chapter scope");
    }
    if (!hasText(entry.section) || !cards.some(card => card.book === entry.book && card.chapter === entry.chapter && sectionOf(card) === entry.section)) {
      fail(entry.id, "section must match an existing knowledge card scope exactly");
    }
    if (!questionTypes.includes(entry.questionType)) fail(entry.id, "unsupported question type (choice questions are excluded)");
    for (const key of ["topic", "source", "analysis"] as const) {
      if (!hasText(entry[key])) fail(entry.id, `${key} is required`);
    }
    if (/教研|教育研究/.test(entry.source)) fail(entry.id, "education research sources are excluded");
    if (!Array.isArray(entry.knowledgeCardIds) || !entry.knowledgeCardIds.length) fail(entry.id, "knowledgeCardIds is required");
    const linkedIds = new Set<string>();
    for (const cardId of entry.knowledgeCardIds) {
      if (linkedIds.has(cardId)) fail(entry.id, `duplicate knowledge card reference: ${cardId}`);
      linkedIds.add(cardId);
      const card = cardById.get(cardId);
      if (!card) fail(entry.id, `missing knowledge card: ${cardId}`);
      if (card.book !== entry.book || card.chapter !== entry.chapter || sectionOf(card) !== entry.section) {
        fail(entry.id, `knowledge card outside entry scope: ${cardId}`);
      }
    }

    if (entry.origin === "source-question") {
      if (!hasText(entry.originalQuestionId)) fail(entry.id, "source-question requires originalQuestionId");
      const original = essayById.get(entry.originalQuestionId);
      if (!original) fail(entry.id, `missing original question: ${entry.originalQuestionId}`);
      const isDandanChoice = original.category === "丹丹中秋国庆卷" && original.number >= 1 && original.number <= 30;
      if (isDandanChoice || /选择|choice|教研|教育研究/i.test(`${original.category} ${original.source}`) || "options" in original) {
        fail(entry.id, "choice/education research references are excluded");
      }
      if (entry.stem !== undefined || entry.referenceAnswer !== undefined) {
        fail(entry.id, "source-question must preserve original stem and referenceAnswer via its reference");
      }
      if (!hasText(original.stem) || !hasText(original.referenceAnswer) || !hasText(original.source) || typeof original.ocrWarning !== "string") {
        fail(entry.id, "original question requires stem, referenceAnswer, source and ocrWarning");
      }
      return { ...entry, source: original.source, knowledgeCardIds: [...entry.knowledgeCardIds], stem: original.stem, referenceAnswer: original.referenceAnswer, ocrWarning: original.ocrWarning };
    }
    if (entry.origin !== "adapted") fail(entry.id, "unsupported origin");
    if (entry.originalQuestionId !== undefined) fail(entry.id, "adapted entries must not present an original question reference");
    if (!hasText(entry.stem) || !hasText(entry.referenceAnswer)) fail(entry.id, "adapted entries require their own complete stem and referenceAnswer");
    return { ...entry, knowledgeCardIds: [...entry.knowledgeCardIds], stem: entry.stem, referenceAnswer: entry.referenceAnswer, ocrWarning: "" };
  });
}

/** Filter before deduplication so another section never consumes this section's reference. */
export function scopedTrainingEntries(
  resolved: readonly ResolvedTrainingEntry[],
  scope: TrainingScope,
): ResolvedTrainingEntry[] {
  const scoped = resolved.filter(entry => entry.book === scope.book && entry.chapter === scope.chapter && (scope.section === undefined || entry.section === scope.section));
  if (scope.section !== undefined) return scoped;
  const seenOriginals = new Set<string>();
  return scoped.filter(entry => {
    if (!entry.originalQuestionId) return true;
    if (seenOriginals.has(entry.originalQuestionId)) return false;
    seenOriginals.add(entry.originalQuestionId);
    return true;
  });
}
