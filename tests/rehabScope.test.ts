import { test } from "node:test";
import assert from "node:assert/strict";
import { newScope, scopeTotals, scopeError, captureScope } from "../src/lib/rehabScope.ts";
import { createManualAnalysisSnapshot, createDraftAnalysisSnapshot } from "../src/lib/analysisSnapshot.ts";

test("$50K allowance becomes $67K quote, with contingency applied once", () => {
  const scope = newScope(50000);
  assert.equal(scopeTotals(scope).total, 50000);
  scope.items[0].unit_cost = 67000;
  scope.contingency_pct = .15;
  assert.equal(scopeTotals(scope).total, 77050);
});
test("rounds each line to cents and final budget to dollars", () => {
  const scope = newScope(1);
  scope.items[0].quantity = 3;
  scope.items[0].unit_cost = .335;
  scope.contingency_pct = .5;
  assert.equal(scopeTotals(scope).subtotal, 1.01);
  assert.equal(scopeTotals(scope).total, 2);
});
test("quotes require provenance and a real calendar date", () => {
  const scope = newScope(50000);
  scope.items[0].basis = "quote";
  assert.match(scopeError(scope)!, /quote date/);
  scope.items[0].source = "Contractor";
  scope.items[0].quote_date = "2026-02-30";
  assert.match(scopeError(scope)!, /valid quote date/);
  scope.items[0].quote_date = "2026-09-10";
  assert.equal(scopeError(scope, 50000), null);
});
test("negative and nonfinite inputs, duplicate IDs and mismatched totals fail", () => {
  const scope = newScope(1);
  assert.ok(scopeError(scope, 2));
  scope.items[0].quantity = -1;
  assert.ok(scopeError(scope));
  scope.items[0].quantity = NaN;
  assert.ok(scopeError(scope));
  scope.items[0].quantity = 1;
  scope.items.push({ ...scope.items[0] });
  assert.ok(scopeError(scope));
});
test("captured scope is detached and deeply frozen", () => {
  const scope = newScope(50000);
  const captured = captureScope(scope)!;
  scope.items[0].unit_cost = 67000;
  assert.equal(scopeTotals(captured).total, 50000);
  assert.throws(() => { captured.items[0].unit_cost = 1; });
  assert.throws(() => captured.items.push(scope.items[0]));
});
test("manual and draft snapshots retain their own scope and revision identity", () => {
  const scope = newScope(50000);
  const first = createManualAnalysisSnapshot({ purchase_price: 150000, arv: 270000, rehab_budget: 50000 }, { rehabScope: scope });
  const second = createDraftAnalysisSnapshot(first.draftInput, { rehabScope: scope, parentDealId: 7, revisionNote: "  New quote  " });
  scope.items[0].unit_cost = 67000;
  assert.equal(scopeTotals(first.rehabScope!).total, 50000);
  assert.equal(scopeTotals(second.rehabScope!).total, 50000);
  assert.equal(first.parentDealId, null);
  assert.equal(second.parentDealId, 7);
  assert.equal(second.revisionNote, "New quote");
});
test("legacy snapshots remain scope-free", () => {
  const result = createManualAnalysisSnapshot({ purchase_price: 150000, arv: 270000, rehab_budget: 50000 });
  assert.equal(result.rehabScope, null);
  assert.equal(scopeError(null, 50000), null);
});
