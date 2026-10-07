import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
async function realModule(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("重点标记: 解析/还原/自测选项清洗", async () => {
  const markers = await realModule("../lib/highlight-markers.ts");
  const quiz = await realModule("../lib/practice-quiz.ts");
  const marked = "墨子主张⟦g|兼爱、非攻⟧，教育作用在于⟦s|兴天下之利⟧。";
  const segments = markers.parseHighlightMarkers(marked);
  assert.deepEqual(segments.map(segment => [segment.kind, segment.text]), [
    ["text", "墨子主张"], ["g", "兼爱、非攻"], ["text", "，教育作用在于"], ["s", "兴天下之利"], ["text", "。"],
  ]);
  assert.equal(markers.stripHighlightMarkers(marked), "墨子主张兼爱、非攻，教育作用在于兴天下之利。");
  assert.equal(markers.hasHighlightMarkers(marked), true);
  assert.equal(markers.hasHighlightMarkers("普通文字"), false);
  // 自测选项生成: 标记不进入选项文本
  const clause = quiz.firstAnswerClause("⟦g|有限的词汇和规则⟧使说话者能不断组合出新句子。", 110);
  assert.ok(!clause.includes("⟦"), clause);
  assert.ok(clause.includes("有限的词汇和规则"));
  // 答案串检测不受标记影响
  assert.equal(quiz.looksLikeAnswerKey("⟦s|T F T F⟧"), true);
});
