import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { getDeals } from "../lib/api";
import type { RehabScopeItem, SavedDeal } from "../lib/types";
import { bidCandidates, compareBidOptions, resolveBidBaseline } from "../lib/bidComparison";
import { lineTotal } from "../lib/rehabScope";

const money = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const field = "mt-1 w-full min-w-0 rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white";
const button = "inline-block rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-40";
const versionName = (deal: SavedDeal) => `#${deal.id} · ${deal.revision_note || "Saved quote version"}`;
type Summary = NonNullable<ReturnType<typeof compareBidOptions>["comparison"]>["left"];

function BidSummary({ label, deal, costs }: { label: string; deal: SavedDeal; costs: Summary }) {
  const rows: [string, string][] = [
    ["New / changed quoted lines", money(costs.quoted)], ["New / changed allowances", money(costs.allowances)],
    ["Retained baseline lines", money(costs.retained)], ["Scope subtotal", money(costs.subtotal)],
    [`Contingency (${Number((costs.contingencyPct * 100).toFixed(4))}%)`, money(costs.contingency)],
    ["Total project rehab budget", money(costs.total)], ["Maximum safe offer", money(costs.maxOffer)],
    ["Net profit", money(costs.netProfit)], ["Saved verdict", costs.verdict],
    ["Rehab +15% stress", costs.stress ? `${costs.stress.verdict} · ${money(costs.stress.netProfit)} net profit` : "Not saved"],
  ];
  return <article aria-label={`${label} impact`} className="min-w-0 rounded-xl border border-white/15 bg-slate-950/60 p-4">
    <h4 className="font-semibold text-amber-200">{label}</h4>
    <Link className="mt-1 block break-words text-sm text-white/70 underline" to={`/deal/${deal.id}`}>{versionName(deal)}</Link>
    <dl className="mt-4 space-y-3">{rows.map(([name, value]) => <div key={name} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-white/5 pb-2">
      <dt className="text-xs text-white/60">{name}</dt><dd className={`text-sm ${name === "Maximum safe offer" ? "font-bold text-amber-200" : "text-white"}`}>{value}</dd>
    </div>)}</dl>
    <p className="mt-4 text-xs text-white/50">Quoted totals sum user-recorded prices and may include more than one contractor. A changed price does not verify a quote. Retained lines are unchanged from the baseline, including any retained allowances.</p>
    <h5 className="mt-4 text-xs font-semibold text-white/80">Budget notes / exclusions</h5>
    <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white/70">{deal.rehab_scope?.notes || "Not recorded"}</p>
    <Link className={`${button} mt-4`} to="/" state={{ resumeDraft: deal.draft_input, resumeDeal: deal }}>Continue with {label}</Link>
  </article>;
}

function CategoryEvidence({ label, items, total }: { label: string; items: RehabScopeItem[]; total: number | null }) {
  return <div className="min-w-0 rounded-lg bg-slate-950/50 p-3">
    <p className="text-xs font-semibold text-amber-200">{label} · {total === null ? "Not separately itemized" : money(total)}</p>
    {total === null ? <p className="mt-2 text-xs text-white/70">Confirm coverage: it may be included elsewhere, excluded or not needed. No cost is assumed.</p>
      : <ul className="mt-3 space-y-4">{items.map(item => <li key={item.id} className="text-xs text-white/70">
        <p className="whitespace-pre-wrap break-words text-sm text-white">{item.description || item.category}</p>
        <p className="mt-1 break-words">{item.quantity} {item.unit} × {money(item.unit_cost)} = {money(lineTotal(item))}</p>
        <p className="mt-1 break-words">{item.basis === "quote" ? "Contractor quote" : "Planning allowance"} · {item.source || "Source not recorded"} · {item.quote_date || "Date not recorded"}</p>
        <p className="mt-1 whitespace-pre-wrap break-words">Notes / exclusions: {item.notes || "Not recorded"}</p>
      </li>)}</ul>}
  </div>;
}

