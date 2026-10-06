import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink, rmdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

// Exercise the real generator and data loaders, with an observation hook only.
// No real API key is read and every provider request is replaced by local fetch.
const bundled = await build({
  stdin: { contents: 'export { generateMockQuiz } from "./lib/mock-quiz"; export { loadTrainingBook } from "./lib/essay-training-data";', resolveDir: fileURLToPath(new URL("..", import.meta.url)) },
  bundle: true, write: false, format: "esm", platform: "node", target: "node20", logLevel: "silent",
  plugins: [{ name: "observe-training-loads", setup(builder) {
    builder.onLoad({ filter: /essay-training-data\.ts$/ }, async ({ path }) => ({ loader: "ts", resolveDir: fileURLToPath(new URL("../lib/", import.meta.url)),
      contents: (await readFile(path, "utf8")).replace('const [module, essays, cards]', 'globalThis.__mockTrainingLoads.push(book); const [module, essays, cards]'),
    }));
  } }],
});
const temp = await mkdtemp(join(tmpdir(), "essay-mock-context-"));
const bundlePath = join(temp, "mock.mjs");
await writeFile(bundlePath, bundled.outputFiles[0].text);
const api = await import(pathToFileURL(bundlePath));
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; delete globalThis.__mockTrainingLoads; await unlink(bundlePath); await rmdir(temp); });
const config = counts => ({ "single-choice": 0, definition: 0, "short-answer": 0, essay: 0, "material-analysis": 0, ...counts });
const context = (bookId, chapter, section) => ({ subject: "333", ranges: [{ bookId, chapters: [chapter], ...(section ? { section } : {}) }] });
const refsOf = call => JSON.parse(call.body.messages[1].content.split("\n").slice(1).join("\n"));
const typeOf = call => call.body.messages[2].content.match(/type必须为([^。]+)\。/)[1];
const clip = (text, limit) => text.length > limit ? text.slice(0, limit - 1) + "…" : text;
function capture() {
  const calls = [];
  globalThis.__mockTrainingLoads = [];
  globalThis.fetch = async (url, init) => {
    const call = { url, body: JSON.parse(init.body) };
    calls.push(call);
    const type = typeOf(call);
    const questions = refsOf(call).map(ref => ({ slotId: ref.slotId, bookId: ref.bookId, chapterNo: ref.chapterNo,
      type, knowledgePointIds: [ref.notes[0].id], stem: `AI新题${calls.length}-${ref.slotId}`,
      ...(type === "single-choice" ? { options: ["A", "B", "C", "D"], answer: 0, explanation: "来自提供笔记的解析" }
        : { referenceAnswer: "逐问参考答案来自提供笔记", rationale: "命题依据来自提供笔记" }),
    }));
    return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ questions }) } }] }), { status: 200 });
  };
  return calls;
}

