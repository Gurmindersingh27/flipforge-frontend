import { useState } from "react";
import type { AnalyzeResponse, Strategy, Verdict } from "./lib/types";
import { generateNegotiationScript } from "./lib/api";
import DealKillerSummary from "./components/DealKillerSummary";
import InvestorActionPlan from "./components/InvestorActionPlan";

interface Props {
  result: AnalyzeResponse;
  // Optional meta from App/page.tsx so the PDF can show URL/address/hold/LTC/rate/carry.
  meta?: Record<string, any>;
}

const API_BASE = (
  (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://127.0.0.1:8000"
).replace(/\/+$/, "");

function rehabBadgeClass(sev?: string) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border";
  if (sev === "LIGHT")
    return `${base} border-slate-500/40 text-slate-200 bg-slate-500/10`;
  if (sev === "MEDIUM")
    return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  if (sev === "HEAVY")
    return `${base} border-orange-500/40 text-orange-200 bg-orange-500/10`;
  if (sev === "EXTREME")
    return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  return `${base} border-white/10 text-white/60 bg-white/5`;
}

function breakpointBadgeClass(isFragile?: boolean) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border";
  if (isFragile)
    return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  return `${base} border-emerald-500/40 text-emerald-200 bg-emerald-500/10`;
}

function verdictBadgeClass(verdict?: string) {
  const base =
    "verdict-badge font-serif-display inline-flex items-center rounded-lg px-3 py-1.5 text-sm font-bold border";
  if (verdict === "BUY")
    return `${base} border-[#E8C547]/50 text-[#E8C547] bg-[#E8C547]/10`;
  if (verdict === "CONDITIONAL")
    return `${base} border-amber-400/60 text-amber-300 bg-amber-400/10`;
  if (verdict === "PASS")
    return `${base} border-red-500/50 text-red-300 bg-red-500/10`;
  return `${base} border-white/10 text-white/60 bg-white/5`;
}

function riskFlagBadgeClass(severity?: string) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border";
  if (severity === "critical")
    return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  if (severity === "moderate")
    return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  if (severity === "mild")
    return `${base} border-slate-500/40 text-slate-200 bg-slate-500/10`;
  return `${base} border-white/10 text-white/60 bg-white/5`;
}

function stressChipClass(verdict?: string) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border";
  if (verdict === "BUY")
    return `${base} border-emerald-500/40 text-emerald-200 bg-emerald-500/10`;
  if (verdict === "CONDITIONAL")
    return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  if (verdict === "PASS")
    return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  return `${base} border-white/10 text-white/60 bg-white/5`;
}

function verdictRank(v: string): number {
  if (v === "BUY") return 2;
  if (v === "CONDITIONAL") return 1;
  return 0;
}

function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function fmtPctDecimalToPct(n: number) {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

// safe clipboard helper (with fallback)
async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}

function strategyName(s: Strategy) {
  if (s === "flip") return "Flip";
  if (s === "brrrr") return "BRRRR";
  return "Wholesale";
}

function pickStrategyVerdict(r: AnalyzeResponse): Verdict {
  if (r.best_strategy === "flip") return r.flip_verdict;
  if (r.best_strategy === "brrrr") return r.brrrr_verdict;
  return r.wholesale_verdict;
}

