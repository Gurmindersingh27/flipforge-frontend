import { formatItemPercent, ITEM_PREFERENCES, parseItemNumber } from './itemAnalysis.ts';
import type { ItemFinancialInput, ItemPreference, ItemPreferences, SaveItemPreferences } from './types.ts';
import type { SavedItemForm } from './savedItems.ts';

export const PREFERENCE_FIELDS = [...ITEM_PREFERENCES, 'pickup', 'fee_fixed'] as const;
export type PreferenceField = typeof PREFERENCE_FIELDS[number];
export type PreferenceForm = Record<PreferenceField, string>;
export function preferenceText(value: number | null, field: PreferenceField): string {
  return value === null ? '' : field.endsWith('_pct') ? formatItemPercent(value).slice(0, -1) : String(value);
}
export function preferenceForm(profile: ItemPreferences | null): PreferenceForm {
  return Object.fromEntries(PREFERENCE_FIELDS.map(key => [key, preferenceText(profile?.[key] ?? null, key)])) as PreferenceForm;
}
export function buildPreferences(form: PreferenceForm): SaveItemPreferences {
  return Object.fromEntries(PREFERENCE_FIELDS.map(key => [key, parseItemNumber(form[key], key)])) as SaveItemPreferences;
}
export function isItemPreferences(value: unknown): value is ItemPreferences {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.updated_at === 'string' && Number.isFinite(Date.parse(record.updated_at)) &&
    PREFERENCE_FIELDS.every(key => record[key] === null || (typeof record[key] === 'number' && Number.isFinite(record[key]) && record[key] >= 0 &&
      record[key] <= (key.endsWith('_pct') ? 1 : key === 'hourly_value' ? 1000 : 1000000)));
}
// Apply once to untouched fields of a new find. Explicit blanks suppress app
// defaults; pickup/fixed fees remain ordinary per-find inputs, never defaults DTO fields.
export function applyItemPreferences(form: SavedItemForm, profile: ItemPreferences | null, touched: ReadonlySet<ItemFinancialInput>): SavedItemForm {
  if (!profile) return form;
  const next = { ...form, values: { ...form.values }, personalDefaults: { ...form.personalDefaults }, useDefault: { ...form.useDefault } };
  for (const key of PREFERENCE_FIELDS) {
    if (touched.has(key)) continue;
    const text = preferenceText(profile[key], key);
    next.values[key] = text;
    if (ITEM_PREFERENCES.includes(key as ItemPreference)) {
      const preference = key as ItemPreference;
      next.personalDefaults[preference] = text;
      next.useDefault[preference] = profile[key] !== null;
    }
  }
  return next;
}