test("333 subjective requests send exact scoped, note-linked answer and analysis samples with bounded excerpts", async () => {
  const calls = capture();
  const ctx = context("principles", 1, "第一节 教育的概念");
  const result = await api.generateMockQuiz("sk-fake-essay-context", config({ "single-choice": 1, "short-answer": 1, essay: 1, "material-analysis": 1 }), ctx);
  assert.deepEqual(globalThis.__mockTrainingLoads, ["principles"]);
  assert.equal(calls.length, 4);
  const entries = await api.loadTrainingBook("principles");
  for (const call of calls) {
    assert.equal(call.url, "https://api.deepseek.com/chat/completions");
    const [ref] = refsOf(call);
    if (typeOf(call) === "single-choice") {
      assert.ok(!("subjectiveQuestionStyle" in ref));
      continue;
    }
    assert.match(call.body.messages[0].content, /手册、母题或资料改编.*不是官方真题或事实库/);
    assert.match(call.body.messages[0].content, /理论→材料证据→分问作答/);
    assert.match(call.body.messages[0].content, /事实仅限.*该题notes/);
    assert.match(call.body.messages[0].content, /完整虚拟案例\/材料/);
    assert.match(call.body.messages[0].content, /逐一对应每个分问/);
    assert.match(call.body.messages[0].content, /不能.*声称官方评分标准/);
    assert.ok(ref.subjectiveQuestionStyle.length > 0 && ref.subjectiveQuestionStyle.length <= 2);
    for (const sample of ref.subjectiveQuestionStyle) {
      const original = entries.find(entry => entry.id === sample.id);
      assert.ok(original);
      assert.equal(original.ocrWarning, "", "unverified OCR sources are not used as model examples");
      assert.equal(sample.bookId, ref.bookId);
      assert.equal(sample.chapterNo, ref.chapterNo);
      assert.equal(sample.section, ref.section);
      assert.equal(sample.origin, original.origin);
      assert.equal(sample.type, original.questionType === "material" ? "material-analysis" : original.questionType);
      assert.equal(sample.source, clip(original.source, 250));
      assert.equal(sample.stem, clip(original.stem, 600));
      assert.equal(sample.referenceAnswer, clip(original.referenceAnswer, 950));
      assert.equal(sample.analysis, clip(original.analysis, 300));
      assert.ok(sample.knowledgeCardIds.length);
      assert.ok(sample.knowledgeCardIds.every(id => original.knowledgeCardIds.includes(id) && ref.notes.some(note => note.id === id)));
      assert.ok(JSON.stringify(sample).length <= 2500);
    }
    if (typeOf(call) === "material-analysis") assert.equal(ref.subjectiveQuestionStyle[0].type, "material-analysis");
  }
  assert.equal(result.questions.length, 4);
  assert.ok(result.questions.every(question => /AI.*非历年真题/.test(question.source)));
});

test("chapter requests recompute sample eligibility after note rotation, and load each selected book once", async () => {
  const calls = capture();
  await api.generateMockQuiz("sk-fake-essay-context", config({ essay: 6 }), { subject: "333", ranges: [{ bookId: "china", chapters: [2, 7] }, { bookId: "principles", chapters: [1] }] });
  assert.deepEqual(globalThis.__mockTrainingLoads, ["china", "principles"]);
  const refs = calls.flatMap(refsOf);
  assert.equal(refs.length, 6);
  assert.notEqual(refs[0].notes[0].id, refs[3].notes[0].id);
  assert.ok(refs.some(ref => ref.subjectiveQuestionStyle.length > 0));
  for (const ref of refs) for (const sample of ref.subjectiveQuestionStyle) {
    assert.equal(sample.bookId, ref.bookId);
    assert.equal(sample.chapterNo, ref.chapterNo);
    assert.ok(sample.knowledgeCardIds.every(id => ref.notes.some(note => note.id === id)));
    assert.ok(JSON.stringify(sample).length <= 2500);
    assert.doesNotMatch(sample.analysis, /跨书|跨章|跨中国教育史/);
  }
});

test("Chinese-only scope excludes the original comparison with Japanese Meiji education", async () => {
  const calls = capture();
  await api.generateMockQuiz("sk-fake-essay-context", config({ essay: 5 }), context("china", 7, "第一节 近代教育改革措施"));
  for (const ref of calls.flatMap(refsOf)) {
    assert.ok(ref.subjectiveQuestionStyle.length);
    assert.ok(ref.subjectiveQuestionStyle.every(sample => sample.bookId === "china" && sample.chapterNo === 7 && sample.section === ref.section));
    assert.doesNotMatch(JSON.stringify(ref.subjectiveQuestionStyle), /明治|training-china-c7-s1-2|hb-zhongjiao-16/);
  }
});

test("825 subjective and 333 MCQ/definition-only requests neither load nor inject subjective banks", async () => {
  for (const [ctx, counts] of [
    [context("principles", 1), { "single-choice": 4 }],
    [context("principles", 1), { definition: 1 }],
    [{ subject: "825", ranges: [{ bookId: "linguistics", chapters: [1], section: "语言的定义" }] }, { "short-answer": 1, essay: 1, "material-analysis": 1 }],
  ]) {
    const calls = capture();
    await api.generateMockQuiz("sk-fake-essay-context", config(counts), ctx);
    assert.deepEqual(globalThis.__mockTrainingLoads, []);
    for (const call of calls) {
      assert.ok(refsOf(call).every(ref => !("subjectiveQuestionStyle" in ref)));
      assert.doesNotMatch(JSON.stringify(call.body.messages), /subjectiveQuestionStyle|手册、母题/);
    }
  }
});
