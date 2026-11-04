import test from "node:test";
import assert from "node:assert/strict";
import { buildItemEvidenceCopy } from "../src/lib/itemEvidenceCopy.ts";
import type { BuyingFinancialResult } from "../src/lib/itemBuyingDecision.ts";
import type { ItemListingEvidence, ItemResaleEstimate } from "../src/lib/types.ts";

const row: ItemListingEvidence = {
  title: "Task chair", url: "https://example.org/chair/1", price: 240, currency: "USD", source: "example.org",
  condition: "Used", condition_type: "used", market: "local_pickup", location: "Brookhaven",
  retrieved_at: "2026-11-04", price_type: "asking", eligible: true, exclusion_reason: null,
  national_eligible: false, national_exclusion_reason: "not_shipped", price_basis: "item_only",
  supporting_quotes: ["Asking $240 for this chair.", " ", "Collect in Brookhaven."],
};
const range: ItemResaleEstimate = { low: 180, high: 220, eligible_count: 3, source: "online_asking_prices", method: "linear_quartiles_v1", label: "Range" };
const evidence = { item_name: "Chair", assessed_at: "2026-11-04T12:00:00Z", listings: [row], resale: null, national_resale: null };

test("copies each full seller excerpt next to its listing even before a calculation", () => {
  const more = "$600 for both. " + "x".repeat(245) + '\nListing 3. "Sample"';
  const copy = buildItemEvidenceCopy({ ...evidence, listings: [row, { ...row, title: "Two chairs", price: 600,
    url: "https://example.org/pair", eligible: false, exclusion_reason: "not_comparable", supporting_quotes: [more] }] }, null, null);
  const sections = copy.split("\nListing ");
  assert.equal(sections.length, 3);
  assert.match(sections[0], /Listings eligible for local pickup: 1 of 2/);
  assert.ok(sections[1].includes('Search excerpt 2 of 2: "Collect in Brookhaven."'));
  assert.ok(sections[2].includes(JSON.stringify(more)));
  assert.match(sections[2], /Local pickup: Excluded \(not comparable\)/);
  assert.ok(copy.endsWith("No buying limit is shown."));
});

test("keeps offered national references separate and preserves missing legacy evidence", () => {
  const historical = { ...row, url: "javascript:alert(1)", location: null, eligible: false,
    exclusion_reason: "legacy_reason", national_eligible: undefined, national_exclusion_reason: undefined,
    condition_type: undefined, price_basis: undefined, supporting_quotes: [] };
  const copy = buildItemEvidenceCopy({ ...evidence, listings: [historical], national_resale: range }, null, null);
  for (const line of ["Local pickup asking range: None", "National shipped reference: $180.00–$220.00 (3 listings)",
    "Prices verified by FlipForge: Not recorded", "National shipped: Not recorded", "No search excerpt recorded.",
    "Location: not recorded", "Link unavailable", "No buying limit is shown."]) assert.ok(copy.includes(line), line);
  assert.ok(!copy.includes("javascript:"));
  assert.match(buildItemEvidenceCopy({ ...evidence, national_resale: undefined }, null, null), /National shipped reference: Not recorded/);
});

test("combines original evidence with only the current calculation and confirmed resale source", () => {
  const values = { resale_low: 180, resale_high: 220, purchase_price: null, repairs: 5, pickup: 10,
    delivery: 0, storage: 0, hours: 2, hourly_value: 20, fee_pct: 0, fee_fixed: 0, contingency_pct: .15, target_profit: 30 };
  const scenario = { resale: 180, contingency: .75, selling_fees: 0, own_time_value: 40, raw_max_offer: 94.25,
    max_offer: 94, cash_left: null, profit_after_time: null, target_shortfall: null };
  const result: BuyingFinancialResult = { schema_version: 1, status: "offer_only", missing_inputs: [],
    assumptions: Object.fromEntries(Object.entries(values).map(([k, value]) => [k, { value, source: "user_entered", default_origin: null }])) as BuyingFinancialResult["assumptions"],
    low: scenario, high: { ...scenario, resale: 220, max_offer: 134, raw_max_offer: 134.25 } };
  const input = { ...evidence, national_resale: range };
  const copy = buildItemEvidenceCopy(input, result, "national_reference");
  for (const line of ["Local pickup asking range: None", "National used asking prices", "Pay no more than: $94",
    "Repairs and hired help: $5.00", "Pickup cost: $10.00", "Your time: 2 hours",
    "Value of your time per hour: $20.00", "Selling fee: 0%", "Profit goal after your time: $30.00"]) assert.ok(copy.includes(line), line);
  assert.match(buildItemEvidenceCopy(input, result, "user_estimate"), /Your sale estimate/);
  const incomplete = { ...result, status: "needs_info" as const, low: null, high: null };
  assert.doesNotMatch(buildItemEvidenceCopy(input, incomplete, "assessment"), /Pay no more than/);
  assert.doesNotMatch(buildItemEvidenceCopy(input, null, null), /\$94/);
});

test("empty evidence has zero eligible listings and never inherits a buying limit", () => {
  const copy = buildItemEvidenceCopy({ ...evidence, listings: [] }, null, null);
  assert.match(copy, /Listings eligible for local pickup: 0 of 0/);
  assert.doesNotMatch(copy, /Listing 1\.|Pay no more than/);
});
