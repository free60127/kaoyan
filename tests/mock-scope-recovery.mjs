import { test, after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temp = await mkdtemp(join(tmpdir(), "mock-scope-recovery-"));
await build({ entryPoints: ["lib/mock-quiz.ts", "lib/mock-paper-templates.ts"], bundle: true, platform: "node", format: "esm", outdir: temp, logLevel: "silent" });
const api = await import(pathToFileURL(join(temp, "mock-quiz.js")));
const templates = await import(pathToFileURL(join(temp, "mock-paper-templates.js")));
const originalFetch = globalThis.fetch;
after(async () => { globalThis.fetch = originalFetch; await rm(temp, { recursive: true, force: true }); });
const key = "sk-fake-SCOPE-TEST-DO-NOT-USE";
const cfg = (counts) => ({ "single-choice": 0, definition: 0, "short-answer": 0, essay: 0, "material-analysis": 0, ...counts });
const context = { subject: "333", ranges: [{ bookId: "principles", chapters: [1, 2, 3] }] };
const oneChapter = { subject: "333", ranges: [{ bookId: "principles", chapters: [1] }] };
function reply(value) {
  return new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: typeof value === "string" ? value : JSON.stringify(value) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}
function responder(transform = (rows) => rows) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const refs = JSON.parse(body.messages[1].content.split("\n").slice(1).join("\n"));
    const type = body.messages[2].content.match(/type必须为([^。]+)\。/)[1];
    calls.push({ body, refs, init });
    const rows = refs.map((ref) => {
      const base = { slotId: ref.slotId, bookId: ref.bookId, chapterNo: ref.chapterNo, type, stem: `${ref.slotId}: ${ref.notes[0].front}`, knowledgePointIds: [ref.notes[0].id] };
      return type === "single-choice" ? { ...base, options: ["A", "B", "C", "D"], answer: 0, explanation: ref.notes[0].back }
        : { ...base, referenceAnswer: ref.notes[0].back, rationale: ref.notes[0].front };
    });
    const result = await transform(rows, calls.length, refs, body, init);
    return result instanceof Response ? result : reply(typeof result === "string" ? result : { questions: result });
  };
  return calls;
}
function assertProvenance(result, calls) {
  const refs = new Map(calls.flatMap((call) => call.refs.map((ref) => [ref.slotId, ref])));
  result.questions.forEach((question, index) => {
    const ref = refs.get(`slot-${index + 1}`);
    assert.equal(question.bookId, ref.bookId);
    assert.equal(question.chapterNo, ref.chapterNo);
    assert.ok(question.knowledgePointIds.every((id) => ref.notes.some((note) => note.id === id)));
    assert.equal(question.stem, `${ref.slotId}: ${ref.notes[0].front}`.trim());
    assert.ok(question.id.endsWith(`-${index + 1}`));
  });
}

test("explicit slots accept reordered numeric-string chapters and exact supplied book-name aliases", async () => {
  for (const ctx of [context, { subject: "825", ranges: [{ bookId: "linguistics", chapters: [1, 2, 3] }] }]) {
    const calls = responder((rows, call, refs) => rows.map((row, index) => ({ ...row, chapterNo: String(row.chapterNo), bookId: refs[index].bookName })).reverse());
    const result = await api.generateMockQuiz(key, cfg({ definition: 3 }), ctx);
    assert.equal(calls.length, 1);
    assertProvenance(result, calls);
    const skeleton = JSON.parse(calls[0].body.messages[2].content.split("）：")[1].split("。已生成题干")[0]);
    assert.deepEqual(skeleton.questions.map(({ slotId, bookId, chapterNo, knowledgePointIds }) => ({ slotId, bookId, chapterNo, knowledgePointIds })), calls[0].refs.map((ref) => ({ slotId: ref.slotId, bookId: ref.bookId, chapterNo: ref.chapterNo, knowledgePointIds: [ref.notes[0].id] })));
  }
});

test("legacy rows without slots map by supplied scope and note provenance when reordered", async () => {
  for (const ctx of [context, oneChapter]) {
    const calls = responder((rows) => rows.map(({ slotId, ...row }) => row).reverse());
    const result = await api.generateMockQuiz(key, cfg({ definition: 3 }), ctx);
    assert.equal(calls.length, 1);
    assertProvenance(result, calls);
  }
});

test("mixed explicit and legacy identities reserve slots and preserve provenance", async () => {
  for (const ctx of [context, oneChapter]) {
    const calls = responder((rows) => rows.map((row, index) => {
      if (index !== 1) return row;
      const { slotId, ...legacy } = row;
      return legacy;
    }).reverse());
    const result = await api.generateMockQuiz(key, cfg({ definition: 3 }), ctx);
    assert.equal(calls.length, 1);
    assertProvenance(result, calls);
  }
  const calls = responder((rows) => {
    const { slotId, ...sameIdentity } = rows[0];
    return [sameIdentity, rows[0], rows[2]];
  });
  await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 3 }), context), /命题蓝图/);
  assert.equal(calls.length, 2);
});

