import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const output = await build({ entryPoints: [fileURLToPath(new URL("../lib/study-backup.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", target: "node20" });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);
const { collectStudyBackup: collect, validateStudyBackup: validate, applyStudyBackup: apply, summarizeStudyBackup: summarize, buildBackupDocument: document, loadBackupCatalogs, MAX_BACKUP_BYTES, BACKUP_STORAGE_KEYS } = api;
const catalogs = await loadBackupCatalogs();
const now = new Date("2026-09-30T12:00:00.000Z");
const sessionKey = "yantu-learning-session-v1";
const examKey = "yantu-exam-target-v1";
const srsKey = subject => `yantu-srs-v1-${subject}`;
const doneKey = subject => subject === "333" ? "yantu-done" : `yantu-done-${subject}`;
const mockKey = subject => `kaoyan.mock-practice.v1.${subject}`;
const clone = value => JSON.parse(JSON.stringify(value));
function memory(initial = {}) {
  const values = new Map(Object.entries(initial)), reads = [], writes = [];
  return { values, reads, writes, getItem(key) { reads.push(key); return values.get(key) ?? null; }, setItem(key, value) { writes.push(key); values.set(key, value); }, removeItem(key) { writes.push(key); values.delete(key); } };
}
function progress(subject) {
  const card = catalogs[subject].cards.find(card => card.section) || catalogs[subject].cards[0];
  const scope = { bookId: card.book, chapters: [card.chapter], ...(card.section ? { section: card.section } : {}) };
  return { version: 1, cards: { [card.id]: { dueAt: "2027-10-04T12:00:00.000Z", firstStudiedAt: "2026-09-29T12:00:00.000Z", lastReviewedAt: "2026-09-29T12:00:00.000Z", intervalDays: 370, ease: 2.6, reps: 3, lapses: 1, stage: "review" } }, scopes: [scope], newScopes: [scope], dailyNewLimit: 17, daily: { date: "2026-09-29", admitted: [card.id] } };
}
function learning() {
  const locations = Object.fromEntries(["333", "825", "politics", "english"].map(subject => {
    const book = catalogs[subject]?.books[0];
    return [subject, { book: book?.id || "", chapter: 1, section: book?.chapters[0].sections[0] || "", view: "overview", pastMode: "practice", pastYear: 2026, pastIndex: 0 }];
  }));
  const q = catalogs["825"].questions[0];
  return { version: 1, subject: "825", locations, feynmanDrafts: Object.fromEntries(["333", "825", "politics"].map(subject => {
    const loc = locations[subject];
    return [JSON.stringify([subject, loc.book, loc.chapter, loc.section]), `${subject}复述草稿\n第二行`];
  })), pastAnswers: { [JSON.stringify(["825", q.book, q.id])]: "完整真题答复\n继续论证" }, plannerPrompts: { english: "英语安排", "333": "今天先复习" } };
}
function mock(subject) {
  const book = catalogs[subject].books[0], unit = { bookId: book.id, chapterNo: 1, bookName: book.name, chapterName: book.chapters[0].title };
  const config = { "single-choice": 1, definition: 0, "short-answer": 0, essay: 1, "material-analysis": 0 };
  const knowledgePointIds = [catalogs[subject].cards.find(card => card.book === book.id && card.chapter === 1).id];
  return { version: 1, subject, settings: { counts: Object.fromEntries(Object.entries(config).map(([key, count]) => [key, String(count)])), selection: { [book.id]: [1] } }, session: {
    snapshot: { subject, config, ranges: [{ bookId: book.id, chapters: [1] }], scopeLabel: `${book.name}第1章`, createdAt: "2026/9/30 20:00:00" },
    result: { questions: [{ ...unit, id: "choice", type: "single-choice", stem: "模拟选择题完整题干", options: ["选项甲", "选项乙", "选项丙", "选项丁"], answer: 1, explanation: "完整选择解析", source: "AI 模拟题", knowledgePointIds }, { ...unit, id: "essay", type: "essay", stem: "模拟论述题完整题干", referenceAnswer: "完整参考答案\n论证", rationale: "完整考点依据", source: "AI 模拟题", knowledgePointIds }], coverage: { requestedUnits: [unit], coveredUnits: [unit], uncoveredUnits: [], complete: true, note: "已覆盖" } },
    cursor: 1, mode: "paper", responses: { choice: { choice: 2, revealed: true }, essay: { text: "我的完整作答\n结论", revealed: false } },
  } };
}
function fullStorage() {
  const values = { [sessionKey]: JSON.stringify(learning()), "unrelated": "keep", "yantu-key": "never read" };
  values[examKey] = JSON.stringify({ version: 1, date: "2028-02-29" });
  values["yantu-mistakes-v1"] = JSON.stringify([{ id: "333:card:x1", subject: "333", kind: "card", refId: "x1", label: "题面", wrongCount: 2, lastAt: now.toISOString() }]);
  values["yantu-mcq-excluded-v1"] = JSON.stringify(["principles-k1-001"]);
  values["yantu-personal-v1"] = JSON.stringify({ version: 1, seq: 3, overlays: { "333:principles-k1-001": { rev: 1, updatedAt: now.toISOString(), baseHash: "abc", note: { text: "老师补充的易错点", runs: [] } } }, cards: [{ id: "mine-test-1", subject: "333", book: catalogs["333"].books[0].id, chapter: 1, section: "", front: { text: "自建问题", runs: [] }, back: { text: "自建答案", runs: [] }, createdAt: now.toISOString(), rev: 1 }] });
  for (const subject of ["333", "825", "politics"]) values[`yantu-activity-v1-${subject}`] = JSON.stringify([{ t: now.toISOString(), kind: "rating", subject, label: "题面", detail: "记住了" }]);
  for (const subject of ["333", "825", "politics"]) {
    values[srsKey(subject)] = JSON.stringify(progress(subject));
    values[doneKey(subject)] = JSON.stringify({ [`${catalogs[subject].books[0].id}-1`]: true, [`${catalogs[subject].books[0].id}-2`]: false });
    values[`yantu-stats-v1-${subject}`] = JSON.stringify({ "2026-09-30": { date: "2026-09-30", ratings: 3, again: 1, newCards: 2, quiz: 4, quizCorrect: 3 } });
    if (subject !== "politics") values[mockKey(subject)] = JSON.stringify(mock(subject));
  }
  return memory(values);
}
function backupWith(key, value) { return { format: "yantu-study-backup", version: 1, createdAt: now.toISOString(), records: { [key]: value } }; }

test("real lazy catalogs match app chapter and section models", () => {
  for (const subject of ["333", "825", "politics"]) {
    assert.ok(catalogs[subject].cards.length > 100);
    const card = catalogs[subject].cards.find(card => card.section);
    const book = catalogs[subject].books.find(book => book.id === card.book);
    assert.ok(book.chapters[card.chapter - 1].sections.includes(card.section));
  }
  assert.ok(catalogs["825"].questions.length > 0);
});
test("sessions on the new practice/mistakes/stats/search views round trip through backup", () => {
  const storage = fullStorage();
  const raw = JSON.parse(storage.values.get(sessionKey));
  raw.locations["333"].view = "choice";
  raw.locations.politics.view = "mistakes";
  raw.locations["825"].view = "stats";
  raw.locations.english.view = "search";
  storage.values.set(sessionKey, JSON.stringify(raw));
  const backup = collect(storage, catalogs, now);
  const restored = backup.records[sessionKey];
  assert.equal(restored.locations["333"].view, "choice");
  assert.equal(restored.locations.politics.view, "mistakes");
  assert.equal(restored.locations["825"].view, "stats");
  assert.equal(restored.locations.english.view, "search");
  const target = memory({});
  apply(target, JSON.stringify(backup), catalogs);
  assert.equal(JSON.parse(target.values.get(sessionKey)).locations.politics.view, "mistakes");
});
test("politics still rejects quiz and mock views in backup", () => {
  const storage = fullStorage();
  const raw = JSON.parse(storage.values.get(sessionKey));
  raw.locations.politics.view = "quiz";
  storage.values.set(sessionKey, JSON.stringify(raw));
  assert.throws(() => collect(storage, catalogs, now), /未知页面/);
});
test("all nineteen keys round trip realistic three-subject records, future dates, drafts and full papers", () => {
  const source = fullStorage(), backup = collect(source, catalogs, now), target = memory({ unrelated: "untouched", "yantu-key": "private" });
  assert.deepEqual(Object.keys(backup.records), BACKUP_STORAGE_KEYS);
  assert.equal(source.writes.length, 0);
  assert.equal(source.reads.includes("yantu-key"), false);
  assert.equal(source.reads.includes("unrelated"), false);
  const result = apply(target, JSON.stringify(backup), catalogs);
  assert.deepEqual(collect(target, catalogs, now), backup);
  assert.equal(target.values.get("unrelated"), "untouched");
  assert.equal(target.values.get("yantu-key"), "private");
  for (const subject of ["333", "825", "politics"]) {
    assert.deepEqual(backup.records[srsKey(subject)], progress(subject));
    assert.equal(result.summary[subject].studiedCards, 1);
    assert.equal(result.summary[subject].completedChapters, 1);
  }
  assert.equal(result.summary["825"].mistakes, 0);
  assert.equal(result.summary["333"].quizAnswers, 4); // fullStorage 的 stats 样本
  assert.deepEqual(result.summary["english"], { studiedCards: 0, completedChapters: 0, mockQuestions: 0, drafts: 1, mistakes: 0, quizAnswers: 0 });
  assert.equal(result.summary.english.drafts, 1);
  assert.deepEqual(backup.records[examKey], { version: 1, date: "2028-02-29" });
});
test("legacy backups omit the exam target and preserve an existing target on import", () => {
  const old = backupWith(sessionKey, learning());
  assert.equal(Object.hasOwn(validate(old, catalogs).records, examKey), false);
  const target = memory({ [examKey]: JSON.stringify({ version: 1, date: "2027-12-01" }) });
  const result = apply(target, old, catalogs);
  assert.equal(result.keys.includes(examKey), false);
  assert.equal(JSON.parse(target.values.get(examKey)).date, "2027-12-01");
  const empty = collect(memory(), catalogs, now);
  assert.equal(Object.hasOwn(empty.records, examKey), false);
});
test("exam target rejects impossible dates, invalid years and versions before writing", () => {
  for (const value of [null, "2027-12-01", { version: 1, date: "2027-02-29" }, { version: 1, date: "2100-02-29" }, { version: 1, date: "0000-01-01" }, { version: 1, date: "10000-01-01" }, { version: 2, date: "2027-12-01" }]) {
    const target = memory();
    assert.throws(() => apply(target, backupWith(examKey, value), catalogs), /考试日期/);
    assert.deepEqual(target.writes, []);
  }
  const raw = JSON.stringify({ version: 1, date: "2027-04-31" }), source = memory({ [examKey]: raw });
  assert.throws(() => collect(source, catalogs, now), /考试日期/);
  assert.equal(source.values.get(examKey), raw);
  assert.deepEqual(source.writes, []);
  assert.deepEqual(validate(backupWith(examKey, { version: 1, date: "2028-02-29", apiKey: "private" }), catalogs).records[examKey], { version: 1, date: "2028-02-29" });
});
test("document includes original problems, chapter labels, dates, every option and complete answers", () => {
  const backup = collect(fullStorage(), catalogs, now), result = document(backup, catalogs), text = result.blocks.map(block => block.text).join("\n");
  for (const subject of ["333", "825", "politics"]) {
    const id = Object.keys(progress(subject).cards)[0], card = catalogs[subject].cards.find(card => card.id === id);
    assert.ok(text.includes(card.front));
    // 备份文档会剥离教材重点标记(⟦k|…⟧)后再输出
    assert.ok(text.includes(card.back.replace(/⟦[gbrys]\|([^⟧]*)⟧/g, "$1")));
  }
  for (const value of ["2027-10-04T12:00:00.000Z", "已完成", "新学范围", "333复述草稿\n第二行", "完整真题答复\n继续论证", "非历年真题", "选项甲", "选项乙", "选项丙", "选项丁", "我的作答：C", "参考答案：B", "我的完整作答\n结论", "完整参考答案\n论证", "完整选择解析", "完整考点依据"]) assert.ok(text.includes(value), value);
  assert.ok(text.includes("目标初试日期：2028-02-29（手动设置）"));
});
test("legacy reviews and last-place migrate without losing future dues or changing source storage", () => {
  const values = {}, originals = {};
  for (const subject of ["333", "825", "politics"]) {
    const id = catalogs[subject].cards[0].id, key = subject === "333" ? "yantu-reviews" : `yantu-reviews-${subject}`;
    values[key] = JSON.stringify({ [id]: { due: "2027-10-04", interval: 370, ease: 2.6, reps: 3 } });
    originals[key] = values[key];
  }
  values["yantu-last-place"] = JSON.stringify({ subject: "825", book: "linguistics", chapter: 2, view: "feynman" });
  const source = memory(values), backup = collect(source, catalogs, now);
  for (const subject of ["333", "825", "politics"]) {
    const saved = backup.records[srsKey(subject)], id = catalogs[subject].cards[0].id;
    assert.equal(saved.cards[id].dueAt, new Date(2027, 9, 4).toISOString());
    assert.equal(saved.cards[id].reps, 3);
    assert.deepEqual(saved.newScopes, []);
    assert.deepEqual(saved.daily.admitted, []);
  }
  assert.equal(backup.records[sessionKey].locations["825"].chapter, 2);
  assert.equal(source.writes.length, 0);
  for (const [key, raw] of Object.entries(originals)) assert.equal(source.values.get(key), raw);
});
test("older v1 SRS without newScopes is normalized only during collection", () => {
  const row = progress("333"); delete row.newScopes;
  const backup = collect(memory({ [srsKey("333")]: JSON.stringify(row) }), catalogs, now);
  assert.deepEqual(backup.records[srsKey("333")].newScopes, []);
  assert.throws(() => validate(backupWith(srsKey("333"), row), catalogs));
});
test("removed card IDs keep valid historical review and admitted data, with explicit document label", () => {
  const row = progress("333"), review = Object.values(row.cards)[0];
  row.cards = { "historical-card": review }; row.daily.admitted = ["historical-card"];
  const backup = validate(backupWith(srsKey("333"), row), catalogs);
  assert.deepEqual(backup.records[srsKey("333")], row);
  assert.ok(document(backup, catalogs).blocks.some(block => block.text.includes("historical-card（当前题库已移除")));
});
test("credential extra fields at any valid data level are discarded", () => {
  const storage = fullStorage();
  for (const key of BACKUP_STORAGE_KEYS) {
    if (key.startsWith("yantu-done")) continue;
    const row = JSON.parse(storage.values.get(key)); row.apiKey = "sk-SECRET";
    if (Array.isArray(row)) { if (typeof row[0] === "object" && row[0]) row[0].apiKey = "sk-SECRET"; continue; }
    if (row.cards) Object.values(row.cards)[0].apiKey = "sk-SECRET";
    if (row.locations) row.locations["333"].apiKey = "sk-SECRET";
    if (row.session) { row.session.responses.essay.apiKey = "sk-SECRET"; row.session.result.questions[0].apiKey = "sk-SECRET"; }
    storage.values.set(key, JSON.stringify(row));
  }
  assert.doesNotMatch(JSON.stringify(collect(storage, catalogs, now)), /apiKey|sk-SECRET/);
});
test("unknown top-level schema, keys, versions and prototype keys are rejected before mutation", () => {
  const baseline = collect(fullStorage(), catalogs, now);
  const mutations = [r => r.version = 2, r => r.format = "wrong", r => r.createdAt = "2026-02-30T12:00:00Z", r => r.extra = true, r => r.records["yantu-key"] = "secret", r => r.records["yantu-last-place"] = {}, r => r.records = [], r => delete r.createdAt];
  for (const mutate of mutations) {
    const row = clone(baseline); mutate(row); const target = memory();
    assert.throws(() => apply(target, row, catalogs)); assert.equal(target.writes.length, 0);
  }
  for (const key of ["__proto__", "constructor", "prototype"]) {
    const raw = JSON.stringify(baseline).replace('"records":{', `"records":{"${key}":{},`);
    assert.throws(() => validate(raw, catalogs), /原型键/);
  }
});
test("malformed existing local records and legacy formats fail visibly rather than defaulting", () => {
  for (const raw of ["{", "null", "[]", JSON.stringify({ version: 2 }), JSON.stringify({ ...progress("333"), cards: { broken: { dueAt: "oops" } } })]) {
    const storage = memory({ [srsKey("333")]: raw });
    assert.throws(() => collect(storage, catalogs, now)); assert.equal(storage.writes.length, 0);
  }
  for (const values of [{ "yantu-reviews": '{"bad":{"due":"2026-02-30"}}' }, { "yantu-reviews": '{"bad":{"reps":"3"}}' }, { "yantu-last-place": '{"subject":"825","book":"gone"}' }]) assert.throws(() => collect(memory(values), catalogs, now));
});
test("strict guards reject damaged typed values, unknown scopes, drafts and mock content", () => {
  const baseline = collect(fullStorage(), catalogs, now);
  const mutations = [
    r => Object.values(r.records[srsKey("333")].cards)[0].ease = "2.6",
    r => Object.values(r.records[srsKey("333")].cards)[0].dueAt = "2026-02-30T00:00:00Z",
    r => r.records[srsKey("333")].daily.admitted.push("unlearned"),
    r => r.records[srsKey("825")].newScopes[0].section = "unknown",
    r => r.records[srsKey("politics")].scopes[0].bookId = "missing",
    r => r.records[srsKey("politics")].dailyNewLimit = 201,
    r => r.records[doneKey("333")]["principles-999"] = true,
    r => r.records[doneKey("333")]["principles-1"] = "yes",
    r => r.records[sessionKey].locations["825"].chapter = 999,
    r => r.records[sessionKey].feynmanDrafts['["333","unknown",1,""]'] = "draft",
    r => r.records[sessionKey].pastAnswers['["825","linguistics","unknown"]'] = "answer",
    r => r.records[mockKey("333")].session.result.questions[0].options.pop(),
    r => r.records[mockKey("825")].session.responses.essay.text = 2,
    r => r.records[mockKey("825")].subject = "333",
  ];
  for (const mutate of mutations) { const row = clone(baseline); mutate(row); assert.throws(() => validate(row, catalogs)); }
});
test("UTF8 size limit includes unrecognized fields before sanitizing; bounded text cannot be overlong", () => {
  const row = backupWith(sessionKey, learning()); row.records[sessionKey].apiKey = "汉".repeat(Math.floor(MAX_BACKUP_BYTES / 3));
  assert.throws(() => validate(row, catalogs), /8 MiB/);
  assert.throws(() => validate(" ".repeat(MAX_BACKUP_BYTES + 1), catalogs), /8 MiB/);
  const large = backupWith(sessionKey, learning()); large.records[sessionKey].plannerPrompts.english = "x".repeat(200_001);
  assert.throws(() => validate(large, catalogs));
});
test("partial replace touches included keys only, preserving absent keys and credentials", () => {
  const storage = fullStorage(), before = new Map(storage.values), backup = backupWith(doneKey("333"), {});
  assert.deepEqual(apply(storage, backup, catalogs).keys, [doneKey("333")]);
  for (const [key, value] of before) assert.equal(storage.values.get(key), key === doneKey("333") ? '{"marks":{},"touch":{}}' : value);
  assert.deepEqual(apply(storage, { ...backup, records: {} }, catalogs).keys, []);
});
test("quota failure restores original strings and removes previously absent and throwing-write keys", () => {
  const storage = memory({ [sessionKey]: "original unparsed value", unrelated: "keep" }), baseline = collect(fullStorage(), catalogs, now);
  const set = storage.setItem.bind(storage); let failed = false;
  storage.setItem = (key, value) => { set(key, value); if (!failed && key === srsKey("825")) { failed = true; throw new Error("quota"); } };
  assert.throws(() => apply(storage, baseline, catalogs), /已恢复原有记录/);
  assert.deepEqual(Object.fromEntries(storage.values), { [sessionKey]: "original unparsed value", unrelated: "keep" });
});
test("failure to read a later old value starts no writes; rollback failures are explicit", () => {
  const baseline = collect(fullStorage(), catalogs, now), storage = memory();
  storage.getItem = key => { if (key === mockKey("825")) throw new Error("unavailable"); return null; };
  assert.throws(() => apply(storage, baseline, catalogs)); assert.equal(storage.writes.length, 0);
  // 首个写入键是个人编辑层; 让它在存储中已存在, 回滚才会走 setItem(被破坏的通道)而非 removeItem
  const broken = memory({ [sessionKey]: "before", "yantu-personal-v1": "before" });
  broken.setItem = () => { throw new Error("unavailable"); };
  assert.throws(() => apply(broken, baseline, catalogs), /写入失败且回滚失败.*yantu-personal-v1/);
});
test("all reads stay within current whitelist and documented read-only legacy aliases", () => {
  const source = memory(); collect(source, catalogs, now);
  const allowed = new Set([...BACKUP_STORAGE_KEYS, "yantu-last-place", "yantu-reviews", "yantu-reviews-825", "yantu-reviews-politics"]);
  assert.ok(source.reads.every(key => allowed.has(key)));
  assert.equal(source.writes.length, 0);
});
