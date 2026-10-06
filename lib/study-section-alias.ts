/** One verified correction, not a fuzzy match or a broader chapter selection. */
export function canonicalStudySection(book: string, chapter: number, section: string): string {
  return book === "principles" && chapter === 1 && section === "第五节 教育的发展趋势"
    ? "第三节 教育的起源与发展"
    : section;
}