// Main overpay explanation — dollar math for the gap lives here (Offer Safety block).
function buildOfferGapCallout(purchasePrice: number, mao: number) {
  if (purchasePrice <= 0 || mao <= 0) return null;
  const gap = purchasePrice - mao;
  const absGap = Math.abs(gap);
  const fmtGap = `$${absGap.toLocaleString()}`;

  if (gap > 0) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
        <div className="text-[10px] uppercase tracking-widest text-red-300/70 mb-1.5">
          Overpay Risk
        </div>
        <p className="text-sm text-red-200 leading-relaxed">
          You are <span className="font-semibold">{fmtGap} over</span> the Max
          Safe Offer.{" "}
          {absGap >= 15000
            ? "At this price, the deal has limited room for ARV or rehab misses."
            : "This deal may still work, but leaves little margin for error."}
        </p>
      </div>
    );
  }

  if (absGap <= 5000) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-5">
        <div className="text-[10px] uppercase tracking-widest text-amber-300/70 mb-1.5">
          Offer Gap
        </div>
        <p className="text-sm text-amber-200 leading-relaxed">
          You are <span className="font-semibold">within {fmtGap}</span> of the
          Max Safe Offer. This deal may work, but only if ARV and rehab
          assumptions hold.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-5">
      <div className="text-[10px] uppercase tracking-widest text-emerald-300/70 mb-1.5">
        Offer Cushion
      </div>
      <p className="text-sm text-emerald-200 leading-relaxed">
        You are <span className="font-semibold">{fmtGap} under</span> the Max
        Safe Offer. The offer has some cushion before the deal breaks.
      </p>
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
}

