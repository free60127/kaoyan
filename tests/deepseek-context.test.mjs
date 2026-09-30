import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../lib/deepseek-browser.ts", import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20", logLevel: "silent" });
const { askDeepSeek } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const cards333 = await json("../lib/knowledge-cards.json");
const data825 = await json("../lib/825/linguistics.json");
const politics = await json("../lib/politics/politics-data.json");
const fixtures = [
  { subject: "333", bookId: "principles", chapterNo: 1, cards: cards333, teacher: /333教育综合/ },
  { subject: "825", bookId: "linguistics", chapterNo: 1, cards: data825.cards, teacher: /英语专业基础/ },
  { subject: "politics", bookId: "mayuan", chapterNo: 2, cards: politics.cards, teacher: /思想政治理论/ },
];
const key = "sk-fake-context-test";
const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });
const sectionOf = card => card.section ?? card.front.match(/^〔([^〕]+)〕/)?.[1];
const trimText = (value, max) => value.length > max ? value.slice(0, max) + "…" : value;
const noteOf = card => ({ front: trimText(card.front, 320), back: trimText(card.back, 420) });
const reply = content => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }), { status: 200 });
function capture(content = "练习反馈") {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return reply(content);
  };
  return calls;
}
function notesFrom(call) {
  const content = call.body.messages[1].content;
  const marker = "\n相关笔记摘录（限量，可能不完整）：";
  const start = content.indexOf(marker);
  return start < 0 ? [] : JSON.parse(content.slice(start + marker.length).split("\n")[0]);
}

for (const fixture of fixtures) {
  const scoped = fixture.cards.filter(card => card.book === fixture.bookId && card.chapter === fixture.chapterNo);
  const sections = [...new Set(scoped.map(sectionOf).filter(Boolean))];
  assert.ok(sections.length >= 2, `${fixture.subject} test needs at least two sections`);

  for (const section of sections.slice(0, 2)) test(`${fixture.subject} feedback uses only requested section: ${section}`, async () => {
    const calls = capture();
    assert.deepEqual(await askDeepSeek(key, "feedback", "复述内容", { ...fixture, section }), { text: "练习反馈" });
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(call.url, "https://api.deepseek.com/chat/completions");
    assert.match(call.body.messages[0].content, fixture.teacher);
    if (fixture.subject !== "333") assert.doesNotMatch(call.body.messages[0].content, /333教育综合/);
    const notes = notesFrom(call);
    const eligible = scoped.filter(card => sectionOf(card) === section).map(noteOf);
    assert.ok(notes.length > 0 && notes.length <= 6);
    assert.deepEqual(notes, eligible.slice(0, notes.length));
    assert.ok(notes.reduce((sum, card) => sum + card.front.length + card.back.length, 0) <= 3800);
    assert.equal(call.body.max_tokens, 1200);
    assert.match(call.body.messages[1].content, /限量，可能不完整/);
    assert.ok(call.body.messages[1].content.includes(`小节：${section}`));
    if (fixture.subject === "politics") assert.ok(call.body.messages[1].content.includes("当前书目：马克思主义基本原理"));
  });

  test(`${fixture.subject} plan stays in scope and uses at most four cards`, async () => {
    const calls = capture();
    await askDeepSeek(key, "plan", "安排今天的学习", { ...fixture, section: sections[1] });
    const notes = notesFrom(calls[0]);
    const eligible = scoped.filter(card => sectionOf(card) === sections[1]).map(noteOf);
    assert.ok(notes.length > 0 && notes.length <= 4);
    assert.deepEqual(notes, eligible.slice(0, notes.length));
    if (fixture.subject === "politics") assert.match(calls[0].body.messages[0].content, /思想政治理论学习规划/);
  });

  test(`${fixture.subject} missing section never falls back to chapter notes`, async () => {
    const calls = capture();
    await askDeepSeek(key, "feedback", "请核对复述", { ...fixture, section: "不存在的小节" });
    assert.deepEqual(notesFrom(calls[0]), []);
    assert.match(calls[0].body.messages[1].content, /未提供匹配当前范围的笔记摘录/);
    assert.match(calls[0].body.messages[1].content, /不代表资料库没有相关资料/);
  });
}

