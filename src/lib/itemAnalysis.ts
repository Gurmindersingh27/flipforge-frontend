import type { ItemAnalyzeRequest, ItemFinancialInput, ItemPersonalDefaults, ItemPreference, ItemStatus } from "./types.ts";

export const ITEM_LABELS: Record<ItemFinancialInput, string> = {
  purchase_price: "Purchase price, including fees or tax",
  resale_low: "Low resale estimate", resale_high: "High resale estimate",
  repairs: "Repairs and hired repair labor", pickup: "Pickup cost", delivery: "Delivery cost",
  storage: "Storage cost", fee_fixed: "Fixed selling fee", hours: "Your total hours",
  hourly_value: "Value of your time per hour", target_profit: "Profit target after your time",
  contingency_pct: "Repair contingency (%)", fee_pct: "Selling fee (%)",
};
export const ITEM_FIELDS = Object.keys(ITEM_LABELS) as ItemFinancialInput[];
export const ITEM_PREFERENCES: ItemPreference[] = ["hourly_value", "target_profit", "contingency_pct", "fee_pct"];
export const ITEM_STATUS_TEXT: Record<ItemStatus, { title: string; explanation: string }> = {
  needs_info: { title: "More information needed", explanation: "Fill in the missing assumptions below to calculate your offers." },
  offer_only: { title: "Offers only", explanation: "Add an all-in purchase price to see cash left and profit after your time." },
  within_budget: { title: "Within your target budget", explanation: "At this purchase price, your profit target is met using the low resale estimate." },
  stretch: { title: "Needs a stronger sale", explanation: "Your profit target is missed at low resale, but met if it sells well." },
  skip: { title: "Above your target budget", explanation: "At this purchase price, your profit target is missed even if it sells well. That does not necessarily mean a cash loss." },
};
export interface ItemForm {
  item_name: string;
  category: string;
  values: Record<ItemFinancialInput, string>;
  useDefault: Record<ItemPreference, boolean>;
  personalDefaults: Record<ItemPreference, string>;
}
export function emptyItemForm(): ItemForm {
  return {
    item_name: "", category: "",
    values: Object.fromEntries(ITEM_FIELDS.map(field => [field, ""])) as ItemForm["values"],
    useDefault: { hourly_value: true, contingency_pct: true, fee_pct: false, target_profit: false },
    personalDefaults: { hourly_value: "", contingency_pct: "", fee_pct: "", target_profit: "" },
  };
}

// Validate the text before Number: no exponent, hex, separators, signs or partial parse.
// Percent entry is shifted as text, not divided in binary floating-point arithmetic.
export function parseItemNumber(raw: string, field: ItemFinancialInput): number | null {
  const text = raw.trim();
  if (!text) return null;
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    throw new Error("Use a non-negative plain number without $, commas, exponents or other text.");
  }
  const [integer = "", fraction = ""] = text.split(".");
  const whole = integer.replace(/^0+/, "") || "0";
  const percent = field === "fee_pct" || field === "contingency_pct";
  const limit = percent ? "100" : field === "hours" ? "10000" : field === "hourly_value" ? "1000" : "1000000";
  if (whole.length > limit.length || (whole.length === limit.length && whole > limit)
      || (whole === limit && /[1-9]/.test(fraction))) {
    throw new Error(`Must be between 0 and ${limit}${percent ? "%" : ""}.`);
  }
  const places = percent ? 4 : field === "hours" ? 2 : null;
  if (places !== null && fraction.length > places) throw new Error(`Use at most ${places} decimal places.`);
  const padded = whole.padStart(3, "0");
  const canonical = percent
    ? `${padded.slice(0, -2)}.${padded.slice(-2)}${fraction}`
    : `${whole}.${fraction || "0"}`;
  const number = Number(canonical);
  if (!Number.isFinite(number)) throw new Error("Enter a finite number.");
  return number;
}

export function hasPersonalDefault(form: ItemForm, field: ItemPreference): boolean {
  try { return parseItemNumber(form.personalDefaults[field], field) !== null; }
  catch { return false; }
}
export function buildItemRequest(form: ItemForm):
  { ok: true; payload: ItemAnalyzeRequest } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const payload: ItemAnalyzeRequest = { item_name: form.item_name.trim() || null, category: form.category.trim() || null };
  if (form.item_name.length > 200) errors.item_name = "Use at most 200 characters.";
  if (form.category.length > 100) errors.category = "Use at most 100 characters.";
  const personal: ItemPersonalDefaults = {};
  for (const field of ITEM_PREFERENCES) {
    try {
      const value = parseItemNumber(form.personalDefaults[field], field);
      if (value !== null) personal[field] = value;
    } catch (error) { errors[`personal_${field}`] = (error as Error).message; }
  }
  if (Object.keys(personal).length) payload.personal_defaults = personal;
  for (const field of ITEM_FIELDS) {
    if (ITEM_PREFERENCES.includes(field as ItemPreference) && form.useDefault[field as ItemPreference]) {
      // Fee/target have no application default. A removed personal default must
      // not silently keep a hidden inherited mode active.
      if ((field === "fee_pct" || field === "target_profit") && personal[field] === undefined) {
        payload[field] = null;
      }
      continue;
    }
    try { payload[field] = parseItemNumber(form.values[field], field); }
    catch (error) { errors[field] = (error as Error).message; }
  }
  if (payload.resale_low != null && payload.resale_high != null && payload.resale_low > payload.resale_high) {
    errors.resale_high = "High resale must be at least the low resale estimate.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, payload };
}

// Items-only display. Offers are already integers; all other money shows cents.
export function formatItemMoney(value: number | null, offer = false): string {
  if (value === null) return "Not available";
  const clean = Math.abs(value) < (offer ? 0.5 : 0.005) ? 0 : value;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: offer ? 0 : 2, maximumFractionDigits: offer ? 0 : 2,
  }).format(clean);
}
export function formatItemPercent(value: number): string {
  // Display-only shift, preserving all six fractional places in the wire value.
  const [whole, fraction = ""] = value.toFixed(6).split(".");
  const percent = `${whole}${fraction.slice(0, 2)}`.replace(/^0+(?=\d)/, "");
  const remainder = fraction.slice(2).replace(/0+$/, "");
  return `${percent}${remainder ? `.${remainder}` : ""}%`;
}
