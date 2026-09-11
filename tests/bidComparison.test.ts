import { test } from "node:test";
import assert from "node:assert/strict";
import type { SavedDeal, RehabScope } from "../src/lib/types.ts";
import { createManualAnalysisSnapshot } from "../src/lib/analysisSnapshot.ts";
import { newScope, scopeTotals } from "../src/lib/rehabScope.ts";
import { bidCandidates, compareBidOptions } from "../src/lib/bidComparison.ts";

function fixture() {
  const scope = newScope(20000);
  scope.items[0] = { ...scope.items[0], id: 'kitchen', category: 'Kitchen' };
  scope.items.push({ ...scope.items[0], id: 'roof', category: 'Roof', unit_cost: 12000 });
  scope.contingency_pct = .1;
  function deal(id: number, current: RehabScope, parent: number | null): SavedDeal {
    const snapshot = createManualAnalysisSnapshot({ purchase_price: 150000, arv: 270000, rehab_budget: scopeTotals(current).total }, { propertyAddress: '1 Example Lane', rehabScope: current });
    return { id, user_id: 'owner-a', address: '1 Example Lane', created_at: '2026-09-11',
      draft_input: { ...structuredClone(snapshot.draftInput) }, rehab_scope: structuredClone(current), parent_deal_id: parent,
      // Synthetic saved metrics test display fidelity; the browser test uses the real engine.
      analysis_result: { max_safe_offer: 150000 + id, net_profit: 30000 + id, overall_verdict: 'BUY',
        stress_tests: [{ name: 'Rehab +15%', verdict: 'CONDITIONAL', net_profit: 20000 + id }] } };
  }
  const baseline = deal(1, scope, null);
  function bid(id: number, quote: number, allowance: number, category: string) {
    const modified = structuredClone(scope);
    modified.items[0] = { ...modified.items[0], basis: 'quote', unit_cost: quote, source: `Builder ${id}`, quote_date: '2026-09-11', notes: 'Disposal excluded. Owner to confirm coverage.' };
    modified.items.push({ ...scope.items[0], id: `extra-${id}`, category, unit_cost: allowance, notes: 'Reviewer planning allowance, not a contractor price.' });
    return deal(id, modified, 1);
  }
  return { baseline, a: bid(2, 14000, 6500, 'Demo / Disposal'), b: bid(3, 18000, 1300, 'Finishes') };
}

