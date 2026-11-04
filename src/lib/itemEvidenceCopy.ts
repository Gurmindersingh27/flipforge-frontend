import { formatItemMoney } from "./itemAnalysis.ts";
import { verifiedPriceCount } from "./itemAssessment.ts";
import { buildBuyingSummary } from "./itemBuyingDecision.ts";
import type { BuyingFinancialResult, BuyingResaleSource } from "./itemBuyingDecision.ts";
import { safeItemLink } from "./savedItems.ts";
import type { ItemAssessmentResult, ItemResaleEstimate } from "./types.ts";

type Evidence = Pick<ItemAssessmentResult, "item_name" | "assessed_at" | "listings" | "resale" | "national_resale">;

function rangeText(range: ItemResaleEstimate | null | undefined) {
  if (range === undefined) return "Not recorded";
  if (range === null) return "None";
  return `${formatItemMoney(range.low)}–${formatItemMoney(range.high)} (${range.eligible_count} listings)`;
}

function eligibility(eligible: boolean | undefined, reason: string | null | undefined) {
  if (eligible === undefined) return "Not recorded";
  if (eligible) return "Eligible";
  return `Excluded (${reason?.replaceAll("_", " ") || "reason unavailable"})`;
}

export function buildItemEvidenceCopy(evidence: Evidence, result: BuyingFinancialResult | null, source: BuyingResaleSource) {
  const lines = [
    `FlipForge price evidence — ${evidence.item_name}`,
    `Assessed ${evidence.assessed_at}`,
    `Local pickup asking range: ${rangeText(evidence.resale)}`,
    `National shipped reference: ${rangeText(evidence.national_resale)}`,
    `Prices verified by FlipForge: ${verifiedPriceCount(evidence.listings) ?? "Not recorded"}`,
    `Listings eligible for local pickup: ${evidence.listings.filter(row => row.eligible).length} of ${evidence.listings.length}`,
    "Location and condition below come from the assessment. Check the seller’s excerpts for the item price and pickup or shipping terms.",
  ];
  for (const [index, row] of evidence.listings.entries()) {
    lines.push("", `Listing ${index + 1}. ${row.title}`,
      `Source: ${row.source} · ${safeItemLink(row.url) ?? "Link unavailable"}`,
      `Listed price: ${formatItemMoney(row.price)}`,
      `Condition: ${row.condition} · Classification: ${row.condition_type ?? "not recorded"}`,
      `Market: ${row.market?.replaceAll("_", " ") ?? "not recorded"} · Location: ${row.location || "not recorded"}`,
      `Price basis: ${row.price_basis?.replaceAll("_", " ") ?? "not recorded"}`,
      `Local pickup: ${eligibility(row.eligible, row.exclusion_reason)}`,
      `National shipped: ${eligibility(row.national_eligible, row.national_exclusion_reason)}`);
    const quotes = row.supporting_quotes?.filter(quote => quote.trim()) ?? [];
    if (!quotes.length) lines.push("No search excerpt recorded.");
    quotes.forEach((quote, i) => lines.push(`Search excerpt ${i + 1} of ${quotes.length}: ${JSON.stringify(quote)}`));
  }
  const summary = result && buildBuyingSummary(result, source);
  lines.push("", "Current calculation", summary || "No buying limit is shown.");
  return lines.join("\n");
}
