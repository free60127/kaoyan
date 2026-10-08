/** Sync wire format v3. Local application/backup schemas stay unchanged.
 * Per-field vector clocks distinguish a later undo from an older value, without
 * relying on device wall clocks. Concurrent text versions remain in the document.
 * A user edit observes every current version and replaces the resolved register.
 */
import { canonicalJson, mergeKindFor, mergeKeyValue } from "./merge";
import { stripHighlightMarkers } from "../highlight-markers";
import { RICH_RUN_LIMIT } from "../rich-text";
import { PERSONAL_TEXT_LIMIT } from "../personal-cards";

type Clock = Record<string, number>;
type Version = { clock: Clock; value: unknown; deleted?: true };
type Cells = Record<string, Version[]>;
export type SyncDocument = { protocol: "yantu-sync-v3"; cells: Cells };
type Row = Record<string, unknown>;
const obj = (v: unknown): Row => v && typeof v === "object" && !Array.isArray(v) ? v as Row : {};
const entries = (v: unknown) => Object.entries(obj(v));
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const path = (...parts: string[]) => JSON.stringify(parts);
const fields = ["ratings", "again", "newCards", "quiz", "quizCorrect"];
const separator = "\n——另一设备的修改——\n";
// Wire ordering must be independent of browser language and ICU collation.
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const mockKey = (key: string) => key.startsWith("kaoyan.mock-practice.v1.");
const paperId = (session: Row) => canonicalJson([obj(session.snapshot).createdAt, array(obj(session.result).questions).map(q => obj(q).id)]);
function scopeUnits(value: unknown): Row[] {
  const scope = obj(value);
  return [...new Set(array(scope.chapters).filter((n): n is number => Number.isSafeInteger(n) && Number(n) > 0))].sort((a, b) => a - b).map(chapter => ({ bookId: scope.bookId, chapters: [chapter], ...(typeof scope.section === "string" ? { section: scope.section } : {}) }));
}

/** Earlier v3 rows grouped chapters. Split their registers without resetting clocks. */
export function normalizeDocument(key: string, doc: SyncDocument): SyncDocument {
  if (mergeKindFor(key) !== "srs") return doc;
  const cells: Cells = {};
  for (const [p, register] of Object.entries(doc.cells)) {
    const parts = JSON.parse(p) as string[];
    let units: Row[] = [];
    if (["scopes", "newScopes"].includes(parts[0]) && parts.length === 2) {
      try { units = scopeUnits(JSON.parse(parts[1])); } catch { /* Retain invalid legacy paths for validation. */ }
    }
    if (!units.length) { cells[p] = versions([...(cells[p] || []), ...register]); continue; }
    for (const unit of units) {
      const target = path(parts[0], canonicalJson(unit));
      cells[target] = versions([...(cells[target] || []), ...register.map(v => ({ ...v, value: v.deleted ? null : unit }))]);
    }
  }
  return { ...doc, cells };
}

/** Convert domain values to independently editable registers. Never sync navigation. */
function flatten(key: string, value: unknown): Row {
  const out: Row = {}, root = obj(value), kind = mergeKindFor(key);
  const put = (parts: string[], v: unknown) => { out[path(...parts)] = v; };
  if (value == null) return out;
  if (kind === "srs") {
    for (const [id, card] of entries(root.cards)) put(["cards", id], card);
    for (const field of ["scopes", "newScopes"]) for (const item of array(root[field]).flatMap(scopeUnits)) put([field, canonicalJson(item)], item);
    put(["dailyNewLimit"], root.dailyNewLimit ?? 20);
    const daily = obj(root.daily), date = String(daily.date || "");
    if (date) put(["date", date], true);
    for (const id of array(daily.admitted)) put(["admitted", date, String(id)], true);
  } else if (kind === "stats") {
    for (const [date, raw] of entries(value)) {
      const day = obj(raw), devices = Object.keys(obj(day.devices)).length ? obj(day.devices) : { legacy: Object.fromEntries(fields.map(f => [f, day[f] || 0])) };
      for (const [device, bucket] of entries(devices)) put([date, device], bucket);
    }
  } else if (kind === "done") {
    for (const [id, mark] of entries(root.marks ?? root)) if (typeof mark === "boolean") put([id], mark);
  } else if (kind === "personal") {
    put(["seq"], root.seq || 0);
    for (const [id, overlay] of entries(root.overlays)) for (const [field, v] of entries(overlay)) put(["overlays", id, field], v);
    for (const card of array(root.cards)) for (const [field, v] of entries(card)) put(["cards", String(obj(card).id), field], v);
  } else if (kind === "session") {
    for (const field of ["feynmanDrafts", "pastAnswers", "plannerPrompts"]) for (const [id, draft] of entries(root[field])) put([field, id], draft);
  } else if (kind === "mistakes") {
    for (const item of array(value)) if (obj(item).id) put([String(obj(item).id)], item);
  } else if (kind === "activity" || kind === "excluded") {
    for (const item of array(value)) put([canonicalJson(item)], item);
  } else if (mockKey(key)) {
    put(["settings"], root.settings || {});
    if (root.session) {
      const session = obj(root.session), id = paperId(session);
      put(["selected"], id);
      put(["paper", id], { snapshot: session.snapshot, result: session.result, mode: session.mode, cursor: 0 });
      for (const [question, response] of entries(session.responses)) for (const [field, v] of entries(response)) put(["response", id, question, field], v);
    }
  } else put(["value"], value);
  return out;
}

