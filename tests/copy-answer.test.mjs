import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const bundled = await build({ entryPoints: [fileURLToPath(new URL("../lib/copy-answer.ts", import.meta.url))], bundle: true, platform: "node", format: "esm", write: false });
const { copyAnswer, selectedAnswer } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
test("copies only the exact multiline learner answer", async () => {
  const text = "  我的答案\nSecond line\r\n结尾  ";
  let actual;
  await copyAnswer(text, { async writeText(value) { actual = value; } });
  assert.equal(actual, text);
});
test("empty answers never call the clipboard", async () => {
  let calls = 0;
  await assert.rejects(copyAnswer(" \n\t", { async writeText() { calls++; } }));
  assert.equal(calls, 0);
});
test("clipboard rejection and unavailable clipboard propagate without success", async () => {
  const denial = new Error("permission denied");
  await assert.rejects(copyAnswer("answer", { async writeText() { throw denial; } }), error => error === denial);
  await assert.rejects(copyAnswer("answer"), /剪贴板不可用/);
});
test("chosen option includes its own letter and exact option rather than the reference", async () => {
  const options = ["参考选项", "自己的选择\n保留换行", "另一个选项"];
  const value = selectedAnswer(options, 1);
  assert.equal(value, "B. 自己的选择\n保留换行");
  let actual;
  await copyAnswer(value, { async writeText(text) { actual = text; } });
  assert.equal(actual, value);
  for (const choice of [null, undefined, -1, 3, 1.5]) assert.equal(selectedAnswer(options, choice), "");
});
