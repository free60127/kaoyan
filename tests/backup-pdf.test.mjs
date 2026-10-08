import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, decodePDFRawStream } from "pdf-lib";

const output = await build({ stdin: {
  contents: 'export * from "./lib/backup-pdf.ts"; export * from "./lib/study-backup.ts";',
  resolveDir: fileURLToPath(new URL("..", import.meta.url)),
}, bundle: true, write: false, platform: "node", format: "esm", target: "node20", mainFields: ["module", "main"], define: { "import.meta.env.BASE_URL": '"/kaoyan/"' } });
// A temporary module keeps failed-test stacks concise instead of printing the
// entire bundle as a data URL. The file is removed immediately after import.
const temporary = await mkdtemp(join(tmpdir(), "yantu-pdf-tests-"));
const modulePath = join(temporary, "backup-pdf.mjs");
let api;
try {
  await writeFile(modulePath, output.outputFiles[0].text);
  api = await import(pathToFileURL(modulePath).href);
} finally { await unlink(modulePath); await rmdir(temporary); }
const { exportStudyBackupPdf: exportPdf, readStudyBackupPdf: readPdf, validateStudyBackup: validate, loadBackupCatalogs, MAX_BACKUP_BYTES, MAX_BACKUP_PDF_BYTES, MAX_BACKUP_PDF_PAGES } = api;
const catalogs = await loadBackupCatalogs();
const fontBytes = new Uint8Array(await readFile(new URL("../public/fonts/yantu-pdf/YantuPdfSC-Regular.ttf", import.meta.url)));
const clone = value => JSON.parse(JSON.stringify(value));
const backup = { format: "yantu-study-backup", version: 1, createdAt: "2026-09-30T12:00:00.000Z", records: {} };
backup.records["yantu-exam-target-v1"] = { version: 1, date: "2028-02-29" };
backup.records["yantu-card-timing-settings-v1"] = { enabled: false };
for (const subject of ["333", "825", "politics"]) {
  const card = catalogs[subject].cards.find(card => card.section) || catalogs[subject].cards[0];
  const range = { bookId: card.book, chapters: [card.chapter], ...(card.section ? { section: card.section } : {}) };
  const timing = { id: subject + '-timing', cardId: card.id, label: card.front.slice(0,300), contentKey: 'snapshot', kind: 'review', startedAt: '2026-09-30T12:00:00Z', updatedAt: '2026-09-30T12:01:00Z', elapsedMs: 60000, days: { '2026-09-30': 60000 }, status: 'completed', grade: 'good' };
  backup.records[`yantu-card-timing-v1-${subject}`] = { [timing.id]: timing };
  backup.records[`yantu-srs-v1-${subject}`] = { version: 1,
    cards: { [card.id]: { dueAt: "2027-10-04T12:00:00.000Z", firstStudiedAt: "2026-09-29T12:00:00.000Z", lastReviewedAt: "2026-09-29T12:00:00.000Z", intervalDays: 370, ease: 2.6, reps: 3, lapses: 1, stage: "review" } },
    scopes: [range], newScopes: [range], dailyNewLimit: 17, daily: { date: "2026-09-29", admitted: [card.id] },
  };
  backup.records[subject === "333" ? "yantu-done" : `yantu-done-${subject}`] = { [`${card.book}-${card.chapter}`]: true };
}
const locations = Object.fromEntries(["333", "825", "politics", "english"].map(subject => {
  const book = catalogs[subject]?.books[0];
  return [subject, { book: book?.id || "", chapter: 1, section: book?.chapters[0].sections[0] || "", view: "overview", pastMode: "practice", pastYear: 2026, pastIndex: 0 }];
}));
const past = catalogs["825"].questions[0];
backup.records["yantu-learning-session-v1"] = { version: 1, subject: "825", locations,
  feynmanDrafts: Object.fromEntries(["333", "825", "politics"].map(subject => [JSON.stringify([subject, locations[subject].book, 1, locations[subject].section]), `${subject} 费曼草稿\n中文标点：〔理解〕、“概念”；保留脑图符号 🧠。`])),
  pastAnswers: { [JSON.stringify(["825", past.book, past.id])]: "完整真题答复\n继续论证" },
  plannerPrompts: { english: "This long English paragraph explains how learning records, complete practice questions, original answers and references remain readable across multiple PDF pages. ".repeat(8) },
};
const longAnswer = "学习过程应结合实际案例，先阐明概念，再解释原因，最后提出可检验的结论。This is a complete English sentence with readable word wrapping.\n".repeat(35) + "作答末尾完整保留 FINAL_ANSWER_END";
for (const subject of ["333", "825"]) {
  const book = catalogs[subject].books[0], unit = { bookId: book.id, chapterNo: 1, bookName: book.name, chapterName: book.chapters[0].title };
  const config = { "single-choice": 1, definition: 0, "short-answer": 0, essay: 1, "material-analysis": 0 };
  const knowledgePointIds = [catalogs[subject].cards.find(card => card.book === book.id && card.chapter === 1).id];
  backup.records[`kaoyan.mock-practice.v1.${subject}`] = { version: 1, subject,
    settings: { counts: Object.fromEntries(Object.entries(config).map(([key, count]) => [key, String(count)])), selection: { [book.id]: [1] } },
    session: { snapshot: { subject, config, ranges: [{ bookId: book.id, chapters: [1] }], scopeLabel: `${book.name}第1章`, createdAt: "2026/9/30 20:00:00" },
      result: { questions: [
        { ...unit, id: "choice", type: "single-choice", stem: `${subject}模拟选择题完整题干`, options: ["选项甲完整内容", "选项乙完整内容", "选项丙完整内容", "选项丁完整内容"], answer: 1, explanation: "完整选择解析", source: "AI 模拟题来源", knowledgePointIds },
        { ...unit, id: "essay", type: "essay", stem: `${subject}模拟论述题完整题干`, referenceAnswer: "完整参考答案\n由事实到论证，再到结论。", rationale: "完整考点依据", source: "AI 模拟题来源", knowledgePointIds },
      ], coverage: { requestedUnits: [unit], coveredUnits: [unit], uncoveredUnits: [], complete: true, note: "已覆盖" } },
      cursor: 1, mode: "paper", responses: { choice: { choice: 2, revealed: true }, essay: { text: longAnswer, revealed: false } },
    },
  };
}
const validated = validate(backup, catalogs);
const bytes = await exportPdf(validated, catalogs, { fontBytes });
// Opt-in QA output goes outside the repository; ordinary test runs create no PDF files.
if (process.env.YANTU_PDF_QA_OUTPUT) await writeFile(process.env.YANTU_PDF_QA_OUTPUT, bytes);

