export type Severity = "critical" | "moderate" | "mild";
export type Verdict = "BUY" | "CONDITIONAL" | "PASS";
export type Strategy = "flip" | "brrrr" | "wholesale";

export type RehabSeverity = "LIGHT" | "MEDIUM" | "HEAVY" | "EXTREME";

export interface RehabReality {
  rehab_ratio: number;
  severity: RehabSeverity;
  contingency_pct: number;
  added_holding_months: number;
  confidence_penalty: number;
}

export type BreakpointReason =
  | "NEGATIVE_PROFIT"
  | "BELOW_MARGIN"
  | "VERDICT_FAIL";

export interface Breakpoints {
  first_break_scenario: string | null;
  break_reason: BreakpointReason | null;
  is_fragile: boolean;
}

export interface RiskFlag {
  code: string;
  label: string;
  severity: Severity;
}

export interface StressTestScenario {
  name: string;
  arv: number;
  rehab_budget: number;
  holding_months: number;
  net_profit: number;
  profit_pct: number;
  annualized_roi: number;
  verdict: Verdict;
}

export interface AnalyzeRequest {
  purchase_price: number;
  arv: number;
  rehab_budget: number;

  closing_cost_pct?: number;
  selling_cost_pct?: number;
  holding_months?: number;

  annual_interest_rate?: number;
  loan_to_cost_pct?: number;
  required_profit_margin_pct?: number;

  est_monthly_rent?: number | null;
  region?: string | null;
}

export interface AnalyzeResponse {
  total_project_cost: number;
  gross_profit: number;
  net_profit: number;
  profit_pct: number;
  annualized_roi: number;
  max_safe_offer: number;

  flip_score: number;
  brrrr_score: number;
  wholesale_score: number;
  best_strategy: Strategy;
  overall_verdict: Verdict;
  flip_verdict: Verdict;
  brrrr_verdict: Verdict;
  wholesale_verdict: Verdict;

  // Rehab Reality (v1)
  rehab_reality: RehabReality;

  // Breakpoints (v1)
  breakpoints: Breakpoints;

  confidence_score: number;
  risk_flags: string[];
  typed_flags: RiskFlag[];
  stress_tests: StressTestScenario[];
  notes: string[];

  rent_to_cost_ratio?: number | null;
  assignment_spread?: number | null;

  // optional newer stuff (won't break old UI)
  verdict_reason?: string;
  allowed_outputs?: Record<string, boolean>;
  narratives?: Record<string, unknown> | null;
}

// =========================================================
// Phase 2 — Draft Deal (URL Extraction + Editor)
// =========================================================

export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "MISSING";

export interface DataPoint<T = number> {
  value: T | null;
  confidence: Confidence;
  source?: string | null;
  evidence?: string | null;
}

/**
 * DraftDeal returned by /api/draft-from-url (wrapped in { draft: DraftDeal }).
 * Best-effort extraction with confidence metadata.
 */
export interface DraftDeal {
  source: string; // "manual" | "opengraph" | "SOURCE_BLOCKED" | etc
  url?: string | null;

  // optional identity
  address?: string | null;
  zip_code?: string | null;
  region?: string | null;

  // required to analyze
  purchase_price: DataPoint<number>;
  arv: DataPoint<number>;
  rehab_budget: DataPoint<number>;

  // optional helper
  est_monthly_rent: DataPoint<number>;

  // assumptions (plain numbers w/ backend defaults)
  closing_cost_pct: number;
  selling_cost_pct: number;
  holding_months: number;
  annual_interest_rate: number;
  loan_to_cost_pct: number;
  required_profit_margin_pct: number;

  // transparency
  notes: string[];
  signals: string[];
}

export interface DraftFromUrlResponse {
  draft: DraftDeal;
}

export interface DraftFinalizeError {
  error: "MISSING_REQUIRED_FIELDS";
  missing_fields: string[];
}

// =========================================================
// Phase 3 — Negotiation Script
// =========================================================

export interface NegotiationScriptRequest {
  result: AnalyzeResponse;
  seller_ask_price?: number | null;
  property_address?: string | null;
  buyer_name?: string | null;
  seller_name?: string | null;
}

export interface NegotiationScriptResponse {
  negotiation_script: string;
}

// =========================================================
// Saved Deals — persistence layer
// =========================================================

export interface SaveDealRequest {
  address?: string | null;
  draft_input?: Record<string, unknown> | null;
  analysis_result: Record<string, unknown>;
}

export interface SavedDeal {
  id: number;
  user_id: string;
  address?: string | null;
  draft_input?: Record<string, unknown> | null;
  analysis_result: Record<string, unknown>;
  created_at: string; // ISO 8601
}

// =========================================================
// Address Enrichment — RentCast passthrough
// =========================================================

export interface PropertyFacts {
  formatted_address: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  square_footage: number | null;
  lot_size: number | null;
  year_built: number | null;
  last_sale_date: string | null;
  last_sale_price: number | null;
}

export interface ValueSignal {
  estimate: number | null;
  low: number | null;
  high: number | null;
}

export interface RentSignal {
  estimate: number | null;
  low: number | null;
  high: number | null;
}

export type ProviderStatus =
  | "cache_hit"
  | "live_success"
  | "quota_exhausted"
  | "provider_unavailable";

export interface EnrichAddressResponse {
  property_facts: PropertyFacts;
  value_signal: ValueSignal;
  rent_signal: RentSignal;
  from_cache?: boolean;
  cached_at?: string | null;
  provider_status?: ProviderStatus;
  provider_error?: string | null;
}
