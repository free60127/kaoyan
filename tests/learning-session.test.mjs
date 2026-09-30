import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../lib/learning-session.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { createLearningSession, restoreLearningSession, feynmanDraftKey, pastAnswerKey, validateLocation } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const ids = { "333": ["principles", "psychology"], "825": ["linguistics", "literature"], politics: ["mayuan", "sixiu"] };
const catalog = [{ id: "mayuan", chapters: [{ sections: ["chapter one"] }, { sections: ["考点二", "考点三"] }] }];

test("reload retains each subject's full location, scoped drafts and separate planner prompts", () => {
  const session = createLearningSession(ids);
  session.subject = "politics";
  session.locations.politics = { ...session.locations.politics, chapter: 2, section: "考点二", view: "feynman" };
  session.locations["825"] = { ...session.locations["825"], book: "literature", view: "quiz", pastMode: "practice", pastYear: 2025, pastIndex: 3 };
  const current = feynmanDraftKey("politics", session.locations.politics);
  const otherSection = feynmanDraftKey("politics", { ...session.locations.politics, section: "考点三" });
  const otherSubject = feynmanDraftKey("333", session.locations["333"]);
  session.feynmanDrafts = { [current]: "复述草稿", [otherSection]: "另一节", [otherSubject]: "教育草稿" };
  session.plannerPrompts = { politics: "今天两小时", "333": "整理教育史" };
  const restored = restoreLearningSession(JSON.stringify(session), ids);
  assert.deepEqual(restored, session);
  assert.equal(validateLocation(restored.locations.politics, catalog), restored.locations.politics);
  assert.notEqual(current, otherSection);
  assert.notEqual(current, otherSubject);
});

test("825 answers belong to stable question IDs independent of year, mode and list index", () => {
  const session = createLearningSession(ids);
  const q1 = pastAnswerKey("linguistics", "2025-q1"), q2 = pastAnswerKey("linguistics", "2025-q2");
  const otherBook = pastAnswerKey("literature", "2025-q1");
  session.pastAnswers = { [q1]: "First answer", [q2]: "Second answer", [otherBook]: "Literature answer" };
  session.locations["825"].pastYear = 2024;
  session.locations["825"].pastMode = "index";
  session.locations["825"].pastIndex = 1;
  const restored = restoreLearningSession(JSON.stringify(session), ids);
  assert.equal(restored.pastAnswers[q1], "First answer");
  assert.equal(restored.pastAnswers[q2], "Second answer");
  assert.equal(restored.pastAnswers[otherBook], "Literature answer");
});

test("lazy catalogs keep restored locations until loaded, then validate against actual sections", () => {
  const session = createLearningSession(ids);
  const location = { ...session.locations.politics, chapter: 2, section: "考点二", view: "feynman" };
  assert.equal(validateLocation(location, []), location);
  assert.equal(validateLocation(location, catalog), location);
  assert.deepEqual(validateLocation({ ...location, section: "deleted" }, catalog), { ...location, section: "" });
  assert.deepEqual(validateLocation({ ...location, chapter: 99 }, catalog), { ...location, chapter: 1, section: "" });
  assert.deepEqual(validateLocation({ ...location, book: "removed" }, catalog), { ...location, book: "mayuan", chapter: 1, section: "" });
});

test("corrupt, null, array and wrong-type stored values recover without crashing", () => {
  for (const raw of [null, "{", "null", "[]", "42", '"oops"', '{"version":2}']) {
    assert.deepEqual(restoreLearningSession(raw, ids), createLearningSession(ids));
  }
  const invalid = { version: 1, subject: "__proto__", locations: { "333": { book: "unknown", chapter: "2", section: {}, view: "bad", pastIndex: -1 }, politics: { book: "mayuan", chapter: -1, view: "quiz" } }, feynmanDrafts: { "__proto__": "invalid", '["333","unknown",1,""]': "bad book", '["333","principles",1,""]': {} }, pastAnswers: null, plannerPrompts: { "333": [], politics: "usable" } };
  const restored = restoreLearningSession(JSON.stringify(invalid), ids);
  assert.equal(restored.subject, "333");
  assert.equal(restored.locations["333"].book, "principles");
  assert.equal(restored.locations["333"].chapter, 1);
  assert.equal(restored.locations.politics.view, "overview");
  assert.deepEqual(restored.feynmanDrafts, {});
  assert.deepEqual(restored.pastAnswers, {});
  assert.deepEqual(restored.plannerPrompts, { politics: "usable" });
});

test("restore explicitly excludes API key and unrelated storage data", () => {
  const session = createLearningSession(ids);
  const restored = restoreLearningSession(JSON.stringify({ ...session, key: "private-key", apiKey: "private-key", locations: { ...session.locations, politics: { ...session.locations.politics, key: "private-key" } }, feynmanDrafts: { apiKey: "private-key" }, pastAnswers: { key: "private-key" }, plannerPrompts: { apiKey: "private-key" } }), ids);
  assert.equal(JSON.stringify(restored).includes("private-key"), false);
  assert.deepEqual(restored, session);
});

test("earlier last-place records migrate and preserve the selected subject", () => {
  const restored = restoreLearningSession(null, ids, JSON.stringify({ subject: "politics", book: "sixiu", chapter: 3 }));
  assert.equal(restored.subject, "politics");
  assert.equal(restored.locations.politics.book, "sixiu");
  assert.equal(restored.locations.politics.chapter, 3);
  assert.equal(restored.locations.politics.view, "overview");
});