test('comparison separates changed quotes, allowances, retained costs and one reserve', () => {
  const { baseline, a, b } = fixture();
  const result = compareBidOptions(baseline, a, b);
  assert.deepEqual(result.issues, []);
  assert.equal(result.comparison!.left.quoted, 14000);
  assert.equal(result.comparison!.left.allowances, 6500);
  assert.equal(result.comparison!.left.retained, 12000);
  assert.equal(result.comparison!.left.subtotal, 32500);
  assert.equal(result.comparison!.left.contingency, 3250);
  assert.equal(result.comparison!.left.total, 35750);
  assert.equal(result.comparison!.right.total, 34430);
  assert.equal(result.comparison!.left.maxOffer, a.analysis_result.max_safe_offer);
  assert.equal(result.comparison!.right.stress?.netProfit, 20003);
});
test('missing category stays unitemized while an explicit zero stays zero', () => {
  const { baseline, a, b } = fixture();
  a.rehab_scope!.items[2].unit_cost = 0;
  (a.draft_input!.rehab_budget as { value: number }).value = scopeTotals(a.rehab_scope!).total;
  const category = compareBidOptions(baseline, a, b).comparison!.categories.find(row => row.label === 'Demo / Disposal')!;
  assert.equal(category.left.total, 0);
  assert.equal(category.right.total, null);
  assert.deepEqual(category.right.items, []);
});
test('only spacing and capitalization are normalized; synonyms are not inferred', () => {
  const { baseline, a, b } = fixture();
  b.rehab_scope!.items[0].category = '  KITCHEN  ';
  b.rehab_scope!.items[2].category = 'Demolition';
  const result = compareBidOptions(baseline, a, b).comparison!;
  assert.equal(result.categories.filter(row => row.key === 'kitchen').length, 1);
  assert.ok(result.categories.some(row => row.key === 'demo / disposal' && row.right.total === null));
  assert.ok(result.categories.some(row => row.key === 'demolition' && row.left.total === null));
});
test('duplicate categories sum cents per line and all groups reconcile to the saved budget', () => {
  const { baseline, a, b } = fixture();
  a.rehab_scope!.items.push({ ...a.rehab_scope!.items[0], id: 'kitchen-extra', quantity: 3, unit_cost: .335 });
  (a.draft_input!.rehab_budget as { value: number }).value = scopeTotals(a.rehab_scope!).total;
  const result = compareBidOptions(baseline, a, b).comparison!;
  assert.equal(result.categories.find(row => row.key === 'kitchen')!.left.total, 14001.01);
  assert.equal(Math.round(result.categories.reduce((sum, row) => sum + (row.left.total ?? 0), 0) * 100) / 100, result.left.subtotal);
  assert.equal(result.left.total, (a.draft_input!.rehab_budget as { value: number }).value);
});
test('same bid, wrong parent and cross-owner records cannot be compared', () => {
  const { baseline, a, b } = fixture();
  assert.match(compareBidOptions(baseline, a, a).issues.join(' '), /different saved bids/);
  b.parent_deal_id = a.id;
  assert.match(compareBidOptions(baseline, a, b).issues.join(' '), /same baseline/);
  b.parent_deal_id = baseline.id; b.user_id = 'other-owner';
  assert.match(compareBidOptions(baseline, a, b).issues.join(' '), /same owner/);
});
test('each changed underwriting assumption blocks a bid-only comparison', () => {
  for (const key of ['closing_cost_pct', 'selling_cost_pct', 'holding_months', 'annual_interest_rate', 'loan_to_cost_pct', 'required_profit_margin_pct']) {
    const { baseline, a, b } = fixture();
    b.draft_input![key] = Number(b.draft_input![key]) + .1;
    const result = compareBidOptions(baseline, a, b);
    assert.equal(result.comparison, null, key);
    assert.equal(result.differences.length, 1, key);
  }
  for (const key of ['purchase_price', 'arv', 'est_monthly_rent']) {
    const { baseline, a, b } = fixture();
    b.draft_input![key] = { value: 99999 };
    assert.equal(compareBidOptions(baseline, a, b).comparison, null, key);
  }
});
test('matching bids that both differ from the baseline are still not bid-only changes', () => {
  const { baseline, a, b } = fixture();
  a.draft_input!.holding_months = 8; b.draft_input!.holding_months = 8;
  const difference = compareBidOptions(baseline, a, b).differences[0];
  assert.deepEqual(difference, { label: 'Holding months', baseline: 6, left: 8, right: 8 });
});
test('changed property identity or region is not hidden by a shared parent', () => {
  for (const key of ['url', 'region']) {
    const { baseline, a, b } = fixture();
    b.draft_input![key] = 'different';
    assert.equal(compareBidOptions(baseline, a, b).comparison, null);
  }
  const { baseline, a, b } = fixture(); b.address = '2 Different Lane';
  assert.equal(compareBidOptions(baseline, a, b).differences[0].label, 'Property address');
});
test('unknown historical assumptions are not silently replaced with defaults', () => {
  const { baseline, a, b } = fixture();
  delete baseline.draft_input!.holding_months;
  assert.equal(compareBidOptions(baseline, a, b).comparison, null);
  assert.equal(compareBidOptions(baseline, a, b).differences[0].baseline, undefined);
});
test('non-positive rent follows the existing omitted-rent convention', () => {
  const { baseline, a, b } = fixture();
  b.draft_input!.est_monthly_rent = { value: 0 };
  assert.deepEqual(compareBidOptions(baseline, a, b).issues, []);
});
test('mismatched scope/analysis budgets and incomplete quote evidence are blocked', () => {
  const { baseline, a, b } = fixture();
  a.rehab_scope!.items[0].unit_cost++;
  assert.equal(compareBidOptions(baseline, a, b).comparison, null);
  a.rehab_scope!.items[0].unit_cost--; a.rehab_scope!.items[0].source = '';
  assert.match(compareBidOptions(baseline, a, b).issues.join(' '), /source and quote date/);
});
test('legacy scopes and incomplete results fail clearly instead of fabricating metrics', () => {
  const { baseline, a, b } = fixture();
  baseline.rehab_scope = null;
  assert.match(compareBidOptions(baseline, a, b).issues.join(' '), /itemized scope/);
  b.analysis_result = {};
  assert.match(compareBidOptions(baseline, a, b).issues.join(' '), /saved analysis is incomplete/);
});
test('missing stress evidence remains unavailable while valid saved results are preserved', () => {
  const { baseline, a, b } = fixture(); delete a.analysis_result.stress_tests;
  const result = compareBidOptions(baseline, a, b);
  assert.equal(result.comparison!.left.stress, null);
  assert.equal(result.comparison!.left.netProfit, a.analysis_result.net_profit);
});
test('notes, quote provenance and every saved record remain unchanged by comparison', () => {
  const records = fixture(), before = structuredClone(records);
  const result = compareBidOptions(records.baseline, records.a, records.b).comparison!;
  const line = result.categories.find(row => row.key === 'kitchen')!.left.items[0];
  assert.equal(line.notes, 'Disposal excluded. Owner to confirm coverage.');
  assert.equal(line.quote_date, '2026-09-11');
  assert.deepEqual(records, before);
});
test('candidate discovery includes only this owner’s quoted siblings and deduplicates records', () => {
  const { baseline, a, b } = fixture();
  const otherOwner = { ...b, id: 4, user_id: 'other-owner' };
  const grandchild = { ...b, id: 5, parent_deal_id: a.id };
  const unquoted = { ...baseline, id: 6, parent_deal_id: baseline.id };
  const all = [baseline, a, b, otherOwner, grandchild, unquoted, b];
  assert.deepEqual(bidCandidates(baseline, all).map(deal => deal.id), [3, 2]);
  assert.deepEqual(bidCandidates(a, all).map(deal => deal.id), [3, 2]);
});
