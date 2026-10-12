import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

// 快捷评分: note.text 评级行(⭐ + #标签)解析与改写
const require = createRequire(import.meta.url);
const { build } = require("esbuild");
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../lib/note-rating.ts", import.meta.url))],
  bundle: true, write: false, format: "esm", platform: "node", target: "node20",
});
const { parseNoteRating, applyNoteStars, applyNoteTag, NOTE_TAGS } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

test("parseNoteRating: 识别评级行, 不误伤正文", () => {
  assert.deepEqual(parseNoteRating("⭐⭐⭐ #选 #简"), { stars: 3, tags: ["#选", "#简"], lineIndex: 0 });
  assert.deepEqual(parseNoteRating("正文第一段\n⭐⭐ #论\n正文第二段"), { stars: 2, tags: ["#论"], lineIndex: 1 });
  // 用户手写无标签形态
  assert.deepEqual(parseNoteRating("⭐⭐⭐选择"), null, "星后跟正文不是评级行");
  assert.equal(parseNoteRating("只有正文, 没有评级行"), null);
  assert.equal(parseNoteRating(""), null);
  // 手写 ★ 也认
  assert.deepEqual(parseNoteRating("★ #选"), { stars: 1, tags: ["#选"], lineIndex: 0 });
});

test("applyNoteStars: 新建/更新/清除, 保留标签", () => {
  assert.equal(applyNoteStars("", 3), "⭐⭐⭐");
  assert.equal(applyNoteStars("已有补充", 4), "⭐⭐⭐⭐\n已有补充");
  assert.equal(applyNoteStars("⭐⭐ #选", 5), "⭐⭐⭐⭐⭐ #选");
  assert.equal(applyNoteStars("正文A\n⭐⭐⭐ #简\n正文B", 1), "正文A\n⭐ #简\n正文B");
  // 清除星级: 标签保留; 全空则整行删除
  assert.equal(applyNoteStars("⭐⭐⭐ #选", 0), "#选");
  assert.equal(applyNoteStars("⭐⭐⭐", 0), "");
  assert.throws(() => applyNoteStars("", 6));
});

test("applyNoteTag: 新建/toggle/移除", () => {
  assert.equal(applyNoteTag("", "#选"), "#选");
  assert.equal(applyNoteTag("已有补充", "#简"), "#简\n已有补充");
  assert.equal(applyNoteTag("⭐⭐ #选", "#简"), "⭐⭐ #选 #简");
  assert.equal(applyNoteTag("⭐⭐ #选 #简", "#简"), "⭐⭐ #选");
  // 最后一个标签移除后仅剩星级
  assert.equal(applyNoteTag("⭐⭐ #选", "#选"), "⭐⭐");
  assert.throws(() => applyNoteTag("", "#不存在"));
});

test("标签集合覆盖考研主要题型", () => {
  for (const tag of ["#选", "#多", "#填", "#判", "#解", "#简", "#论", "#分", "#案"]) {
    assert.ok(NOTE_TAGS.includes(tag));
  }
});

test("重复点击幂等: 星级设定后 parse 往返一致", () => {
  let text = "老师强调的重点";
  text = applyNoteStars(text, 4);
  text = applyNoteTag(text, "#选");
  text = applyNoteTag(text, "#简");
  const parsed = parseNoteRating(text);
  assert.deepEqual([parsed.stars, parsed.tags], [4, ["#选", "#简"]]);
  // 组件语义: 再点当前星数=清除星级(传 0), 标签保留
  text = applyNoteStars(text, 0);
  assert.equal(parseNoteRating(text).stars, 0);
  assert.deepEqual(parseNoteRating(text).tags, ['#选', '#简']);
});
