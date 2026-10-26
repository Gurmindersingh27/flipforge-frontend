import test from "node:test";
import assert from "node:assert/strict";
import { buildBuyingSummary, buyingFieldTarget, buyingMissingTargets, buyingResaleLabel } from "../src/lib/itemBuyingDecision.ts";
import type { BuyingFinancialResult } from "../src/lib/itemBuyingDecision.ts";
import type { ItemFinancialInput } from "../src/lib/types.ts";

function result(): BuyingFinancialResult {
  const values: Record<ItemFinancialInput, number | null> = { purchase_price: 40, resale_low: 200, resale_high: 250,
    repairs: 10, pickup: 5, delivery: 0, storage: 0, fee_fixed: 2, fee_pct: .029,
    hours: 2, hourly_value: 20, target_profit: 30, contingency_pct: .143 };
  return { schema_version: 1, status: "within_budget", missing_inputs: [],
    assumptions: Object.fromEntries(Object.entries(values).map(([field, value]) => [field, { value, source: "user_entered", default_origin: null }])) as BuyingFinancialResult["assumptions"],
    // Deliberately distinct amounts: the summary must reproduce the server, not
    // calculate its own profit or substitute profit at the maximum ceiling.
    low: { resale: 200, contingency: 1.43, selling_fees: 7.8, own_time_value: 40, raw_max_offer: 115.77, max_offer: 115,
      cash_left: 135.77, profit_after_time: 95.77, target_shortfall: 0 },
    high: { resale: 250, contingency: 1.43, selling_fees: 9.25, own_time_value: 40, raw_max_offer: 164.32, max_offer: 164,
      cash_left: 184.32, profit_after_time: 144.32, target_shortfall: 0 } };
}

test("financial navigation maps explicitly and deduplicates resale only when its input exists", () => {
  assert.deepEqual(buyingFieldTarget("repairs", true), { id: "quick-repairs", inCosts: false });
  assert.deepEqual(buyingFieldTarget("target_profit", true), { id: "quick-target_profit", inCosts: true });
  assert.deepEqual(buyingMissingTargets(["resale_low", "resale_high", "repairs", "target_profit"], true), [
    { field: "resale_low", target: { id: "quick-resale_low", inCosts: false } },
    { field: "repairs", target: { id: "quick-repairs", inCosts: false } },
    { field: "target_profit", target: { id: "quick-target_profit", inCosts: true } },
  ]);
  assert.deepEqual(buyingMissingTargets(["resale_low", "resale_high"], false), [
    { field: "resale_low", target: null }, { field: "resale_high", target: null },
  ]);
  for (const field of ["notes", "listing_url", "item_name", "category", "personal_fee_pct", "toString", "__proto__"]) {
    assert.equal(buyingFieldTarget(field, true), null);
    assert.deepEqual(buyingMissingTargets([field], true), [{ field, target: null }]);
  }
  const target = buyingFieldTarget("pickup", true)!; target.id = "changed";
  assert.equal(buyingFieldTarget("pickup", true)?.id, "quick-pickup", "Callers cannot mutate the shared map");
});

test("summary uses exact server amounts and explicitly bases profit on the entered purchase price", () => {
  const current = result();
  const original = structuredClone(current);
  const text = buildBuyingSummary(current, "assessment");
  for (const expected of ["Pay no more than: $115", "Including buyer fees and tax.", "Low sale estimate: $200.00", "High sale estimate: $250.00",
    "Sale prices: online listings, not confirmed sales.", "Profit goal after your time: $30.00", "entered purchase price of $40.00, including buyer fees and tax",
    "Cash left at low sale estimate: $135.77", "Profit after your time at low sale estimate: $95.77", "Profit after your time if it sells for $250.00: $144.32",
    "Selling fee: 2.9%", "Repair buffer: 14.3%", "Repair buffer at low sale estimate: $1.43", "Your time value: $40.00",
    "Estimates, not confirmed sale proceeds."]) assert.ok(text.includes(expected), expected);
  assert.equal(text.includes("profit at $115"), false);
  assert.deepEqual(current, original);
});

