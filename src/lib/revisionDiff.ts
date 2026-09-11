import type { RehabScope, RehabScopeItem } from './types.ts';

const fields = [
  ['category', 'Category'], ['description', 'Scope / description'],
  ['quantity', 'Quantity'], ['unit', 'Unit'], ['unit_cost', 'Unit cost'],
  ['basis', 'Basis'], ['source', 'Source / contractor'],
  ['quote_date', 'Quote date'], ['notes', 'Notes / exclusions'],
] as const;

/** Compare the stored evidence, including changes that leave the price unchanged. */
export function revisionScopeDiff(previous?: RehabScope | null, current?: RehabScope | null) {
  const before = new Map((previous?.items ?? []).map(item => [item.id, item]));
  const after = new Map((current?.items ?? []).map(item => [item.id, item]));
  const items = [...new Set([...before.keys(), ...after.keys()])].flatMap(id => {
    const old = before.get(id), next = after.get(id);
    const changes = fields.flatMap(([key, label]) => {
      const a = old?.[key] ?? null, b = next?.[key] ?? null;
      return a === b ? [] : [{ key, label, previous: a, current: b }];
    });
    return changes.length ? [{ id, previous: old, current: next, changes }] : [];
  });
  const oldNotes = previous?.notes ?? '', newNotes = current?.notes ?? '';
  return { items, notes: oldNotes === newNotes ? null : { previous: oldNotes, current: newNotes } };
}

export function scopeFieldValue(key: keyof RehabScopeItem, value: string | number | null): string {
  if (value === null || value === '') return 'Not recorded';
  if (key === 'unit_cost' && typeof value === 'number') {
    return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 6 });
  }
  if (key === 'basis') return value === 'quote' ? 'Contractor quote' : 'Planning allowance';
  return String(value);
}
