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
  if (v === "BUY") return "text-emerald-400";
  if (v === "CONDITIONAL") return "text-amber-400";
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

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      const token = await getToken().catch(() => null);
      if (!token) {
        setError("Could not retrieve auth token.");
        setLoading(false);
        return;
      }
      try {
        const data = await getDeals(token);
        if (!cancelled) setDeals(data);
      } catch (e: unknown) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : "Failed to load deals.";
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
  }, [getToken]);

  if (loading) {
    return (
      <div className="text-sm text-white/50 py-8 text-center">
        Loading deals…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-red-400 py-8 text-center">{error}</div>
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
            <th className="py-3 pr-4">Address</th>
            <th className="py-3 pr-4">Profit</th>
            <th className="py-3 pr-4">ROI</th>
            <th className="py-3 pr-4">Verdict</th>
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

            return (
              <tr
                key={deal.id}
                className="border-b border-white/5 hover:bg-white/5 transition-colors"
              >
                <td className="py-3 pr-4 text-white/90 max-w-[200px] truncate">
                  {deal.address
                    ?? (deal.draft_input as any)?.address
                    ?? <span className="text-white/40">No address</span>}
                </td>
                <td className="py-3 pr-4 text-white/80">{fmt(profit)}</td>
                <td className="py-3 pr-4 text-white/80">{fmtPct(roi)}</td>
                <td className={`py-3 pr-4 font-semibold ${verdictClass(verdict)}`}>
                  {verdict}
                </td>
                <td className="py-3 pr-4 text-white/50 text-xs">
                  {fmtDate(deal.created_at)}
                </td>
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-3">
                    <Link
                      to={`/deal/${deal.id}`}
                      className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
                    >
                      Open
                    </Link>
                    <span className="text-xs text-white/30 cursor-not-allowed">
                      Compare
                    </span>
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
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Nav bar */}
      <div className="border-b border-white/10 bg-slate-900/60 px-6 py-3 flex items-center justify-between">
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
          <div className="mt-1 text-xs text-white/50">
            Deals are stored per account. Sign in to view yours.
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <SignedIn>
            <DealsList />
          </SignedIn>
          <SignedOut>
            <div className="py-8 text-center">
              <div className="text-sm text-white/60 mb-4">
                Sign in to view your saved deals.
              </div>
              <SignInButton mode="modal">
                <button className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/10 bg-white text-slate-900">
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
