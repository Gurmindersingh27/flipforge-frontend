import { formatItemMoney, formatItemPercent, ITEM_STATUS_TEXT } from "./itemAnalysis.ts";
import type { ItemAnalyzeResponse, ItemAssumption, ItemAssessmentConfirmation, ItemFinancialInput } from "./types.ts";

export type BuyingResaleSource = ItemAssessmentConfirmation["resale_source"] | null;
export type BuyingFinancialResult = Omit<ItemAnalyzeResponse, "assumptions"> & {
  assumptions: Record<ItemFinancialInput, ItemAssumption>;
};
export interface BuyingFieldTarget { id: string; inCosts: boolean }

const FIELD_TARGETS: Record<ItemFinancialInput, BuyingFieldTarget> = {
  purchase_price: { id: "quick-purchase_price", inCosts: false },
  resale_low: { id: "quick-resale_low", inCosts: false },
  resale_high: { id: "quick-resale_low", inCosts: false },
  repairs: { id: "quick-repairs", inCosts: false },
  target_profit: { id: "quick-target_profit", inCosts: true },
  pickup: { id: "quick-pickup", inCosts: true },
  delivery: { id: "quick-delivery", inCosts: true },
  storage: { id: "quick-storage", inCosts: true },
  hours: { id: "quick-hours", inCosts: true },
  hourly_value: { id: "quick-hourly_value", inCosts: true },
  fee_pct: { id: "quick-fee_pct", inCosts: true },
  fee_fixed: { id: "quick-fee_fixed", inCosts: true },
  contingency_pct: { id: "quick-contingency_pct", inCosts: true },
};

// Mapping only: the server and existing form builder still decide what is missing.
export function buyingFieldTarget(field: string, ownResale: boolean, resaleRange = false): BuyingFieldTarget | null {
  if (!Object.hasOwn(FIELD_TARGETS, field)) return null;
  if (!ownResale && (field === "resale_low" || field === "resale_high")) return null;
  if (resaleRange && field === "resale_high") return { id: "quick-resale_high", inCosts: false };
  return { ...FIELD_TARGETS[field as ItemFinancialInput] };
}

export function buyingMissingTargets(fields: readonly string[], ownResale: boolean, resaleRange = false): { field: string; target: BuyingFieldTarget | null }[] {
  const seen = new Set<string>();
  return fields.flatMap(field => {
    const target = buyingFieldTarget(field, ownResale, resaleRange);
    if (target && seen.has(target.id)) return [];
    if (target) seen.add(target.id);
    return [{ field, target }];
  });
}

export function buyingResaleLabel(source: BuyingResaleSource): string {
  if (source === "national_reference") return "National used asking prices; shipping excluded. Not confirmed sales. Local prices and condition may differ.";
  if (source === "assessment") return "Sale prices: online listings, not confirmed sales.";
  if (source === "user_estimate") return "Your sale estimate, not a confirmed sale price.";
  return "Sale assumptions used for this calculation; source not recorded.";
}

function assumptionText(field: ItemFinancialInput, value: number | null): string {
  if (value === null) return "Unknown";
  if (field === "hours") return `${value} hours`;
  if (field === "fee_pct" || field === "contingency_pct") return formatItemPercent(value);
  return formatItemMoney(value);
}

// Only financial result fields and explicit provenance are accepted. No saved
// record, assessment prose, item identity, notes, URLs or location is inspected.
export function buildBuyingSummary(result: BuyingFinancialResult, source: BuyingResaleSource): string {
  const { low, high, assumptions } = result;
  if (result.status === "needs_info" || !low || !high) return "";
  const negative = low.max_offer < 0;
  const noTime = assumptions.hours.value === 0;
  const purchase = assumptions.purchase_price.value;
  const lines = [
    "FlipForge buying summary",
    negative ? "Even free misses your profit goal." : `Pay no more than: ${formatItemMoney(low.max_offer, true)}`,
    negative ? `Calculated ceiling: ${formatItemMoney(low.max_offer, true)}. This is not a price to offer the seller.` : "Including buyer fees and tax.",
    `Status: ${ITEM_STATUS_TEXT[result.status].title}`,
    `Low sale estimate: ${formatItemMoney(low.resale)}`,
    `High sale estimate: ${formatItemMoney(high.resale)}`,
    buyingResaleLabel(source),
    `Profit goal after your time: ${assumptionText("target_profit", assumptions.target_profit.value)}`,
  ];
  if (result.status === "skip") {
    lines.push(`It misses your profit goal even if it sells well. ${low.cash_left !== null && low.cash_left < 0 ? "At their price, you'd likely lose money." : "That doesn't necessarily mean a cash loss."}`);
  } else if (result.status === "stretch") {
    lines.push("At their price, you'd need a stronger sale to meet your goal.");
  }
  if (result.status === "offer_only" || purchase === null) {
    lines.push("Add an asking price to see how much you'd keep.", "Purchase-price-dependent cash and profit figures are unavailable.",
      `If it sells well, the offer ceiling is ${formatItemMoney(high.max_offer, true)}.`);
  } else {
    lines.push(`Cash and profit assume buying at the entered purchase price of ${formatItemMoney(purchase)}, including buyer fees and tax.`,
      `Cash left at low sale estimate: ${formatItemMoney(low.cash_left)}`);
    if (!noTime) lines.push(`Profit after your time at low sale estimate: ${formatItemMoney(low.profit_after_time)}`);
    if (high.resale !== low.resale) lines.push(noTime
      ? `Cash left if it sells for ${formatItemMoney(high.resale)}: ${formatItemMoney(high.cash_left)}`
      : `Profit after your time if it sells for ${formatItemMoney(high.resale)}: ${formatItemMoney(high.profit_after_time)}`);
  }
  lines.push("", "Effective cost assumptions:");
  const costs: [ItemFinancialInput, string][] = [
    ["repairs", "Repairs and hired help"], ["pickup", "Pickup cost"], ["delivery", "Delivery cost"],
    ["storage", "Storage cost"], ["hours", "Your time"], ["hourly_value", "Value of your time per hour"],
    ["fee_pct", "Selling fee"], ["fee_fixed", "Fixed selling fee"], ["contingency_pct", "Repair buffer"],
  ];
  for (const [field, label] of costs) lines.push(`${label}: ${assumptionText(field, assumptions[field].value)}`);
  lines.push(`Repair buffer at low sale estimate: ${formatItemMoney(low.contingency)}`,
    `Selling fees at low sale estimate: ${formatItemMoney(low.selling_fees)}`,
    `Your time value: ${formatItemMoney(low.own_time_value)}`,
    "", "Estimates, not confirmed sale proceeds. Before income tax and costs not entered. Check the item in person; this is a budget, not an inspection.");
  return lines.join("\n");
}
