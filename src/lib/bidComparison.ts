import type { RehabScopeItem, SavedDeal } from "./types.ts";
import { lineTotal, scopeError, scopeTotals } from "./rehabScope.ts";

const itemFields = ["category", "description", "quantity", "unit", "unit_cost", "basis", "source", "quote_date", "notes"] as const;
const verdicts = new Set(["BUY", "CONDITIONAL", "PASS"]);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown) => typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
const amount = (items: RehabScopeItem[]) => items.reduce((cents, item) => cents + Math.round(lineTotal(item) * 100), 0) / 100;

function point(deal: SavedDeal, key: string): unknown {
  const value = deal.draft_input?.[key];
  return value && typeof value === "object" && "value" in value ? value.value : undefined;
}

function assumptions(deal: SavedDeal): { label: string; value: number | string | null | undefined }[] {
  const rent = point(deal, "est_monthly_rent");
  return [
    { label: "Property address", value: text(deal.address ?? deal.draft_input?.address).toLowerCase() },
    { label: "Listing URL", value: text(deal.draft_input?.url) },
    { label: "Region", value: text(deal.draft_input?.region).toLowerCase() },
    ...[["purchase_price", "Purchase price"], ["arv", "ARV"]].map(([key, label]) => {
      const value = point(deal, key);
      return { label, value: finite(value) && value > 0 ? value : undefined };
    }),
    ...[
      ["closing_cost_pct", "Closing costs"], ["selling_cost_pct", "Selling costs"],
      ["holding_months", "Holding months"], ["annual_interest_rate", "Interest rate"],
      ["loan_to_cost_pct", "Loan to cost"], ["required_profit_margin_pct", "Required return"],
    ].map(([key, label]) => {
      const value = deal.draft_input?.[key];
      return { label, value: finite(value) ? value : undefined };
    }),
    // The existing engine omits non-positive rent. Never fill missing required assumptions with guesses.
    { label: "Monthly rent", value: rent == null ? null : finite(rent) ? (rent > 0 ? rent : null) : undefined },
  ];
}

export function bidCandidates(baseline: SavedDeal, deals: SavedDeal[]): SavedDeal[] {
  return [...new Map(deals.filter(deal => deal.id !== baseline.id && deal.user_id === baseline.user_id
    && deal.parent_deal_id === baseline.id && deal.rehab_scope?.items.some(item => item.basis === "quote"))
    .map(deal => [deal.id, deal])).values()].sort((a, b) => b.id - a.id);
}

export function resolveBidBaseline(context: SavedDeal, deals: SavedDeal[], previous: SavedDeal | null = null): SavedDeal | null {
  // Any saved revision can become a baseline. Its quoted children take precedence over its own parent.
  if (bidCandidates(context, deals).length || !context.parent_deal_id
    || !context.rehab_scope?.items.some(item => item.basis === "quote")) return context;
  return [...deals, ...(previous ? [previous] : [])].find(deal => deal.id === context.parent_deal_id
    && deal.user_id === context.user_id) ?? null;
}

function carriedAllowance(item: RehabScopeItem, baseline: SavedDeal) {
  const prior = baseline.rehab_scope?.items.find(previous => previous.id === item.id);
  return item.basis === "quote" && prior?.basis === "allowance" && lineTotal(item) === lineTotal(prior) ? prior : null;
}

function amountChecks(deal: SavedDeal, baseline: SavedDeal, label: string, confirmed: string[]) {
  return (deal.rehab_scope?.items ?? []).flatMap(item => {
    const prior = carriedAllowance(item, baseline);
    if (!prior) return [];
    // The acknowledgement applies only to this exact saved line and baseline, never a later edit.
    const key = JSON.stringify([baseline.id, baseline.user_id, deal.id, deal.user_id, prior, item]);
    return [{ key, label, dealId: deal.id, item, amount: lineTotal(item), confirmed: confirmed.includes(key) }];
  });
}

function unchanged(item: RehabScopeItem, baseline: SavedDeal): boolean {
  const prior = baseline.rehab_scope?.items.find(previous => previous.id === item.id);
  return !!prior && itemFields.every(field => prior[field] === item[field]);
}

