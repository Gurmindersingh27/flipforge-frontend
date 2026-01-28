import { useMemo, useState } from "react";
import AnalysisResult from "./AnalysisResult";
import ShieldHeader from "./components/ShieldHeader";
import { analyzeDeal, draftFromUrl, finalizeAndAnalyze } from "./lib/api";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DraftDeal,
  Confidence,
} from "./lib/types";
import "./App.css";

function dpNumber(val: number | ""): number | null {
  if (val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

function confidenceBadgeClass(c?: Confidence) {
  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold border";
  if (c === "HIGH")
    return `${base} border-emerald-500/40 text-emerald-200 bg-emerald-500/10`;
  if (c === "MEDIUM")
    return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  if (c === "LOW")
    return `${base} border-orange-500/40 text-orange-200 bg-orange-500/10`;
  if (c === "MISSING")
    return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  return `${base} border-white/10 text-white/60 bg-white/5`;
}

function isLowConfidence(c?: Confidence) {
  return c === "LOW" || c === "MISSING";
}

export default function App() {
  // =========================
  // Phase 2 — URL + DraftDeal
  // =========================
  const [listingUrl, setListingUrl] = useState<string>("");
  const [manualAddress, setManualAddress] = useState<string>("");

  const [draft, setDraft] = useState<DraftDeal | null>(null);
  const [missingFields, setMissingFields] = useState<string[]>([]);
  const [draftLoading, setDraftLoading] = useState(false);
  const [draftError, setDraftError] = useState<string>("");

  const [analyzeLoading, setAnalyzeLoading] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string>("");

  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const isSourceBlocked =
    draft?.source?.toUpperCase?.().includes("SOURCE_BLOCKED") ?? false;

  const canFinalize = useMemo(() => {
    if (!draft) return false;
    const pp = draft.purchase_price?.value;
    const arv = draft.arv?.value;
    const rehab = draft.rehab_budget?.value;
    return (
      typeof pp === "number" &&
      pp > 0 &&
      typeof arv === "number" &&
      arv > 0 &&
      typeof rehab === "number" &&
      rehab >= 0
    );
  }, [draft]);

  async function onFetchDraft() {
    setDraftError("");
    setAnalyzeError("");
    setMissingFields([]);
    setResult(null);

    if (!listingUrl.trim()) {
      setDraftError("Paste a listing URL first.");
      return;
    }

    try {
      setDraftLoading(true);
      const d = await draftFromUrl(listingUrl.trim());
      setDraft(d);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to draft from URL.";
      setDraftError(msg);
      setDraft(null);
    } finally {
      setDraftLoading(false);
    }
  }

  function setDraftDpNumber(
    field: "purchase_price" | "arv" | "rehab_budget" | "est_monthly_rent",
    v: number | ""
  ) {
    if (!draft) return;
    const next = { ...draft };
    const num = dpNumber(v);
    next[field] = {
      ...(next[field] as DraftDeal[typeof field]),
      value: num,
    };
    setDraft(next);
  }

  async function onFinalizeAnalyze() {
    setAnalyzeError("");
    setDraftError("");
    setMissingFields([]);
    setResult(null);

    if (!draft) {
      setAnalyzeError("Fetch a draft first.");
      return;
    }

    if (!canFinalize) {
      setAnalyzeError(
        "Fill Purchase Price, ARV, and Rehab Budget before analyzing."
      );
      return;
    }

    try {
      setAnalyzeLoading(true);
      const res = await finalizeAndAnalyze(draft);

      if (!res.ok) {
        setMissingFields(res.missing_fields || []);
        setAnalyzeError("Missing required fields. Fill the highlighted inputs.");
        return;
      }

      setResult(res.result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to finalize/analyze.";
      setAnalyzeError(msg);
    } finally {
      setAnalyzeLoading(false);
    }
  }

  // =========================
  // Legacy Manual Analyze
  // =========================
  const [purchasePrice, setPurchasePrice] = useState<number>(120000);
  const [arv, setArv] = useState<number>(220000);
  const [rehabBudget, setRehabBudget] = useState<number>(35000);
  const [monthlyRent, setMonthlyRent] = useState<number | "">(1800);

  // ✅ Financing assumptions (PDF-only)
  const [holdingMonths, setHoldingMonths] = useState<number>(6);
  const [annualInterestRate, setAnnualInterestRate] = useState<number>(10);
  const [loanToCostPct, setLoanToCostPct] = useState<number>(80);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const canAnalyze = useMemo(() => {
    return purchasePrice > 0 && arv > 0 && rehabBudget >= 0;
  }, [purchasePrice, arv, rehabBudget]);

  async function onAnalyze() {
    setError("");
    setResult(null);

    if (!canAnalyze) {
      setError("Please enter valid Purchase Price, ARV, and Rehab Budget.");
      return;
    }

    const payload: AnalyzeRequest = {
      purchase_price: purchasePrice,
      arv,
      rehab_budget: rehabBudget,
      est_monthly_rent: monthlyRent === "" ? null : monthlyRent,
    };

    try {
      setLoading(true);
      const res = await analyzeDeal(payload);
      setResult(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to analyze deal.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  const verdictReason = result?.verdict_reason ?? "";
  const missing = new Set(missingFields);

  function inputClass(isMissingField: boolean, lowConfidence: boolean) {
    const base = "w-full rounded-lg bg-slate-900 border px-3 py-2";
    if (isMissingField) {
      return `${base} border-red-500/70 focus:ring-2 focus:ring-red-500/40`;
    }
    if (lowConfidence) {
      return `${base} border-amber-500/40 focus:ring-2 focus:ring-amber-500/30`;
    }
    return `${base} border-white/10`;
  }

  const FinancingAssumptions = (
    <div className="mt-4 rounded-xl border border-white/10 bg-slate-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-white/60">
        Financing assumptions (optional)
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Holding Months
          </label>
          <input
            type="number"
            min={0}
            step={1}
            value={holdingMonths}
            onChange={(e) =>
              setHoldingMonths(e.target.value === "" ? 0 : Number(e.target.value))
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Interest Rate (%)
          </label>
          <input
            type="number"
            min={0}
            step={0.25}
            value={annualInterestRate}
            onChange={(e) =>
              setAnnualInterestRate(
                e.target.value === "" ? 0 : Number(e.target.value)
              )
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Loan-to-Cost (LTC %)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={1}
            value={loanToCostPct}
            onChange={(e) =>
              setLoanToCostPct(e.target.value === "" ? 0 : Number(e.target.value))
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
          />
        </div>
      </div>

      <div className="mt-2 text-[11px] text-white/45">
        Used only to estimate carry in the lender report. Does not change underwriting
        math.
      </div>
    </div>
  );

  // Meta passed to AnalysisResult so PDF can show URL + financing assumptions + deal snapshot
  const pdfMeta = useMemo(() => {
    const addr = (draft as any)?.address ?? null;

    // Prefer draft values when using the URL flow; otherwise use manual fields.
    const usingDraft = !!draft;

    const purchase = usingDraft
      ? (draft?.purchase_price?.value ?? null)
      : purchasePrice;
    const arvVal = usingDraft ? (draft?.arv?.value ?? null) : arv;
    const rehabVal = usingDraft
      ? (draft?.rehab_budget?.value ?? null)
      : rehabBudget;

    const rentVal = usingDraft
      ? (draft?.est_monthly_rent?.value ?? null)
      : monthlyRent === ""
      ? null
      : monthlyRent;

    return {
      // identity
      listing_url: listingUrl?.trim() || null,
      property_address: addr || manualAddress.trim() || null,

      // deal snapshot
      purchase_price: purchase,
      arv: arvVal,
      rehab_budget: rehabVal,
      est_monthly_rent: rentVal,

      // financing assumptions (PDF-only)
      holding_months: holdingMonths,
      interest_rate_pct: annualInterestRate,
      ltc_pct: loanToCostPct,
    };
  }, [
    draft,
    listingUrl,
    manualAddress,
    purchasePrice,
    arv,
    rehabBudget,
    monthlyRent,
    holdingMonths,
    annualInterestRate,
    loanToCostPct,
  ]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* =========================
            Phase 2 — URL → DraftDeal
           ========================= */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-white">Draft from URL</div>
              <div className="mt-1 text-xs text-white/60">
                Paste a listing URL. We extract what we can. Fill gaps. Then analyze.
              </div>
            </div>

            {draft?.source && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                Source: {draft.source}
              </span>
            )}
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <input
              value={listingUrl}
              onChange={(e) => setListingUrl(e.target.value)}
              placeholder="https://..."
              className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
            />
            <button
              type="button"
              onClick={onFetchDraft}
              disabled={draftLoading}
              className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/10 bg-white text-slate-900 disabled:opacity-50"
            >
              {draftLoading ? "Fetching…" : "Fetch Draft"}
            </button>
          </div>

          {/* ✅ NEW: Manual address override */}
          <div className="mt-3">
            <label className="block text-xs text-slate-400 mb-1">
              Property Address (optional - for PDF)
            </label>
            <input
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="123 Main St, City, ST 12345"
              className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
            />
            <div className="mt-1 text-[11px] text-white/45">
              Use this if scraping fails or for manual deals
            </div>
          </div>

          {draftError && (
            <div className="mt-3 text-sm text-red-400">{draftError}</div>
          )}

          {isSourceBlocked && (
            <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Source blocked (403). Normal for Zillow/Redfin sometimes. Fill the
              numbers below.
            </div>
          )}

          {draft && (
            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Purchase Price
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white/50"> </span>
                    <span
                      className={confidenceBadgeClass(
                        draft.purchase_price?.confidence
                      )}
                    >
                      {draft.purchase_price?.confidence ?? "—"}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={draft.purchase_price?.value ?? ""}
                    onChange={(e) =>
                      setDraftDpNumber(
                        "purchase_price",
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    className={inputClass(
                      missing.has("purchase_price"),
                      isLowConfidence(draft.purchase_price?.confidence)
                    )}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">ARV</label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white/50"> </span>
                    <span className={confidenceBadgeClass(draft.arv?.confidence)}>
                      {draft.arv?.confidence ?? "—"}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={draft.arv?.value ?? ""}
                    onChange={(e) =>
                      setDraftDpNumber(
                        "arv",
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    className={inputClass(
                      missing.has("arv"),
                      isLowConfidence(draft.arv?.confidence)
                    )}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Rehab Budget
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white/50"> </span>
                    <span
                      className={confidenceBadgeClass(
                        draft.rehab_budget?.confidence
                      )}
                    >
                      {draft.rehab_budget?.confidence ?? "—"}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={draft.rehab_budget?.value ?? ""}
                    onChange={(e) =>
                      setDraftDpNumber(
                        "rehab_budget",
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    className={inputClass(
                      missing.has("rehab_budget"),
                      isLowConfidence(draft.rehab_budget?.confidence)
                    )}
                  />
                </div>

                <div>
                  <label className="block text-xs text-slate-400 mb-1">
                    Est. Monthly Rent (optional)
                  </label>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-white/50"> </span>
                    <span
                      className={confidenceBadgeClass(
                        draft.est_monthly_rent?.confidence
                      )}
                    >
                      {draft.est_monthly_rent?.confidence ?? "—"}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={draft.est_monthly_rent?.value ?? ""}
                    onChange={(e) =>
                      setDraftDpNumber(
                        "est_monthly_rent",
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    className={inputClass(
                      missing.has("est_monthly_rent"),
                      isLowConfidence(draft.est_monthly_rent?.confidence)
                    )}
                  />
                </div>
              </div>

              {analyzeError && (
                <div className="mt-3 text-sm text-red-400">{analyzeError}</div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onFinalizeAnalyze}
                  disabled={!canFinalize || analyzeLoading}
                  className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/10 bg-indigo-600 disabled:opacity-50"
                >
                  {analyzeLoading ? "Analyzing…" : "Finalize & Analyze"}
                </button>

                {!canFinalize && (
                  <div className="text-xs text-white/60">
                    Required: Purchase Price, ARV, Rehab Budget
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* =========================
            Legacy Manual Analyze
           ========================= */}
        <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
          <div className="text-sm font-semibold text-white">
            Manual Analyze (Legacy)
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
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
                Est. Monthly Rent (optional)
              </label>
              <input
                type="number"
                value={monthlyRent}
                onChange={(e) =>
                  setMonthlyRent(e.target.value === "" ? "" : Number(e.target.value))
                }
                className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
              />
            </div>
          </div>

          {FinancingAssumptions}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onAnalyze}
              disabled={loading}
              className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/10 bg-white text-slate-900 disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Analyze Deal"}
            </button>

            {error && <div className="text-sm text-red-400">{error}</div>}
          </div>

          {verdictReason && (
            <div className="mt-3 text-xs text-white/60">
              <span className="text-white/80">Verdict reason:</span> {verdictReason}
            </div>
          )}
        </div>

        {/* =========================
            Results
           ========================= */}
        {result && (
          <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4">
            {/* ✅ moved ShieldHeader here so it doesn't sit above inputs */}
            <ShieldHeader result={result} />

            <div className="mt-4">
              <div className="text-sm font-semibold text-white">Results</div>
              <div className="mt-3">
                <AnalysisResult result={result} meta={pdfMeta} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}