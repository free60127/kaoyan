import type { MockQuizConfig, MockQuizType } from "./mock-quiz";

export type MockPaperTemplateId = "333-2026" | "825-2026";
export type MockPaperGroup = { label: string; type: MockQuizType; count: number; points: number; bookId?: string };
export type MockPaperTemplate = {
  id: MockPaperTemplateId; subject: "333" | "825"; title: string;
  sourceFile: string; sourcePages: number[]; recall: boolean; groups: MockPaperGroup[];
};

/** Structure only: generated questions are never presented as these source papers. */
export const MOCK_PAPER_TEMPLATES: readonly MockPaperTemplate[] = [
  {
    id: "333-2026", subject: "333", title: "2026 333 真题构成参考（36题，150分）",
    sourceFile: "【凯程考研】2026年全国333教育硕士研究生入学统一考试真题.pdf",
    sourcePages: [1, 8, 9], recall: false,
    groups: [
      { label: "一、单项选择题", type: "single-choice", count: 30, points: 2 },
      { label: "二、论述题", type: "essay", count: 2, points: 15 },
      { label: "三、材料分析题", type: "material-analysis", count: 4, points: 15 },
    ],
  },
  {
    id: "825-2026", subject: "825", title: "2026 825 回忆版构成参考（14题，150分）",
    sourceFile: "2026年东北师范大学825英语专业基础初试回忆真题.pdf",
    sourcePages: [1], recall: true,
    groups: [
      { label: "Linguistics — Definitions", bookId: "linguistics", type: "definition", count: 5, points: 5 },
      { label: "Linguistics — Short answers (10 points)", bookId: "linguistics", type: "short-answer", count: 3, points: 10 },
      { label: "Linguistics — Short answer (20 points)", bookId: "linguistics", type: "short-answer", count: 1, points: 20 },
      { label: "Literature — Short answers", bookId: "literature", type: "short-answer", count: 5, points: 15 },
    ],
  },
];

/** Filter the 825 paper to selected books; chapters alter scope, never source structure. */
export function getApplicableMockPaperTemplate(templateId: MockPaperTemplateId, subject: "333" | "825", bookIds: readonly string[]) {
  const template = MOCK_PAPER_TEMPLATES.find((row) => row.id === templateId && row.subject === subject);
  if (!template) throw new Error("模拟卷构成参考与当前科目不符。");
  const groups = template.groups.filter((group) => !group.bookId || bookIds.includes(group.bookId)).map((group) => ({ ...group }));
  if (!groups.length) throw new Error("所选书目没有适用的模拟卷构成参考。");
  const config: MockQuizConfig = { "single-choice": 0, definition: 0, "short-answer": 0, essay: 0, "material-analysis": 0 };
  groups.forEach((group) => { config[group.type] += group.count; });
  return {
    template, groups, config,
    totalQuestions: groups.reduce((sum, group) => sum + group.count, 0),
    totalPoints: groups.reduce((sum, group) => sum + group.count * group.points, 0),
  };
}