function dominates(a: Clock, b: Clock): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every(k => (a[k] || 0) >= (b[k] || 0)) && [...keys].some(k => (a[k] || 0) > (b[k] || 0));
}
function versions(values: Version[]): Version[] {
  const unique = [...new Map(values.map(v => [canonicalJson(v), v])).values()];
  return unique.filter(v => !unique.some(other => dominates(other.clock, v.clock))).sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
}
export function isSyncDocument(value: unknown): value is SyncDocument {
  const row = obj(value);
  try {
    return row.protocol === "yantu-sync-v3" && !!row.cells && typeof row.cells === "object" && !Array.isArray(row.cells) && Object.entries(obj(row.cells)).every(([p, register]) => {
      const parts = JSON.parse(p);
      if (!Array.isArray(parts) || !parts.length || parts.length > 4 || !parts.every(part => typeof part === "string" && !["__proto__", "prototype", "constructor"].includes(part))) return false;
      return Array.isArray(register) && register.every(v => {
        const entry = obj(v);
        return !!entry.clock && typeof entry.clock === "object" && !Array.isArray(entry.clock) && Object.entries(obj(entry.clock)).every(([id, n]) => !["__proto__", "prototype", "constructor"].includes(id) && typeof n === "number" && Number.isSafeInteger(n) && n >= 0) && "value" in entry;
      });
    });
  } catch { return false; }
}
/** Raw legacy rows are accepted once as migration input, never as a later revision. */
export function legacyDocument(key: string, value: unknown): SyncDocument {
  return { protocol: "yantu-sync-v3", cells: Object.fromEntries(entries(flatten(key, value)).map(([p, v]) => [p, [{ clock: {}, value: v }]])) };
}
export function mergeDocuments(a: SyncDocument, b: SyncDocument): SyncDocument {
  const cells: Cells = {};
  for (const p of [...new Set([...Object.keys(a.cells), ...Object.keys(b.cells)])].sort()) cells[p] = versions([...(a.cells[p] || []), ...(b.cells[p] || [])]);
  return { protocol: "yantu-sync-v3", cells };
}

/** Capture actual local edits against the last successfully applied domain value. */
export function editDocument(key: string, doc: SyncDocument, baseline: unknown, current: unknown, device: string): SyncDocument {
  doc = normalizeDocument(key, doc);
  const before = flatten(key, baseline), after = flatten(key, current), cells: Cells = { ...doc.cells };
  for (const p of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonicalJson(before[p]) === canonicalJson(after[p]) && (p in before) === (p in after)) continue;
    const clock: Clock = {};
    for (const version of cells[p] || []) for (const [id, count] of Object.entries(version.clock)) clock[id] = Math.max(clock[id] || 0, count);
    clock[device] = (clock[device] || 0) + 1;
    cells[p] = [{ clock, value: after[p] ?? null, ...(!(p in after) ? { deleted: true as const } : {}) }];
  }
  return { protocol: "yantu-sync-v3", cells };
}

