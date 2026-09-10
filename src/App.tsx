import { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, useLocation } from "react-router-dom";
import { useAuth, SignInButton, SignUpButton, SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import AnalysisResult from "./AnalysisResult";
import DealsPage from "./components/DealsPage";
import DealPage from "./components/DealPage";
import RehabScopeEditor from "./components/RehabScopeEditor";
import RevisionComparison from "./components/RevisionComparison";
import { scopeTotals, scopeError } from "./lib/rehabScope";
import type { RehabScope, SavedDeal } from "./lib/types";
import RepairBudgetBuilder from "./components/RepairBudgetBuilder";
import PhotoRehabAnalyzer from "./components/PhotoRehabAnalyzer";
import WorkflowRail from "./components/WorkflowRail";
import InvestorMemoPreview from "./components/InvestorMemoPreview";
import { analyzeDeal, draftFromUrl, enrichAddress, finalizeAndAnalyze, saveDeal } from "./lib/api";
import {
  createDraftAnalysisSnapshot,
  createManualAnalysisSnapshot,
} from "./lib/analysisSnapshot";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DraftDeal,
  Confidence,
  EnrichAddressResponse,
} from "./lib/types";
import type { AnalysisSnapshot } from "./lib/analysisSnapshot";
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

// Mirrors the backend default loan_to_cost_pct = 0.90 (app/models.py). Percent form for display.
const DEFAULT_LTC_PCT = 90;

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
      value: data.value_signal?.estimate != null
        ? Number(data.value_signal.estimate)
        : null,
      confidence: data.value_signal.estimate != null ? "MEDIUM" : "MISSING",
      source: data.value_signal.estimate != null ? "rentcast" : null,
    },
    rehab_budget: { value: null, confidence: "MISSING", source: null },
    est_monthly_rent: {
      value: data.rent_signal?.estimate != null
        ? Number(data.rent_signal.estimate)
        : null,
      confidence: data.rent_signal.estimate != null ? "MEDIUM" : "MISSING",
      source: data.rent_signal.estimate != null ? "rentcast" : null,
    },
    closing_cost_pct: 0.03,
    selling_cost_pct: 0.08,
    holding_months: 6,
    annual_interest_rate: 0.10,
    loan_to_cost_pct: DEFAULT_LTC_PCT / 100,
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
  const [analysisSnapshot, setAnalysisSnapshot] =
    useState<AnalysisSnapshot | null>(null);
  const [isResumed, setIsResumed] = useState(false);
  const [draftScope, setDraftScope] = useState<RehabScope | null>(null);
  const [manualScope, setManualScope] = useState<RehabScope | null>(null);
  const [previousDeal, setPreviousDeal] = useState<SavedDeal | null>(null);
  const [manualPreviousDeal, setManualPreviousDeal] = useState<SavedDeal | null>(null);
  const [comparisonDeal, setComparisonDeal] = useState<SavedDeal | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [savedId, setSavedId] = useState<number | null>(null);
  const activeSnapshot = useRef<AnalysisSnapshot | null>(null);

  // 3c — Address enrichment flow
  const [activeTab, setActiveTab] = useState<"address" | "url">("address");
  const [addressInput, setAddressInput] = useState<string>("");
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichError, setEnrichError] = useState<string>("");

  const location = useLocation();

  useEffect(() => {
    const state = location.state as { resumeDraft?: unknown; resumeDeal?: SavedDeal } | null;
    const incoming = state?.resumeDraft;

    if (
      !incoming ||
      typeof incoming !== "object" ||
      !("purchase_price" in incoming)
    ) return;

    const resumeDraft = incoming as DraftDeal;
    setPreviousDeal(state?.resumeDeal ?? null);
    setDraftScope(state?.resumeDeal?.rehab_scope ? structuredClone(state.resumeDeal.rehab_scope) : null);
    setRevisionNote("");

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
      closing_cost_pct:
        typeof resumeDraft.closing_cost_pct === "number"
          ? resumeDraft.closing_cost_pct
          : 0.03,
      selling_cost_pct:
        typeof resumeDraft.selling_cost_pct === "number"
          ? resumeDraft.selling_cost_pct
          : 0.08,
      holding_months:
        typeof resumeDraft.holding_months === "number"
          ? resumeDraft.holding_months
          : 6,
      annual_interest_rate:
        typeof resumeDraft.annual_interest_rate === "number"
          ? resumeDraft.annual_interest_rate
          : 0.10,
      loan_to_cost_pct:
        typeof resumeDraft.loan_to_cost_pct === "number"
          ? resumeDraft.loan_to_cost_pct
          : DEFAULT_LTC_PCT / 100,
      required_profit_margin_pct:
        typeof resumeDraft.required_profit_margin_pct === "number"
          ? resumeDraft.required_profit_margin_pct
          : 0.12,
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
    setAnalysisSnapshot(null);
    activeSnapshot.current = null;
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
    setAnalysisSnapshot(null);
    activeSnapshot.current = null;
    setSaveError("");
    setSaveSuccess(false);
    setIsResumed(false);
    setPreviousDeal(null);
    setDraftScope(null);
    setRevisionNote("");

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
    setAnalysisSnapshot(null);
    activeSnapshot.current = null;
    setSaveError("");
    setSaveSuccess(false);
    setIsResumed(false);
    setPreviousDeal(null);
    setDraftScope(null);
    setRevisionNote("");

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
    field:
      | "closing_cost_pct"
      | "selling_cost_pct"
      | "holding_months"
      | "annual_interest_rate"
      | "loan_to_cost_pct"
      | "required_profit_margin_pct",
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
    setAnalysisSnapshot(null);
    activeSnapshot.current = null;
    setSaveError("");
    setSaveSuccess(false);

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
      const scopeIssue = scopeError(draftScope, draft.rehab_budget.value);
      if (scopeIssue) throw new Error(scopeIssue);
      setAnalyzeLoading(true);
      // Treat a non-positive draft rent as "no rent" (omitted), without mutating draft state.
      const normalizedDraft =
        draft.est_monthly_rent.value !== null &&
        draft.est_monthly_rent.value <= 0
          ? {
              ...draft,
              est_monthly_rent: { ...draft.est_monthly_rent, value: null },
            }
          : draft;
      const snapshot = createDraftAnalysisSnapshot(normalizedDraft, {
        rehabScope: draftScope, parentDealId: previousDeal?.id ?? null, revisionNote,
        listingUrl:
          normalizedDraft.source === "rentcast"
            ? null
            : listingUrl || normalizedDraft.url,
        propertyAddress:
          normalizedDraft.source === "rentcast"
            ? addressInput || normalizedDraft.address
            : manualAddress || normalizedDraft.address,
      });
      const res = await finalizeAndAnalyze(normalizedDraft);

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
      setAnalysisSnapshot(snapshot);
      activeSnapshot.current = snapshot;
      setResult(res.result);
      setComparisonDeal(previousDeal);
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

  // Manual underwriting assumptions. Percentages are stored in display form
  // here (e.g. 10 = 10%) and converted to decimals in the API payload.
  const [closingCostPct, setClosingCostPct] = useState<number>(3);
  const [sellingCostPct, setSellingCostPct] = useState<number>(8);
  const [holdingMonths, setHoldingMonths] = useState<number>(6);
  const [annualInterestRate, setAnnualInterestRate] = useState<number>(10);
  const [loanToCostPct, setLoanToCostPct] = useState<number>(DEFAULT_LTC_PCT);
  const [requiredProfitMarginPct, setRequiredProfitMarginPct] = useState<number>(12);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  const canAnalyze = useMemo(() => {
    return purchasePrice > 0 && arv > 0 && rehabBudget >= 0;
  }, [purchasePrice, arv, rehabBudget]);

  async function onAnalyze() {
    setError("");
    setResult(null);
    setAnalysisSnapshot(null);
    activeSnapshot.current = null;
    setSaveError("");
    setSaveSuccess(false);

    if (!canAnalyze) {
      setError("Please enter valid Purchase Price, ARV, and Rehab Budget.");
      return;
    }

    const scopeIssue = scopeError(manualScope, rehabBudget);
    if (scopeIssue) { setError(scopeIssue); return; }
    const payload: AnalyzeRequest = {
      purchase_price: purchasePrice,
      arv,
      rehab_budget: rehabBudget,
      closing_cost_pct: closingCostPct / 100,
      selling_cost_pct: sellingCostPct / 100,
      holding_months: holdingMonths,
      annual_interest_rate: annualInterestRate / 100,
      loan_to_cost_pct: loanToCostPct / 100,
      required_profit_margin_pct: requiredProfitMarginPct / 100,
      est_monthly_rent:
        monthlyRent === "" || Number(monthlyRent) <= 0 ? null : monthlyRent,
    };
    const snapshot = createManualAnalysisSnapshot(payload, {
      rehabScope: manualScope, parentDealId: manualPreviousDeal?.id ?? null,
      listingUrl: activeTab === "url" ? listingUrl : null,
      propertyAddress:
        activeTab === "address" ? addressInput : manualAddress,
    });

    try {
      setLoading(true);
      const res = await analyzeDeal(payload);
      setAnalysisSnapshot(snapshot);
      activeSnapshot.current = snapshot;
      setResult(res);
      setComparisonDeal(manualPreviousDeal);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to analyze deal.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  async function onSaveDeal() {
    if (!result || !analysisSnapshot || saveLoading) return;
    setSaveError("");
    setSaveSuccess(false);

    const token = await getToken().catch(() => null);
    if (!token) {
      setSaveError("Could not retrieve auth token. Are you signed in?");
      return;
    }

    try {
      setSaveLoading(true);
      const saved = await saveDeal(
        {
          address: analysisSnapshot.meta.property_address,
          rehab_scope: analysisSnapshot.rehabScope,
          parent_deal_id: analysisSnapshot.parentDealId,
          revision_note: analysisSnapshot.revisionNote,
          draft_input: analysisSnapshot.draftInput as unknown as Record<
            string,
            unknown
          >,
          analysis_result: result as unknown as Record<string, unknown>,
        },
        token
      );
      if (activeSnapshot.current !== analysisSnapshot) return;
      setSavedId(saved.id);
      if (analysisSnapshot.source === "manual") setManualPreviousDeal(saved);
      else setPreviousDeal(saved);
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
    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/50">
        Pre-filled with common defaults. Every value below is used in the
        underwriting math.
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Acquisition Closing Costs (%)
          </label>
          <input
            type="number"
            min={0}
            max={20}
            step={0.25}
            value={closingCostPct}
            onChange={(e) =>
              setClosingCostPct(e.target.value === "" ? 0 : Number(e.target.value))
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Selling Costs (%)
          </label>
          <input
            type="number"
            min={0}
            max={25}
            step={0.25}
            value={sellingCostPct}
            onChange={(e) =>
              setSellingCostPct(e.target.value === "" ? 0 : Number(e.target.value))
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
          />
        </div>

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Holding Months
          </label>
          <input
            type="number"
            min={0}
            max={60}
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
            max={100}
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

        <div>
          <label className="block text-xs text-slate-400 mb-1">
            Required Profit Margin (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={requiredProfitMarginPct}
            onChange={(e) =>
              setRequiredProfitMarginPct(
                e.target.value === "" ? 0 : Number(e.target.value)
              )
            }
            className="w-full rounded-lg bg-slate-900 border border-white/10 px-3 py-2"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0f1115] text-slate-100">
      {/* Nav bar */}
      <div className="border-b border-white/10 bg-black/40 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-5">
          <span className="text-sm font-bold tracking-wide text-white">
            Flip<span className="text-amber-400">Forge</span>
          </span>
          <SignedIn>
            <Link
              to="/"
              className="text-xs font-semibold text-white/70 hover:text-amber-300 transition-colors"
            >
              Analyze
            </Link>
            <Link
              to="/deals"
              className="text-xs font-semibold text-white/70 hover:text-amber-300 transition-colors"
            >
              Saved Deals
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
            Hero — static promise + sample memo preview.
            Hidden once a real result exists so it never implies live data.
           ========================= */}
        {!result && (
          <section className="rounded-2xl border border-amber-500/20 bg-black/40 p-6 md:p-8">
            <div className="grid gap-6 md:grid-cols-2 md:items-center">
              <div>
                <div className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
                  Risk-first deal underwriting
                </div>
                <h1 className="mt-3 font-serif-display text-3xl font-bold leading-tight text-white md:text-4xl">
                  Upload the house.
                  <br />
                  Know the rehab.
                  <br />
                  <span className="text-amber-400">Know the offer.</span>
                </h1>
                <p className="mt-4 max-w-md text-sm text-white/60">
                  FlipForge stress-tests the deal and hands you the max safe
                  offer before you chase the property — not a cashflow
                  calculator, a where-does-this-break engine.
                </p>
              </div>
              <InvestorMemoPreview />
            </div>
          </section>
        )}

        {/* Visual workflow rail — presentational only, not a stepper. */}
        <WorkflowRail />

        {/* =========================
            Property — Address / URL → DraftDeal
           ========================= */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 hover:bg-white/[0.06] transition-colors duration-150">

          {/* Step label — presentational only */}
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
              1
            </span>
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
              Property
            </span>
          </div>

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
              {/* =========================
                  Step 2 — Photos / Rehab (promoted core product cards)
                 ========================= */}
              <div className="mb-4 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
                  2
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
                  Photos / Rehab Intelligence
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-4">
                  <div className="text-sm font-bold text-white">
                    Photo Rehab Analyzer
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    Upload property photos. AI estimates visible condition and a
                    rehab cost range.
                  </div>
                  {draftScope && <p className="mt-2 text-xs text-amber-200/80">Applying a photo estimate replaces this itemized scope with a lump-sum planning allowance.</p>}
                  <PhotoRehabAnalyzer
                    onApply={(v) => { setDraftScope(null); setDraftDpNumber("rehab_budget", v); }}
                  />
                </div>
                <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-4">
                  <div className="text-sm font-bold text-white">
                    Repair Budget Builder
                  </div>
                  <div className="mt-1 text-xs text-white/55">
                    Build a line-item rehab estimate by hand across nine
                    categories.
                  </div>
                  {!draftScope && <RepairBudgetBuilder
                    onApply={(v, scope) => { setDraftScope(scope); setDraftDpNumber("rehab_budget", v); }}
                  />}
                  <RehabScopeEditor scope={draftScope} budget={draft.rehab_budget.value ?? 0} onChange={scope => {
                    setDraftScope(scope);
                    if (scope) setDraftDpNumber("rehab_budget", scopeTotals(scope).total);
                  }} />
                </div>
              </div>

              {previousDeal && <label className="mt-4 block text-sm text-white/70">
                Revision note — compared with saved deal #{previousDeal.id}
                <textarea aria-label="Revision note" value={revisionNote} maxLength={2000} onChange={e => setRevisionNote(e.target.value)} className="mt-2 w-full rounded-xl border border-white/15 bg-slate-950 p-3" placeholder="What changed after the walkthrough or quote?" />
              </label>}
              {/* =========================
                  Step 3 — Deal Assumptions (Deal Numbers / Financing & Holding / Investor Criteria)
                 ========================= */}
              <div className="mt-6 mb-4 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
                  3
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
                  Deal Assumptions
                </span>
              </div>

              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">
                Deal Numbers
              </div>
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
                    readOnly={draftScope !== null}
                    title={draftScope ? "Edit the itemized scope to change this total." : undefined}
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

              {/* Financing & Holding — editable in draft flow */}
              <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">
                Financing &amp; Holding
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Holding Months
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={60}
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
                      max={100}
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

              {/* Transaction costs and investor criteria — all used by underwriting. */}
              <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">
                Transaction Costs &amp; Investor Criteria
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Acquisition Closing Costs (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={20}
                      step={0.25}
                      value={Number((draft.closing_cost_pct * 100).toFixed(4))}
                      onChange={(e) =>
                        setDraftAssumption(
                          "closing_cost_pct",
                          e.target.value === ""
                            ? ""
                            : String(Number(e.target.value) / 100)
                        )
                      }
                      className={inputClass(missing.has("closing_cost_pct"), false)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Selling Costs (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={25}
                      step={0.25}
                      value={Number((draft.selling_cost_pct * 100).toFixed(4))}
                      onChange={(e) =>
                        setDraftAssumption(
                          "selling_cost_pct",
                          e.target.value === ""
                            ? ""
                            : String(Number(e.target.value) / 100)
                        )
                      }
                      className={inputClass(missing.has("selling_cost_pct"), false)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">
                      Required Profit Margin (%)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      value={Number(
                        (draft.required_profit_margin_pct * 100).toFixed(4)
                      )}
                      onChange={(e) =>
                        setDraftAssumption(
                          "required_profit_margin_pct",
                          e.target.value === ""
                            ? ""
                            : String(Number(e.target.value) / 100)
                        )
                      }
                      className={inputClass(
                        missing.has("required_profit_margin_pct"),
                        false
                      )}
                    />
                  </div>
                </div>
                <div className="mt-2 text-xs text-white/65">
                  These values directly affect total project cost and Max Safe Offer.
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

              {/* Step 4 — Generate Investor Memo */}
              <div className="mt-6 mb-3 flex items-center gap-2">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
                  4
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
                  Generate Investor Memo
                </span>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={onFinalizeAnalyze}
                  disabled={!canFinalize || analyzeLoading}
                  className="rounded-xl px-4 py-2 text-sm font-semibold bg-[#E8C547] text-slate-900 shadow-sm shadow-[#E8C547]/20 hover:bg-[#d4b33e] active:scale-95 transition-all duration-150 disabled:bg-[#E8C547]/35 disabled:text-[#F6E27A]/70 disabled:border disabled:border-[#E8C547]/30 disabled:shadow-none disabled:cursor-not-allowed"
                >
                  {analyzeLoading ? "Generating Investor Memo…" : "Generate Investor Memo"}
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
            {showLegacy ? "Hide manual entry ↑" : "Analyze without address lookup ↓"}
          </button>
        </div>

        {/* =========================
            Legacy Manual Analyze
           ========================= */}
        {showLegacy && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3 hover:bg-white/[0.06] transition-colors duration-150">
          <div className="text-sm font-semibold text-white">Manual Entry</div>
          {manualPreviousDeal && <p className="mt-2 text-xs text-amber-200/80">The next saved analysis will be a new revision of deal #{manualPreviousDeal.id}. <a href="/" className="underline">Start a separate deal</a></p>}
          <div className="mt-1 text-xs text-white/55">
            Analyze without address lookup — enter the numbers directly.
          </div>

          {/* =========================
              Step 2 — Photos / Rehab Intelligence (promoted core product cards)
             ========================= */}
          <div className="mt-5 mb-4 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
              2
            </span>
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
              Photos / Rehab Intelligence
            </span>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-4">
              <div className="text-sm font-bold text-white">
                Photo Rehab Analyzer
              </div>
              <div className="mt-1 text-xs text-white/55">
                Upload property photos. AI estimates visible condition and a
                rehab cost range.
              </div>
              {manualScope && <p className="mt-2 text-xs text-amber-200/80">Applying a photo estimate replaces this itemized scope with a lump-sum planning allowance.</p>}
              <PhotoRehabAnalyzer onApply={(mid) => { setManualScope(null); setRehabBudget(mid); }} />
            </div>
            <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-4">
              <div className="text-sm font-bold text-white">
                Repair Budget Builder
              </div>
              <div className="mt-1 text-xs text-white/55">
                Build a line-item rehab estimate by hand across nine categories.
              </div>
              {!manualScope && <RepairBudgetBuilder onApply={(mid, scope) => { setManualScope(scope); setRehabBudget(mid); }} />}
              <RehabScopeEditor scope={manualScope} budget={rehabBudget} onChange={scope => {
                setManualScope(scope);
                if (scope) setRehabBudget(scopeTotals(scope).total);
              }} />
            </div>
          </div>

          {/* =========================
              Step 3 — Deal Assumptions
             ========================= */}
          <div className="mt-6 mb-4 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
              3
            </span>
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
              Deal Assumptions
            </span>
          </div>

          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">
            Deal Numbers
          </div>
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
                readOnly={manualScope !== null}
                title={manualScope ? "Edit the itemized scope to change this total." : undefined}
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

          {/* Underwriting Controls */}
          <div className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wide text-white/60">
            Underwriting Controls
          </div>
          {FinancingAssumptions}

          {/* Step 4 — Generate Investor Memo */}
          <div className="mt-6 mb-3 flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
              4
            </span>
            <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
              Generate Investor Memo
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={onAnalyze}
              disabled={loading}
              className="rounded-xl px-5 py-2.5 text-sm font-bold bg-amber-400 text-slate-900 shadow-sm hover:bg-amber-500 active:scale-95 transition-all duration-150 disabled:bg-amber-400/30 disabled:text-amber-100/60 disabled:shadow-none disabled:cursor-not-allowed"
            >
              {loading ? "Generating Investor Memo…" : "Generate Investor Memo"}
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
        {result && analysisSnapshot && (
          <div className="rounded-2xl border border-amber-500/20 bg-black/40 p-3">
            <div className="mt-4">
              <div className="flex items-center gap-2 px-3">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
                  5
                </span>
                <span className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
                  Investor Memo
                </span>
              </div>
              <div className="mt-3">
                <p className="mb-3 text-xs text-white/60">This memo uses the submitted inputs. Later edits take effect only after generating a new memo. Holding costs model loan interest; separate taxes, insurance, utilities, financing points and draw timing are not modeled.</p>
                <AnalysisResult result={result} meta={analysisSnapshot.meta} />
                <RehabScopeEditor scope={analysisSnapshot.rehabScope} readOnly />
                {comparisonDeal && analysisSnapshot.parentDealId === comparisonDeal.id && <RevisionComparison previous={comparisonDeal} current={{
                  draft_input: analysisSnapshot.draftInput as unknown as Record<string, unknown>,
                  analysis_result: result as unknown as Record<string, unknown>,
                  rehab_scope: analysisSnapshot.rehabScope, revision_note: analysisSnapshot.revisionNote,
                }} />}
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
                      : analysisSnapshot.parentDealId ? "Save New Revision" : "Save Deal"}
                  </button>
                  {saveSuccess && (
                    <Link
                      to={savedId ? `/deal/${savedId}` : "/deals"}
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                    >
                      View saved version →
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
            <div className="text-xs font-semibold uppercase tracking-widest text-amber-300/80">
              Risk-first deal underwriting
            </div>
            <div className="mt-3 font-serif-display text-2xl font-bold text-white">
              Upload the house. Know the rehab.{" "}
              <span className="text-amber-400">Know the offer.</span>
            </div>
            <div className="mt-3 text-sm text-white/60">
              Sign in or create an account to generate your first Investor Memo.
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
