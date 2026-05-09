import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useAuth, SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import AnalysisResult from "./AnalysisResult";
import ShieldHeader from "./components/ShieldHeader";
import DealsPage from "./components/DealsPage";
import DealPage from "./components/DealPage";
import { analyzeDeal, draftFromUrl, enrichAddress, finalizeAndAnalyze, saveDeal } from "./lib/api";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DraftDeal,
  Confidence,
  EnrichAddressResponse,
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

const FIELD_LABELS: Record<string, string> = {
  purchase_price: "Purchase Price",
  arv: "ARV",
  rehab_budget: "Rehab Budget",
  est_monthly_rent: "Est. Monthly Rent",
  holding_months: "Holding Months",
  annual_interest_rate: "Interest Rate (%)",
  loan_to_cost_pct: "LTC (%)",
};

// 3d — Maps a RentCast EnrichAddressResponse into a DraftDeal for the editor.
// ARV ← value_signal.estimate, rent ← rent_signal.estimate.
// purchase_price and rehab_budget are always null — user must fill them.
// All defaults match the backend DraftDeal model exactly (loan_to_cost_pct: 0.90).
function enrichResponseToDraft(
  address: string,
  data: EnrichAddressResponse
): DraftDeal {
  return {
    source: "rentcast",
    address,
    url: null,
    zip_code: null,
    region: null,
    purchase_price: { value: null, confidence: "MISSING", source: null },
    arv: {
      value: data.value_signal.estimate,
      confidence: data.value_signal.estimate != null ? "MEDIUM" : "MISSING",
      source: data.value_signal.estimate != null ? "rentcast" : null,
    },
    rehab_budget: { value: null, confidence: "MISSING", source: null },
    est_monthly_rent: {
      value: data.rent_signal.estimate,
      confidence: data.rent_signal.estimate != null ? "MEDIUM" : "MISSING",
      source: data.rent_signal.estimate != null ? "rentcast" : null,
    },
    closing_cost_pct: 0.03,
    selling_cost_pct: 0.08,
    holding_months: 6,
    annual_interest_rate: 0.10,
    loan_to_cost_pct: 0.90,
    required_profit_margin_pct: 0.12,
    notes: [],
    signals: [],
  };
}

