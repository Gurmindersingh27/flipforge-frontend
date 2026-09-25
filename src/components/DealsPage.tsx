import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth, SignedIn, SignedOut, SignInButton } from "@clerk/clerk-react";
import { getDeals } from "../lib/api";
import type { SavedDeal } from "../lib/types";

function fmt(n: unknown, prefix = "$"): string {
  if (n == null || typeof n !== "number") return "—";
  return `${prefix}${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(n: unknown): string {
  if (n == null || typeof n !== "number") return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function verdictClass(v: string): string {
  if (v === "BUY") return "text-[#E8C547]";
  if (v === "CONDITIONAL") return "text-amber-300";
  return "text-red-400";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function DealsList() {
  const { getToken } = useAuth();
  const [deals, setDeals] = useState<SavedDeal[]>([]);
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
      try {
        const token = await getToken().catch(() => null);
        if (!token) throw new Error("Could not retrieve auth token.");
        if (cancelled) return;
        const data = await getDeals(token);
        if (!cancelled) setDeals(data);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load deals.";
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
  }, [getToken, attempt]);

  if (loading) {
    return (
      <div role="status" className="text-sm text-white/50 py-8 text-center">
        Loading deals…
        {slow && <p className="mt-2">This is taking longer than usual. Keep this page open while FlipForge connects.</p>}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm py-8 text-center">
        <p role="alert" className="text-red-400">{error}</p>
        <button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-3 rounded-xl border border-white/20 px-4 py-2 text-white hover:bg-white/10">
          Try again
        </button>
      </div>
    );
  }

  if (deals.length === 0) {
    return (
      <div className="text-sm text-white/50 py-8 text-center">
        No saved deals yet.{" "}
        <Link to="/" className="text-white/70 underline hover:text-white">
          Analyze a deal
        </Link>{" "}
        and hit Save Deal.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-white/50">
            <th className="py-3 pr-4">Deal / version</th>
            <th className="py-3 pr-4">Est. profit</th>
            <th className="py-3 pr-4">Annualized ROI</th>
            <th className="py-3 pr-4">Verdict</th>
            <th className="py-3 pr-4">Max Offer</th>
            <th className="py-3 pr-4">Date</th>
            <th className="py-3 pr-4">Actions</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const r = deal.analysis_result as Record<string, unknown>;
            const profit = r?.net_profit as number | null;
            const roi = r?.annualized_roi as number | null;
            const verdict = (r?.overall_verdict as string) ?? "—";
            const maxOffer = r?.max_safe_offer as number | null;
            const draftAddress = deal.draft_input?.address;
            const address = deal.address?.trim()
              || (typeof draftAddress === "string" ? draftAddress.trim() : "");

            return (
              <tr
                key={deal.id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="py-3 pr-4 text-white/90 min-w-[180px] max-w-[240px]">
                  <div className="truncate" title={address || undefined}>
                    {address || `Untitled deal #${deal.id}`}
                  </div>
                  <div className="mt-1 text-xs text-white/60">
                    Version #{deal.id}
                    {deal.parent_deal_id != null && (
                      <> · From <Link to={`/deal/${deal.parent_deal_id}`} className="underline hover:text-white">#{deal.parent_deal_id}</Link></>
                    )}
                  </div>
                  {deal.revision_note?.trim() && (
                    <div className="mt-1 text-xs text-white/60 break-words">{deal.revision_note}</div>
                  )}
                </td>
                <td className="py-3 pr-4 text-white/80 font-jetbrains">{fmt(profit)}</td>
                <td className="py-3 pr-4 text-white/80 font-jetbrains">{fmtPct(roi)}</td>
                <td className="py-3 pr-4">
                  <span className={`verdict-badge inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-bold ${verdictClass(verdict)} ${
                    verdict === "BUY"
                      ? "border-[#E8C547]/40 bg-[#E8C547]/10"
                      : verdict === "CONDITIONAL"
                      ? "border-amber-400/50 bg-amber-400/10"
                      : "border-red-500/40 bg-red-500/10"
                  }`}>
                    {verdict}
                  </span>
                </td>
                <td className="py-3 pr-4 text-white/80 font-jetbrains">{fmt(maxOffer)}</td>
                <td className="py-3 pr-4 text-white/50 text-xs">
                  {fmtDate(deal.created_at)}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/deal/${deal.id}`}
                      aria-label={`Open saved version ${deal.id}`}
                      className="text-xs text-white/50 hover:text-white/80 transition-colors"
                    >
                      Open
                    </Link>
                    <Link
                      to="/"
                      state={{ resumeDraft: deal.draft_input, resumeDeal: deal }}
                      aria-label={`Create revision from version ${deal.id}`}
                      className="text-xs text-white/50 hover:text-white/80 transition-colors"
                    >
                      Create revision
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function DealsPage() {
  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-100">
      {/* Nav bar */}
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-sm font-semibold text-white hover:text-white/80 transition-colors"
          >
            FlipForge
          </Link>
          <span className="text-xs text-white/40">My Deals</span>
        </div>
        <Link
          to="/"
          className="text-xs text-white/60 hover:text-white transition-colors"
        >
          ← Back to Analyzer
        </Link>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-6">
          <div className="text-lg font-semibold text-white">My Saved Deals</div>
          <SignedIn>
            <p className="mt-2 text-sm text-white/70">
              Open a saved version to review it. Choose Create revision to update its numbers or scope, then analyze and save a new version. The original stays unchanged.
            </p>
            <p className="mt-2 text-xs text-white/50">
              Figures and verdicts reflect the analysis saved with each version. Annualized ROI scales the modeled return to one year; it is not a guaranteed return.
            </p>
          </SignedIn>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 hover:bg-white/[0.06] transition-colors duration-150">
          <SignedIn>
            <DealsList />
          </SignedIn>
          <SignedOut>
            <div className="py-8 text-center">
              <div className="text-sm text-white/60 mb-4">
                Sign in to view your saved deals.
              </div>
              <SignInButton mode="modal">
                <button className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12]">
                  Sign In
                </button>
              </SignInButton>
            </div>
          </SignedOut>
        </div>
      </div>
    </div>
  );
}
