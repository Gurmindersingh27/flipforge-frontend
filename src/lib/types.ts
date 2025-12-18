export type Severity = "critical" | "moderate" | "mild";
export type Verdict = "BUY" | "CONDITIONAL" | "PASS";
export type Strategy = "flip" | "brrrr" | "wholesale";

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

  confidence_score: number;
  risk_flags: string[];
  typed_flags: RiskFlag[];
  stress_tests: StressTestScenario[];
  notes: string[];

  rent_to_cost_ratio?: number | null;
  assignment_spread?: number | null;
}
