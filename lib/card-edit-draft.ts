import { sanitizeRuns, type RichContent, type RichRun } from "./rich-text";

export type EditFields = { q: RichContent; a: RichContent; note: RichContent; bg: string | undefined };
export type EditLocation = { book: string; chapter: number; section: string };
export type CardEditDraft = { fields: EditFields; location?: EditLocation; baselineRev: number | null; baselineFields?: EditFields; baselineLocation?: EditLocation };
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
function readFields(value: unknown): EditFields {
  const row = object(value);
  const field = (value: unknown): RichContent => {
    const item = object(value), text = typeof item.text === "string" ? item.text : "";
    return { text, runs: sanitizeRuns(item.runs as RichRun[], text.length) };
  };
  return { q: field(row.q), a: field(row.a), note: field(row.note), bg: typeof row.bg === "string" ? row.bg : undefined };
}
function readLocation(value: unknown): EditLocation | undefined {
  const row = object(value);
  if (typeof row.book !== "string" || !row.book) return undefined;
  return { book: row.book, chapter: Number(row.chapter) || 1, section: typeof row.section === "string" ? row.section : "" };
}
/** v2 writers store fields in a nested object. Keep compatibility with flat drafts. */
export function parseCardEditDraft(value: unknown): CardEditDraft | null {
  const row = object(value);
  if (!Object.keys(row).length || !row.fields && !row.q && !row.a && !row.note) return null;
  return { fields: readFields(row.fields ?? row), location: readLocation(row.location),
    baselineRev: typeof row.baselineRev === "number" ? row.baselineRev : null,
    baselineFields: row.baselineFields ? readFields(row.baselineFields) : undefined,
    baselineLocation: readLocation(row.baselineLocation) };
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function readOwnedDraft(all: Record<string, unknown>, id: string, owner: string): CardEditDraft | null {
  return parseCardEditDraft(all[`${id}@${owner}`] ?? all[id]);
}
/** Keep a shared recovery copy, but one tab must not erase another tab's draft. */
export function updateOwnedDraft(all: Record<string, unknown>, id: string, owner: string, draft: CardEditDraft | null, expected?: CardEditDraft | null): Record<string, unknown> {
  const next = { ...all }, key = `${id}@${owner}`, previous = next[key];
  if (draft) { next[key] = draft; next[id] = draft; }
  else { delete next[key]; if (previous ? equal(next[id], previous) : expected && equal(parseCardEditDraft(next[id]), parseCardEditDraft(expected))) delete next[id]; }
  return next;
}
export function mergeEditField(mine: RichContent, latest: RichContent, base?: RichContent): RichContent {
  if (base && equal(mine, base)) return latest;
  if (base && equal(latest, base)) return mine;
  if (equal(mine, latest)) return mine;
  if (mine.text === latest.text) {
    const runs = [...latest.runs, ...mine.runs].filter((run, i, all) => all.findIndex(other => equal(other, run)) === i);
    return { text: mine.text, runs: sanitizeRuns(runs, mine.text.length) };
  }
  if (!mine.text) return latest;
  if (!latest.text) return mine;
  const separator = "\n——最新版本——\n", shift = mine.text.length + separator.length;
  const text = mine.text + separator + latest.text;
  return { text, runs: sanitizeRuns([...mine.runs, ...latest.runs.map(run => ({ ...run, start: run.start + shift, end: run.end + shift }))], text.length) };
}
/** Rebase unchanged fields, keep both versions of conflicting text for review. */
export function mergeEditFields(mine: EditFields, latest: EditFields, base?: EditFields): EditFields {
  return { q: mergeEditField(mine.q, latest.q, base?.q), a: mergeEditField(mine.a, latest.a, base?.a),
    note: mergeEditField(mine.note, latest.note, base?.note), bg: base && mine.bg === base.bg ? latest.bg : mine.bg };
}