function rawAttachment(pdf) {
  const spec = pdf.context.lookup(pdf.catalog.get(PDFName.of("YantuStudyBackup")), PDFDict);
  const ef = pdf.context.lookup(spec.get(PDFName.of("EF")), PDFDict);
  return pdf.context.lookup(ef.get(PDFName.of("F")), PDFRawStream);
}

async function synthetic(payload, options = {}) {
  const pdf = await PDFDocument.create(); pdf.addPage();
  if (options.noPayload) return pdf.save();
  const stream = pdf.context.stream(payload, { Type: "EmbeddedFile", Subtype: "application/json", Params: { Size: 1 }, ...(options.filter ? { Filter: "FlateDecode" } : {}) });
  const ref = pdf.context.register(stream);
  const spec = pdf.context.register(pdf.context.obj({ Type: "Filespec", F: PDFString.of("yantu-study-backup.json"), EF: { F: ref } }));
  pdf.catalog.set(PDFName.of("YantuStudyBackup"), spec);
  return pdf.save();
}

// Decode our embedded font's ToUnicode mapping to verify readable, searchable
// text independently of the JSON payload. Rendering is inspected separately.
function searchableText(pdf) {
  const cmap = new Map();
  for (const page of pdf.getPages()) {
    const fonts = page.node.Resources().lookup(PDFName.of("Font"), PDFDict);
    for (const [, ref] of fonts.entries()) {
      const font = pdf.context.lookup(ref, PDFDict);
      const unicode = font.lookup(PDFName.of("ToUnicode"), PDFRawStream);
      const source = Buffer.from(decodePDFRawStream(unicode).decode()).toString("ascii");
      for (const section of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
        for (const pair of section[1].matchAll(/<([\da-f]+)>\s*<([\da-f]+)>/gi)) {
          const units = pair[2].match(/.{4}/g).map(unit => parseInt(unit, 16));
          cmap.set(pair[1].toUpperCase(), String.fromCharCode(...units));
        }
      }
    }
  }
  let text = "";
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray() : [contents];
    for (const ref of streams) {
      const source = Buffer.from(decodePDFRawStream(pdf.context.lookup(ref, PDFRawStream)).decode()).toString("ascii");
      for (const match of source.matchAll(/<([\da-f]*)>\s*Tj/gi)) {
        for (let i = 0; i < match[1].length; i += 4) text += cmap.get(match[1].slice(i, i + 4).toUpperCase()) || "?";
        text += "\n";
      }
    }
  }
  return text;
}
const compact = text => text.replace(/\s/g, "");

