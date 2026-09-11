import { test } from "node:test";
import assert from "node:assert/strict";
import { newScope, scopeTotals, scopeError, captureScope, stampQuote } from "../src/lib/rehabScope.ts";
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

test("bulk quote details cannot silently convert a planning allowance", () => {
  const scope = newScope(12000), before = structuredClone(scope);
  assert.throws(() => stampQuote(scope, "Builder A", "2026-09-11", [scope.items[0].id]), /Confirm.*planning allowances/);
  assert.deepEqual(scope, before);
});
test("confirmed stamping changes only selected provenance and preserves amounts, IDs and evidence", () => {
  const scope = newScope(12000);
  scope.items[0].notes = "Finish selection pending; demolition included.";
  scope.items.push({ ...scope.items[0], id: 'roof', category: 'Roof', basis: 'quote', source: 'Roofer', quote_date: '2026-09-01' });
  const frozen = captureScope(scope)!;
  const stamped = stampQuote(frozen, "  Builder A  ", "2026-09-11", [scope.items[0].id], { convertAllowances: true });
  assert.equal(stamped.items[0].basis, "quote");
  assert.equal(stamped.items[0].source, "Builder A");
  assert.equal(stamped.items[0].id, frozen.items[0].id);
  assert.equal(stamped.items[0].notes, frozen.items[0].notes);
  assert.deepEqual(stamped.items[1], frozen.items[1]);
  assert.equal(frozen.items[0].basis, "allowance");
  assert.deepEqual(scopeTotals(stamped), scopeTotals(frozen));
  assert.equal(scopeError(stamped, 24000), null);
});
test("existing contractor and date require separate explicit replacement", () => {
  const scope = newScope(12000), id = scope.items[0].id;
  const quote = stampQuote(scope, "Builder A", "2026-09-10", [id], { convertAllowances: true });
  for (const [source, date] of [["Builder B", "2026-09-10"], ["Builder A", "2026-09-11"]]) {
    assert.throws(() => stampQuote(quote, source, date, [id], { convertAllowances: true }), /Confirm replacement/);
  }
  const updated = stampQuote(quote, "Builder B", "2026-09-11", [id], { replaceQuoteDetails: true });
  assert.equal(updated.items[0].source, "Builder B");
  assert.equal(quote.items[0].source, "Builder A");
});
test("matching or blank quote details can be filled without replacing existing provenance", () => {
  const scope = newScope(100), id = scope.items[0].id;
  scope.items[0] = { ...scope.items[0], basis: "quote", source: "Builder A", quote_date: null };
  const updated = stampQuote(scope, "Builder A", "2026-09-11", [id]);
  assert.equal(scopeError(updated), null);
  assert.deepEqual(stampQuote(updated, "Builder A", "2026-09-11", [id]), updated);
});
test("bulk quote input rejects bad dates, missing contractor and invalid selection", () => {
  const scope = newScope(100), id = scope.items[0].id, options = { convertAllowances: true };
  for (const date of ["", "2026-02-30", "not-a-date"]) assert.throws(() => stampQuote(scope, "Builder", date, [id], options), /valid quote date/);
  for (const source of ["  ", "A".repeat(501)]) assert.throws(() => stampQuote(scope, source, "2026-09-11", [id], options), /contractor/);
  for (const ids of [[], [id, id], ["removed-line"]]) assert.throws(() => stampQuote(scope, "Builder", "2026-09-11", ids, options), /Select/);
});
test("one conflicting quote prevents a partially applied bulk operation", () => {
  const scope = newScope(100);
  scope.items.push({ ...scope.items[0], id: 'other', basis: 'quote', source: 'Existing builder', quote_date: '2026-08-01' });
  const before = structuredClone(scope);
  assert.throws(() => stampQuote(scope, "New builder", "2026-09-11", scope.items.map(item => item.id), { convertAllowances: true }), /Confirm replacement/);
  assert.deepEqual(scope, before);
});
