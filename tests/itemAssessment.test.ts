import test from "node:test";
import assert from "node:assert/strict";
import { buildAssessmentRequest, formatItemHeadlineMoney, itemDecision, newQuickItemForm, quickAssumptionsSummary, suggestedRepairTotal } from "../src/lib/itemAssessment.ts";
import { buildSavedItemInputs } from "../src/lib/savedItems.ts";
import type { ItemAnalyzeResponse, ItemAssessmentPhoto, ItemAssessmentResult } from "../src/lib/types.ts";

const photos: ItemAssessmentPhoto[] = [{ media_type: "image/jpeg", data: "fixture" }];
test("photo request leaves missing asking price omitted for extraction, preserves zero and rejects raw junk", () => {
  for (const blank of ["", "  "]) assert.equal(Object.hasOwn(buildAssessmentRequest("id", "They want $20", blank, photos), "asking_price"), false);
  assert.equal(buildAssessmentRequest("id", "Free chair", "0", photos).asking_price, 0);
  for (const bad of ["1e3", "12abc", "$1,200", "0x10", "-1", "Infinity"]) assert.throws(() => buildAssessmentRequest("id", "Chair", bad, photos));
});
test("photo request validates description and count without blocking ordinary emoji", () => {
  for (const text of ["x".repeat(501), "a\u0000b", "\ud800", "\udc00"]) assert.throws(() => buildAssessmentRequest("id", text, "", photos));
  assert.equal(buildAssessmentRequest("id", "Chair 🪑", "20", photos).description, "Chair 🪑");
  assert.doesNotThrow(() => buildAssessmentRequest("id", "x".repeat(500), "20", [...photos, ...photos, ...photos]));
  for (const set of [[], [...photos, ...photos, ...photos, ...photos]]) assert.throws(() => buildAssessmentRequest("id", "Chair", "", set));
});
test("quick preset is explicit and leaves unknown purchase, resale and repairs unknown", () => {
  const built = buildSavedItemInputs(newQuickItemForm());
  assert.equal(built.ok, true);
  if (!built.ok) throw Error("invalid preset");
  assert.equal(built.payload.target_profit, 30);
  assert.equal(built.payload.contingency_pct, .15);
  for (const key of ["pickup", "delivery", "storage", "fee_pct", "fee_fixed", "hours"] as const) assert.equal(built.payload[key], 0);
  for (const key of ["purchase_price", "resale_low", "resale_high", "repairs"] as const) assert.equal(built.payload[key], null);
});
test("quick editable percentages retain exact wire decimals", () => {
  for (const [percent, wire] of [["14.3", "0.143"], ["2.9", "0.029"], ["7.5", "0.075"]]) {
    const form = newQuickItemForm(); form.values.fee_pct = percent;
    const built = buildSavedItemInputs(form);
    assert.ok(built.ok);
    assert.equal(JSON.stringify(built.payload.fee_pct), wire);
  }
});
test("repair catalog cents sum without floating-point artifacts and empty suggestions total zero", () => {
  const report = { repair_suggestions: [{ materials_cost: .1 }, { materials_cost: .2 }, { materials_cost: 15.99 }] } as ItemAssessmentResult;
  assert.equal(suggestedRepairTotal(report), "16.29");
  assert.equal(suggestedRepairTotal({ repair_suggestions: [] } as unknown as ItemAssessmentResult), "0.00");
});
test("decision copy follows server status even when rounded ceiling equals asking price", () => {
  const result = { status: "skip", low: { max_offer: 100, raw_max_offer: 100.04 }, assumptions: { purchase_price: { value: 100.04 } } } as ItemAnalyzeResponse;
  assert.equal(itemDecision(result), "I'd pass at $100.04. Offer $100 or walk.");
  assert.equal(itemDecision({ ...result, status: "within_budget" }), "Good buy at $100.04.");
  assert.equal(itemDecision({ ...result, status: "stretch" }), "Offer up to $100.");
  assert.equal(itemDecision({ ...result, status: "offer_only" }), "Offer up to $100.");
  assert.equal(itemDecision({ ...result, status: "needs_info" }), "A couple of details first.");
});
test("negative offers stay negative in results and never become a positive buy headline", () => {
  const result = { status: "offer_only", low: { max_offer: -50 }, assumptions: { purchase_price: { value: null } } } as ItemAnalyzeResponse;
  assert.equal(itemDecision(result), "Even free is a tight flip.");
  assert.equal(itemDecision({ ...result, status: "stretch" }), "The profit is too tight at this price.");
  assert.equal(itemDecision({ ...result, status: "skip", assumptions: { purchase_price: { value: 60 } } } as ItemAnalyzeResponse), "I'd pass at $60. Even free misses your profit goal.");
  assert.equal(result.low?.max_offer, -50);
});
test("headline dollars omit only unnecessary cents, preserving fractional boundaries and money elsewhere", () => {
  assert.equal(formatItemHeadlineMoney(20), "$20");
  assert.equal(formatItemHeadlineMoney(20.01), "$20.01");
  assert.equal(formatItemHeadlineMoney(-50), "-$50");
  assert.equal(formatItemHeadlineMoney(0), "$0");
  assert.equal(formatItemHeadlineMoney(null), "Not available");
});
test("compact assumptions reflect changed goals and never describe edited costs as the preset", () => {
  const form = newQuickItemForm();
  assert.equal(quickAssumptionsSummary(form), "Assumes local pickup, no fees, $30 profit goal");
  form.values.target_profit = "40.50";
  assert.equal(quickAssumptionsSummary(form), "Assumes local pickup, no fees, $40.50 profit goal");
  form.values.fee_pct = "14.3";
  assert.equal(quickAssumptionsSummary(form), "Uses your entered costs, $40.50 profit goal");
  form.values.target_profit = "";
  assert.equal(quickAssumptionsSummary(form), "Uses your entered costs, profit goal unknown");
  form.values.target_profit = "1e3";
  assert.equal(quickAssumptionsSummary(form), "Check your costs and profit goal");
  form.useDefault.target_profit = true; form.personalDefaults.target_profit = "55";
  assert.equal(quickAssumptionsSummary(form), "Uses your entered costs, $55 profit goal");
});