function summary(deal: SavedDeal, baseline: SavedDeal) {
  const items = deal.rehab_scope!.items;
  const retained = items.filter(item => unchanged(item, baseline));
  const changed = items.filter(item => !unchanged(item, baseline));
  const totals = scopeTotals(deal.rehab_scope!);
  const stressTests = deal.analysis_result.stress_tests;
  const stress = Array.isArray(stressTests) ? stressTests.find(row => row?.name === "Rehab +15%") : null;
  return {
    retained: amount(retained), quoted: amount(changed.filter(item => item.basis === "quote")),
    allowances: amount(changed.filter(item => item.basis === "allowance")),
    ...totals, contingencyPct: deal.rehab_scope!.contingency_pct,
    maxOffer: deal.analysis_result.max_safe_offer as number,
    netProfit: deal.analysis_result.net_profit as number,
    verdict: deal.analysis_result.overall_verdict as string,
    stress: stress && finite(stress.net_profit) && verdicts.has(stress.verdict)
      ? { netProfit: stress.net_profit as number, verdict: stress.verdict as string } : null,
  };
}

export function compareBidOptions(baseline: SavedDeal, left: SavedDeal, right: SavedDeal, confirmedAmounts: string[] = []) {
  const issues: string[] = [];
  const checks = [...amountChecks(left, baseline, "Bid A", confirmedAmounts), ...amountChecks(right, baseline, "Bid B", confirmedAmounts)];
  if (left.id === right.id) issues.push("Choose two different saved bids.");
  if ([left, right].some(deal => deal.id === baseline.id || deal.parent_deal_id !== baseline.id)) {
    issues.push("Both bids must be saved directly from this same baseline.");
  }
  if (!baseline.user_id || [left, right].some(deal => deal.user_id !== baseline.user_id)) {
    issues.push("Both bids and their baseline must belong to the same owner.");
  }
  for (const [label, deal] of [["Baseline", baseline], ["Bid A", left], ["Bid B", right]] as const) {
    const budget = point(deal, "rehab_budget");
    if (!finite(budget) || budget < 0) issues.push(`${label}: saved rehab budget is unavailable.`);
    try {
      if (!deal.rehab_scope) issues.push(`${label}: save an itemized scope before comparing bids.`);
      else {
        const error = scopeError(deal.rehab_scope, finite(budget) ? budget : undefined);
        if (error) issues.push(`${label}: ${error}`);
        if (label !== "Baseline" && !deal.rehab_scope.items.some(item => item.basis === "quote" && !unchanged(item, baseline)
          && !checks.some(check => check.dealId === deal.id && check.item.id === item.id && !check.confirmed))) {
          issues.push(`${label}: record the new or changed contractor quote lines.`);
        }
      }
    } catch {
      issues.push(`${label}: the saved scope is incomplete or invalid.`);
    }
    if (label !== "Baseline" && (![deal.analysis_result.max_safe_offer, deal.analysis_result.net_profit].every(finite)
      || !verdicts.has(String(deal.analysis_result.overall_verdict)))) {
      issues.push(`${label}: saved analysis is incomplete; resume, analyze and save a new version.`);
    }
  }
  const baseAssumptions = assumptions(baseline), leftAssumptions = assumptions(left), rightAssumptions = assumptions(right);
  const differences = baseAssumptions.flatMap((entry, index) => {
    const a = leftAssumptions[index].value, b = rightAssumptions[index].value;
    return entry.value === undefined || a === undefined || b === undefined || a !== entry.value || b !== entry.value
      ? [{ label: entry.label, baseline: entry.value, left: a, right: b }] : [];
  });
  if (differences.some(diff => diff.baseline === undefined)) {
    issues.push("The baseline lacks recorded assumptions. Resume it, confirm the missing inputs, analyze and save a new baseline. Then create both bids from that new baseline; the historical record stays unchanged.");
  } else if (differences.length) issues.push("Bid impact requires the same recorded property and non-rehab assumptions as the baseline. Resolve the differences below in a new version.");
  if (checks.some(check => !check.confirmed)) issues.push("Some quoted lines carry the same amount as a baseline planning allowance. Confirm each amount against its contractor quote below before comparing.");
  if (issues.length) return { issues, differences, amountChecks: checks, comparison: null };

  const key = (item: RehabScopeItem) => text(item.category).toLowerCase();
  const all = [...left.rehab_scope!.items, ...right.rehab_scope!.items];
  const categories = [...new Set(all.map(key))].map(category => {
    const a = left.rehab_scope!.items.filter(item => key(item) === category);
    const b = right.rehab_scope!.items.filter(item => key(item) === category);
    return {
      key: category, label: text(all.find(item => key(item) === category)!.category),
      left: { items: a, total: a.length ? amount(a) : null },
      right: { items: b, total: b.length ? amount(b) : null },
    };
  });
  return { issues, differences, amountChecks: checks, comparison: { left: summary(left, baseline), right: summary(right, baseline), categories } };
}
