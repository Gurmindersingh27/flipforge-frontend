import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOutcomeFacts, isItemOutcome, OUTCOME_CHANNELS, OUTCOME_DATES, OUTCOME_EXPENSES,
  OUTCOME_FIGURES, OUTCOME_NUMBERS, outcomeFieldsToClear, outcomeForm, outcomeIsUncertain, validOutcomeDate } from '../src/lib/itemOutcomes.ts';
import type { ItemOutcomeFacts, ItemOutcomeResponse } from '../src/lib/types.ts';

const id = '11111111-1111-4111-8111-111111111111';
function facts(): ItemOutcomeFacts {
  const built = buildOutcomeFacts(outcomeForm());
  assert.ok(built.ok);
  return built.facts;
}
function response(): ItemOutcomeResponse {
  return { id, root_item_id: 5, based_on_item_id: 9, previous_id: null, revision_number: 1, schema_version: 1,
    created_at: '2026-10-20T14:00:00Z', inputs: facts(), calculated: {
      cash_invested: null, cash_profit: null, profit_after_time: null, days_held: null, days_to_sell: null,
      missing_fields: { cash_invested: ['purchase_price'], cash_profit: ['status', 'sale_price'],
        profit_after_time: ['hours'], days_held: ['sold_on'], days_to_sell: ['listed_on'] },
    } };
}

