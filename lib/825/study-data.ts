export type Chapter825 = {
  number: number;
  title: string;
  part?: string;
  sections: string[];
};

export type Book825 = {
  id: "linguistics" | "literature";
  name: string;
  chapters: Chapter825[];
};

export type Card825 = {
  id: string;
  book: Book825["id"];
  chapter: number;
  section: string;
  front: string;
  back: string;
  source: string;
  sourceFile: string;
  sourcePage?: number;
  sourcePages?: number[];
};

export type Question825 = {
  id: string;
  year: number;
  book: Book825["id"];
  chapter: null;
  type: string;
  stem: string;
  referenceAnswer: string | null;
  analysis: string | null;
  source: string;
  sourceFile: string;
  sourcePage: number;
  answerSource: string | null;
  status: "verified" | "question-only" | "recalled";
  practiceReady: boolean;
  limitation: string | null;
};

export type StudyData825 = {
  books: Book825[];
  cards: Card825[];
  questions: Question825[];
};

/** Called only after the learner opens 825; Vite keeps these JSON files out of the initial bundle. */
export async function load825StudyData(): Promise<StudyData825> {
  const [linguisticsModule, literatureModule, questionsModule] = await Promise.all([
    import("./linguistics.json"),
    import("./literature.json"),
    import("./past-questions.json"),
  ]);

  const linguistics = linguisticsModule.default as {
    book: { id: "linguistics"; name: string; chapters: Chapter825[] };
    cards: Card825[];
  };
  const literature = literatureModule.default as {
    book: { id: "literature"; name: string; chapters: Chapter825[] };
    cards: Card825[];
  };
  const questionData = questionsModule.default as { questions: Question825[] };

  return {
    books: [linguistics.book, literature.book],
    cards: [...linguistics.cards, ...literature.cards],
    questions: questionData.questions,
  };
}
