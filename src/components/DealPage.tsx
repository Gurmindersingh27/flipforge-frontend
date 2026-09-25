import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth, SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { getDeal } from "../lib/api";
import AnalysisResult from "../AnalysisResult";
import RehabScopeEditor from "./RehabScopeEditor";
import RevisionComparison from "./RevisionComparison";
import BidComparison from "./BidComparison";
import ShieldHeader from "./ShieldHeader";
import type { SavedDeal, DraftDeal, AnalyzeResponse } from "../lib/types";

function fmt(n: number | null | undefined, prefix = "$"): string {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function DealView({ deal, previous, comparisonError }: { deal: SavedDeal; previous: SavedDeal | null; comparisonError: string }) {
  const draft = deal.draft_input as DraftDeal | null;
  const result = deal.analysis_result as unknown as AnalyzeResponse;

  const pdfMeta = {
    listing_url: draft?.url ?? null,
    property_address: deal.address ?? draft?.address ?? null,
    purchase_price: draft?.purchase_price?.value ?? null,
    arv: draft?.arv?.value ?? null,
    rehab_budget: draft?.rehab_budget?.value ?? null,
    est_monthly_rent: draft?.est_monthly_rent?.value ?? null,
    closing_cost_pct: draft ? (draft.closing_cost_pct ?? 0.03) * 100 : 3,
    selling_cost_pct: draft ? (draft.selling_cost_pct ?? 0.08) * 100 : 8,
    holding_months: draft?.holding_months ?? 6,
    interest_rate_pct: draft ? (draft.annual_interest_rate ?? 0.10) * 100 : 10,
    ltc_pct: draft ? (draft.loan_to_cost_pct ?? 0.90) * 100 : 90,
    required_profit_margin_pct: draft
      ? (draft.required_profit_margin_pct ?? 0.12) * 100
      : 12,
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Deal summary header */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-white">
            {pdfMeta.property_address ?? "Saved Deal"}
          </div>
          {draft ? (
            <Link
              to="/"
              state={{ resumeDraft: draft, resumeDeal: deal }}
              className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-indigo-500/40 bg-indigo-600/20 text-indigo-300 hover:bg-indigo-600/30 transition-colors"
            >
              Resume Deal
            </Link>
          ) : (
            <span
              className="rounded-xl px-3 py-1.5 text-xs font-semibold border border-white/10 bg-white/5 text-white/30 cursor-not-allowed"
              title="Draft data not available for this deal"
            >
              Resume Deal
            </span>
          )}
        </div>
        {draft?.source && (
          <span className="mt-1 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
            Source: {draft.source}
          </span>
        )}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>
            <div className="text-xs text-slate-400">Purchase Price</div>
            <div className="text-white/90">{fmt(pdfMeta.purchase_price)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">ARV</div>
            <div className="text-white/90">{fmt(pdfMeta.arv)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Rehab Budget</div>
            <div className="text-white/90">{fmt(pdfMeta.rehab_budget)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Est. Monthly Rent</div>
            <div className="text-white/90">{fmt(pdfMeta.est_monthly_rent)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Max Safe Offer</div>
            <div className="text-white/90">{fmt(result?.max_safe_offer)}</div>
          </div>
        </div>
      </div>

      <RehabScopeEditor scope={deal.rehab_scope ?? null} readOnly />
      {deal.parent_deal_id && <Link to={`/deal/${deal.parent_deal_id}`} className="text-sm text-amber-200 underline">Open previous version #{deal.parent_deal_id}</Link>}
      {comparisonError && <p role="alert" className="text-sm text-rose-300">{comparisonError}</p>}
      {previous && <RevisionComparison previous={previous} current={deal} />}
      <BidComparison key={deal.id} context={deal} previous={previous} />
      <p className="text-xs text-white/60">Screening estimate. Holding costs model loan interest; separate taxes, insurance, utilities, financing points and draw timing are not modeled.</p>
      {/* Results — rendered from saved analysis_result, no re-run */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <ShieldHeader result={result} />
        <div className="mt-4">
          <div className="text-sm font-semibold text-white">Results</div>
          <div className="mt-3">
            <AnalysisResult
              result={{ ...result, allowed_outputs: result?.allowed_outputs ?? { lender_report: false, negotiation_script: false } }}
              meta={pdfMeta}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function DealLoader() {
  const { id } = useParams<{ id: string }>();
  const { getToken } = useAuth();
  const [deal, setDeal] = useState<SavedDeal | null>(null);
  const [previous, setPrevious] = useState<SavedDeal | null>(null);
  const [comparisonError, setComparisonError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const slowTimer = setTimeout(() => { if (!cancelled) setSlow(true); }, 8_000);
    async function load() {
      setLoading(true);
      setError("");
      setSlow(false);
      setPrevious(null);
      setComparisonError("");
      try {
        const token = await getToken().catch(() => null);
        if (!token) throw new Error("Could not retrieve auth token.");
        if (cancelled) return;
        const data = await getDeal(Number(id), token);
        if (cancelled) return;
        setDeal(data);
        if (data.parent_deal_id) {
          try {
            const prior = await getDeal(data.parent_deal_id, token);
            if (!cancelled) setPrevious(prior);
          } catch {
            if (!cancelled) setComparisonError("The current deal loaded, but the previous version could not be loaded for comparison.");
          }
        }
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load deal.";
          setError(msg);
        }
      } finally {
        clearTimeout(slowTimer);
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      clearTimeout(slowTimer);
    };
  }, [id, getToken, attempt]);

  if (loading) {
    return (
      <div role="status" className="text-sm text-white/50 py-16 text-center">
        Loading deal…
        {slow && <p className="mt-2">This is taking longer than usual. Keep this page open while FlipForge connects.</p>}
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm py-16 text-center">
        <p role="alert" className="text-red-400">{error}</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-xl border border-white/20 px-4 py-2 text-white hover:bg-white/10">
          Try again
        </button>
      </div>
    );
  }
  if (!deal) {
    return (
      <div className="text-sm text-white/50 py-16 text-center">
        Deal not found.
      </div>
    );
  }

  return <DealView deal={deal} previous={previous} comparisonError={comparisonError} />;
}

export default function DealPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="border-b border-white/10 bg-slate-900/60 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-sm font-semibold text-white hover:text-white/80 transition-colors"
          >
            FlipForge
          </Link>
          <Link
            to="/deals"
            className="text-xs text-white/40 hover:text-white/70 transition-colors"
          >
            ← My Deals
          </Link>
        </div>
      </div>

      <SignedIn>
        <DealLoader />
      </SignedIn>
      <SignedOut>
        <div className="py-16 text-center">
          <div className="text-sm text-white/60 mb-4">
            Sign in to view this deal.
          </div>
          <SignInButton mode="modal">
            <button className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12]">
              Sign In
            </button>
          </SignInButton>
        </div>
      </SignedOut>
    </div>
  );
}