test("legacy positional compatibility requires scope and every note to match that slot", async () => {
  const ctx = { subject: "333", ranges: [{ bookId: "principles", chapters: [1], section: "第二节 教育的结构与功能" }] };
  const calls = responder((rows, call, refs) => {
    const common = refs[0].notes.find((note) => refs.every((ref) => ref.notes.some((own) => own.id === note.id)));
    assert.ok(common, "fixture must include overlapping per-slot notes");
    return rows.map(({ slotId, ...row }) => ({ ...row, knowledgePointIds: [common.id] }));
  });
  const result = await api.generateMockQuiz(key, cfg({ definition: 3 }), ctx);
  assert.equal(calls.length, 1);
  assert.equal(result.questions.length, 3);
  result.questions.forEach((row, index) => {
    assert.equal(row.stem, `slot-${index + 1}: ${calls[0].refs[index].notes[0].front}`.trim());
    assert.ok(row.knowledgePointIds.every((id) => calls[0].refs[index].notes.some((note) => note.id === id)));
  });
});

test("duplicate, unknown or malformed slots and real scope violations fail after only one correction", async () => {
  const mutations = [
    (rows) => rows.map((row) => ({ ...row, slotId: rows[0].slotId })),
    ...["unknown-slot", "", null, 1].map((slotId) => (rows) => rows.map((row) => ({ ...row, slotId }))),
    (rows) => rows.map((row) => ({ ...row, bookId: "foreign" })),
    (rows) => rows.map((row) => ({ ...row, chapterNo: 99 })),
    (rows) => rows.map((row) => ({ ...row, chapterNo: "1e0" })),
    (rows) => rows.map((row) => ({ ...row, chapterNo: "1.0" })),
    // These scopes exist in this batch, but belong to a different slot.
    (rows) => rows.map((row, index) => ({ ...row, chapterNo: rows[(index + 1) % rows.length].chapterNo })),
    (rows) => rows.map((row) => ({ ...row, knowledgePointIds: ["unknown-note-id"] })),
  ];
  for (const mutate of mutations) {
    const calls = responder(mutate);
    const progress = [];
    await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 3 }), context, { onProgress: (done) => progress.push(done) }));
    assert.equal(calls.length, 2);
    assert.deepEqual(progress, [0]);
    assert.equal(calls[1].body.messages.length, 4);
    assert.deepEqual(calls[1].refs, calls[0].refs);
  }
});

test("same-chapter slots reject another slot's exclusive notes for both subjects", async () => {
  for (const ctx of [oneChapter, { subject: "825", ranges: [{ bookId: "linguistics", chapters: [1] }] }]) {
    let checked = false;
    const calls = responder((rows, call, refs) => {
      const other = refs[1].notes.find((note) => !refs[0].notes.some((own) => own.id === note.id));
      assert.ok(other, "fixture must include notes exclusive to another slot");
      checked = true;
      return rows.map((row, index) => index === 0 ? { ...row, knowledgePointIds: [other.id] } : row);
    });
    await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 3 }), ctx), /笔记范围/);
    assert.equal(checked, true);
    assert.equal(calls.length, 2);
  }
});

test("correction regenerates only failed batch and commits progress only after validation", async () => {
  const secretResponse = `malformed model response ${key}`;
  const calls = responder((rows, call) => call === 2 ? secretResponse : rows.reverse());
  const progress = [];
  const result = await api.generateMockQuiz(key, cfg({ definition: 4 }), context, { onProgress: (done) => progress.push(done) });
  assert.equal(calls.length, 3);
  assert.deepEqual(progress, [0, 3, 4]);
  assert.deepEqual(calls[1].refs, calls[2].refs);
  assert.deepEqual(calls[2].body.messages.slice(0, 3), calls[1].body.messages);
  assert.match(calls[2].body.messages[3].content, /JSON.*仅重新生成本批/);
  assert.ok(!JSON.stringify(calls[2].body).includes(key));
  assert.ok(!JSON.stringify(calls[2].body).includes(secretResponse));
  assertProvenance(result, calls);
});

test("invalid batches do not consume stems from earlier valid rows during correction", async () => {
  const calls = responder((rows, call) => call === 1 ? rows.map((row, index) => index === 1 ? { ...row, knowledgePointIds: ["invalid-note"] } : row) : rows.reverse());
  const progress = [];
  const result = await api.generateMockQuiz(key, cfg({ definition: 3 }), context, { onProgress: (done) => progress.push(done) });
  assert.equal(calls.length, 2);
  assert.deepEqual(progress, [0, 3]);
  assertProvenance(result, calls);
});

