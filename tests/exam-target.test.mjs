import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const output = await build({ entryPoints: [fileURLToPath(new URL("../lib/exam-target.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm", target: "node20" });
const { examTargetKey, isExamDate, validateExamTarget, localCalendarDate, examDaysRemaining, examDateLabel, examCountdownLabel, examPlannerContext, millisecondsToLocalMidnight, createExamTargetController, watchExamTarget } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString("base64")}`);

function memory(raw = null) {
  return { raw, writes: [], reads: 0, getItem(key) { assert.equal(key, examTargetKey); this.reads++; return this.raw; }, setItem(key, value) { this.writes.push([key, value]); this.raw = value; } };
}
const record = date => JSON.stringify({ version: 1, date });
function timezone(zone, run) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try { run(); } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
}

test("real date validation accepts leap days and four-digit years, rejects normalization", () => {
  for (const date of ["0001-01-01", "0099-12-31", "2000-02-29", "2028-02-29", "9999-12-31"]) assert.equal(isExamDate(date), true, date);
  for (const date of ["0000-01-01", "1900-02-29", "2100-02-29", "2027-02-29", "2027-04-31", "2027-00-10", "2027-13-01", "2027-12-00", "2027-12-32", "2027-1-01", "10000-01-01", "2027-12-01T00:00:00Z", " 2027-12-01", "", null, 20271201]) assert.equal(isExamDate(date), false, String(date));
  assert.deepEqual(validateExamTarget({ version: 1, date: "2028-02-29" }), { version: 1, date: "2028-02-29" });
  for (const value of [null, [], "2027-12-01", { date: "2027-12-01" }, { version: 2, date: "2027-12-01" }, { version: 1, date: "2027-02-29" }, { version: 1, date: "2027-12-01", extra: true }]) assert.throws(() => validateExamTarget(value));
});

test("countdown handles future, today, past, leap days and early years", () => {
  assert.equal(examDaysRemaining("2027-12-01", "2027-11-30"), 1);
  assert.equal(examDaysRemaining("2028-03-01", "2028-02-28"), 2);
  assert.equal(examDaysRemaining("0001-01-02", "0001-01-01"), 1);
  assert.equal(examDaysRemaining("0100-01-01", "0099-12-31"), 1);
  assert.equal(examCountdownLabel("2027-12-01", "2027-11-30"), "距考试 1 天");
  assert.equal(examCountdownLabel("2027-12-01", "2027-12-01"), "今天考试");
  assert.equal(examCountdownLabel("2027-12-01", "2027-12-03"), "考试已过 2 天");
  assert.equal(examCountdownLabel(null, "2027-12-03"), "目标初试日期未设置");
  assert.throws(() => examDaysRemaining("2027-02-29", "2027-02-28"));
  assert.equal(examDateLabel(null), "设置考试日期");
  assert.equal(examDateLabel("2027-12-01"), "2027 年 12 月 1 日");
  assert.match(examPlannerContext(null), /未设置具体日期/);
  assert.match(examPlannerContext("2028-02-29"), /2028 年 2 月 29 日.*手动设置/);
});

test("Shanghai local midnight uses the local date on both sides of the UTC day", () => timezone("Asia/Shanghai", () => {
  const before = new Date("2027-11-30T15:59:59.900Z"), after = new Date("2027-11-30T16:00:00.000Z");
  assert.equal(localCalendarDate(before), "2027-11-30");
  assert.equal(localCalendarDate(after), "2027-12-01");
  assert.equal(examDaysRemaining("2027-12-01", localCalendarDate(before)), 1);
  assert.equal(examDaysRemaining("2027-12-01", localCalendarDate(after)), 0);
  assert.equal(millisecondsToLocalMidnight(before), 100);
}));

test("New York midnight, spring and fall DST use calendar days instead of elapsed 24 hours", () => timezone("America/New_York", () => {
  assert.equal(localCalendarDate(new Date("2027-12-01T04:59:59Z")), "2027-11-30");
  assert.equal(localCalendarDate(new Date("2027-12-01T05:00:00Z")), "2027-12-01");
  assert.equal(millisecondsToLocalMidnight(new Date("2027-03-14T00:00:00")), 23 * 3_600_000);
  assert.equal(millisecondsToLocalMidnight(new Date("2027-11-07T00:00:00")), 25 * 3_600_000);
  assert.equal(examDaysRemaining("2027-03-15", "2027-03-14"), 1);
  assert.equal(examDaysRemaining("2027-11-08", "2027-11-07"), 1);
}));

test("fresh storage stays unset and is never written during initial reads", () => {
  const storage = memory(), controller = createExamTargetController(() => storage, () => new Date(2026, 9, 7));
  assert.equal(controller.getSnapshot().ready, false);
  assert.equal(controller.save("2027-12-01"), false);
  controller.refresh();
  assert.deepEqual(controller.getSnapshot(), { date: null, today: "2026-10-07", ready: true, error: "" });
  assert.deepEqual(storage.writes, []);
});

test("explicit save changes date and persisted record together; invalid dates cannot write", () => {
  const storage = memory(record("2027-12-01")), controller = createExamTargetController(() => storage);
  controller.refresh();
  assert.equal(controller.save("2027-02-29"), false);
  assert.equal(controller.getSnapshot().date, "2027-12-01");
  assert.equal(controller.getSnapshot().error, "", "an invalid form date must not be reported as a storage failure");
  assert.deepEqual(storage.writes, []);
  assert.equal(controller.save("2028-02-29"), true);
  assert.equal(controller.getSnapshot().date, "2028-02-29");
  assert.equal(controller.getSnapshot().error, "");
  assert.deepEqual(JSON.parse(storage.raw), { version: 1, date: "2028-02-29" });
});

test("malformed storage and blocked storage report read errors without overwriting", () => {
  for (const raw of ["not JSON", record("2027-02-29"), '{"version":2,"date":"2027-12-01"}']) {
    const storage = memory(raw), controller = createExamTargetController(() => storage);
    controller.refresh(); controller.refresh();
    assert.equal(controller.getSnapshot().date, null);
    assert.match(controller.getSnapshot().error, /未能读取/);
    assert.equal(storage.raw, raw);
    assert.deepEqual(storage.writes, []);
  }
  const controller = createExamTargetController(() => { throw new Error("SecurityError"); });
  controller.refresh();
  assert.equal(controller.getSnapshot().ready, true);
  assert.match(controller.getSnapshot().error, /未能读取/);
  assert.equal(controller.save("2027-12-01"), false);
  assert.match(controller.getSnapshot().error, /未能保存/);
});

test("failed write keeps the confirmed date; successful retry clears the error", () => {
  const storage = memory(record("2027-12-01")), controller = createExamTargetController(() => storage);
  controller.refresh();
  const setItem = storage.setItem;
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(controller.save("2028-12-02"), false);
  assert.equal(controller.getSnapshot().date, "2027-12-01");
  assert.equal(storage.raw, record("2027-12-01"));
  assert.match(controller.getSnapshot().error, /未能保存/);
  storage.setItem = setItem;
  assert.equal(controller.save("2028-12-02"), true);
  assert.equal(controller.getSnapshot().error, "");
});

test("a corrupt external record preserves the confirmed date while the local day still advances", () => {
  let now = new Date(2027, 10, 30, 23, 59);
  const storage = memory(record("2027-12-01")), controller = createExamTargetController(() => storage, () => now);
  controller.refresh();
  storage.raw = record("2027-02-29"); now = new Date(2027, 11, 1);
  controller.refresh();
  assert.equal(controller.getSnapshot().date, "2027-12-01");
  assert.equal(controller.getSnapshot().today, "2027-12-01");
  assert.match(controller.getSnapshot().error, /未能读取/);
  assert.deepEqual(storage.writes, []);
});

test("midnight timer, wake events and matching storage events refresh and clean up", () => {
  let now = new Date(2027, 10, 30, 23, 59, 59, 900), nextId = 0;
  const timers = new Map(), win = new EventTarget(), doc = new EventTarget(); doc.visibilityState = "visible";
  const storage = memory(record("2027-12-01")), controller = createExamTargetController(() => storage, () => now);
  let notices = 0; const unsubscribe = controller.subscribe(() => notices++);
  const stop = watchExamTarget(controller, { window: win, document: doc, now: () => now,
    setTimeout(callback, delay) { timers.set(++nextId, { callback, delay }); return nextId; }, clearTimeout(id) { timers.delete(id); },
  });
  assert.equal([...timers.values()][0].delay, 150);
  assert.equal(controller.getSnapshot().today, "2027-11-30");
  now = new Date(2027, 11, 1, 0, 0, 0, 50);
  [...timers.values()][0].callback();
  assert.equal(controller.getSnapshot().today, "2027-12-01");
  assert.equal([...timers.values()][0].delay, 3_600_000);
  storage.raw = record("2028-02-29"); win.dispatchEvent(new Event("focus"));
  assert.equal(controller.getSnapshot().date, "2028-02-29");
  const storageEvent = key => { const event = new Event("storage"); Object.defineProperty(event, "key", { value: key }); return event; };
  const reads = storage.reads;
  win.dispatchEvent(storageEvent("unrelated")); assert.equal(storage.reads, reads);
  storage.raw = record("2028-03-01"); win.dispatchEvent(storageEvent(examTargetKey));
  assert.equal(controller.getSnapshot().date, "2028-03-01");
  storage.raw = null; win.dispatchEvent(storageEvent(null)); assert.equal(controller.getSnapshot().date, null);
  now = new Date(2027, 11, 4); doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(controller.getSnapshot().today, "2027-12-04");
  assert.ok(notices >= 5);
  const finalReads = storage.reads; stop(); unsubscribe();
  assert.equal(timers.size, 0);
  win.dispatchEvent(new Event("focus")); win.dispatchEvent(storageEvent(examTargetKey)); doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(storage.reads, finalReads);
});
