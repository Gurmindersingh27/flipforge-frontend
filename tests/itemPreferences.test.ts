import test from 'node:test';
import assert from 'node:assert/strict';
import { applyItemPreferences, buildPreferences, isItemPreferences, preferenceForm } from '../src/lib/itemPreferences.ts';
import { buildSavedItemInputs, newSavedItemForm, restoreItemForm } from '../src/lib/savedItems.ts';
import { newQuickItemForm, acceptFreshItemInputs, quickAssumptionsDetail, quickAssumptionsSummary } from '../src/lib/itemAssessment.ts';
import { itemFieldText } from '../src/lib/itemAnalysis.ts';
import type { ItemFinancialInput, ItemPreferences } from '../src/lib/types.ts';
const profile: ItemPreferences = { hourly_value: 25, target_profit: 0, contingency_pct: .143, fee_pct: null, pickup: 12.50, fee_fixed: 0, updated_at: '2026-10-21T12:00:00Z' };
const build = (form: ReturnType<typeof newQuickItemForm>) => { const result = buildSavedItemInputs(form); assert.ok(result.ok); return result.payload; };

test('storage DTO round-trips six optional fields, percentage precision and explicit zero', () => {
  assert.deepEqual(buildPreferences(preferenceForm(profile)), { hourly_value: 25, target_profit: 0, contingency_pct: .143, fee_pct: null, pickup: 12.5, fee_fixed: 0 });
  const form = preferenceForm(null); form.fee_pct = '14.3001';
  assert.equal(buildPreferences(form).fee_pct, .143001);
  assert.deepEqual(Object.values(buildPreferences(preferenceForm(null))), [null, null, null, null, null, null]);
});
test('preference input uses existing numeric bounds and rejects malformed values', () => {
  for (const [key, raw] of [['fee_pct','100.001'],['pickup','-1'],['hourly_value','1001'],['target_profit','1e3'],['contingency_pct','14.12345']] as const) {
    assert.throws(() => buildPreferences({ ...preferenceForm(null), [key]: raw }));
  }
  assert.equal(isItemPreferences(profile), true);
  for (const value of [{}, { ...profile, fee_pct: undefined }, { ...profile, pickup: Infinity }, { ...profile, updated_at: 'bad' }]) assert.equal(isItemPreferences(value), false);
});
test('no profile preserves both existing entry modes unchanged', () => {
  for (const form of [newQuickItemForm(), newSavedItemForm()]) assert.equal(applyItemPreferences(form, null, new Set()), form);
});
test('captured defaults stay four fields and pickup/fixed fee are only ordinary inputs', () => {
  const initial = newQuickItemForm(); const before = structuredClone(initial);
  const form = applyItemPreferences(initial, profile, new Set());
  const payload = build(form);
  assert.deepEqual(initial, before);
  assert.deepEqual(payload.personal_defaults, { hourly_value: 25, target_profit: 0, contingency_pct: .143 });
  assert.equal(Object.hasOwn(payload, 'hourly_value'), false);
  assert.equal(payload.fee_pct, null); assert.equal(payload.pickup, 12.5); assert.equal(payload.fee_fixed, 0);
  assert.equal(itemFieldText(form, 'target_profit'), '0');
});
test('saved blanks remain unknown in both modes instead of application or preset fallbacks', () => {
  for (const form of [newQuickItemForm(), newSavedItemForm()]) {
    const payload = build(applyItemPreferences(form, { ...profile, ...buildPreferences(preferenceForm(null)) }, new Set()));
    for (const key of ['hourly_value','target_profit','contingency_pct','fee_pct','pickup','fee_fixed'] as const) assert.equal(payload[key], null);
    assert.equal(payload.personal_defaults, undefined);
  }
});
test('late load preserves touched values, nulls, zero and toggled per-find modes', () => {
  const form = newSavedItemForm(); form.values.pickup = '0'; form.values.hourly_value = ''; form.useDefault.hourly_value = false;
  const touched = new Set<ItemFinancialInput>(['pickup','hourly_value']);
  const payload = build(applyItemPreferences(form, profile, touched));
  assert.equal(payload.pickup, 0); assert.equal(payload.hourly_value, null); assert.equal(payload.personal_defaults?.hourly_value, undefined);
  assert.equal(payload.personal_defaults?.target_profit, 0);
});
test('fresh provider answer retains captured preferences, explicit financial edits and untouched price extraction', () => {
  const form = applyItemPreferences(newQuickItemForm(), profile, new Set());
  form.values.delivery = '9'; form.values.hours = '2'; form.values.pickup = ''; form.values.fee_pct = '0'; form.useDefault.fee_pct = false;
  const touched = new Set<ItemFinancialInput>(['delivery','hours','pickup','fee_pct']);
  const inputs = { purchase_price: 20, resale_low: 65, resale_high: 90, repairs: 15, fee_pct: 0, pickup: 0, hourly_value: 20, target_profit: 30 };
  const original = structuredClone(inputs);
  const payload = build(acceptFreshItemInputs(inputs, form, touched));
  assert.deepEqual(inputs, original); assert.equal(payload.purchase_price, 20);
  assert.equal(payload.delivery, 9); assert.equal(payload.hours, 2); assert.equal(payload.pickup, null); assert.equal(payload.fee_pct, 0);
  assert.equal(payload.personal_defaults?.hourly_value, 25); assert.equal(payload.personal_defaults?.target_profit, 0);
});
test('explicit asking zero and blank overrides survive a fresh answer', () => {
  for (const value of ['0','']) {
    const form = newQuickItemForm(); form.values.purchase_price = value;
    assert.equal(build(acceptFreshItemInputs({ purchase_price: 99 }, form, new Set(['purchase_price']))).purchase_price, value === '' ? null : 0);
  }
});
test('saved null/default semantics are stable on reopening without preference application', () => {
  const inputs = { hourly_value: null, fee_pct: 0, personal_defaults: { hourly_value: 50, target_profit: 0 } };
  const payload = build(restoreItemForm(inputs));
  assert.equal(payload.hourly_value, null); assert.equal(payload.fee_pct, 0); assert.equal(payload.personal_defaults?.target_profit, 0);
});
test('summary and confirmation disclose effective remembered fees, nulls, percentages and zero', () => {
  const form = applyItemPreferences(newQuickItemForm(), profile, new Set());
  assert.equal(quickAssumptionsSummary(form), 'Uses your entered costs, $0 profit goal');
  const text = quickAssumptionsDetail(form);
  for (const expected of ['Pickup: $12.50','Selling fee: unknown','Fixed selling fee: $0','Time value: $25','Repair buffer: 14.3%','Profit goal: $0']) assert.ok(text.includes(expected), text);
  const fee = applyItemPreferences(newQuickItemForm(), { ...profile, fee_pct: .143 }, new Set());
  assert.ok(!quickAssumptionsSummary(fee).includes('no fees'));
  assert.ok(quickAssumptionsDetail(fee).includes('Selling fee: 14.3%'));
});
