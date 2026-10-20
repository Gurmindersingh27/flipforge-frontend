import type { ItemOutcomeDate, ItemOutcomeFacts, ItemOutcomeField, ItemOutcomeFigure, ItemOutcomeNumber,
  ItemOutcomeResponse, ItemOutcomeStatus, ItemSaleChannel } from "./types.ts";

export const OUTCOME_EXPENSES = ["materials", "hired_labor", "pickup", "delivery", "storage", "selling_fees", "other_expenses"] as const;
export const OUTCOME_NUMBERS = ["purchase_price", ...OUTCOME_EXPENSES, "hours", "hourly_value", "sale_price"] as const;
export const OUTCOME_DATES = ["purchased_on", "listed_on", "sold_on"] as const;
export const OUTCOME_STATUSES: ItemOutcomeStatus[] = ["bought", "listed", "sold"];
export const OUTCOME_CHANNELS: Record<ItemSaleChannel, string> = {
  facebook_marketplace: "Facebook Marketplace", craigslist: "Craigslist", offerup: "OfferUp",
  ebay: "eBay", in_person: "In person", other: "Other",
};
export const OUTCOME_LABELS: Record<ItemOutcomeField | "sale_channel", string> = {
  status: "Sold status", purchase_price: "Purchase price, including tax and fees", materials: "Materials",
  hired_labor: "Hired labor", pickup: "Pickup", delivery: "Delivery", storage: "Storage",
  selling_fees: "Selling fees", other_expenses: "Other expenses", hours: "Your hours", hourly_value: "Value of your time per hour",
  sale_price: "Sale price, before selling fees", sale_channel: "Sale channel", purchased_on: "Purchase date", listed_on: "Listing date", sold_on: "Sale date",
};
export const OUTCOME_FIGURES: Record<ItemOutcomeFigure, string> = {
  cash_invested: "Cash invested", cash_profit: "Cash profit", profit_after_time: "Profit after your time",
  days_to_sell: "Days to sell", days_held: "Days held",
};
export type OutcomeForm = Record<ItemOutcomeNumber | ItemOutcomeDate, string> & {
  status: ItemOutcomeStatus; sale_channel: ItemSaleChannel | "";
};
export function outcomeForm(facts?: ItemOutcomeFacts): OutcomeForm {
  return {
    ...Object.fromEntries([...OUTCOME_NUMBERS, ...OUTCOME_DATES].map(key => [key, facts?.[key] == null ? "" : String(facts[key])])),
    status: facts?.status ?? "bought", sale_channel: facts?.sale_channel ?? "",
  } as OutcomeForm;
}
export function validOutcomeDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export function outcomeFieldsToClear(form: OutcomeForm, status: ItemOutcomeStatus): (keyof OutcomeForm)[] {
  const fields: (keyof OutcomeForm)[] = status === "sold" ? [] : ["sale_price", "sale_channel", "sold_on"];
  if (status === "bought") fields.push("listed_on");
  return fields.filter(key => form[key] !== "");
}
export function buildOutcomeFacts(form: OutcomeForm): { ok: true; facts: ItemOutcomeFacts } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const facts = { status: form.status, sale_channel: form.sale_channel || null } as ItemOutcomeFacts;
  if (!OUTCOME_STATUSES.includes(form.status)) errors.status = "Choose Bought, Listed or Sold.";
  if (form.sale_channel && !Object.hasOwn(OUTCOME_CHANNELS, form.sale_channel)) errors.sale_channel = "Choose a sale channel from the list.";
  for (const key of OUTCOME_NUMBERS) {
    const raw = form[key].trim();
    const value = raw === "" ? null : Number(raw);
    const maximum = key === "hours" ? 10_000 : key === "hourly_value" ? 1_000 : 1_000_000;
    if (value !== null && (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw) || !Number.isFinite(value) || value < 0 || value > maximum)) {
      errors[key] = `Enter a number from 0 to ${maximum.toLocaleString("en-US")}, or leave blank.`;
    } else if (key === "hours" && /\.\d{2}\d*[1-9]\d*$/.test(raw)) errors[key] = "Use at most two decimal places for hours.";
    facts[key] = value;
  }
  for (const key of OUTCOME_DATES) {
    const raw = form[key].trim();
    if (raw && !validOutcomeDate(raw)) errors[key] = "Enter a valid date (YYYY-MM-DD).";
    facts[key] = raw || null;
  }
  for (const key of outcomeFieldsToClear(form, form.status)) errors[key] = `${OUTCOME_LABELS[key]} does not apply to this status.`;
  for (const [first, last] of [["purchased_on", "listed_on"], ["listed_on", "sold_on"], ["purchased_on", "sold_on"]] as const) {
    if (facts[first] && facts[last] && facts[first] > facts[last]) errors[last] = `${OUTCOME_LABELS[last]} must be on or after ${OUTCOME_LABELS[first].toLowerCase()}.`;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, facts };
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const uuid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const positiveId = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
// Do not turn malformed confirmations into editable state or a confirmed save.
export function isItemOutcome(value: unknown, rootId: number): value is ItemOutcomeResponse {
  if (!record(value) || !uuid(value.id) || value.root_item_id !== rootId || value.schema_version !== 1
    || !positiveId(value.revision_number) || !(value.previous_id === null || uuid(value.previous_id))
    || !(value.based_on_item_id === null || positiveId(value.based_on_item_id))
    || typeof value.created_at !== "string" || !Number.isFinite(Date.parse(value.created_at))
    || !record(value.inputs) || !record(value.calculated)) return false;
  const facts = value.inputs;
  if (!OUTCOME_STATUSES.includes(facts.status as ItemOutcomeStatus)
    || !(facts.sale_channel === null || typeof facts.sale_channel === "string" && Object.hasOwn(OUTCOME_CHANNELS, facts.sale_channel))) return false;
  for (const key of OUTCOME_NUMBERS) if (!(facts[key] === null || typeof facts[key] === "number" && Number.isFinite(facts[key]) && facts[key] >= 0)) return false;
  for (const key of OUTCOME_DATES) if (!(facts[key] === null || validOutcomeDate(facts[key]))) return false;
  if (!buildOutcomeFacts(outcomeForm(facts as ItemOutcomeFacts)).ok) return false;
  const figures = value.calculated;
  if (!record(figures.missing_fields)) return false;
  for (const key of Object.keys(OUTCOME_FIGURES)) {
    const figure = figures[key];
    if (!(figure === null || typeof figure === "number" && Number.isFinite(figure))) return false;
    if (key.startsWith("days_") && figure !== null && (!Number.isSafeInteger(figure) || (figure as number) < 0)) return false;
    const missing = figures.missing_fields[key];
    if (!Array.isArray(missing) || !missing.every(field => field === "status" || [...OUTCOME_NUMBERS, ...OUTCOME_DATES].includes(field))) return false;
    if ((figure === null) !== (missing.length > 0)) return false;
  }
  return true;
}
export function outcomeIsUncertain(previouslyUncertain: boolean, unconfirmed: boolean, status?: number): boolean {
  return unconfirmed || previouslyUncertain && ![404, 409, 422].includes(status ?? 0);
}
