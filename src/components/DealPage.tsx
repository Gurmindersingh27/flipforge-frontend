import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useAuth, SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { getDeal } from "../lib/api";
import AnalysisResult from "../AnalysisResult";
import ShieldHeader from "./ShieldHeader";
import type { SavedDeal, DraftDeal, AnalyzeResponse } from "../lib/types";

function fmt(n: number | null | undefined, prefix = "$"): string {
  if (n == null) return "—";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function DealView({ deal }: { deal: SavedDeal }) {
  const draft = deal.draft_input as DraftDeal | null;
  const result = deal.analysis_result as unknown as AnalyzeResponse;

  const pdfMeta = {
    listing_url: draft?.url ?? null,
    property_address: deal.address ?? draft?.address ?? null,
    purchase_price: draft?.purchase_price?.value ?? null,
    arv: draft?.arv?.value ?? null,
    rehab_budget: draft?.rehab_budget?.value ?? null,
    est_monthly_rent: draft?.est_monthly_rent?.value ?? null,
    holding_months: draft?.holding_months ?? 6,
    interest_rate_pct: draft ? draft.annual_interest_rate * 100 : 10,
    ltc_pct: draft ? draft.loan_to_cost_pct * 100 : 80,
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* Deal summary header */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <div className="text-sm font-semibold text-white">
          {pdfMeta.property_address ?? "Saved Deal"}
        </div>
        {draft?.source && (
          <span className="mt-1 inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
            Source: {draft.source}
          </span>
        )}
        <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
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
        </div>
      </div>

      {/* Results — rendered from saved analysis_result, no re-run */}
      <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
        <ShieldHeader result={result} />
        <div className="mt-4">
          <div className="text-sm font-semibold text-white">Results</div>
          <div className="mt-3">
            <AnalysisResult result={result} meta={pdfMeta} />
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const token = await getToken().catch(() => null);
      if (!token) {
        if (!cancelled) {
          setError("Could not retrieve auth token.");
          setLoading(false);
        }
        return;
      }
      try {
        const data = await getDeal(Number(id), token);
        if (!cancelled) setDeal(data);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load deal.";
          setError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  if (loading) {
    return (
      <div className="text-sm text-white/50 py-16 text-center">
        Loading deal…
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-red-400 py-16 text-center">{error}</div>
    );
  }
  if (!deal) {
    return (
      <div className="text-sm text-white/50 py-16 text-center">
        Deal not found.
      </div>
    );
  }

  return <DealView deal={deal} />;
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
            <button className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/10 bg-white text-slate-900">
              Sign In
            </button>
          </SignInButton>
        </div>
      </SignedOut>
    </div>
  );
}
