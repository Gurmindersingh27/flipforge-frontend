import { formatItemMoney, formatItemPercent, ITEM_FIELDS, ITEM_LABELS, ITEM_STATUS_TEXT } from "./itemAnalysis.ts";
import type { ItemAssumption, SavedItem } from "./types.ts";

type Unit = "money" | "offer" | "percent" | "hours" | "text";
export interface ComparisonRow {
  key: string;
  label: string;
  previous: string;
  current: string;
  previousSource?: string;
  currentSource?: string;
  changed: boolean;
  difference: string | null;
}
function display(value: number | string | null, unit: Unit): string {
  if (value === null) return "Unknown";
  if (typeof value === "string") return value === "" ? "Empty" : value;
  if (unit === "percent") return formatItemPercent(value);
  if (unit === "hours") return `${Number(value.toFixed(2))} hours`;
  return formatItemMoney(value, unit === "offer");
}
function source(assumption: ItemAssumption<number | string>): string {
  if (assumption.value === null) return "Unknown";
  if (assumption.source === "user_entered") return "You entered";
  if (assumption.source === "default") return assumption.default_origin === "personal" ? "Personal default"
    : assumption.default_origin === "application" ? "App default" : "Default (origin unknown)";
  return "Unknown";
}
function row(key: string, label: string, previous: number | string | null, current: number | string | null, unit: Unit,
  previousSource?: string, currentSource?: string): ComparisonRow {
  let difference: string | null = null;
  if (typeof previous === "number" && typeof current === "number" && current !== previous) {
    const delta = current - previous;
    difference = `${delta > 0 ? "+" : "−"}${display(Math.abs(delta), unit)}`;
  }
  return { key, label, previous: display(previous, unit), current: display(current, unit), previousSource, currentSource,
    changed: previous !== current || previousSource !== currentSource, difference };
}
export function compareItemVersions(previous: SavedItem, current: SavedItem) {
  const a = previous.analysis_result, b = current.analysis_result;
  const assumptions = (["item_name", "category", ...ITEM_FIELDS] as const).map(field => {
    const old = a.assumptions[field], next = b.assumptions[field];
    return row(field, field === "item_name" ? "Item name" : field === "category" ? "Category" : ITEM_LABELS[field],
      old.value, next.value, field.endsWith("_pct") ? "percent" : field === "hours" ? "hours" : "money", source(old), source(next));
  });
  const status = row("status", "Saved status", ITEM_STATUS_TEXT[a.status].title, ITEM_STATUS_TEXT[b.status].title, "text");
  const scenarios = (["low", "high"] as const).map(side => ({
    key: side, label: side === "low" ? "Low resale estimate" : "High resale estimate",
    previousNegative: (a[side]?.max_offer ?? 0) < 0,
    currentNegative: (b[side]?.max_offer ?? 0) < 0,
    rows: (["max_offer", "cash_left", "profit_after_time"] as const).map(field => row(`${side}.${field}`,
      field === "max_offer" ? "Most you should pay, including fees or tax" : field === "cash_left" ? "Cash left" : "Profit after your time",
      a[side]?.[field] ?? null, b[side]?.[field] ?? null, field === "max_offer" ? "offer" : "money")),
  }));
  const metadata = [row("notes", "Notes", previous.notes, current.notes, "text"),
    row("listing_url", "Listing link", previous.listing_url, current.listing_url, "text")];
  const estimateChanged = [status, ...assumptions, ...scenarios.flatMap(s => s.rows)].some(r => r.changed);
  return { assumptions, status, scenarios, metadata,
    onlyNotesOrLink: !estimateChanged && metadata.some(r => r.changed) };
}