test("politics routes each of its five books to matching notes", async () => {
  const calls = capture();
  for (const book of politics.books) {
    const card = politics.cards.find(card => card.book === book.id);
    await askDeepSeek(key, "feedback", "请核对复述", { subject: "politics", bookId: book.id, chapterNo: card.chapter, section: card.section });
    const call = calls.at(-1);
    assert.ok(call.body.messages[1].content.includes(`当前书目：${book.name}`));
    const eligible = politics.cards.filter(row => row.book === book.id && row.chapter === card.chapter && row.section === card.section).map(noteOf);
    assert.deepEqual(notesFrom(call), eligible.slice(0, notesFrom(call).length));
    assert.ok(notesFrom(call).length > 0);
  }
});

test("333 quiz retains compatibility and requires notes for the selected section", async () => {
  const calls = capture(JSON.stringify({ stem: "新题", options: ["甲", "乙", "丙", "丁"], answer: 0, explanation: "练习解析" }));
  const ctx = { subject: "333", bookId: "principles", chapterNo: 1, section: "第二节 教育的结构与功能" };
  const result = await askDeepSeek(key, "quiz", "出一道练习题", ctx);
  assert.equal(result.question.stem, "新题");
  assert.match(result.question.source, /当前笔记/);
  assert.doesNotMatch(result.question.source, /真题风格/);
  assert.ok(notesFrom(calls[0]).every(note => note.front.startsWith(`〔${ctx.section}〕`)));
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  await assert.rejects(askDeepSeek(key, "quiz", "出题", { ...ctx, section: "不存在的小节" }), /没有可供命题的笔记/);
  assert.equal(calls.length, 1);
});

test("unsupported subjects and politics quiz do not issue requests", async () => {
  const calls = capture();
  await assert.rejects(askDeepSeek(key, "feedback", "复述", { subject: "english" }), /当前科目暂未接入/);
  await assert.rejects(askDeepSeek(key, "quiz", "出题", { subject: "politics", bookId: "mayuan", chapterNo: 1 }), /政治暂未接入/);
  assert.equal(calls.length, 0);
});

test("pre-aborted request propagates AbortError without calling fetch", async () => {
  const calls = capture();
  const controller = new AbortController();
  controller.abort("private caller details");
  await assert.rejects(askDeepSeek(key, "feedback", "复述", fixtures[0], { signal: controller.signal }), error => error.name === "AbortError" && !error.message.includes("private"));
  assert.equal(calls.length, 0);
});

test("fifth argument cancellation aborts an in-flight transport", async () => {
  const controller = new AbortController();
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  let transportSignal;
  globalThis.fetch = async (_url, init) => {
    transportSignal = init.signal;
    markStarted();
    return new Promise(() => {});
  };
  const request = askDeepSeek(key, "feedback", "复述", fixtures[0], { signal: controller.signal });
  await started;
  assert.equal(transportSignal.aborted, false);
  controller.abort("private caller details");
  await assert.rejects(request, error => error.name === "AbortError" && !error.message.includes("private"));
  assert.equal(transportSignal.aborted, true);
});

test("transport errors propagate safe diagnostics through askDeepSeek", async () => {
  globalThis.fetch = async () => new Response("private provider diagnostics", { status: 401 });
  await assert.rejects(askDeepSeek(key, "feedback", "复述", fixtures[0]), /拒绝了这个 Key（401）/);
  globalThis.fetch = async () => { throw new Error(`private Authorization Bearer ${key}`); };
  await assert.rejects(askDeepSeek(key, "feedback", "复述", fixtures[0]), error => error.message === "连接 DeepSeek 超时或网络不可用。");
});
