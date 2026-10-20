import test from "node:test";
import assert from "node:assert/strict";
import { createItemTiming } from "../src/lib/itemTiming.ts";
import type { ItemTimings } from "../src/lib/itemTiming.ts";

function fixture() {
  let now = 0;
  let values: ItemTimings = {};
  const entries = new Map<string, { start: number; duration: number }>();
  const clock = {
    now: () => now,
    measure: (name: string, options: { start: number; duration: number }) => { entries.set(name, options); },
    clearMeasures: (name: string) => { entries.delete(name); },
  };
  const timer = createItemTiming(next => { values = next; }, () => clock);
  timer.activate();
  return { timer, clock, entries, values: () => values, time: (next: number) => { now = next; } };
}

test("five numeric measurements preserve first availability and replace the latest values", () => {
  const f = fixture();
  const first = f.timer.begin("availability"); f.time(41200); first();
  const next = f.timer.begin("availability"); f.time(41400); next();
  for (const kind of ["photo", "assessment", "status"] as const) {
    const finish = f.timer.begin(kind); f.time(42000); finish();
  }
  assert.deepEqual(f.values(), { availability_first_ms: 41200, availability_latest_ms: 200,
    photo_prepare_ms: 600, assessment_ms: 0, status_ms: 0 });
  assert.equal(f.entries.size, 5);
  for (let i = 0; i < 20; i++) {
    const finish = f.timer.begin("assessment"); f.time(42001 + i); finish();
  }
  assert.equal(f.entries.size, 5);
  assert.deepEqual([...f.entries.values()].map(v => Object.keys(v)), Array(5).fill(["start", "duration"]));
  assert.ok(Object.values(f.values()).every(value => typeof value === "number"));
});

test("bounds are inclusive, fractional milliseconds truncate, invalid clocks do not clamp", () => {
  for (const [start, end, expected] of [
    [0, 0, 0], [0, 600000, 600000], [0, 600000.01, undefined], [1, 0, undefined],
    [0, 12.9, 12], [-1, 0, undefined], [NaN, 20, undefined], [0, Infinity, undefined],
    [0, NaN, undefined], [Infinity, Infinity, undefined],
  ]) {
    const f = fixture(); f.time(start!);
    const finish = f.timer.begin("assessment"); f.time(end!); finish();
    assert.deepEqual(f.values(), expected === undefined ? {} : { assessment_ms: expected });
    assert.equal(f.entries.size, expected === undefined ? 0 : 1);
  }
});

test("late and duplicate completions cannot overwrite newer timings or survive editor disposal", () => {
  const f = fixture();
  const old = f.timer.begin("assessment"); f.time(10);
  const current = f.timer.begin("assessment"); f.time(20); current(); f.time(30); old(); current();
  assert.deepEqual(f.values(), { assessment_ms: 10 });
  const late = f.timer.begin("photo");
  f.timer.dispose();
  assert.equal(f.entries.size, 0);
  const inactive = f.timer.begin("status"); f.time(100); inactive(); late();
  assert.equal(f.entries.size, 0);
  // StrictMode reactivates the recorder; old callbacks still cannot publish.
  f.timer.activate(); late(); old();
  assert.deepEqual(f.values(), {});
  assert.equal(f.entries.size, 0);
  const availability = f.timer.begin("availability"); f.time(110); availability();
  assert.deepEqual(f.values(), { availability_first_ms: 10, availability_latest_ms: 10 });
});

test("first availability is identified by request order, not completion order", () => {
  const f = fixture();
  const first = f.timer.begin("availability"); f.time(10);
  const second = f.timer.begin("availability"); f.time(20); second(); f.time(40); first();
  assert.deepEqual(f.values(), { availability_latest_ms: 10, availability_first_ms: 40 });
});

test("timing API and observer failures cannot interrupt the caller", () => {
  const fail = () => { throw new Error("fixture timing failure"); };
  const absent = createItemTiming(fail, fail);
  assert.doesNotThrow(() => { absent.activate(); absent.begin("photo")(); absent.dispose(); });
  for (const method of ["now", "measure", "clearMeasures"] as const) {
    const f = fixture();
    f.clock[method] = fail;
    assert.doesNotThrow(() => { f.timer.activate(); f.timer.begin("assessment")(); f.timer.dispose(); });
    assert.deepEqual(f.values(), method === "now" ? {} : { assessment_ms: 0 });
  }
  const f = fixture(); const finish = f.timer.begin("assessment"); f.clock.now = fail;
  assert.doesNotThrow(finish); assert.deepEqual(f.values(), {});
  const throwingObserver = createItemTiming(fail, () => ({ now: () => 0, measure() {}, clearMeasures() {} }));
  assert.doesNotThrow(() => { throwingObserver.activate(); throwingObserver.begin("photo")(); throwingObserver.dispose(); });
});