function resolve(register: Version[], text = false, maxText = 200_000): unknown {
  const active = register.filter(v => !v.deleted);
  if (!active.length) return undefined;
  if (!text && register.some(v => v.deleted)) return undefined;
  const values = [...new Map(active.map(v => [canonicalJson(v.value), v.value])).values()].sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
  if (values.length === 1) return values[0];
  if (text && values.every(v => typeof v === "string")) {
    const joined = [...new Set(values.flatMap(v => String(v).split(separator)))].sort().join(separator);
    // The session validator caps drafts; originals remain exportable in cells.
    return joined.length <= maxText ? joined : values[0];
  }
  if (text && values.every(v => typeof obj(v).text === "string")) {
    let result = ""; const runs: Row[] = [];
    for (const value of values) {
      const content = obj(value), text = String(content.text);
      if (result) result += separator;
      const offset = stripHighlightMarkers(result).length; result += text;
      for (const raw of array(content.runs)) {
        const run = obj(raw); runs.push({ ...run, start: Number(run.start) + offset, end: Number(run.end) + offset });
      }
    }
    return result.length <= maxText && runs.length <= RICH_RUN_LIMIT ? { text: result, runs } : values[0];
  }
  // Concurrent reset/delete wins; concurrent edits remain available in cells.
  if (register.some(v => v.deleted)) return undefined;
  if (values.every(v => typeof v === "number")) return Math.max(...values as number[]);
  if (values.every(v => typeof v === "boolean")) return values.includes(false) ? false : true;
  return values[values.length - 1];
}

export function materialize(key: string, doc: SyncDocument, local: unknown = null): unknown {
  const kind = mergeKindFor(key), rows: [string[], unknown][] = [];
  for (const [p, register] of Object.entries(doc.cells)) {
    const parts = JSON.parse(p) as string[];
    const text = kind === "session" || kind === "personal" && ["q", "a", "note", "front", "back"].includes(parts[2]) || mockKey(key) && parts[0] === "response" && parts[3] === "text";
    const value = resolve(register, text, kind === "personal" ? PERSONAL_TEXT_LIMIT : mockKey(key) ? 20_000 : 200_000);
    if (value !== undefined) rows.push([parts, value]);
  }
  rows.sort((a, b) => compare(canonicalJson(a[0]), canonicalJson(b[0])));
  if (kind === "srs") {
    const cards: Row = {}, scopes: unknown[] = [], newScopes: unknown[] = [];
    const date = rows.filter(([p]) => p[0] === "date").map(([p]) => p[1]).sort().at(-1) || "";
    const admitted: string[] = []; let dailyNewLimit: unknown = 20;
    for (const [p, value] of rows) {
      if (p[0] === "cards") cards[p[1]] = value;
      else if (p[0] === "scopes") scopes.push(value);
      else if (p[0] === "newScopes") newScopes.push(value);
      else if (p[0] === "admitted" && p[1] === date) admitted.push(p[2]);
      else if (p[0] === "dailyNewLimit") dailyNewLimit = value;
    }
    return { version: 1, cards, scopes, newScopes, dailyNewLimit, daily: { date, admitted: admitted.sort() } };
  }
  if (kind === "stats") {
    const days: Record<string, Row> = {};
    for (const [p, value] of rows) {
      const day = days[p[0]] ||= { date: p[0], devices: {} };
      (day.devices as Row)[p[1]] = value;
    }
    for (const day of Object.values(days)) for (const field of fields) day[field] = Object.values(obj(day.devices)).reduce<number>((sum, bucket) => sum + (Number(obj(bucket)[field]) || 0), 0);
    return days;
  }
  if (kind === "done") return { marks: Object.fromEntries(rows.map(([p, v]) => [p[0], v])), touch: {} };
  if (kind === "personal") {
    const overlays: Record<string, Row> = {}, cards: Record<string, Row> = {}; let seq = 0;
    for (const [p, v] of rows) {
      if (p[0] === "seq") seq = Number(v);
      else { const target = p[0] === "overlays" ? overlays : cards; (target[p[1]] ||= {})[p[2]] = v; }
    }
    return { version: 1, seq, overlays, cards: Object.values(cards).filter(c => c.id).sort((a, b) => compare(String(a.id), String(b.id))) };
  }
  if (kind === "session") {
    const result: Row = { ...obj(local), version: 1, feynmanDrafts: {}, pastAnswers: {}, plannerPrompts: {} };
    for (const [p, value] of rows) (result[p[0]] as Row)[p[1]] = value;
    return result;
  }
  if (kind === "activity") return rows.map(([, v]) => v).sort((a, b) => compare(String(obj(a).t), String(obj(b).t))).slice(-300);
  if (kind === "mistakes") return rows.map(([p, value]) => {
    const register = doc.cells[path(...p)] || [], counts: Record<string, number> = {};
    for (const v of register.filter(v => !v.deleted)) {
      const item = obj(v.value), buckets = Object.keys(obj(item.wrongCounts)).length ? obj(item.wrongCounts) : { legacy: item.wrongCount };
      for (const [id, n] of entries(buckets)) if (!["__proto__", "constructor", "prototype"].includes(id) && typeof n === "number" && Number.isSafeInteger(n) && n >= 0) counts[id] = Math.max(counts[id] || 0, n);
    }
    return { ...obj(value), wrongCounts: counts, wrongCount: Object.values(counts).reduce((sum, n) => sum + n, 0), ...(register.some(v => obj(v.value).deleted === true) ? { deleted: true } : {}) };
  });
  if (kind === "excluded") return rows.map(([, v]) => v);
  if (mockKey(key)) {
    const selected = rows.find(([p]) => p[0] === "selected")?.[1];
    const base = rows.find(([p]) => p[0] === "paper" && p[1] === selected)?.[1];
    const responses: Record<string, Row> = {};
    for (const [p, v] of rows) if (p[0] === "response" && p[1] === selected) (responses[p[2]] ||= {})[p[3]] = v;
    const current = obj(obj(local).session);
    return { version: 1, subject: key.endsWith("825") ? "825" : "333", settings: rows.find(([p]) => p[0] === "settings")?.[1] || {}, session: base ? { ...obj(base), cursor: paperId(current) === selected ? current.cursor ?? 0 : 0, responses } : null };
  }
  return rows[0]?.[1] ?? null;
}