function AnalyzerPage() {
  const { getToken } = useAuth();

  // Save Deal state
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState<string>("");
  const [saveSuccess, setSaveSuccess] = useState(false);

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
  const [isResumed, setIsResumed] = useState(false);

  // 3c — Address enrichment flow
  const [activeTab, setActiveTab] = useState<"address" | "url">("address");
  const [addressInput, setAddressInput] = useState<string>("");
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichError, setEnrichError] = useState<string>("");

  const location = useLocation();

  useEffect(() => {
    const state = location.state as { resumeDraft?: unknown } | null;
    const incoming = state?.resumeDraft;

    if (
      !incoming ||
      typeof incoming !== "object" ||
      !("purchase_price" in incoming)
    ) return;

    const resumeDraft = incoming as DraftDeal;

    const VALID_CONFIDENCE = new Set(["HIGH", "MEDIUM", "LOW", "MISSING"]);
    const fixDp = (dp: any): any =>
      dp && typeof dp === "object"
        ? {
            ...dp,
            confidence:
              typeof dp.confidence === "string" && VALID_CONFIDENCE.has(dp.confidence)
                ? dp.confidence
                : "MISSING",
          }
        : dp;
    setDraft({
      ...resumeDraft,
      source: resumeDraft.source ?? "saved",
      purchase_price: fixDp(resumeDraft.purchase_price),
      arv: fixDp(resumeDraft.arv),
      rehab_budget: fixDp(resumeDraft.rehab_budget),
      est_monthly_rent: fixDp(resumeDraft.est_monthly_rent),
    });
    setIsResumed(true);

    // 3f — Restore correct tab and address input when resuming
    if (resumeDraft.source === "rentcast") {
      setActiveTab("address");
      setAddressInput(resumeDraft.address ?? "");
    } else {
      setActiveTab("url");
      setListingUrl(resumeDraft.url ?? "");
      setManualAddress(resumeDraft.address ?? "");
    }

    setMissingFields([]);
    setDraftLoading(false);
    setDraftError("");
    setEnrichError("");
    setAnalyzeLoading(false);
    setAnalyzeError("");
    setResult(null);
    setSaveLoading(false);
    setSaveError("");
    setSaveSuccess(false);
    setLoading(false);
    setError("");

    window.history.replaceState({}, "");
  }, [location.state]);

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
    setEnrichError("");
    setAnalyzeError("");
    setMissingFields([]);
    setResult(null);
    setIsResumed(false);

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

  // 3e — Address enrichment handler
  async function onEnrichAddress() {
    setEnrichError("");
    setDraftError("");
    setAnalyzeError("");
    setMissingFields([]);
    setResult(null);
    setIsResumed(false);

    const trimmed = addressInput.trim();
    if (!trimmed) {
      setEnrichError("Enter a property address first.");
      return;
    }

    try {
      setEnrichLoading(true);
      const data = await enrichAddress(trimmed);
      setDraft(enrichResponseToDraft(trimmed, data));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to look up address.";
      setEnrichError(msg);
      setDraft(null);
    } finally {
      setEnrichLoading(false);
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

  function setDraftAssumption(
    field: "holding_months" | "annual_interest_rate" | "loan_to_cost_pct",
    v: string
  ) {
    if (!draft) return;
    const num = v === "" ? 0 : Number(v);
    if (!Number.isFinite(num)) return;
    setDraft({ ...draft, [field]: num });
  }

  async function onFinalizeAnalyze() {
    setAnalyzeError("");
    setDraftError("");
    setEnrichError("");
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
        const fields = res.missing_fields || [];
        setMissingFields(fields);
        const names = fields.map((f) => FIELD_LABELS[f] || f).join(", ");
        setAnalyzeError(
          names
            ? `Missing: ${names}`
            : "Missing required fields. Fill the highlighted inputs."
        );
        return;
      }

      setMissingFields([]);
      setAnalyzeError("");
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
  const [showLegacy, setShowLegacy] = useState(false);
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

  async function onSaveDeal() {
    if (!result) return;
    setSaveError("");
    setSaveSuccess(false);

    const token = await getToken().catch(() => null);
    if (!token) {
      setSaveError("Could not retrieve auth token. Are you signed in?");
      return;
    }

    try {
      setSaveLoading(true);
      const addr =
        (draft as DraftDeal | null)?.address ??
        (pdfMeta.property_address as string | null) ??
        null;
      await saveDeal(
        {
          address: addr,
          draft_input: draft
            ? (draft as unknown as Record<string, unknown>)
            : {
                purchase_price:   { value: pdfMeta.purchase_price   ?? null, confidence: "MANUAL" },
                arv:              { value: pdfMeta.arv              ?? null, confidence: "MANUAL" },
                rehab_budget:     { value: pdfMeta.rehab_budget     ?? null, confidence: "MANUAL" },
                est_monthly_rent: { value: pdfMeta.est_monthly_rent ?? null, confidence: "MANUAL" },
              },
          analysis_result: result as unknown as Record<string, unknown>,
        },
        token
      );
      setSaveSuccess(true);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save deal.";
      setSaveError(msg);
    } finally {
      setSaveLoading(false);
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
    <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
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

      <div className="mt-2 text-xs text-white/65">
        Used only to estimate carry in the lender report. Does not change underwriting
        math.
      </div>
    </div>
  );

  // 3g — Meta passed to AnalysisResult for PDF. Address flow uses addressInput.
  const pdfMeta = useMemo(() => {
    const addr = (draft as any)?.address ?? null;

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
      listing_url: activeTab === "url" ? (listingUrl?.trim() || null) : null,
      property_address:
        (activeTab === "address" ? addressInput.trim() || null : null) ??
        addr ??
        manualAddress.trim() ??
        null,

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
    activeTab,
    addressInput,
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
    <div className="min-h-screen bg-[#0f1115] text-slate-100">
      {/* Nav bar */}
      <div className="border-b border-white/10 bg-white/[0.04] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold text-white">FlipForge</span>
          <SignedIn>
            <Link
              to="/deals"
              className="text-xs text-white/60 hover:text-white transition-colors"
            >
              My Deals
            </Link>
          </SignedIn>
        </div>
        <div className="flex items-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="rounded-lg px-3 py-1.5 text-xs font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors">
                Sign In
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </div>

      <SignedIn>
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        {/* =========================
            Address / URL → DraftDeal
           ========================= */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 hover:bg-white/[0.06] transition-colors duration-150">

          {/* 3h — Card header: tabs when not resumed, plain label when resumed */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {isResumed ? (
                <div className="text-sm font-semibold text-white">Resumed Deal</div>
              ) : (
                <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] p-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab("address")}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                      activeTab === "address"
                        ? "bg-white/[0.12] text-white"
                        : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    Address
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("url")}
                    className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                      activeTab === "url"
                        ? "bg-white/[0.12] text-white"
                        : "text-white/50 hover:text-white/80"
                    }`}
                  >
                    URL
                  </button>
                </div>
              )}
              <div className="mt-1 text-xs text-white/60">
                {isResumed
                  ? "Resumed from a saved deal. Review the fields and re-analyze."
                  : activeTab === "address"
                  ? "Enter a property address to look up data. Fill gaps. Then analyze."
                  : "Paste a listing URL. We extract what we can. Fill gaps. Then analyze."}
              </div>
            </div>

            {/* 3l — Source badge: special copy for rentcast */}
            {draft?.source && (
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/70">
                {draft.source === "rentcast"
                  ? "Source: RentCast · Suggested fields are estimates. Review before analyzing."
                  : `Source: ${draft.source}`}
              </span>
            )}
          </div>

          {/* 3i + 3j — Conditional inputs: address tab vs URL tab */}
          {activeTab === "address" ? (
            <div className="mt-4 flex flex-col gap-3 md:flex-row">
              <input
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && onEnrichAddress()}
                placeholder="123 Main St, City, ST 12345"
                className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 placeholder:text-white/40"
              />
              <button
                type="button"
                onClick={onEnrichAddress}
                disabled={enrichLoading}
                className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors disabled:bg-white/[0.04] disabled:text-white/40 disabled:border-white/[0.08] disabled:cursor-not-allowed"
              >
                {enrichLoading ? "Looking up…" : "Look Up"}
              </button>
            </div>
          ) : (
            <>
              <div className="mt-4 flex flex-col gap-3 md:flex-row">
                <input
                  value={listingUrl}
                  onChange={(e) => setListingUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 placeholder:text-white/40"
                />
                <button
                  type="button"
                  onClick={onFetchDraft}
                  disabled={draftLoading}
                  className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors disabled:bg-white/[0.04] disabled:text-white/40 disabled:border-white/[0.08] disabled:cursor-not-allowed"
                >
                  {draftLoading ? "Fetching…" : "Fetch Draft"}
                </button>
              </div>

              {/* Manual address override — URL flow only */}
              <div className="mt-3">
                <label className="block text-xs text-slate-400 mb-1">
                  Property Address (optional - for PDF)
                </label>
                <input
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder="123 Main St, City, ST 12345"
                  className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2 placeholder:text-white/40"
                />
                <div className="mt-1 text-xs text-white/65">
                  Use this if scraping fails or for manual deals
                </div>
              </div>
            </>
          )}

          {(draftError || enrichError) && (
            <div className="mt-3 text-sm text-red-400">{draftError || enrichError}</div>
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
                  {/* 3k — Suggested label for RentCast-filled fields */}
                  {draft.purchase_price?.source === "rentcast" && (
                    <div className="mt-1 text-[10px] text-amber-400/70">Suggested · Verify before analyzing</div>
                  )}
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
                  {draft.arv?.source === "rentcast" && (
                    <div className="mt-1 text-[10px] text-amber-400/70">Suggested · Verify before analyzing</div>
                  )}
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
                  {draft.rehab_budget?.source === "rentcast" && (
                    <div className="mt-1 text-[10px] text-amber-400/70">Suggested · Verify before analyzing</div>
                  )}
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
                  {draft.est_monthly_rent?.source === "rentcast" && (
                    <div className="mt-1 text-[10px] text-amber-400/70">Suggested · Verify before analyzing</div>
                  )}
                </div>
              </div>

              {/* Assumptions — editable in draft flow */}
              <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.04] p-4">
                <div className="text-xs uppercase tracking-wide text-white/60">
                  Assumptions
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
                      value={draft.holding_months}
                      onChange={(e) =>
                        setDraftAssumption("holding_months", e.target.value)
                      }
                      className={inputClass(missing.has("holding_months"), false)}
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
                      value={Number((draft.annual_interest_rate * 100).toFixed(4))}
                      onChange={(e) =>
                        setDraftAssumption(
                          "annual_interest_rate",
                          e.target.value === "" ? "" : String(Number(e.target.value) / 100)
                        )
                      }
                      className={inputClass(missing.has("annual_interest_rate"), false)}
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
                      value={Number((draft.loan_to_cost_pct * 100).toFixed(4))}
                      onChange={(e) =>
                        setDraftAssumption(
                          "loan_to_cost_pct",
                          e.target.value === "" ? "" : String(Number(e.target.value) / 100)
                        )
                      }
                      className={inputClass(missing.has("loan_to_cost_pct"), false)}
                    />
                  </div>
                </div>
                <div className="mt-2 text-xs text-white/65">
                  Pre-filled from backend defaults. Adjust if needed.
                </div>
              </div>

              {/* Extraction notes / signals */}
              {((draft.notes?.length ?? 0) > 0 ||
                (draft.signals?.length ?? 0) > 0) && (
                <div className="mt-3 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="text-xs uppercase tracking-wide text-white/60 mb-2">
                    Extraction notes
                  </div>
                  {draft.signals?.map((s, i) => (
                    <div key={i} className="text-xs text-white/70">
                      • {s}
                    </div>
                  ))}
                  {draft.notes?.map((n, i) => (
                    <div key={i} className="text-xs text-white/70">
                      • {n}
                    </div>
                  ))}
                </div>
              )}

              {analyzeError && (
                <div className="mt-3 text-sm text-red-400">{analyzeError}</div>
              )}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onFinalizeAnalyze}
                  disabled={!canFinalize || analyzeLoading}
                  className="rounded-xl px-4 py-2 text-sm font-semibold bg-[#E8C547] text-slate-900 hover:bg-[#d4b33e] active:scale-95 transition-all duration-150 disabled:bg-white/[0.06] disabled:text-white/40 disabled:cursor-not-allowed"
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

        {/* Legacy toggle */}
        <div className="text-center">
          <button
            type="button"
            onClick={() => setShowLegacy((v) => !v)}
            className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors"
          >
            {showLegacy ? "Hide legacy analyzer ↑" : "Show legacy analyzer ↓"}
          </button>
        </div>

        {/* =========================
            Legacy Manual Analyze
           ========================= */}
        {showLegacy && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 hover:bg-white/[0.06] transition-colors duration-150">
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
              className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors disabled:bg-white/[0.04] disabled:text-white/40 disabled:border-white/[0.08] disabled:cursor-not-allowed"
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
        )}

        {/* =========================
            Results
           ========================= */}
        {result && (
          <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 hover:bg-white/[0.06] transition-colors duration-150">
            {/* ✅ moved ShieldHeader here so it doesn't sit above inputs */}
            <ShieldHeader result={result} />

            <div className="mt-4">
              <div className="text-[11px] uppercase tracking-widest text-white/60">Results</div>
              <div className="mt-3">
                <AnalysisResult result={result} meta={pdfMeta} />
              </div>

              {/* Save Deal — visible only when signed in */}
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <SignedIn>
                  <button
                    type="button"
                    onClick={onSaveDeal}
                    disabled={saveLoading || saveSuccess}
                    className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.25] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors disabled:bg-white/[0.04] disabled:text-white/40 disabled:border-white/[0.08] disabled:cursor-not-allowed"
                  >
                    {saveLoading
                      ? "Saving…"
                      : saveSuccess
                      ? "Saved!"
                      : "Save Deal"}
                  </button>
                  {saveSuccess && (
                    <Link
                      to="/deals"
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      View in My Deals →
                    </Link>
                  )}
                  {saveError && (
                    <span className="text-xs text-red-400">{saveError}</span>
                  )}
                </SignedIn>
                <SignedOut>
                  <SignInButton mode="modal">
                    <button
                      type="button"
                      className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors"
                    >
                      Sign in to Save Deal
                    </button>
                  </SignInButton>
                </SignedOut>
              </div>
            </div>
          </div>
        )}
      </div>
      </SignedIn>
      <SignedOut>
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
          <div className="text-center">
            <div className="text-xl font-semibold text-white">Welcome to FlipForge</div>
            <div className="mt-2 text-sm text-white/60">
              Sign in or create an account to analyze deals.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <SignInButton mode="modal">
              <button className="rounded-lg px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="rounded-lg px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors">
                Create Account
              </button>
            </SignUpButton>
          </div>
        </div>
      </SignedOut>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<AnalyzerPage />} />
      <Route path="/deals" element={<DealsPage />} />
      <Route path="/deal/:id" element={<DealPage />} />
    </Routes>
  );
}