test("a second invalid output fails entire run without retrying prior batches", async () => {
  const calls = responder((rows, call) => call > 1 ? rows.map((row) => ({ ...row, bookId: "foreign" })) : rows);
  const progress = [];
  await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 4 }), context, { onProgress: (done) => progress.push(done) }), /书目或章节/);
  assert.equal(calls.length, 3);
  assert.deepEqual(progress, [0, 3]);
  assert.deepEqual(calls[1].refs, calls[2].refs);
});

test("cancelling a corrective request prevents late progress or a third request", async () => {
  const controller = new AbortController();
  const progress = [];
  let resolveLate;
  let signalReady;
  const ready = new Promise((resolve) => { signalReady = resolve; });
  const calls = responder((rows, call) => {
    if (call === 1) return rows.map((row) => ({ ...row, bookId: "foreign" }));
    return new Promise((resolve) => { resolveLate = () => resolve(rows); signalReady(); });
  });
  const pending = api.generateMockQuiz(key, cfg({ definition: 3 }), context, { signal: controller.signal, onProgress: (done) => progress.push(done) });
  await ready;
  controller.abort(key);
  await assert.rejects(pending, { name: "AbortError", message: "已取消生成。" });
  resolveLate();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(progress, [0]);
});

test("cancellation immediately after invalid response prevents corrective request", async () => {
  const controller = new AbortController();
  const calls = responder((rows) => { controller.abort(key); return []; });
  await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 3 }), context, { signal: controller.signal }), { name: "AbortError", message: "已取消生成。" });
  assert.equal(calls.length, 1);
});

test("transport failures never retry even following a recoverable output failure", async () => {
  for (const failedAttempt of [1, 2]) {
    for (const failure of ["401", "429", "network", "timeout", "truncated"]) {
      const calls = responder((rows, call) => {
        if (call < failedAttempt) return [];
        if (failure === "network") throw new Error(key);
        if (failure === "timeout") return new Promise(() => {});
        if (failure === "truncated") return new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: key } }] }));
        return new Response(key, { status: Number(failure) });
      });
      const progress = [];
      await assert.rejects(api.generateMockQuiz(key, cfg({ definition: 3 }), context, { timeoutMs: failure === "timeout" ? 10 : 30000, onProgress: (done) => progress.push(done) }), (error) => !error.message.includes(key));
      assert.equal(calls.length, failedAttempt);
      assert.deepEqual(progress, [0]);
    }
  }
});

test("whole china and foreign 26-chapter 333 template keeps 36 questions and 150 points with reordered batches", async () => {
  const ctx = { subject: "333", ranges: [{ bookId: "china" }, { bookId: "foreign" }] };
  const template = templates.getApplicableMockPaperTemplate("333-2026", "333", ["china", "foreign"]);
  const calls = responder((rows) => rows.map((row) => ({ ...row, chapterNo: String(row.chapterNo) })).reverse());
  const result = await api.generateMockQuiz(key, template.config, ctx, { templateId: "333-2026" });
  assert.equal(calls.length, 13);
  assert.equal(result.coverage.requestedUnits.length, 26);
  assert.equal(result.coverage.coveredUnits.length, 26);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.questions.length, 36);
  assert.equal(result.questions.reduce((sum, row) => sum + row.points, 0), 150);
  assert.deepEqual(result.questions.map((row) => row.type), [...Array(30).fill("single-choice"), ...Array(2).fill("essay"), ...Array(4).fill("material-analysis")]);
  assertProvenance(result, calls);
});

test("825 full and filtered templates preserve groups, scores and provenance with reordered batches", async () => {
  for (const bookIds of [["linguistics", "literature"], ["linguistics"], ["literature"]]) {
    const template = templates.getApplicableMockPaperTemplate("825-2026", "825", bookIds);
    const calls = responder((rows) => rows.map((row) => ({ ...row, chapterNo: String(row.chapterNo) })).reverse());
    const result = await api.generateMockQuiz(key, template.config, { subject: "825", ranges: bookIds.map((bookId) => ({ bookId })) }, { templateId: "825-2026" });
    assert.equal(result.questions.length, template.totalQuestions);
    assert.equal(result.questions.reduce((sum, row) => sum + row.points, 0), template.totalPoints);
    let offset = 0;
    template.groups.forEach((group) => {
      result.questions.slice(offset, offset + group.count).forEach((row) => {
        assert.equal(row.bookId, group.bookId);
        assert.equal(row.type, group.type);
        assert.equal(row.points, group.points);
        assert.equal(row.groupLabel, group.label);
      });
      offset += group.count;
    });
    assert.equal(result.coverage.complete, result.coverage.uncoveredUnits.length === 0);
    assertProvenance(result, calls);
  }
});
