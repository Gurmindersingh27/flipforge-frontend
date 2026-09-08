import assert from "node:assert/strict";
import test from "node:test";

import {
  createDraftAnalysisSnapshot,
  createManualAnalysisSnapshot,
} from "../src/lib/analysisSnapshot.ts";
import type { AnalyzeRequest, DraftDeal } from "../src/lib/types.ts";

function manualRequest(
  overrides: Partial<AnalyzeRequest> = {}
): AnalyzeRequest {
  return {
    purchase_price: 150_000,
    arv: 270_000,
    rehab_budget: 50_000,
    closing_cost_pct: 0.03,
    selling_cost_pct: 0.08,
    holding_months: 6,
    annual_interest_rate: 0.1,
    loan_to_cost_pct: 0.9,
    required_profit_margin_pct: 0.12,
    est_monthly_rent: 1_800,
    region: "GA",
    ...overrides,
  };
}

function draftDeal(overrides: Partial<DraftDeal> = {}): DraftDeal {
  return {
    source: "opengraph",
    url: "https://example.com/original",
    address: "10 Original St, Atlanta, GA",
    zip_code: "30303",
    region: "GA",
    purchase_price: {
      value: 150_000,
      confidence: "MEDIUM",
      source: "listing",
      evidence: "$150,000",
    },
    arv: { value: 270_000, confidence: "LOW", source: "manual" },
    rehab_budget: { value: 50_000, confidence: "HIGH", source: "manual" },
    est_monthly_rent: { value: 1_800, confidence: "MEDIUM", source: "rentcast" },
    closing_cost_pct: 0.03,
    selling_cost_pct: 0.08,
    holding_months: 6,
    annual_interest_rate: 0.1,
    loan_to_cost_pct: 0.9,
    required_profit_margin_pct: 0.12,
    notes: ["Original note"],
    signals: ["Original signal"],
    ...overrides,
  };
}

test("manual snapshot records its source", () => {
  assert.equal(createManualAnalysisSnapshot(manualRequest()).source, "manual");
});

test("manual snapshot captures all three required deal values", () => {
  const snapshot = createManualAnalysisSnapshot(manualRequest());
  assert.deepEqual(
    [snapshot.meta.purchase_price, snapshot.meta.arv, snapshot.meta.rehab_budget],
    [150_000, 270_000, 50_000]
  );
});

test("manual snapshot converts decimal controls to display percentages", () => {
  const snapshot = createManualAnalysisSnapshot(manualRequest());
  assert.deepEqual(
    [
      snapshot.meta.closing_cost_pct,
      snapshot.meta.selling_cost_pct,
      snapshot.meta.interest_rate_pct,
      snapshot.meta.ltc_pct,
      snapshot.meta.required_profit_margin_pct,
    ],
    [3, 8, 10, 90, 12]
  );
});

test("manual snapshot preserves holding months", () => {
  assert.equal(
    createManualAnalysisSnapshot(manualRequest({ holding_months: 11 })).meta
      .holding_months,
    11
  );
});

test("manual snapshot preserves a positive rent", () => {
  assert.equal(
    createManualAnalysisSnapshot(manualRequest({ est_monthly_rent: 2_125 })).meta
      .est_monthly_rent,
    2_125
  );
});

test("manual snapshot normalizes zero rent to omitted", () => {
  assert.equal(
    createManualAnalysisSnapshot(manualRequest({ est_monthly_rent: 0 })).meta
      .est_monthly_rent,
    null
  );
});

test("manual snapshot normalizes negative rent to omitted", () => {
  assert.equal(
    createManualAnalysisSnapshot(manualRequest({ est_monthly_rent: -1 })).meta
      .est_monthly_rent,
    null
  );
});

test("manual snapshot marks omitted rent as missing", () => {
  const snapshot = createManualAnalysisSnapshot(
    manualRequest({ est_monthly_rent: null })
  );
  assert.equal(snapshot.draftInput.est_monthly_rent.confidence, "MISSING");
  assert.equal(snapshot.draftInput.est_monthly_rent.source, null);
});

test("manual snapshot uses backend defaults when optional controls are absent", () => {
  const snapshot = createManualAnalysisSnapshot({
    purchase_price: 150_000,
    arv: 270_000,
    rehab_budget: 50_000,
  });
  assert.deepEqual(
    [
      snapshot.draftInput.closing_cost_pct,
      snapshot.draftInput.selling_cost_pct,
      snapshot.draftInput.holding_months,
      snapshot.draftInput.annual_interest_rate,
      snapshot.draftInput.loan_to_cost_pct,
      snapshot.draftInput.required_profit_margin_pct,
    ],
    [0.03, 0.08, 6, 0.1, 0.9, 0.12]
  );
});

test("manual snapshot trims identity fields", () => {
  const snapshot = createManualAnalysisSnapshot(manualRequest(), {
    listingUrl: "  https://example.com/deal  ",
    propertyAddress: "  2190 Addison Pl NW  ",
  });
  assert.equal(snapshot.meta.listing_url, "https://example.com/deal");
  assert.equal(snapshot.meta.property_address, "2190 Addison Pl NW");
});