test('initial bought form has no inferred money, dates, channel or estimate defaults', () => {
  const form = outcomeForm();
  assert.equal(form.status, 'bought');
  for (const key of [...OUTCOME_NUMBERS, ...OUTCOME_DATES, 'sale_channel'] as const) assert.equal(form[key], '');
  const built = buildOutcomeFacts(form); assert.ok(built.ok);
  for (const key of [...OUTCOME_NUMBERS, ...OUTCOME_DATES, 'sale_channel'] as const) assert.equal(built.facts[key], null);
});
test('blank versus typed zero survives conversion in every number field', () => {
  for (const field of OUTCOME_NUMBERS) {
    for (const [text, expected] of [['', null], ['  ', null], ['0', 0], ['0.00', 0], ['25', 25]] as const) {
      const built = buildOutcomeFacts({ ...outcomeForm(), status: 'sold', [field]: text });
      assert.ok(built.ok); assert.equal(built.facts[field], expected);
    }
  }
});
test('a complete saved snapshot round-trips all hidden fields without mutation', () => {
  const saved: ItemOutcomeFacts = { ...facts(), status: 'sold', ...Object.fromEntries(OUTCOME_NUMBERS.map((key, i) => [key, i + 0.25])),
    purchased_on: '2026-10-01', listed_on: '2026-10-02', sold_on: '2026-10-03', sale_channel: 'in_person' };
  const before = structuredClone(saved), form = outcomeForm(saved);
  form.purchase_price = '55';
  const built = buildOutcomeFacts(form); assert.ok(built.ok);
  assert.deepEqual(built.facts, { ...saved, purchase_price: 55 }); assert.deepEqual(saved, before);
});
test('invalid numbers and money/hour limits fail before a save', () => {
  for (const field of OUTCOME_NUMBERS) {
    const max = field === 'hours' ? 10000 : field === 'hourly_value' ? 1000 : 1000000;
    for (const raw of ['NaN', 'Infinity', '-0.01', '0x10', '1e3', '1,000', '$25', String(max + 1)]) {
      const built = buildOutcomeFacts({ ...outcomeForm(), status: 'sold', [field]: raw });
      assert.ok(!built.ok); assert.ok(built.errors[field], `${field}: ${raw}`);
    }
    assert.ok(buildOutcomeFacts({ ...outcomeForm(), status: 'sold', [field]: String(max) }).ok);
  }
});
test('money goes to the server without browser rounding; hours allow only two meaningful places', () => {
  const built = buildOutcomeFacts({ ...outcomeForm(), purchase_price: '1.005', hourly_value: '12.345', hours: '1.2300' });
  assert.ok(built.ok); assert.equal(built.facts.purchase_price, 1.005); assert.equal(built.facts.hourly_value, 12.345); assert.equal(built.facts.hours, 1.23);
  for (const hours of ['0.001', '1.23001', '2.123']) assert.ok(!buildOutcomeFacts({ ...outcomeForm(), hours }).ok);
});
test('all six sale channels pass; arbitrary text and invalid statuses fail', () => {
  for (const channel of Object.keys(OUTCOME_CHANNELS)) {
    assert.ok(buildOutcomeFacts({ ...outcomeForm(), status: 'sold', sale_channel: channel as ItemOutcomeFacts['sale_channel'] & string }).ok);
  }
  assert.ok(!buildOutcomeFacts({ ...outcomeForm(), status: 'sold', sale_channel: 'FB' as 'ebay' }).ok);
  assert.ok(!buildOutcomeFacts({ ...outcomeForm(), status: 'purchased' as 'bought' }).ok);
});
test('backward status changes identify only incompatible nonblank fields; zero counts as entered', () => {
  const form = { ...outcomeForm(), status: 'sold' as const, sale_price: '0', sale_channel: 'other' as const,
    listed_on: '2026-10-01', sold_on: '2026-10-02', materials: '5' };
  assert.deepEqual(outcomeFieldsToClear(form, 'sold'), []);
  assert.deepEqual(outcomeFieldsToClear(form, 'listed'), ['sale_price', 'sale_channel', 'sold_on']);
  assert.deepEqual(outcomeFieldsToClear(form, 'bought'), ['sale_price', 'sale_channel', 'sold_on', 'listed_on']);
  assert.ok(!buildOutcomeFacts({ ...form, status: 'bought' }).ok);
  assert.equal(form.materials, '5');
});
test('dates validate calendar days, known-pair order and same-day sales without timezone conversion', () => {
  for (const value of ['2026-02-29', '2026-04-31', '0000-01-01', '10/20/2026', '2026-10-20T00:00:00Z']) assert.equal(validOutcomeDate(value), false);
  assert.ok(validOutcomeDate('2024-02-29'));
  const form = { ...outcomeForm(), status: 'sold' as const, purchased_on: '2026-10-20', sold_on: '2026-10-20' };
  assert.ok(buildOutcomeFacts(form).ok);
  assert.ok(!buildOutcomeFacts({ ...form, sold_on: '2026-10-19' }).ok);
  assert.ok(!buildOutcomeFacts({ ...form, listed_on: '2026-10-21' }).ok);
  assert.ok(!buildOutcomeFacts({ ...form, purchased_on: '', listed_on: '2026-10-21' }).ok);
});
test('nullable estimate basis and stored null figures are accepted without computing missing profit', () => {
  const saved = response(); saved.based_on_item_id = null;
  assert.ok(isItemOutcome(saved, 5));
  assert.equal(saved.calculated.cash_profit, null);
});
test('server zeroes, losses and days remain exactly the stored values', () => {
  const saved = response();
  for (const field of Object.keys(OUTCOME_FIGURES) as (keyof typeof OUTCOME_FIGURES)[]) { saved.calculated[field] = 0; saved.calculated.missing_fields[field] = []; }
  saved.calculated.cash_profit = -25.31; saved.calculated.profit_after_time = -72.68;
  assert.ok(isItemOutcome(saved, 5)); assert.equal(saved.calculated.cash_profit, -25.31); assert.equal(saved.calculated.days_held, 0);
});
test('wrong-root, malformed identity and incomplete or inconsistent responses cannot confirm a save', () => {
  assert.equal(isItemOutcome(response(), 6), false);
  for (const patch of [{ id: 'not-uuid' }, { schema_version: 2 }, { revision_number: 0 }, { based_on_item_id: -1 },
    { previous_id: 'bad' }, { created_at: 'never' }, { inputs: null }, { calculated: {} }]) assert.equal(isItemOutcome({ ...response(), ...patch }, 5), false);
  for (const mutate of [
    (s: ItemOutcomeResponse) => { delete (s.inputs as Partial<ItemOutcomeFacts>).materials; },
    (s: ItemOutcomeResponse) => { s.inputs.hours = 1.001; },
    (s: ItemOutcomeResponse) => { s.calculated.cash_profit = NaN; },
    (s: ItemOutcomeResponse) => { s.calculated.cash_profit = 0; },
    (s: ItemOutcomeResponse) => { s.calculated.missing_fields.cash_profit = ['buyer_name' as 'status']; },
    (s: ItemOutcomeResponse) => { s.calculated.days_held = -1; s.calculated.missing_fields.days_held = []; },
  ]) { const saved = response(); mutate(saved); assert.equal(isItemOutcome(saved, 5), false); }
});
test('only post-replay app rejections release an earlier uncertain save', () => {
  for (const status of [401, 403, 429, 500, 503, undefined]) assert.equal(outcomeIsUncertain(true, false, status), true);
  for (const status of [404, 409, 422]) assert.equal(outcomeIsUncertain(true, false, status), false);
  assert.equal(outcomeIsUncertain(false, true), true);
  assert.equal(outcomeIsUncertain(false, false, 401), false);
  assert.equal(OUTCOME_EXPENSES.length, 7);
});