export default function BidComparison({ context, previous }: { context: SavedDeal; previous: SavedDeal | null }) {
  const { getToken } = useAuth();
  const [saved, setSaved] = useState<SavedDeal[]>([]);
  const [confirmedAmounts, setConfirmedAmounts] = useState<string[]>([]);
  const [useCurrentBaseline, setUseCurrentBaseline] = useState(false);
  const [leftId, setLeftId] = useState<number | null>(null), [rightId, setRightId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const alive = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function loadBids() {
    setLoading(true); setError(""); setLoaded(false); setConfirmedAmounts([]); setUseCurrentBaseline(false);
    try {
      const token = await getToken();
      if (!token) throw new Error("Could not retrieve auth token.");
      const saved = await getDeals(token);
      if (!alive.current) return;
      const baseline = resolveBidBaseline(context, saved, previous);
      const options = baseline ? bidCandidates(baseline, saved) : [];
      const preferred = options.find(deal => deal.id === context.id) ?? options[0];
      setSaved(saved); setLeftId(preferred?.id ?? null);
      setRightId(options.find(deal => deal.id !== preferred?.id)?.id ?? null); setLoaded(true);
    } catch {
      if (alive.current) setError("Saved bids could not be loaded. Your current deal is unchanged; try again.");
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  const baseline = loaded ? useCurrentBaseline ? context : resolveBidBaseline(context, saved, previous) : null;
  const candidates = baseline ? bidCandidates(baseline, saved) : [];
  const left = candidates.find(deal => deal.id === leftId), right = candidates.find(deal => deal.id === rightId);
  const review = baseline && left && right ? compareBidOptions(baseline, left, right, confirmedAmounts) : null;
  const display = (value: unknown) => value === undefined ? "Not recorded" : value === null || value === "" ? "Not provided" : String(value);
  return <section aria-label="Bid comparison" className="rounded-2xl border border-amber-400/25 bg-slate-900/40 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-lg font-semibold text-white">Compare saved bids</h3>
      <button type="button" className={button} disabled={loading} onClick={loadBids}>{loading ? "Loading bids…" : loaded ? "Refresh saved bids" : "Compare bids"}</button>
    </div>
    {baseline ? <p className="mt-2 text-sm text-white/60">Save each contractor option by resuming the same <Link className="text-amber-200 underline" to={`/deal/${baseline.id}`}>baseline #{baseline.id}</Link>. Compare two saved versions with matching property and underwriting assumptions.</p>
      : <p className="mt-2 text-sm text-white/60">Load saved bids to identify their common baseline. This version's quoted children are checked first; otherwise a quoted version is compared with its siblings.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
    {loaded && !useCurrentBaseline && baseline?.id !== context.id && <button type="button" className={`${button} mt-3`} onClick={() => { setUseCurrentBaseline(true); setLeftId(null); setRightId(null); setConfirmedAmounts([]); }}>Start new bids from this version #{context.id}</button>}
    {loaded && !baseline && <p role="alert" className="mt-3 text-sm text-rose-300">The baseline could not be loaded. Open it before comparing retained costs.</p>}
    {loaded && baseline && candidates.length < 2 && <p role="status" className="mt-4 text-sm text-white/70">Two saved quote versions are needed. Resume baseline #{baseline.id} for each bid, enter its scope and quote details, analyze, then save a new revision.</p>}
    {loaded && candidates.length >= 2 && <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {([['Bid A', leftId, setLeftId], ['Bid B', rightId, setRightId]] as const).map(([label, id, setId]) => <label key={label} className="min-w-0 text-xs text-white/70">{label}
          <select aria-label={`${label} saved version`} disabled={loading} className={field} value={id ?? ""} onChange={e => { setId(Number(e.target.value)); setConfirmedAmounts([]); }}>{candidates.map(deal => <option key={deal.id} value={deal.id}>{versionName(deal)}</option>)}</select>
        </label>)}
      </div>
      {review && review.issues.length > 0 && <div role="alert" className="mt-4 rounded-xl border border-rose-400/30 p-3 text-sm text-rose-200">
        <ul className="list-inside list-disc space-y-2">{review.issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
        {review.differences.map(diff => <p key={diff.label} className="mt-2 break-words">{diff.label}: baseline {display(diff.baseline)} · Bid A {display(diff.left)} · Bid B {display(diff.right)}</p>)}
      </div>}
      {!!review?.amountChecks.length && <fieldset aria-label="Carried allowance amount review" className="mt-4 min-w-0 rounded-xl border border-amber-400/40 p-3">
        <legend className="px-2 text-sm font-semibold text-amber-200">Check carried-over allowance amounts</legend>
        <p className="text-xs text-white/70">These prices equal the baseline planning allowances. They may be valid quotes, but relabeling an allowance does not establish its price. Check each against the named contractor quote. If it differs, resume the bid and correct it. Confirmations apply to this comparison only and are not saved as verified quote evidence.</p>
        <div className="mt-3 space-y-4">{review.amountChecks.map(check => <div key={check.key} className="min-w-0 text-xs text-white/80">
          <p className="break-words font-semibold">{check.label} #{check.dealId} · {check.item.category} · {money(check.amount)}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{check.item.description || "Description not recorded"}</p>
          <p className="mt-1 break-words">{check.item.quantity} {check.item.unit} × {money(check.item.unit_cost)} · {check.item.source} · {check.item.quote_date}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">Notes / exclusions: {check.item.notes || "Not recorded"}</p>
          <label className="mt-2 flex items-start gap-2"><input type="checkbox" aria-label={`Confirm ${check.label} amount for ${check.item.id}`} checked={check.confirmed} onChange={e => setConfirmedAmounts(values => e.target.checked ? [...values, check.key] : values.filter(key => key !== check.key))} />I checked this contractor quote and it states {money(check.amount)} for this line. This is my confirmation; FlipForge has not verified the document.</label>
        </div>)}</div>
      </fieldset>}
      {review?.comparison && left && right && <>
        <p className="mt-4 text-xs text-white/60">Saved results are shown without recalculation. Totals cover recorded lines only; confirm unpriced work and exclusions before choosing a contractor. No automatic winner is selected.</p>
        <div className="mt-4 grid gap-4 md:grid-cols-2"><BidSummary label="Bid A" deal={left} costs={review.comparison.left} /><BidSummary label="Bid B" deal={right} costs={review.comparison.right} /></div>
        <p className="mt-3 text-xs text-white/50">Continue opens that bid for editing and analysis. Saving creates a new linked version; the baseline and saved bids stay unchanged.</p>
        <h4 className="mt-6 font-semibold text-white">Scope evidence by category</h4>
        <p className="mt-1 text-xs text-white/60">Only spacing and capitalization are grouped. Different category names may cover the same work; absence is not proof of exclusion.</p>
        <div className="mt-3 space-y-4">{review.comparison.categories.map(category => <article key={category.key} className="rounded-xl border border-white/10 p-3">
          <h5 className="mb-3 break-words text-sm font-semibold text-white">{category.label}</h5>
          <div className="grid gap-3 md:grid-cols-2"><CategoryEvidence label="Bid A" {...category.left} /><CategoryEvidence label="Bid B" {...category.right} /></div>
        </article>)}</div>
      </>}
    </>}
  </section>;
}