test("summary provenance is explicit and never inferred from a stored number", () => {
  assert.ok(buildBuyingSummary(result(), "user_estimate").includes("Your sale estimate, not a confirmed sale price."));
  assert.equal(buildBuyingSummary(result(), "user_estimate").includes("Sale prices: online listings"), false);
  assert.equal(buyingResaleLabel(null), "Sale assumptions used for this calculation; source not recorded.");
  assert.ok(buildBuyingSummary(result(), null).includes(buyingResaleLabel(null)));
  assert.equal(buildBuyingSummary(result(), null).includes("Your sale estimate"), false);
});

test("zero ceiling and explicit zero remain real values; null assumptions never become zero", () => {
  const current = result(); current.low!.max_offer = 0;
  current.assumptions.pickup.value = null; current.assumptions.fee_pct.value = null;
  current.assumptions.delivery.value = 0;
  const text = buildBuyingSummary(current, "user_estimate");
  assert.ok(text.includes("Pay no more than: $0\n"));
  assert.ok(text.includes("Pickup cost: Unknown"));
  assert.ok(text.includes("Selling fee: Unknown"));
  assert.ok(text.includes("Delivery cost: $0.00"));
});

test("negative ceiling leads with an even-free warning and is never an actionable seller price", () => {
  const current = result(); current.status = "skip"; current.low!.max_offer = -50;
  current.low!.cash_left = 10; current.low!.profit_after_time = -30;
  const text = buildBuyingSummary(current, "assessment");
  assert.ok(text.startsWith("FlipForge buying summary\nEven free misses your profit goal."));
  assert.ok(text.includes("Calculated ceiling: -$50. This is not a price to offer the seller."));
  assert.equal(text.includes("Pay no more than"), false);
  assert.ok(text.includes("That doesn't necessarily mean a cash loss."));
  current.low!.cash_left = -1;
  assert.ok(buildBuyingSummary(current, "assessment").includes("At their price, you'd likely lose money."));
});

test("offer-only never includes purchase-price-dependent figures even if a fixture supplies them", () => {
  const current = result(); current.status = "offer_only"; current.assumptions.purchase_price.value = null;
  const text = buildBuyingSummary(current, "user_estimate");
  assert.ok(text.includes("Pay no more than: $115"));
  assert.ok(text.includes("Add an asking price to see how much you'd keep."));
  assert.ok(text.includes("Purchase-price-dependent cash and profit figures are unavailable."));
  assert.ok(text.includes("If it sells well, the offer ceiling is $164."));
  for (const excluded of ["$135.77", "$95.77", "$144.32", "entered purchase price of", "Cash left at low sale estimate:"]) assert.equal(text.includes(excluded), false, excluded);
});

test("no-time summary uses cash figures and incomplete results produce no buying recommendation", () => {
  const current = result(); current.assumptions.hours.value = 0;
  const text = buildBuyingSummary(current, "assessment");
  assert.ok(text.includes("Cash left at low sale estimate: $135.77"));
  assert.ok(text.includes("Cash left if it sells for $250.00: $184.32"));
  assert.equal(text.includes("Profit after your time at low sale estimate:"), false);
  assert.equal(buildBuyingSummary({ ...current, status: "needs_info", missing_inputs: ["repairs"] }, null), "");
  assert.equal(buildBuyingSummary({ ...current, low: null }, null), "");
  assert.equal(buildBuyingSummary({ ...current, high: null }, null), "");
});

test("summary excludes identity, private data and assessment prose even on an over-rich runtime object", () => {
  const current = { ...result(), assumptions: { ...result().assumptions, item_name: { value: "UNCONFIRMED_BRAND_ERA", source: "user_entered", default_origin: null }, category: { value: "UNCONFIRMED_MATERIAL", source: "user_entered", default_origin: null } }, item_name: "UNCONFIRMED_BRAND_ERA", notes: "PRIVATE_NEGOTIATION", listing_url: "https://private.example/source",
    location: "PRIVATE_LOCATION", photos: ["PRIVATE_PHOTO"], account: "PRIVATE_ACCOUNT", repair_unknowns: ["UNCONFIRMED_DEFECT"] };
  const text = buildBuyingSummary(current, null);
  for (const secret of ["UNCONFIRMED_BRAND_ERA", "UNCONFIRMED_MATERIAL", "PRIVATE_NEGOTIATION", "https://private.example/source", "PRIVATE_LOCATION", "PRIVATE_PHOTO", "PRIVATE_ACCOUNT", "UNCONFIRMED_DEFECT"]) assert.equal(text.includes(secret), false);
});