test("real PDF restores all nine records with three subjects, both mock papers and original unsupported Unicode", async () => {
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), "%PDF-");
  assert.ok(bytes.length < MAX_BACKUP_PDF_BYTES);
  assert.deepEqual(await readPdf(bytes, catalogs), validated);
});

test("standard JSON attachment has no filter and is registered in Names and AF", async () => {
  const pdf = await PDFDocument.load(bytes), stream = rawAttachment(pdf);
  assert.equal(stream.dict.has(PDFName.of("Filter")), false);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(stream.getContents())), validated);
  const names = pdf.catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"), PDFArray);
  assert.equal(names.lookup(0, PDFString).decodeText(), "yantu-study-backup.json");
  assert.equal(names.get(1), pdf.catalog.get(PDFName.of("YantuStudyBackup")));
  assert.equal(pdf.catalog.lookup(PDFName.of("AF"), PDFArray).get(0), names.get(1));
});

test("multi-page Chinese searchable text retains full long answers, all options, references, rationale and source", async () => {
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 6);
  assert.ok(pdf.getPageCount() < MAX_BACKUP_PDF_PAGES);
  for (const page of pdf.getPages()) { assert.equal(page.getWidth(), 595.28); assert.equal(page.getHeight(), 841.89); }
  const text = searchableText(pdf), joined = compact(text);
  assert.ok(joined.includes(compact("目标初试日期：2028-02-29（手动设置）")));
  assert.doesNotMatch(text, /^[、。，：；？！》）〕】〉」』”’]/mu, "sample must not wrap closing CJK punctuation onto an otherwise empty line");
  assert.doesNotMatch(text, /[《（〔【〈「『“‘]$/mu, "sample must not leave opening CJK punctuation at the end of a line");
  for (const value of ["研途学习记录与模拟卷备份", "政治", "2027-10-04T12:00:00.000Z", "333模拟选择题完整题干", "825模拟论述题完整题干", "选项甲完整内容", "选项乙完整内容", "选项丙完整内容", "选项丁完整内容", "我的作答：C", "参考答案：B", "完整选择解析", "完整参考答案", "完整考点依据", "AI 模拟题来源", "〔理解〕、“概念”；", "[U+1F9E0]", "FINAL_ANSWER_END"]) assert.ok(joined.includes(compact(value)), value);
  // Footer text intervenes between page fragments; exclude it for continuity.
  const body = text.replace(/研途学习备份\s*\|\s*\d+\s*\/\s*\d+/g, "").replace(/研途学习记录与模拟卷备份/g, "");
  assert.equal(compact(body).split(compact(longAnswer)).length - 1, 2);
});