test("manual snapshot persists a complete resumable draft", () => {
  const snapshot = createManualAnalysisSnapshot(manualRequest(), {
    propertyAddress: "2190 Addison Pl NW",
  });
  assert.equal(snapshot.draftInput.source, "manual");
  assert.equal(snapshot.draftInput.address, "2190 Addison Pl NW");
  assert.equal(snapshot.draftInput.purchase_price.confidence, "HIGH");
  assert.equal(snapshot.draftInput.region, "GA");
});

test("draft snapshot records its source", () => {
  assert.equal(createDraftAnalysisSnapshot(draftDeal()).source, "draft");
});

test("draft snapshot preserves data-point confidence and evidence", () => {
  const snapshot = createDraftAnalysisSnapshot(draftDeal());
  assert.equal(snapshot.draftInput.purchase_price.confidence, "MEDIUM");
  assert.equal(snapshot.draftInput.purchase_price.evidence, "$150,000");
});

test("draft snapshot preserves a positive rent", () => {
  assert.equal(
    createDraftAnalysisSnapshot(draftDeal()).draftInput.est_monthly_rent.value,
    1_800
  );
});

test("draft snapshot normalizes zero rent in both memo and saved draft", () => {
  const draft = draftDeal({
    est_monthly_rent: { value: 0, confidence: "HIGH", source: "manual" },
  });
  const snapshot = createDraftAnalysisSnapshot(draft);
  assert.equal(snapshot.meta.est_monthly_rent, null);
  assert.equal(snapshot.draftInput.est_monthly_rent.value, null);
});

test("draft snapshot normalizes negative rent in both memo and saved draft", () => {
  const draft = draftDeal({
    est_monthly_rent: { value: -500, confidence: "HIGH", source: "manual" },
  });
  const snapshot = createDraftAnalysisSnapshot(draft);
  assert.equal(snapshot.meta.est_monthly_rent, null);
  assert.equal(snapshot.draftInput.est_monthly_rent.value, null);
});

test("draft identity overrides scraped address and URL", () => {
  const snapshot = createDraftAnalysisSnapshot(draftDeal(), {
    listingUrl: "https://example.com/verified",
    propertyAddress: "20 Verified Ave, Atlanta, GA",
  });
  assert.equal(snapshot.draftInput.url, "https://example.com/verified");
  assert.equal(snapshot.draftInput.address, "20 Verified Ave, Atlanta, GA");
});

test("blank draft identity falls back to draft address and URL", () => {
  const snapshot = createDraftAnalysisSnapshot(draftDeal(), {
    listingUrl: "   ",
    propertyAddress: "   ",
  });
  assert.equal(snapshot.meta.listing_url, "https://example.com/original");
  assert.equal(snapshot.meta.property_address, "10 Original St, Atlanta, GA");
});

test("draft snapshot captures every underwriting control", () => {
  const snapshot = createDraftAnalysisSnapshot(
    draftDeal({
      closing_cost_pct: 0.05,
      selling_cost_pct: 0.1,
      holding_months: 12,
      annual_interest_rate: 0.14,
      loan_to_cost_pct: 0.7,
      required_profit_margin_pct: 0.15,
    })
  );
  assert.deepEqual(
    [
      snapshot.meta.closing_cost_pct,
      snapshot.meta.selling_cost_pct,
      snapshot.meta.holding_months,
      snapshot.meta.ltc_pct,
      snapshot.meta.required_profit_margin_pct,
    ],
    [5, 10, 12, 70, 15]
  );
  assert.ok(Math.abs(snapshot.meta.interest_rate_pct - 14) < Number.EPSILON * 10);
});

test("draft mutations after analysis cannot change snapshot values", () => {
  const draft = draftDeal();
  const snapshot = createDraftAnalysisSnapshot(draft);
  draft.purchase_price.value = 999_999;
  draft.holding_months = 24;
  draft.notes.push("Later note");
  assert.equal(snapshot.meta.purchase_price, 150_000);
  assert.equal(snapshot.meta.holding_months, 6);
  assert.deepEqual(snapshot.draftInput.notes, ["Original note"]);
});

test("manual and draft snapshots remain isolated", () => {
  const draftSnapshot = createDraftAnalysisSnapshot(draftDeal());
  const manualSnapshot = createManualAnalysisSnapshot(
    manualRequest({ purchase_price: 90_000 })
  );
  assert.equal(draftSnapshot.meta.purchase_price, 150_000);
  assert.equal(manualSnapshot.meta.purchase_price, 90_000);
  assert.equal(draftSnapshot.source, "draft");
  assert.equal(manualSnapshot.source, "manual");
});

test("snapshots are frozen through memo, draft, arrays, and data points", () => {
  const snapshot = createDraftAnalysisSnapshot(draftDeal());
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.meta), true);
  assert.equal(Object.isFrozen(snapshot.draftInput), true);
  assert.equal(Object.isFrozen(snapshot.draftInput.purchase_price), true);
  assert.equal(Object.isFrozen(snapshot.draftInput.notes), true);
});
