export type BookPolitics = {
  id: "mayuan" | "maozhongte" | "xinsixiang" | "shigang" | "sixiu";
  name: string;
  short: string;
  tone: string;
  chapters: string[];
};

export type CardPolitics = {
  id: string;
  book: BookPolitics["id"];
  chapter: number;
  section: string;
  front: string;
  back: string;
  source: string;
};

export type StudyDataPolitics = {
  books: BookPolitics[];
  cards: CardPolitics[];
};

/** Called only after the learner opens 政治; Vite keeps this JSON out of the initial bundle. */
export async function loadPoliticsStudyData(): Promise<StudyDataPolitics> {
  const politicsModule = await import("./politics-data.json");
  const data = politicsModule.default as unknown as StudyDataPolitics;
  if (!data.books?.length || !data.cards?.length) throw new Error("politics data empty");
  return data;
}
