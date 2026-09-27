import { Link } from "react-router-dom";
import type { SavedDeal } from "../lib/types";
import { savedDealComparisonRows, savedDealName } from "../lib/savedDealComparison";

export default function SavedDealComparison({ deals }: { deals: SavedDeal[] }) {
  const rows = savedDealComparisonRows(deals);
  const warnings = rows.filter(row => row.warning);

  return (
    <section aria-label="Saved deal comparison" className="mb-5 min-w-0 rounded-xl border border-amber-400/30 bg-slate-950/60 p-4">
      <h2 className="text-lg font-semibold text-amber-200">Compare saved deals</h2>
      <p className="mt-2 text-sm text-white/70">Compare properties or saved versions side by side. These are the results saved at the time, without recalculation or an automatic recommendation.</p>
      {warnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-400/25 p-3 text-sm text-amber-100">
          <p className="font-semibold">Review the assumptions before comparing returns.</p>
          <ul className="mt-1 list-inside list-disc">{warnings.map(row => <li key={row.key}>{row.label}: {row.warning.toLowerCase()}</li>)}</ul>
        </div>
      )}
      <div role="region" aria-label="Saved deal comparison table" tabIndex={0} className="mt-4 overflow-x-auto focus-visible:outline-2 focus-visible:outline-amber-300">
        <table className="w-full min-w-[580px] table-fixed text-left text-sm">
          <caption className="sr-only">Recorded results and assumptions for selected saved versions</caption>
          <thead>
            <tr className="align-top">
              <th scope="col" className="w-40 p-2 text-white/60">Saved version</th>
              {deals.map(deal => (
                <th scope="col" key={deal.id} className="p-2 font-normal">
                  <Link to={`/deal/${deal.id}`} aria-label={`Open compared version ${deal.id}`} className="break-words font-semibold text-amber-200 underline">{savedDealName(deal)}</Link>
                  <p className="mt-1 text-xs text-white/70">Version #{deal.id}{deal.parent_deal_id != null ? ` · From #${deal.parent_deal_id}` : ""}</p>
                  <p className="mt-1 text-xs text-white/50">Saved: {Number.isFinite(Date.parse(deal.created_at)) ? new Date(deal.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable"}</p>
                  {deal.revision_note?.trim() && <details className="mt-2 text-xs text-white/70"><summary className="cursor-pointer">Revision note</summary><p className="mt-1 whitespace-pre-wrap break-words">{deal.revision_note}</p></details>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{rows.map(row => (
            <tr key={row.key} data-comparison-metric={row.key} className="border-t border-white/10 align-top">
              <th scope="row" className="p-2 font-normal text-white/70">{row.label}{row.warning && <span className="mt-1 block text-xs text-amber-200">{row.warning}</span>}</th>
              {row.cells.map((cell, index) => <td key={deals[index].id} className="break-words p-2 tabular-nums text-white/90">{cell}</td>)}
            </tr>
          ))}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-white/60">Not recorded means the saved value is unavailable; no default is assumed. Difference flags use unrounded saved values. Different versions can belong to the same property. Saved verdicts can reflect different underwriting policy versions.</p>
      <p className="mt-2 text-xs text-white/50">Screening estimates, not verified property values or quotes. Annualized ROI is not a guaranteed return. Holding costs model loan interest; separate taxes, insurance, utilities, financing points and draw timing are not modeled. Open each version to review its scope and exclusions.</p>
    </section>
  );
}
