import { buildItemRequest, emptyItemForm, formatItemPercent, ITEM_FIELDS, ITEM_PREFERENCES } from "./itemAnalysis.ts";
import type { ItemForm } from "./itemAnalysis.ts";
import type { ItemAnalyzeRequest, ItemPreference, SaveItemRequest } from "./types.ts";

// One editable form, never a retained request plus an overlay of edits.
// Literal empty strings are legal saved text and differ from null in assumptions.
export interface SavedItemForm extends ItemForm {
  literalEmptyText: { item_name: boolean; category: boolean };
}
export function newSavedItemForm(): SavedItemForm {
  return { ...emptyItemForm(), literalEmptyText: { item_name: false, category: false } };
}
export function restoreItemForm(inputs: ItemAnalyzeRequest): SavedItemForm {
  const form = newSavedItemForm();
  for (const field of ["item_name", "category"] as const) {
    form[field] = inputs[field] ?? "";
    form.literalEmptyText[field] = inputs[field] === "";
  }
  for (const field of ITEM_PREFERENCES) {
    const value = inputs.personal_defaults?.[field];
    form.personalDefaults[field] = value == null ? "" : field.endsWith("_pct") ? formatItemPercent(value).slice(0, -1) : String(value);
  }
  for (const field of ITEM_FIELDS) {
    const value = inputs[field];
    form.values[field] = value == null ? "" : field.endsWith("_pct") ? formatItemPercent(value).slice(0, -1) : String(value);
    if (ITEM_PREFERENCES.includes(field as ItemPreference)) {
      const preference = field as ItemPreference;
      const personal = inputs.personal_defaults?.[preference];
      const hasPersonal = inputs.personal_defaults != null && Object.hasOwn(inputs.personal_defaults, preference);
      // Explicit item null blocks personal defaults, too. A null personal value
      // blocks the application fallback; represent its effective unknown as blank/off.
      form.useDefault[preference] = !Object.hasOwn(inputs, field)
        && (hasPersonal ? personal != null : field === "hourly_value" || field === "contingency_pct");
    }
  }
  return form;
}
export function buildSavedItemInputs(form: SavedItemForm) {
  const built = buildItemRequest(form);
  if (built.ok) {
    for (const field of ["item_name", "category"] as const) {
      built.payload[field] = form[field] !== "" || form.literalEmptyText[field] ? form[field] : null;
    }
  }
  return built;
}

export function safeItemLink(raw: string | null): string | null {
  if (!raw || raw.length > 2048 || [...raw].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127 || char === "\\")) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function buildItemSave(form: SavedItemForm, notes: string, listingUrl: string, parentId: number | null):
  { ok: true; payload: SaveItemRequest } | { ok: false; errors: Record<string, string> } {
  const built = buildSavedItemInputs(form);
  const errors: Record<string, string> = built.ok ? {} : { ...built.errors };
  for (const [field, value] of Object.entries({ notes, item_name: form.item_name, category: form.category })) {
    if (value.includes("\u0000")) errors[field] = "Remove the invisible NUL character before saving.";
  }
  if (notes.length > 5000) errors.notes = "Use at most 5,000 characters.";
  const link = listingUrl.trim();
  if (listingUrl.length > 2048 || [...listingUrl].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) || (link && !safeItemLink(link))) {
    errors.listing_url = "Use an absolute http or https link, without credentials or control characters, up to 2,048 characters.";
  }
  if (parentId !== null && (!Number.isSafeInteger(parentId) || parentId <= 0)) errors.parent_item_id = "Invalid saved item.";
  if (!built.ok || Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, payload: { inputs: built.payload, notes: notes || null, listing_url: link || null, parent_item_id: parentId } };
}
