import assert from 'node:assert/strict';
import test from 'node:test';
import { compareItemVersions } from '../src/lib/itemComparison.ts';
import { ITEM_FIELDS } from '../src/lib/itemAnalysis.ts';
import type { ItemAssumptions, ItemScenario, SavedItem, SavedItemAssessment } from '../src/lib/types.ts';

function fixture(): SavedItem {
  const assumptions = Object.fromEntries([...ITEM_FIELDS, 'item_name', 'category'].map(field =>
    [field, { value: null, source: null, default_origin: null }])) as ItemAssumptions;
  assumptions.item_name = { value: 'Chair', source: 'user_entered', default_origin: null };
  return { id: 1, parent_item_id: null, root_item_id: 1, schema_version: 1, created_at: '2026-10-17T12:00:00Z',
    inputs: { purchase_price: 999999 }, notes: null, listing_url: null,
    analysis_result: { schema_version: 1, status: 'needs_info', missing_inputs: [], assumptions, low: null, high: null } };
}
const scenario: ItemScenario = { resale: 300, contingency: 9, selling_fees: 0, own_time_value: 100,
  raw_max_offer: -50.4, max_offer: -51, cash_left: 49.6, profit_after_time: -50.4, target_shortfall: 150.4 };

test('national versus own-estimate provenance is a change even when every saved number is equal', () => {
  const previous = fixture(), current = fixture();
  // Comparison consumes confirmation only, never evidence or recalculated prices.
  previous.assessment = { confirmation: { resale_source: 'national_reference' } } as SavedItemAssessment;
  current.assessment = { confirmation: { resale_source: 'user_estimate' } } as SavedItemAssessment;
  current.notes = 'Only the numeric values are unchanged.';
  const before = structuredClone([previous, current]);
  const compared = compareItemVersions(previous, current);
  assert.ok(compared.resaleSource.previous.includes('National used asking prices; shipping excluded.'));
  assert.equal(compared.resaleSource.current, 'Your sale estimate, not a confirmed sale price.');
  assert.equal(compared.resaleSource.changed, true);
  assert.equal(compared.resaleSource.difference, null);
  assert.equal(compared.onlyNotesOrLink, false);
  assert.deepEqual([previous, current], before);
});

test('comparison preserves legacy unknown provenance and never infers national source from values', () => {
  const previous = fixture(), current = fixture();
  previous.assessment = { confirmation: {} } as SavedItemAssessment;
  const compared = compareItemVersions(previous, current);
  assert.equal(compared.resaleSource.previous, 'Sale assumptions used for this calculation; source not recorded.');
  assert.equal(compared.resaleSource.current, 'Your sale estimate, not a confirmed sale price.');
});

