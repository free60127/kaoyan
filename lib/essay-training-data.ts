import { loadEssayQuestions } from "./essay-questions";
import { loadKnowledgeCards } from "./study-data";
import { resolveTrainingEntries, type ResolvedTrainingEntry, type TrainingBook, type TrainingEntry } from "./essay-training";

const loaders = {
  principles: () => import("./essay-training/principles.json"),
  china: () => import("./essay-training/china.json"),
  foreign: () => import("./essay-training/foreign.json"),
  psychology: () => import("./essay-training/psychology.json"),
};

/** Load only the requested book's associations; original texts remain in the source bank. */
export async function loadTrainingBook(book: TrainingBook): Promise<ResolvedTrainingEntry[]> {
  if (!Object.prototype.hasOwnProperty.call(loaders, book)) throw new Error("所选书目没有333大题资料。");
  const [module, essays, cards] = await Promise.all([loaders[book](), loadEssayQuestions(), loadKnowledgeCards()]);
  const entries = module.default as TrainingEntry[];
  if (entries.some(entry => entry.book !== book)) throw new Error("大题资料与所选书目不一致。");
  return resolveTrainingEntries(entries, essays, cards);
}
