import { test } from 'node:test';
import assert from 'node:assert/strict';
import { revisionScopeDiff, scopeFieldValue } from '../src/lib/revisionDiff.ts';
import { newScope, captureScope } from '../src/lib/rehabScope.ts';

test('a cost-neutral exclusion change preserves both exact passages', () => {
  const a = newScope(67000), b = structuredClone(a);
  a.items[0].notes = 'Debris removal included.';
  b.items[0].notes = 'Debris removal excluded. Owner to arrange.';
  const changes = revisionScopeDiff(a, b).items[0].changes;
  assert.deepEqual(changes, [{ key: 'notes', label: 'Notes / exclusions', previous: a.items[0].notes, current: b.items[0].notes }]);
});
test('quantity, specification and unit changes are visible even at the same line total', () => {
  const a = newScope(200), b = structuredClone(a);
  b.items[0] = { ...b.items[0], quantity: 2, unit_cost: 100, unit: 'each', description: 'Two basic units replace one premium unit.' };
  assert.deepEqual(revisionScopeDiff(a, b).items[0].changes.map(c => c.key), ['description', 'quantity', 'unit', 'unit_cost']);
});
test('changing contractor and quote date exposes old and new evidence', () => {
  const a = newScope(100), b = structuredClone(a);
  b.items[0] = { ...b.items[0], basis: 'quote', source: 'Contractor B', quote_date: '2026-09-11' };
  assert.deepEqual(revisionScopeDiff(a, b).items[0].changes.map(c => c.key), ['basis', 'source', 'quote_date']);
});
test('removed or added itemization retains its evidence', () => {
  const a = newScope(100);
  const removed = revisionScopeDiff(a, null).items[0];
  assert.equal(removed.current, undefined);
  assert.equal(removed.previous?.unit_cost, 100);
  assert.equal(revisionScopeDiff(null, a).items[0].previous, undefined);
});
test('reordering items or object properties does not invent changes', () => {
  const a = newScope(100);
  a.items.push({ ...a.items[0], id: 'second' });
  const b = structuredClone(a);
  b.items.reverse();
  b.items[0] = Object.fromEntries(Object.entries(b.items[0]).reverse()) as typeof b.items[0];
  assert.deepEqual(revisionScopeDiff(a, b), { items: [], notes: null });
});
test('budget-level exclusions are compared separately from line prices', () => {
  const a = newScope(100), b = structuredClone(a);
  b.notes = 'Investigate concealed subfloor damage before contracting.';
  assert.deepEqual(revisionScopeDiff(a, b), { items: [], notes: { previous: '', current: b.notes } });
});
test('legacy scopes compare without inventing historical evidence or mutating snapshots', () => {
  assert.deepEqual(revisionScopeDiff(null, undefined), { items: [], notes: null });
  const captured = captureScope(newScope(100));
  const copy = structuredClone(captured);
  revisionScopeDiff(captured, null);
  assert.deepEqual(captured, copy);
});
test('blank evidence stays missing while numeric zero stays explicit', () => {
  assert.equal(scopeFieldValue('notes', ''), 'Not recorded');
  assert.equal(scopeFieldValue('quantity', 0), '0');
  assert.equal(scopeFieldValue('unit_cost', 0), '$0.00');
  assert.equal(scopeFieldValue('basis', 'allowance'), 'Planning allowance');
});
