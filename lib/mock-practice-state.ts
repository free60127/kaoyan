import { MOCK_QUIZ_TYPES, validateMockQuizConfig, type MockQuizConfig, type MockQuizRange, type MockQuizResult } from "./mock-quiz";
import { getApplicableMockPaperTemplate, type MockPaperTemplateId } from "./mock-paper-templates";

export type MockPracticeBook = { id: string; name: string; chapters: { title: string; sections: string[] }[] };
export type MockCounts = Record<keyof MockQuizConfig, string>;
export type MockSnapshot = { subject: "333" | "825"; config: MockQuizConfig; ranges: MockQuizRange[]; scopeLabel: string; templateId?: MockPaperTemplateId; createdAt: string };
export type MockResponse = { choice?: number; text?: string; revealed?: boolean };
export type MockSession = { result: MockQuizResult; snapshot: MockSnapshot; cursor: number; mode: "practice" | "paper"; responses: Record<string, MockResponse> };
export type MockPracticeState = { session: MockSession | null; pending: boolean; progress: { done: number; total: number }; error: string };
export type MockPracticeAction =
  | { type: "start"; total: number }
  | { type: "progress"; done: number; total: number }
  | { type: "success"; result: MockQuizResult; snapshot: MockSnapshot }
  | { type: "stop"; error?: string }
  | { type: "clear" }
  | { type: "cursor"; cursor: number }
  | { type: "mode"; mode: MockSession["mode"] }
  | { type: "response"; id: string; response: MockResponse };

export function initialMockPracticeState(): MockPracticeState {
  return { session: null, pending: false, progress: { done: 0, total: 0 }, error: "" };
}
export function mockPracticeReducer(state: MockPracticeState, action: MockPracticeAction): MockPracticeState {
  if (action.type === "start") return { ...state, pending: true, error: "", progress: { done: 0, total: action.total } };
  if (action.type === "progress") return state.pending ? { ...state, progress: { done: action.done, total: action.total } } : state;
  if (action.type === "stop") return { ...state, pending: false, error: action.error || "" };
  if (action.type === "clear") return initialMockPracticeState();
  if (action.type === "success") return { ...state, pending: false, error: "", session: { result: action.result, snapshot: action.snapshot, cursor: 0, mode: "practice", responses: {} } };
  if (!state.session) return state;
  const session = state.session;
  if (action.type === "cursor") return { ...state, session: { ...session, cursor: Math.max(0, Math.min(session.result.questions.length - 1, action.cursor)) } };
  if (action.type === "mode") return { ...state, session: { ...session, mode: action.mode } };
  const question = session.result.questions.find((row) => row.id === action.id);
  if (!question) return state;
  const previous = session.responses[action.id] || {};
  // A choice is submitted once; revisiting it never increases the score.
  if (question.type === "single-choice" && action.response.choice !== undefined && (previous.choice !== undefined || !Number.isInteger(action.response.choice) || action.response.choice < 0 || action.response.choice > 3)) return state;
  return { ...state, session: { ...session, responses: { ...session.responses, [action.id]: { ...previous, ...action.response } } } };
}
export function mockPracticeScore(session: MockSession) {
  let right = 0, answered = 0, written = 0, choiceTotal = 0, openTotal = 0;
  for (const question of session.result.questions) {
    const response = session.responses[question.id];
    if (question.type === "single-choice") {
      choiceTotal++;
      if (response?.choice !== undefined) { answered++; right += Number(response.choice === question.answer); }
    } else { openTotal++; written += Number(!!response?.text?.trim()); }
  }
  return { right, answered, written, choiceTotal, openTotal };
}
export function countsToStrings(config: MockQuizConfig): MockCounts {
  return Object.fromEntries(MOCK_QUIZ_TYPES.map((type) => [type, String(config[type])])) as MockCounts;
}
export function parseMockCounts(counts: MockCounts): MockQuizConfig {
  const config = Object.fromEntries(MOCK_QUIZ_TYPES.map((type) => [type, /^\d+$/.test(counts[type]) ? Number(counts[type]) : NaN]));
  return validateMockQuizConfig(config);
}
export function initialMockCounts(subject: "333" | "825"): MockCounts {
  return countsToStrings({ "single-choice": subject === "333" ? 3 : 0, definition: subject === "825" ? 2 : 0, "short-answer": 2, essay: subject === "825" ? 1 : 0, "material-analysis": 0 });
}
export function mockRangesFromSelection(books: MockPracticeBook[], selection: Record<string, number[]>, section?: { bookId: string; chapter: number; name: string }): MockQuizRange[] {
  return books.flatMap((book) => {
    const chapters = book.chapters.map((_, index) => index + 1).filter((number) => selection[book.id]?.includes(number));
    if (!chapters.length) return [];
    return [{ bookId: book.id, chapters, ...(section && section.bookId === book.id && chapters.length === 1 && chapters[0] === section.chapter ? { section: section.name } : {}) }];
  });
}
export function snapshotMockSettings(subject: "333" | "825", counts: MockCounts, ranges: MockQuizRange[], scopeLabel: string, templateId?: MockPaperTemplateId): MockSnapshot {
  if (!ranges.length) throw new Error("请选择至少一个书目或章节范围。");
  const config = parseMockCounts(counts);
  if (templateId) {
    const template = getApplicableMockPaperTemplate(templateId, subject, ranges.map((range) => range.bookId));
    if (MOCK_QUIZ_TYPES.some((type) => config[type] !== template.config[type])) throw new Error("题型数量已改变，请切换自定义构成。");
  }
  return { subject, config, ranges: ranges.map((range) => ({ ...range, chapters: range.chapters ? [...range.chapters] : undefined })), scopeLabel, ...(templateId ? { templateId } : {}), createdAt: new Date().toLocaleString("zh-CN") };
}
