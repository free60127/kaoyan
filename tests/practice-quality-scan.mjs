// 自测题质量批检: 三科真实数据 × 多seed, 机检常见质量问题
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { build } = require("esbuild");
async function realModule(path) {
  const result = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, format: "esm", platform: "node", target: "node20" });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const { buildPracticeQuestions } = await realModule("../lib/practice-quiz.ts");
const politics = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/politics/politics-data.json", import.meta.url)), "utf-8"));
const knowledge = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/knowledge-cards.json", import.meta.url)), "utf-8"));
const linguistics = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/825/linguistics.json", import.meta.url)), "utf-8"));
const literature = JSON.parse(readFileSync(fileURLToPath(new URL("../lib/825/literature.json", import.meta.url)), "utf-8"));

const suites = [
  { name: "政治", bookId: "mayuan", cards: politics.cards },
  { name: "333", bookId: "principles", cards: knowledge },
  { name: "825语言", bookId: "linguistics", cards: linguistics.cards },
  { name: "825文学", bookId: "literature", cards: literature.cards },
];

const issues = { shortOptions: 0, dupOptions: 0, emptyCorrect: 0, leakInStem: 0, truncated: 0, nearDup: 0, samples: [] };
let total = 0;
for (const suite of suites) {
  for (const seed of [1, 2, 3, 4, 5]) {
    const questions = buildPracticeQuestions(suite.cards, { bookId: suite.bookId, count: 60, seed });
    for (const q of questions) {
      total++;
      const correct = q.options[q.answer];
      if (q.options.length < 4) { issues.shortOptions++; if (issues.samples.length < 8) issues.samples.push(["不足4项", suite.name, q.stem.slice(0, 30)]); }
      if (new Set(q.options).size < q.options.length) { issues.dupOptions++; if (issues.samples.length < 8) issues.samples.push(["重复选项", suite.name, q.stem.slice(0, 30)]); }
      if (!correct || correct.length < 3) { issues.emptyCorrect++; if (issues.samples.length < 8) issues.samples.push(["正确项过短", suite.name, q.stem.slice(0, 30), correct]); }
      // 题干泄露: 正确项(≥6字)整体出现在题干里
      if (correct && correct.length >= 6 && q.stem.includes(correct)) { issues.leakInStem++; if (issues.samples.length < 10) issues.samples.push(["题干泄露答案", suite.name, q.stem.slice(0, 36), "→", correct.slice(0, 24)]); }
      if (correct?.endsWith("…")) issues.truncated++;
      // 近重复选项: 任意两项相似度>0.8
      for (let i = 0; i < q.options.length; i++) for (let j = i + 1; j < q.options.length; j++) {
        const a = q.options[i], b = q.options[j];
        if (a && b && a.length > 8 && b.length > 8) {
          const same = a.slice(0, Math.min(a.length, b.length)) === b.slice(0, Math.min(a.length, b.length));
          if (same) { issues.nearDup++; }
        }
      }
    }
  }
}
console.log(`共 ${total} 题`);
console.log(issues);
