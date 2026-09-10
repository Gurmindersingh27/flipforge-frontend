import type { SavedDeal, DraftDeal, RehabScope } from "../lib/types";
import { lineTotal } from "../lib/rehabScope";
type Version = { draft_input?: Record<string, unknown> | null; analysis_result: Record<string, unknown>; rehab_scope?: RehabScope | null; revision_note?: string };
const numeric = (n: unknown): number | null => typeof n === "number" && Number.isFinite(n) ? n : null;
const fmt = (n: number | null, unit: string) => n === null ? "—" : unit === "%" ? `${(n * 100).toFixed(1)}%` : unit === "months" ? `${n} mo` : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function RevisionComparison({ previous, current }: { previous: SavedDeal; current: Version }) {
  const a = previous.draft_input as DraftDeal | null;
  const b = current.draft_input as DraftDeal | null;
  const rows: [string, number | null, number | null, string][] = [
    ["Purchase price", numeric(a?.purchase_price?.value), numeric(b?.purchase_price?.value), "$"],
    ["ARV", numeric(a?.arv?.value), numeric(b?.arv?.value), "$"],
    ["Rehab budget", numeric(a?.rehab_budget?.value), numeric(b?.rehab_budget?.value), "$"],
    ["Holding period", numeric(a?.holding_months), numeric(b?.holding_months), "months"],
    ["Interest rate", numeric(a?.annual_interest_rate), numeric(b?.annual_interest_rate), "%"],
    ["Loan to cost", numeric(a?.loan_to_cost_pct), numeric(b?.loan_to_cost_pct), "%"],
    ["Closing costs", numeric(a?.closing_cost_pct), numeric(b?.closing_cost_pct), "%"],
    ["Selling costs", numeric(a?.selling_cost_pct), numeric(b?.selling_cost_pct), "%"],
    ["Required return on cost", numeric(a?.required_profit_margin_pct), numeric(b?.required_profit_margin_pct), "%"],
    ["Maximum offer", numeric(previous.analysis_result.max_safe_offer), numeric(current.analysis_result.max_safe_offer), "$"],
    ["Projected net profit", numeric(previous.analysis_result.net_profit), numeric(current.analysis_result.net_profit), "$"],
  ];
  const oldItems = previous.rehab_scope?.items ?? [];
  const newItems = current.rehab_scope?.items ?? [];
  const changed = [...new Set([...oldItems.map(i => i.id), ...newItems.map(i => i.id)])].flatMap(id => {
    const old = oldItems.find(i => i.id === id), next = newItems.find(i => i.id === id);
    if (JSON.stringify(old) === JSON.stringify(next)) return [];
    return [`${next?.category ?? old?.category}: ${old ? fmt(lineTotal(old), "$") : "added"} → ${next ? fmt(lineTotal(next), "$") : "removed"}${next ? ` (${next.basis}${next.source ? ` · ${next.source}` : ""}${next.quote_date ? ` · ${next.quote_date}` : ""})` : ""}`];
  });
  return <section className="my-4 rounded-2xl border border-amber-400/25 bg-slate-950/60 p-4" aria-label="Revision comparison">
    <h3 className="text-lg font-semibold text-amber-200">What changed since the previous version</h3>
    <p className="mt-1 text-xs text-white/60">Compared with saved deal #{previous.id}. The previous record stays unchanged. Differences below reflect the combined input changes, not an attribution of profit to individual items.</p>
    {current.revision_note && <p className="mt-3 text-sm text-white/80">{current.revision_note}</p>}
    <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-xs sm:text-sm"><thead className="text-white/50"><tr><th className="py-2">Metric</th><th>Previous</th><th>Current</th><th>Change</th></tr></thead><tbody>{rows.map(([label, old, next, unit]) => <tr key={label} className="border-t border-white/10"><th className="py-2 pr-3 font-normal text-white/70">{label}</th><td className="pr-3 tabular-nums">{fmt(old, unit)}</td><td className="pr-3 tabular-nums">{fmt(next, unit)}</td><td className="tabular-nums text-amber-100">{old === null || next === null ? "—" : `${next > old ? "+" : ""}${fmt(next - old, unit)}`}</td></tr>)}</tbody></table></div>
    <p className="mt-3 text-sm text-white/70">Verdict: {String(previous.analysis_result.overall_verdict ?? "—")} → {String(current.analysis_result.overall_verdict ?? "—")}</p>
    {changed.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-white/70">{changed.map((text, i) => <li key={i}>{text}</li>)}</ul>}
    {(previous.rehab_scope?.contingency_pct ?? null) !== (current.rehab_scope?.contingency_pct ?? null) && <p className="mt-2 text-xs text-white/60">Scope contingency: {fmt(previous.rehab_scope?.contingency_pct ?? null, "%")} → {fmt(current.rehab_scope?.contingency_pct ?? null, "%")}</p>}
    <p className="mt-4 text-xs text-white/50">Screening estimate. Holding costs currently model loan interest; separate taxes, insurance, utilities, financing points and draw timing are not modeled.</p>
  </section>;
}
