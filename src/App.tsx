import { useMemo, useState } from "react";
import AnalysisResult from "./AnalysisResult";
import { analyzeDeal } from "./lib/api";
import type { AnalyzeRequest, AnalyzeResponse } from "./lib/types";

export default function App() {
  const [purchasePrice, setPurchasePrice] = useState<number>(120000);
  const [arv, setArv] = useState<number>(220000);
  const [rehabBudget, setRehabBudget] = useState<number>(35000);
  const [monthlyRent, setMonthlyRent] = useState<number | "">(1800);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const canAnalyze = useMemo(() => {
    return purchasePrice > 0 && arv > 0 && rehabBudget >= 0;
  }, [purchasePrice, arv, rehabBudget]);

  async function onAnalyze() {
    setError("");

    if (!canAnalyze) {
      setError("Please enter valid Purchase Price, ARV, and Rehab Budget.");
      return;
    }

    const payload: AnalyzeRequest = {
      purchase_price: Number(purchasePrice),
      arv: Number(arv),
      rehab_budget: Number(rehabBudget),
      est_monthly_rent: monthlyRent === "" ? null : Number(monthlyRent),
    };

    try {
      setLoading(true);
      setResult(null);

      const res = await analyzeDeal(payload);
      setResult(res);
    } catch (err: any) {
      setError(err?.message || "Failed to analyze deal.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">FlipForge MVP</h1>
          <p className="mt-2 text-sm text-slate-400">
            Enter deal numbers → Analyze → see verdict.
          </p>
        </header>

        {/* Input Card */}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Purchase Price
              </label>
              <input
                type="number"
                value={purchasePrice}
                onChange={(e) => setPurchasePrice(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">ARV</label>
              <input
                type="number"
                value={arv}
                onChange={(e) => setArv(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Rehab Budget
              </label>
              <input
                type="number"
                value={rehabBudget}
                onChange={(e) => setRehabBudget(Number(e.target.value))}
                className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
              />
            </div>

            <div>
              <label className="block text-xs text-slate-400 mb-1">
                Monthly Rent (optional)
              </label>
              <input
                type="number"
                value={monthlyRent}
                onChange={(e) =>
                  setMonthlyRent(
                    e.target.value === "" ? "" : Number(e.target.value)
                  )
                }
                className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
              />
            </div>
          </div>

          <div className="mt-6 flex items-center gap-4">
            <button
              onClick={onAnalyze}
              disabled={loading}
              className="rounded-xl bg-white text-slate-900 px-6 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze"}
            </button>

            {error && <span className="text-sm text-red-400">{error}</span>}
          </div>
        </div>

        {/* Results */}
        {result && <AnalysisResult result={result} />}
      </div>
    </div>
  );
}
