import assert from 'node:assert/strict';
import test from 'node:test';
import { buildItemSave, buildSavedItemInputs, newSavedItemForm, restoreItemForm, safeItemLink } from '../src/lib/savedItems.ts';
import { ITEM_FIELDS, ITEM_PREFERENCES } from '../src/lib/itemAnalysis.ts';
import type { ItemAnalyzeRequest } from '../src/lib/types.ts';

// Exported cases are also checked through the real engine by browserFlow.mjs.
export function roundTripCases(): ItemAnalyzeRequest[] {
  const cases: ItemAnalyzeRequest[] = [{}, { item_name: '', category: '  oak  ' }, { personal_defaults: null }];
  const base = { purchase_price: 40, resale_low: 300, resale_high: 450, repairs: 60, pickup: 40, delivery: 0, storage: 0, fee_fixed: 0, hours: 5, fee_pct: 0, target_profit: 150 };
  for (const field of ITEM_PREFERENCES) {
    for (const personal of [undefined, null, 0, field.endsWith('_pct') ? 0.143 : 20]) {
      for (const own of [undefined, null, 0, field.endsWith('_pct') ? 0.029 : 30]) {
        const value: ItemAnalyzeRequest = { ...base, personal_defaults: personal === undefined ? {} : { [field]: personal } };
        delete value[field];
        if (own !== undefined) value[field] = own;
        cases.push(value);
      }
    }
  }
  let seed = 20261005;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let n = 0; n < 200; n++) {
    const input: ItemAnalyzeRequest = { resale_low: 300, resale_high: 700, item_name: ['Dresser', '', '   ', null][n % 4], personal_defaults: {} };
    for (const field of ITEM_FIELDS.filter(f => !f.startsWith('resale'))) {
      const mode = Math.floor(random() * 4);
      if (mode) input[field] = mode === 1 ? null : mode === 2 ? 0 : field.endsWith('_pct') ? Number((random() * 0.5).toFixed(6)) : Number((random() * 50).toFixed(2));
    }
    for (const field of ITEM_PREFERENCES) {
      const mode = Math.floor(random() * 4);
      if (mode) input.personal_defaults![field] = mode === 1 ? null : mode === 2 ? 0 : field.endsWith('_pct') ? 0.075 : 20;
    }
    cases.push(input);
  }
  return cases;
}
// Independently resolve only assumptions; financial math remains exclusively server-side.
function effective(input: ItemAnalyzeRequest) {
  const defaults: Record<string, number> = { hourly_value: 20, contingency_pct: 0.15 };
  return Object.fromEntries([...ITEM_FIELDS, 'item_name', 'category'].map(key => {
    const field = key as keyof ItemAnalyzeRequest;
    let value, source = null, origin = null;
    if (Object.hasOwn(input, key)) { value = input[field]; source = 'user_entered'; }
    else if (input.personal_defaults && Object.hasOwn(input.personal_defaults, key)) {
      value = input.personal_defaults[key as keyof typeof input.personal_defaults]; source = 'default'; origin = 'personal';
    } else if (Object.hasOwn(defaults, key)) { value = defaults[key]; source = 'default'; origin = 'application'; }
    return [key, value == null ? { value: null, source: null, origin: null } : { value, source, origin }];
  }));
}
test('267 representative and seeded cases preserve every effective assumption and source', () => {
  const cases = roundTripCases();
  assert.equal(cases.length, 267);
  for (const original of cases) {
    const before = structuredClone(original);
    const rebuilt = buildSavedItemInputs(restoreItemForm(original));
    assert.ok(rebuilt.ok);
    assert.deepEqual(effective(rebuilt.payload), effective(original), JSON.stringify(original));
    assert.deepEqual(original, before);
  }
});
test('explicit null blocks a personal value and null personal defaults block app fallback', () => {
  for (const field of ITEM_PREFERENCES) {
    const form = restoreItemForm({ [field]: null, personal_defaults: { [field]: 0 } });
    assert.equal(form.useDefault[field], false);
    assert.equal(form.values[field], '');
    const built = buildSavedItemInputs(form); assert.ok(built.ok); assert.equal(built.payload[field], null);
  }
  const form = restoreItemForm({ personal_defaults: { hourly_value: null, contingency_pct: null } });
  assert.equal(form.useDefault.hourly_value, false); assert.equal(form.useDefault.contingency_pct, false);
});
test('percent restores and rebuilds exact JSON wire fractions', () => {
  for (const [fraction, percent] of [[0.143, '14.3'], [0.029, '2.9'], [0.075, '7.5'], [0.000001, '0.0001'], [1, '100']] as const) {
    const form = restoreItemForm({ fee_pct: fraction, personal_defaults: { contingency_pct: fraction } });
    assert.equal(form.values.fee_pct, percent); assert.equal(form.personalDefaults.contingency_pct, percent);
    const built = buildSavedItemInputs(form); assert.ok(built.ok);
    assert.ok(JSON.stringify(built.payload).includes(`"fee_pct":${fraction}`));
  }
});
test('current screen values drive saving, including a notes-only linked version', () => {
  const form = restoreItemForm({ purchase_price: 0, repairs: null });
  form.values.purchase_price = '40';
  const built = buildItemSave(form, 'Passed: damaged veneer', ' https://example.com/listing ', 7);
  assert.ok(built.ok); assert.equal(built.payload.inputs.purchase_price, 40); assert.equal(built.payload.parent_item_id, 7);
  assert.equal(built.payload.listing_url, 'https://example.com/listing');
  assert.equal(built.payload.notes, 'Passed: damaged veneer'); assert.ok(!('analysis_result' in built.payload));
  const notesOnly = buildItemSave(form, 'New note', '', 7); assert.ok(notesOnly.ok); assert.deepEqual(notesOnly.payload.inputs, built.payload.inputs);
});
test('saving uses the same number validation and accepts incomplete finds', () => {
  for (const text of ['1e3', '12abc', '$1,200', '-1', '0x10']) {
    const form = newSavedItemForm(); form.values.repairs = text;
    const analyze = buildSavedItemInputs(form), save = buildItemSave(form, '', '', null);
    assert.ok(!analyze.ok && !save.ok); assert.deepEqual(save.errors, analyze.errors);
  }
  assert.ok(buildItemSave(newSavedItemForm(), '', '', null).ok);
});
test('save-only text and URL validation reject dangerous content and preserve plain notes', () => {
  for (const field of ['notes', 'item_name', 'category'] as const) {
    const form = newSavedItemForm(); if (field !== 'notes') form[field] = 'a\0b';
    const built = buildItemSave(form, field === 'notes' ? 'a\0b' : '', '', null);
    assert.ok(!built.ok); assert.ok(built.errors[field]);
  }
  for (const link of ['javascript:alert(1)', 'data:text/html,x', '/relative', 'https://u:p@example.com', 'https://example.com\n', 'x'.repeat(2049)]) assert.ok(!buildItemSave(newSavedItemForm(), '', link, null).ok);
  assert.ok(buildItemSave(newSavedItemForm(), '<script>text</script>\n🪑', 'https://example.com', null).ok);
  assert.ok(!buildItemSave(newSavedItemForm(), 'a'.repeat(5001), '', null).ok);
});
test('stored links are separately checked before rendering', () => {
  for (const bad of [null, '', 'javascript:alert(1)', '//example.com', 'http:\\example.com', 'https://u:p@example.com', ' https://example.com', 'https://example.com/\u0000']) assert.equal(safeItemLink(bad), null);
  assert.equal(safeItemLink('https://example.com/item?q=oak'), 'https://example.com/item?q=oak');
});