/** Keep legacy pure merge for first-login import, then track causal operations. */
export function importLegacy(key: string, doc: SyncDocument | undefined, local: unknown, remote: unknown): SyncDocument {
  if (doc && ["session", "mistakes"].includes(mergeKindFor(key))) return mergeDocuments(doc, legacyDocument(key, remote));
  if (doc && !Object.values(doc.cells).some(vs => vs.some(v => Object.keys(v.clock).length))) return legacyDocument(key, mergeKeyValue(mergeKindFor(key), local, remote).value);
  if (doc) return mergeDocuments(doc, legacyDocument(key, remote));
  return legacyDocument(key, mergeKeyValue(mergeKindFor(key), local, remote).value);
}

export function documentConflicts(doc: SyncDocument): Record<string, Version[]> {
  return Object.fromEntries(Object.entries(doc.cells).filter(([p, versions]) => {
    const parts = JSON.parse(p) as string[];
    return !["rev", "updatedAt"].includes(parts.at(-1) || "") && new Set(versions.map(v => canonicalJson({ value: v.value, deleted: !!v.deleted }))).size > 1;
  }));
}

/** Respect existing domain retention; do not retain invisible activity forever. */
export function compactDocument(key: string, doc: SyncDocument): SyncDocument {
  if (mergeKindFor(key) === "activity") {
    const keep = new Set(Object.entries(doc.cells).sort(([pa, a], [pb, b]) => {
      const ta = String(obj(resolve(a)).t || ""), tb = String(obj(resolve(b)).t || "");
      return compare(ta, tb) || compare(pa, pb);
    }).slice(-300).map(([p]) => p));
    return { ...doc, cells: Object.fromEntries(Object.entries(doc.cells).filter(([p]) => keep.has(p))) };
  }
  if (mergeKindFor(key) === "srs") {
    const date = Object.entries(doc.cells).filter(([p, versions]) => JSON.parse(p)[0] === "date" && resolve(versions) === true).map(([p]) => JSON.parse(p)[1] as string).sort().at(-1);
    return { ...doc, cells: Object.fromEntries(Object.entries(doc.cells).filter(([p]) => { const parts = JSON.parse(p); return parts[0] !== "admitted" || parts[1] === date; })) };
  }
  return doc;
}
