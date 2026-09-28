import assert from "node:assert/strict";
import test from "node:test";
import { savedDealComparisonRows, savedDealName } from "../src/lib/savedDealComparison.ts";
import type { SavedDeal } from "../src/lib/types.ts";

function deal(id = 1): SavedDeal {
  return {
    id, user_id: "fixture", created_at: "2026-09-24T19:07:51Z",
    draft_input: {
      address: "10 Example St", purchase_price: { value: 150000 }, arv: { value: 270000 },
      rehab_budget: { value: 50000 }, est_monthly_rent: { value: null },
      holding_months: 6, annual_interest_rate: 0.1, loan_to_cost_pct: 0.9,
      closing_cost_pct: 0.03, selling_cost_pct: 0.08, required_profit_margin_pct: 0.12,
    },
    analysis_result: { max_safe_offer: 155600, net_profit: 34900, overall_verdict: "BUY", annualized_roi: 0.2968949383241174, total_project_cost: 235100 },
  };
}
const row = (deals: SavedDeal[], key: string) => savedDealComparisonRows(deals).find(value => value.key === key)!;

test("comparison keeps selected order and displays saved economics without recalculation or mutation", () => {
  const first = deal(), second = deal(2);
  second.analysis_result.net_profit = 17135;
  second.analysis_result.max_safe_offer = 139000;
  second.analysis_result.overall_verdict = "CONDITIONAL";
  const before = structuredClone([second, first]);
  assert.deepEqual(row([second, first], "net_profit").cells, ["$17,135", "$34,900"]);
  assert.deepEqual(row([second, first], "max_safe_offer").cells, ["$139,000", "$155,600"]);
  assert.deepEqual(row([second, first], "overall_verdict").cells, ["CONDITIONAL", "BUY"]);
  assert.deepEqual([second, first], before);
  assert.ok(savedDealComparisonRows([first, deal(3)]).every(value => !value.warning));
});

test("legacy missing assumptions are incomplete, never filled with current defaults", () => {
  const legacy = deal(2);
  legacy.draft_input = null;
  assert.deepEqual(row([deal(), legacy], "holding_months").cells, ["6 months", "Not recorded"]);
  assert.equal(row([deal(), legacy], "holding_months").warning, "Incomplete");
  assert.equal(row([legacy, { ...legacy, id: 3 }], "annual_interest_rate").warning, "Incomplete");
  assert.equal(row([deal(), legacy], "est_monthly_rent").warning, "");
});

test("different financing, costs, timing and required returns are each disclosed", () => {
  const first = deal(), second = deal(2);
  Object.assign(second.draft_input!, { holding_months: 8, annual_interest_rate: 0.14, loan_to_cost_pct: 0.8, closing_cost_pct: 0.04, selling_cost_pct: 0.09, required_profit_margin_pct: 0.15 });
  assert.deepEqual(savedDealComparisonRows([first, second]).filter(value => value.warning).map(value => value.key), ["holding_months", "annual_interest_rate", "loan_to_cost_pct", "closing_cost_pct", "selling_cost_pct", "required_profit_margin_pct"]);
  const missing = { ...deal(3), draft_input: null };
  assert.equal(row([first, second, missing], "holding_months").warning, "Different · Incomplete");
});

test("differences smaller than display precision still warn", () => {
  const first = deal(), second = deal(2);
  second.draft_input!.annual_interest_rate = 0.100001;
  const rate = row([first, second], "annual_interest_rate");
  assert.deepEqual(rate.cells, ["10%", "10%"]);
  assert.equal(rate.warning, "Different");
});

test("missing, malformed and non-finite data never become plausible financial values", () => {
  const broken = deal();
  Object.assign(broken.analysis_result, { max_safe_offer: Infinity, net_profit: "34900", overall_verdict: "APPROVED", annualized_roi: NaN });
  Object.assign(broken.draft_input!, { purchase_price: "150000", arv: { value: "270000" }, rehab_budget: {}, holding_months: "6" });
  for (const key of ["max_safe_offer", "net_profit", "overall_verdict", "annualized_roi", "purchase_price", "arv", "rehab_budget", "holding_months"]) {
    assert.deepEqual(row([broken], key).cells, ["Not recorded"]);
  }
});

test("zero and negative saved numbers remain visible and cents are not discarded", () => {
  const zero = deal();
  Object.assign(zero.analysis_result, { net_profit: -1234.56, max_safe_offer: 0, annualized_roi: -0.035 });
  zero.draft_input!.annual_interest_rate = 0;
  assert.deepEqual(row([zero], "net_profit").cells, ["-$1,234.56"]);
  assert.deepEqual(row([zero], "max_safe_offer").cells, ["$0"]);
  assert.deepEqual(row([zero], "annualized_roi").cells, ["-3.5%"]);
  assert.deepEqual(row([zero], "annual_interest_rate").cells, ["0%"]);
  zero.analysis_result.net_profit = -1234;
  assert.deepEqual(row([zero], "net_profit").cells, ["-$1,234"]);
  zero.analysis_result.net_profit = 1234.5;
  assert.deepEqual(row([zero], "net_profit").cells, ["$1,234.50"]);
});

test("identity uses saved address, draft fallback, then version-specific untitled label", () => {
  const item = deal();
  item.address = "  20 Saved St  ";
  assert.equal(savedDealName(item), "20 Saved St");
  item.address = "  ";
  assert.equal(savedDealName(item), "10 Example St");
  item.draft_input!.address = " ";
  assert.equal(savedDealName(item), "Untitled deal #1");
});