test("non-PDF, corrupt, ordinary and unmarked attachments fail clearly", async () => {
  await assert.rejects(readPdf(new TextEncoder().encode("{}"), catalogs), /不是有效的 PDF/);
  await assert.rejects(readPdf(new TextEncoder().encode("%PDF-1.7\ncorrupt"), catalogs), /损坏/);
  await assert.rejects(readPdf(await synthetic(new Uint8Array(), { noPayload: true }), catalogs), /未包含兼容/);
  const ordinary = await PDFDocument.create(); ordinary.addPage(); await ordinary.attach(JSON.stringify(validated), "yantu-study-backup.json");
  await assert.rejects(readPdf(await ordinary.save(), catalogs), /未包含兼容/);
});

test("filtered attachment is rejected without decompression even if its JSON is valid", async () => {
  await assert.rejects(readPdf(await synthetic(new TextEncoder().encode(JSON.stringify(validated)), { filter: true }), catalogs), /压缩或过滤/);
});

test("JSON damage, malformed UTF8, incompatible versions and forbidden storage keys fail", async () => {
  for (const payload of [new TextEncoder().encode("{"), Uint8Array.of(0xc3, 0x28)]) await assert.rejects(readPdf(await synthetic(payload), catalogs), /JSON 损坏或文字编码/);
  for (const mutate of [value => value.version = 2, value => value.records["yantu-key"] = "secret"]) {
    const invalid = clone(validated); mutate(invalid);
    await assert.rejects(readPdf(await synthetic(new TextEncoder().encode(JSON.stringify(invalid))), catalogs), /版本不兼容|存储键/);
  }
});

test("actual file and raw payload sizes are bounded before JSON parsing, ignoring declared Params.Size", async () => {
  const hugeFile = new Uint8Array(MAX_BACKUP_PDF_BYTES + 1); hugeFile.set(new TextEncoder().encode("%PDF-"));
  await assert.rejects(readPdf(hugeFile, catalogs), /32 MiB/);
  await assert.rejects(readPdf(await synthetic(new Uint8Array(MAX_BACKUP_BYTES + 1)), catalogs), /8 MiB/);
});

test("invalid attachment object types and missing EF are rejected", async () => {
  for (const marker of ["invalid", { Type: "Filespec" }, { Type: "Filespec", EF: { F: "not-a-stream" } }]) {
    const pdf = await PDFDocument.create(); pdf.addPage(); pdf.catalog.set(PDFName.of("YantuStudyBackup"), pdf.context.obj(marker));
    await assert.rejects(readPdf(await pdf.save(), catalogs), /恢复数据/);
  }
});

test("encrypted documents are rejected", async () => {
  // Minimal encryption marker: pdf-lib detects encryption before parsing data.
  const pdf = await PDFDocument.create(); pdf.addPage();
  pdf.context.trailerInfo.Encrypt = pdf.context.register(pdf.context.obj({ Filter: "Standard", V: 1, R: 2, Length: 40 }));
  await assert.rejects(readPdf(await pdf.save(), catalogs), /加密/);
});

test("PDF page limit is enforced on import", async () => {
  const pdf = await PDFDocument.create(); for (let i = 0; i <= MAX_BACKUP_PDF_PAGES; i++) pdf.addPage();
  await assert.rejects(readPdf(await pdf.save(), catalogs), /3000 页/);
});

test("export validates backup and font rather than writing a misleading PDF", async () => {
  await assert.rejects(exportPdf({ ...validated, version: 2 }, catalogs, { fontBytes }), /版本不兼容/);
  await assert.rejects(exportPdf(validated, catalogs, { fontBytes: Uint8Array.of(1, 2, 3) }), /中文字体无效/);
});

test("default font is fetched lazily under the configured Pages base", async () => {
  const original = globalThis.fetch, urls = [];
  try {
    globalThis.fetch = async url => { urls.push(url); return new Response(fontBytes); };
    const empty = { ...validated, records: {} };
    const pdf = await exportPdf(empty, catalogs);
    assert.deepEqual(urls, ["/kaoyan/fonts/yantu-pdf/YantuPdfSC-Regular.ttf"]);
    assert.deepEqual(await readPdf(pdf, catalogs), empty);
    globalThis.fetch = async () => new Response("missing", { status: 404 });
    await assert.rejects(exportPdf(empty, catalogs), /中文字体加载失败/);
  } finally { globalThis.fetch = original; }
});
