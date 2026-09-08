import type { AnalyzeRequest, DraftDeal } from "./types";

const DEFAULTS = {
  closingCostPct: 0.03,
  sellingCostPct: 0.08,
  holdingMonths: 6,
  annualInterestRate: 0.1,
  loanToCostPct: 0.9,
  requiredProfitMarginPct: 0.12,
} as const;

export interface AnalysisIdentity {
  listingUrl?: string | null;
  propertyAddress?: string | null;
}

export interface AnalysisMeta {
  listing_url: string | null;
  property_address: string | null;
  purchase_price: number | null;
  arv: number | null;
  rehab_budget: number | null;
  est_monthly_rent: number | null;
  closing_cost_pct: number;
  selling_cost_pct: number;
  holding_months: number;
  interest_rate_pct: number;
  ltc_pct: number;
  required_profit_margin_pct: number;
  photo_rehab_mid?: number | null;
}

export interface AnalysisSnapshot {
  readonly source: "manual" | "draft";
  readonly meta: Readonly<AnalysisMeta>;
  readonly draftInput: Readonly<DraftDeal>;
}

function cleanText(value: string | null | undefined): string | null {
  const cleaned = value?.trim();
  return cleaned ? cleaned : null;
}

function positiveRent(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function numberOrDefault(
  value: number | null | undefined,
  fallback: number
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function freezeDraft(draft: DraftDeal): Readonly<DraftDeal> {
  Object.freeze(draft.purchase_price);
  Object.freeze(draft.arv);
  Object.freeze(draft.rehab_budget);
  Object.freeze(draft.est_monthly_rent);
  Object.freeze(draft.notes);
  Object.freeze(draft.signals);
  return Object.freeze(draft);
}

function snapshotFromDraft(
  source: AnalysisSnapshot["source"],
  sourceDraft: DraftDeal,
  identity: AnalysisIdentity
): AnalysisSnapshot {
  const listingUrl = cleanText(identity.listingUrl) ?? cleanText(sourceDraft.url);
  const propertyAddress =
    cleanText(identity.propertyAddress) ?? cleanText(sourceDraft.address);

  const draftInput: DraftDeal = {
    ...sourceDraft,
    url: listingUrl,
    address: propertyAddress,
    purchase_price: { ...sourceDraft.purchase_price },
    arv: { ...sourceDraft.arv },
    rehab_budget: { ...sourceDraft.rehab_budget },
    est_monthly_rent: {
      ...sourceDraft.est_monthly_rent,
      value: positiveRent(sourceDraft.est_monthly_rent.value),
    },
    closing_cost_pct: numberOrDefault(
      sourceDraft.closing_cost_pct,
      DEFAULTS.closingCostPct
    ),
    selling_cost_pct: numberOrDefault(
      sourceDraft.selling_cost_pct,
      DEFAULTS.sellingCostPct
    ),
    holding_months: numberOrDefault(
      sourceDraft.holding_months,
      DEFAULTS.holdingMonths
    ),
    annual_interest_rate: numberOrDefault(
      sourceDraft.annual_interest_rate,
      DEFAULTS.annualInterestRate
    ),
    loan_to_cost_pct: numberOrDefault(
      sourceDraft.loan_to_cost_pct,
      DEFAULTS.loanToCostPct
    ),
    required_profit_margin_pct: numberOrDefault(
      sourceDraft.required_profit_margin_pct,
      DEFAULTS.requiredProfitMarginPct
    ),
    notes: [...(sourceDraft.notes ?? [])],
    signals: [...(sourceDraft.signals ?? [])],
  };

  const meta: AnalysisMeta = {
    listing_url: listingUrl,
    property_address: propertyAddress,
    purchase_price: draftInput.purchase_price.value,
    arv: draftInput.arv.value,
    rehab_budget: draftInput.rehab_budget.value,
    est_monthly_rent: draftInput.est_monthly_rent.value,
    closing_cost_pct: draftInput.closing_cost_pct * 100,
    selling_cost_pct: draftInput.selling_cost_pct * 100,
    holding_months: draftInput.holding_months,
    interest_rate_pct: draftInput.annual_interest_rate * 100,
    ltc_pct: draftInput.loan_to_cost_pct * 100,
    required_profit_margin_pct: draftInput.required_profit_margin_pct * 100,
  };

  return Object.freeze({
    source,
    meta: Object.freeze(meta),
    draftInput: freezeDraft(draftInput),
  });
}

export function createDraftAnalysisSnapshot(
  draft: DraftDeal,
  identity: AnalysisIdentity = {}
): AnalysisSnapshot {
  return snapshotFromDraft("draft", draft, identity);
}

export function createManualAnalysisSnapshot(
  request: AnalyzeRequest,
  identity: AnalysisIdentity = {}
): AnalysisSnapshot {
  const rent = positiveRent(request.est_monthly_rent);
  const draft: DraftDeal = {
    source: "manual",
    url: cleanText(identity.listingUrl),
    address: cleanText(identity.propertyAddress),
    zip_code: null,
    region: cleanText(request.region),
    purchase_price: {
      value: request.purchase_price,
      confidence: "HIGH",
      source: "manual",
    },
    arv: {
      value: request.arv,
      confidence: "HIGH",
      source: "manual",
    },
    rehab_budget: {
      value: request.rehab_budget,
      confidence: "HIGH",
      source: "manual",
    },
    est_monthly_rent: {
      value: rent,
      confidence: rent === null ? "MISSING" : "HIGH",
      source: rent === null ? null : "manual",
    },
    closing_cost_pct: numberOrDefault(
      request.closing_cost_pct,
      DEFAULTS.closingCostPct
    ),
    selling_cost_pct: numberOrDefault(
      request.selling_cost_pct,
      DEFAULTS.sellingCostPct
    ),
    holding_months: numberOrDefault(
      request.holding_months,
      DEFAULTS.holdingMonths
    ),
    annual_interest_rate: numberOrDefault(
      request.annual_interest_rate,
      DEFAULTS.annualInterestRate
    ),
    loan_to_cost_pct: numberOrDefault(
      request.loan_to_cost_pct,
      DEFAULTS.loanToCostPct
    ),
    required_profit_margin_pct: numberOrDefault(
      request.required_profit_margin_pct,
      DEFAULTS.requiredProfitMarginPct
    ),
    notes: [],
    signals: [],
  };

  return snapshotFromDraft("manual", draft, identity);
}
