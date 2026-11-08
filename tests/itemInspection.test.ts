import test from "node:test";
import assert from "node:assert/strict";
import { appendInspectionNotes, buildInspectionNotes } from "../src/lib/itemInspection.ts";
import type { InspectionDraft } from "../src/lib/itemInspection.ts";

const empty: InspectionDraft = { kind: "chair", label: "", notes: "", answers: {} };
test("an untouched inspection produces no observations or condition claim", () => {
  assert.equal(buildInspectionNotes(empty), "");
  assert.equal(buildInspectionNotes({ ...empty, answers: { "chair-frame": "unchecked" } }), "");
});
test("one observed check leaves every untested chair part explicitly unknown", () => {
  const text = buildInspectionNotes({ ...empty, answers: { "chair-frame": "okay", "chair-height": "issue" } });
  assert.match(text, /Model\/version not verified/);
  assert.match(text, /Looked OK to me: frame and base\./);
  assert.match(text, /Issue found: seat height\./);
  assert.match(text, /Not checked: tilt and controls, seat, back and arms, wheels and swivel\./);
});
test("switching checklist cannot turn old chair answers into cabinet findings", () => {
  const text = buildInspectionNotes({ ...empty, kind: "storage", notes: "Drawer sticks", answers: { "chair-frame": "okay", "chair-height": "issue" } });
  assert.ok(!text.includes("Looked OK"));
  assert.ok(!text.includes("Issue found"));
  assert.match(text, /Not checked: frame and joints, drawers and doors/);
  assert.match(text, /My notes: Drawer sticks/);
});
test("partial label text is preserved without decoding a model or generation", () => {
  const text = buildInspectionNotes({ ...empty, label: "  Herman Miller\nMR??  ", notes: "Date unreadable" });
  assert.match(text, /Label text I can read: Herman Miller\nMR\?\?/);
  assert.match(text, /Model\/version not verified/);
  assert.ok(!text.includes("Mirra 1") && !text.includes("Mirra 2"));
  assert.ok(!text.includes("Looked OK"));
});
test("adding notes preserves every original character and never repeats identical notes", () => {
  const original = "  Seller wants $20.\nCall first.  ";
  const text = buildInspectionNotes({ ...empty, notes: "Arm is cracked" });
  const result = appendInspectionNotes(original, text);
  assert.equal(result.error, null);
  assert.equal(result.value, original + "\n\n" + text);
  assert.deepEqual(appendInspectionNotes(result.value, text), result);
});
test("the 500-character boundary never truncates an observation or existing description", () => {
  const original = "x".repeat(490);
  assert.equal(appendInspectionNotes(original, "12345678").value.length, 500);
  const tooLong = appendInspectionNotes(original, "123456789");
  assert.equal(tooLong.value, original);
  assert.match(tooLong.error!, /1 characters over/);
  assert.deepEqual(appendInspectionNotes(original, ""), { value: original, error: null });
});