export default function AnalysisResult({ result, meta }: Props) {
  const rehab = result.rehab_reality;
  const bp = result.breakpoints;

  // If allowed_outputs is missing (legacy/manual analyze), default to enabled.
  const allowed = result.allowed_outputs;
  const canReport = allowed ? !!allowed.lender_report : true;
  const canScript = allowed ? !!allowed.negotiation_script : true;

  const [script, setScript] = useState<string | null>(null);
  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState<string | null>(null);

  // Copy action feedback (ported from ShieldHeader)
  const [offerCopied, setOfferCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);

  // Build verdict rationale bullets from backend notes (primary) + stress context.
  // result.notes is populated by build_notes() in analysis_engine.py — human-readable.
  const whyBullets: string[] = [];
  if (result.notes?.length > 0) {
    whyBullets.push(...result.notes);
  } else if (result.net_profit <= 0) {
    whyBullets.push("Deal loses money in the base case.");
  } else {
    whyBullets.push("Deal is profitable assuming inputs are accurate.");
  }
  if (bp?.is_fragile && bp?.first_break_scenario) {
    whyBullets.push(`Breaks under "${bp.first_break_scenario}" stress test.`);
  }
  const baseRank = verdictRank(result.stress_tests?.[0]?.verdict ?? "");
  const firstDowngrade = result.stress_tests?.slice(1).find(
    (s) => verdictRank(s.verdict) < baseRank
  );
  if (firstDowngrade) {
    whyBullets.push(
      `"${firstDowngrade.name}" stress test reduces verdict to ${firstDowngrade.verdict}.`
    );
  }

  // Offer Safety inputs — purchase price arrives via meta and may be absent (legacy flow).
  const purchasePriceMeta =
    typeof meta?.purchase_price === "number" && meta.purchase_price > 0
      ? meta.purchase_price
      : null;
  const offerGapBlock =
    purchasePriceMeta !== null
      ? buildOfferGapCallout(purchasePriceMeta, result.max_safe_offer)
      : null;

  const negotiateFirstDelta =
    result.overall_verdict === "BUY" &&
    purchasePriceMeta !== null &&
    purchasePriceMeta > result.max_safe_offer
      ? `$${(purchasePriceMeta - result.max_safe_offer).toLocaleString()}`
      : null;

  const verdict = result.overall_verdict;
  const bestStrategy: Strategy = result.best_strategy ?? "flip";
  const strategyVerdict = pickStrategyVerdict(result);
  const confidence = Math.max(
    0,
    Math.min(100, Number(result.confidence_score ?? 0))
  );

  // One-line decision summary: backend verdict_reason first, then notes, then fallback.
  const decisionSummary =
    (typeof result.verdict_reason === "string" && result.verdict_reason.trim()) ||
    result.notes?.[0] ||
    (verdict === "BUY"
      ? "Deal pencils at current assumptions."
      : verdict === "CONDITIONAL"
      ? "Deal may work, but key assumptions must be verified first."
      : "Deal does not pencil at current terms.");

  // ARV and LTC arrive via meta. LTC is a user-entered financing assumption,
  // NOT engine output — it must always be labeled as assumed.
  const arvMeta =
    typeof meta?.arv === "number" && meta.arv > 0 ? meta.arv : null;
  const ltcMeta =
    typeof meta?.ltc_pct === "number" && meta.ltc_pct > 0 ? meta.ltc_pct : null;

  const offerGapValue =
    purchasePriceMeta !== null ? purchasePriceMeta - result.max_safe_offer : null;
  const marginOfSafetyPct =
    purchasePriceMeta !== null && result.max_safe_offer > 0
      ? ((result.max_safe_offer - purchasePriceMeta) / result.max_safe_offer) * 100
      : null;

  const offer = Number(result.max_safe_offer ?? 0);
  const offerText = fmtMoney(offer);
  const profit = Number(result.net_profit ?? result.gross_profit ?? 0);
  // Match the Risk Flags card: prefer typed_flags, fall back to legacy risk_flags.
  const riskCount =
    (result.typed_flags?.length ?? 0) > 0
      ? result.typed_flags.length
      : result.risk_flags?.length ?? 0;

  async function onCopyOffer() {
    const ok = await copyToClipboard(String(Math.round(offer)));
    if (ok) {
      setOfferCopied(true);
      window.setTimeout(() => setOfferCopied(false), 1200);
    } else {
      setOfferCopied(false);
    }
  }

  async function onCopySummary() {
    const summary = [
      `${verdict}`,
      `Offer ${offerText}`,
      `Net ${fmtMoney(profit)}`,
      `Profit ${fmtPctDecimalToPct(Number(result.profit_pct ?? 0))}`,
      `ROI ${fmtPctDecimalToPct(Number(result.annualized_roi ?? 0))}`,
      `Flags ${riskCount}`,
      `Strategy ${bestStrategy}`,
      `Conf ${confidence}/100`,
    ].join(" | ");

    const ok = await copyToClipboard(summary);
    if (ok) {
      setSummaryCopied(true);
      window.setTimeout(() => setSummaryCopied(false), 1200);
    } else {
      setSummaryCopied(false);
    }
  }

  async function onGenerateScript() {
    setScriptLoading(true);
    setScriptError(null);
    try {
      const data = await generateNegotiationScript({
        result,
        seller_ask_price: null,
        property_address: (meta?.property_address as string | undefined) ?? null,
      });
      setScript(data.negotiation_script);
    } catch (e: any) {
      setScriptError(e?.message || "Failed to generate negotiation script.");
    } finally {
      setScriptLoading(false);
    }
  }

  async function onDownloadLenderReport() {
    try {
      const payload = { result, meta: meta || {} };

      const res = await fetch(`${API_BASE}/api/export/lender-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        let msg = "Failed to generate lender report.";
        try {
          const j = await res.json();
          msg = j?.detail || j?.message || msg;
        } catch {}
        throw new Error(msg);
      }

      const blob = await res.blob();
      downloadBlob(blob, "flipforge_lender_report_v0.pdf");
    } catch (e: any) {
      alert(e?.message || "Failed to generate lender report.");
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6 text-left">
      {/* ============ 1. Decision Header ============ */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 space-y-4">
        <div className="text-[11px] uppercase tracking-widest text-white/60">
          Decision
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <span className={verdictBadgeClass(verdict)}>{verdict}</span>

          {negotiateFirstDelta !== null && (
            <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold border border-amber-500/40 text-amber-200 bg-amber-500/10">
              NEGOTIATE FIRST • {negotiateFirstDelta} over MAO
            </span>
          )}

          <span className="text-xs text-white/80">
            Best strategy:{" "}
            <span className="font-semibold text-white">
              {strategyName(bestStrategy)}
            </span>{" "}
            <span className="text-white/50">({strategyVerdict})</span>
          </span>

          <span className="text-xs text-white/80">
            Confidence:{" "}
            <span className="font-semibold text-white">{confidence}</span>/100
          </span>
        </div>

        <p className="text-sm text-white/85 leading-relaxed">{decisionSummary}</p>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onCopyOffer}
            className="rounded-full border border-white/[0.15] bg-white/[0.08] text-white px-3 py-1 text-xs font-semibold hover:bg-white/[0.12]"
            title="Copy max safe offer number to clipboard"
          >
            {offerCopied ? "Copied ✓" : `Copy Offer ${offerText}`}
          </button>

          <button
            type="button"
            onClick={onCopySummary}
            className="rounded-full border border-white/[0.15] bg-white/[0.08] text-white px-3 py-1 text-xs font-semibold hover:bg-white/[0.12]"
            title="Copy a one-line deal summary"
          >
            {summaryCopied ? "Summary Copied ✓" : "Copy Summary"}
          </button>
        </div>
      </section>

      {/* ============ 2. Offer Safety ============ */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 space-y-5">
        <div className="text-[11px] uppercase tracking-widest text-white/60">
          Offer Safety
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-widest text-white/50 mb-2">
            Max Safe Offer
          </div>
          <div className="font-jetbrains text-5xl font-bold text-[#E8C547] leading-none pb-1">
            ${result.max_safe_offer.toLocaleString()}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-3 gap-y-4 border-t border-white/[0.06] pt-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Purchase Price
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {purchasePriceMeta !== null
                ? `$${purchasePriceMeta.toLocaleString()}`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Offer Gap
            </div>
            <div
              className={`font-jetbrains text-lg font-medium ${
                offerGapValue === null
                  ? "text-white/70"
                  : offerGapValue > 0
                  ? "text-red-300"
                  : "text-emerald-300"
              }`}
            >
              {offerGapValue === null
                ? "—"
                : offerGapValue > 0
                ? `$${offerGapValue.toLocaleString()} over`
                : `$${Math.abs(offerGapValue).toLocaleString()} under`}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Total Project Cost
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              ${result.total_project_cost.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              LTC (assumed)
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {ltcMeta !== null ? `${ltcMeta}%` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Margin of Safety
            </div>
            <div
              className={`font-jetbrains text-lg font-medium ${
                marginOfSafetyPct === null
                  ? "text-white/70"
                  : marginOfSafetyPct < 0
                  ? "text-red-300"
                  : "text-emerald-300"
              }`}
            >
              {marginOfSafetyPct === null
                ? "—"
                : `${marginOfSafetyPct.toFixed(1)}%`}
            </div>
          </div>
        </div>

        {ltcMeta !== null && (
          <div className="text-xs text-white/50">
            LTC is a financing assumption you entered — not computed by
            underwriting.
          </div>
        )}

        {purchasePriceMeta === null && (
          <div className="text-xs text-white/50">
            Purchase price not provided — gap analysis unavailable.
          </div>
        )}

        {/* Main overpay explanation — Overpay Risk / Offer Gap / Offer Cushion */}
        {offerGapBlock}
      </section>

      {/* ============ 3. Downside & Stress ============ */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 space-y-4">
        <div className="text-[11px] uppercase tracking-widest text-white/60">
          Downside &amp; Stress
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          {rehab && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest text-white/60">
                Rehab
              </span>
              <span className={rehabBadgeClass(rehab.severity)}>
                {rehab.severity}
              </span>
            </div>
          )}

          {bp && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest text-white/60">
                Breakpoint
              </span>
              <span className={breakpointBadgeClass(bp.is_fragile)}>
                {bp.first_break_scenario
                  ? bp.first_break_scenario
                  : "Holds under mild stress"}
              </span>
            </div>
          )}
        </div>

        {(result.stress_tests?.length ?? 0) > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-2">
              Stress Tests
            </div>
            <div className="flex flex-wrap gap-2">
              {result.stress_tests.map((s, i) => (
                <span key={i} className={stressChipClass(s.verdict)}>
                  {s.name}: {s.verdict}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>

      <DealKillerSummary
        result={result}
        purchasePrice={purchasePriceMeta}
        photoRehabMid={typeof meta?.photo_rehab_mid === "number" ? meta.photo_rehab_mid : null}
      />

      {/* ============ 4. Borrower / Investor Action ============ */}
      <InvestorActionPlan result={result} purchasePrice={purchasePriceMeta} />

      {/* ============ 5. Supporting Detail ============ */}
      <div className="text-[11px] uppercase tracking-widest text-white/40 pt-2">
        Supporting Detail
      </div>

      {/* Metrics grid */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-3 gap-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Net Profit
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {result.net_profit < 0 ? "-" : ""}$
              {Math.abs(result.net_profit).toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Profit %
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {(result.profit_pct * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              ROI
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {(result.annualized_roi * 100).toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              ARV
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {arvMeta !== null ? `$${arvMeta.toLocaleString()}` : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Flip Score
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {result.flip_score}
              <span className="text-xs font-normal text-white/40">
                {" "}
                ({result.flip_verdict})
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              BRRRR Score
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {result.brrrr_score}
              <span className="text-xs font-normal text-white/40">
                {" "}
                ({result.brrrr_verdict})
              </span>
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Wholesale Score
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70">
              {result.wholesale_score}
              <span className="text-xs font-normal text-white/40">
                {" "}
                ({result.wholesale_verdict})
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Risk Flags card */}
      {((result.typed_flags?.length ?? 0) > 0 ||
        (result.risk_flags?.length ?? 0) > 0) && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
          <h3 className="font-serif-display text-base font-semibold text-white mb-3">
            Risk Flags
          </h3>
          <div className="flex flex-wrap gap-2">
            {(result.typed_flags?.length ?? 0) > 0
              ? result.typed_flags.map((f, i) => (
                  <span key={i} className={riskFlagBadgeClass(f.severity)}>
                    {f.label}
                  </span>
                ))
              : result.risk_flags.map((f, i) => (
                  <span key={i} className={riskFlagBadgeClass(undefined)}>
                    {f}
                  </span>
                ))}
          </div>
        </section>
      )}

      {/* Narrative card — Why this verdict (notes + stress context) */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
        <h3 className="font-serif-display text-base font-semibold text-white mb-2">
          Why this verdict
        </h3>
        <ul className="list-disc pl-5 space-y-1.5 text-sm text-white/85 leading-relaxed">
          {whyBullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </section>

      {/* Actions card — Integrity Gate copy + grouped buttons */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 space-y-4">
        <div>
          <div className="text-sm font-semibold text-white">Integrity Gate</div>
          <div className="mt-1 text-xs text-white/60">
            {canReport && canScript
              ? "Lender Report and Negotiation Script are available."
              : "Outputs are disabled — deal did not meet viability threshold."}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canReport}
            title={
              canReport
                ? "Generate lender report"
                : "Suppressed by Integrity Gate"
            }
            className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
              canReport
                ? "bg-white/[0.08] text-white border-white/[0.15] hover:bg-white/[0.12]"
                : "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
            }`}
            onClick={onDownloadLenderReport}
          >
            Lender Report
          </button>

          <button
            type="button"
            disabled={!canScript || scriptLoading}
            title={
              canScript
                ? "Generate negotiation script"
                : "Suppressed by Integrity Gate"
            }
            className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
              canScript && !scriptLoading
                ? "bg-white/[0.08] text-white border-white/[0.15] hover:bg-white/[0.12]"
                : "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
            }`}
            onClick={onGenerateScript}
          >
            {scriptLoading ? "Generating…" : "Negotiation Script"}
          </button>
        </div>

        {(!canReport || !canScript) && (
          <div className="text-xs text-white/60">
            <span className="text-white/80">Suppressed:</span>{" "}
            {!canReport ? "Lender Report" : ""}
            {!canReport && !canScript ? " • " : ""}
            {!canScript ? "Negotiation Script" : ""}
          </div>
        )}
      </section>

      {/* Negotiation Script output — appears below actions when generated */}
      {scriptError && (
        <div className="text-xs text-red-400 px-1">{scriptError}</div>
      )}
      {script && (
        <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">
              Negotiation Script
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(script)}
              className="rounded-xl px-3 py-1 text-xs font-semibold border bg-white/10 text-white border-white/10 hover:bg-white/20"
            >
              Copy Script
            </button>
          </div>
          <div className="space-y-3 text-sm text-white/80 leading-relaxed">
            {script.split("\n\n").map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
