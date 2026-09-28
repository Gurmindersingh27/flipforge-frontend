import type { SavedDeal } from "./types.ts";

type Format = "money" | "percent" | "months" | "verdict";
type Metric = {
  key: string;
  label: string;
  source: "result" | "draft" | "dataPoint";
  format: Format;
  assumption?: boolean;
};

const metrics: readonly Metric[] = [
  { key: "max_safe_offer", label: "Maximum safe offer", source: "result", format: "money" },
  { key: "net_profit", label: "Projected net profit", source: "result", format: "money" },
  { key: "overall_verdict", label: "Saved verdict", source: "result", format: "verdict" },
  { key: "annualized_roi", label: "Annualized ROI", source: "result", format: "percent" },
  { key: "total_project_cost", label: "Modeled project cost", source: "result", format: "money" },
  { key: "purchase_price", label: "Purchase price", source: "dataPoint", format: "money" },
  { key: "arv", label: "After-repair value", source: "dataPoint", format: "money" },
  { key: "rehab_budget", label: "Rehab budget", source: "dataPoint", format: "money" },
  { key: "est_monthly_rent", label: "Monthly rent (optional)", source: "dataPoint", format: "money" },
  { key: "holding_months", label: "Holding period", source: "draft", format: "months", assumption: true },
  { key: "annual_interest_rate", label: "Annual interest rate", source: "draft", format: "percent", assumption: true },
  { key: "loan_to_cost_pct", label: "Loan to cost", source: "draft", format: "percent", assumption: true },
  { key: "closing_cost_pct", label: "Closing costs", source: "draft", format: "percent", assumption: true },
  { key: "selling_cost_pct", label: "Selling costs", source: "draft", format: "percent", assumption: true },
  { key: "required_profit_margin_pct", label: "Required return on cost", source: "draft", format: "percent", assumption: true },
];

function valueFor(deal: SavedDeal, metric: Metric): number | string | null {
  let value = metric.source === "result" ? deal.analysis_result?.[metric.key] : deal.draft_input?.[metric.key];
  if (metric.source === "dataPoint") {
    value = value && typeof value === "object" && "value" in value ? value.value : null;
  }
  if (metric.format === "verdict") return value === "BUY" || value === "CONDITIONAL" || value === "PASS" ? value : null;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function display(value: number | string | null, format: Format): string {
  if (value === null) return "Not recorded";
  if (typeof value === "string") return value;
  if (format === "money") return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
  if (format === "percent") return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} months`;
}

export function savedDealName(deal: SavedDeal): string {
  const address = deal.address?.trim();
  const draftAddress = deal.draft_input?.address;
  return address || (typeof draftAddress === "string" && draftAddress.trim()) || `Untitled deal #${deal.id}`;
}

export function savedDealComparisonRows(deals: readonly SavedDeal[]) {
  return metrics.map(metric => {
    const values = deals.map(deal => valueFor(deal, metric));
    const missing = values.some(value => value === null);
    const different = new Set(values.filter(value => value !== null)).size > 1;
    return {
      key: metric.key,
      label: metric.label,
      cells: values.map(value => display(value, metric.format)),
      // Compare exact recorded values, never rounded display strings or guessed defaults.
      warning: metric.assumption && deals.length > 1
        ? [different ? "Different" : "", missing ? "Incomplete" : ""].filter(Boolean).join(" · ")
        : "",
    };
  });
}