test('saved assumptions distinguish unknown and zero, ignoring raw inputs without mutation', () => {
  const previous = fixture(), current = fixture();
  current.analysis_result.assumptions.purchase_price = { value: 0, source: 'user_entered', default_origin: null };
  const before = structuredClone([previous, current]);
  const row = compareItemVersions(previous, current).assumptions.find(r => r.key === 'purchase_price')!;
  assert.equal(row.previous, 'Unknown'); assert.equal(row.current, '$0.00');
  assert.equal(row.difference, null); assert.equal(row.changed, true);
  assert.deepEqual([previous, current], before);
});
test('blank text is None without unknown provenance, while missing financial values stay Unknown', () => {
  for (const value of [null, '', '  \n']) {
    const previous = fixture(), current = fixture();
    for (const item of [previous, current]) {
      item.notes = item.listing_url = value;
      for (const field of ['item_name', 'category'] as const) {
        item.analysis_result.assumptions[field] = { value, source: value === null ? null : 'user_entered', default_origin: null };
      }
    }
    const comparison = compareItemVersions(previous, current);
    for (const row of [...comparison.assumptions.slice(0, 2), ...comparison.metadata]) {
      assert.equal(row.previous, 'None'); assert.equal(row.current, 'None');
      assert.equal(row.previousSource, undefined); assert.equal(row.currentSource, undefined);
      assert.equal(row.changed, false);
    }
    for (const field of ['purchase_price', 'fee_pct', 'hours']) {
      const row = comparison.assumptions.find(r => r.key === field)!;
      assert.equal(row.previous, 'Unknown'); assert.equal(row.current, 'Unknown');
    }
  }
});
test('source-only changes distinguish entered, personal default and app default', () => {
  const previous = fixture(), current = fixture();
  previous.analysis_result.assumptions.hourly_value = { value: 20, source: 'user_entered', default_origin: null };
  for (const [origin, label] of [['personal', 'Personal default'], ['application', 'App default']] as const) {
    current.analysis_result.assumptions.hourly_value = { value: 20, source: 'default', default_origin: origin };
    const row = compareItemVersions(previous, current).assumptions.find(r => r.key === 'hourly_value')!;
    assert.equal(row.previousSource, 'You entered'); assert.equal(row.currentSource, label);
    assert.equal(row.changed, true); assert.equal(row.difference, null);
  }
});
test('needs_info and offer_only retain stored status and null figures never become zero', () => {
  const previous = fixture(), current = fixture();
  current.analysis_result.status = 'offer_only';
  current.analysis_result.low = { ...scenario, cash_left: null, profit_after_time: null };
  const comparison = compareItemVersions(previous, current);
  assert.equal(comparison.status.previous, 'More information needed'); assert.equal(comparison.status.current, 'Offers only');
  for (const row of comparison.scenarios[0].rows) assert.equal(row.previous, 'Unknown');
  for (const row of comparison.scenarios[0].rows.slice(1)) {
    assert.equal(row.current, 'Unknown'); assert.equal(row.difference, null);
  }
  assert.ok(comparison.scenarios[1].rows.every(r => r.previous === 'Unknown' && r.current === 'Unknown'));
});
test('negative saved offers, cents and equal low/high endpoints remain distinct scenarios', () => {
  const previous = fixture(), current = fixture();
  previous.analysis_result.low = previous.analysis_result.high = { ...scenario, max_offer: 77, cash_left: 100.4 };
  current.analysis_result.low = current.analysis_result.high = { ...scenario };
  const comparison = compareItemVersions(previous, current);
  assert.equal(comparison.scenarios.length, 2);
  for (const s of comparison.scenarios) {
    assert.equal(s.rows[0].current, '-$51'); assert.equal(s.rows[0].difference, '−$128');
    assert.equal(s.rows[1].current, '$49.60'); assert.equal(s.rows[1].difference, '−$50.80');
    assert.equal(s.currentNegative, true); assert.equal(s.previousNegative, false);
  }
});
test('percentages preserve exact wire precision and signed differences', () => {
  const previous = fixture(), current = fixture();
  previous.analysis_result.assumptions.fee_pct = { value: .143, source: 'user_entered', default_origin: null };
  current.analysis_result.assumptions.fee_pct = { value: .029, source: 'user_entered', default_origin: null };
  const row = compareItemVersions(previous, current).assumptions.find(r => r.key === 'fee_pct')!;
  assert.equal(row.previous, '14.3%'); assert.equal(row.current, '2.9%'); assert.equal(row.difference, '−11.4%');
});
test('notes/link-only versions are explained, while item-name and estimate changes are not mislabeled', () => {
  const previous = fixture(), current = fixture();
  current.notes = 'Check runners.\nKeep hardware.';
  let comparison = compareItemVersions(previous, current);
  assert.equal(comparison.onlyNotesOrLink, true); assert.equal(comparison.metadata[0].changed, true);
  current.listing_url = 'https://example.com/chair';
  assert.equal(compareItemVersions(previous, current).metadata[1].changed, true);
  current.analysis_result.assumptions.item_name.value = 'Oak chair';
  comparison = compareItemVersions(previous, current);
  assert.equal(comparison.onlyNotesOrLink, false); assert.equal(comparison.assumptions[0].changed, true);
  assert.equal(comparison.assumptions[0].previous, 'Chair'); assert.equal(comparison.assumptions[0].current, 'Oak chair');
});
