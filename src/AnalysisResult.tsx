import { useState } from "react";
import type { AnalyzeResponse } from "./lib/types";
import { generateNegotiationScript } from "./lib/api";
import DealKillerSummary from "./components/DealKillerSummary";

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

function verdictRank(v: string): number {
  if (v === "BUY") return 2;
  if (v === "CONDITIONAL") return 1;
  return 0;
}

function buildOfferGapCallout(purchasePrice: number, mao: number) {
  if (purchasePrice <= 0 || mao <= 0) return null;
  const gap = purchasePrice - mao;
  const absGap = Math.abs(gap);
  const fmtGap = `$${absGap.toLocaleString()}`;

  if (gap > 0) {
    return (
      <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5">
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
      </section>
    );
  }

  if (absGap <= 5000) {
    return (
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
        <div className="text-[10px] uppercase tracking-widest text-amber-300/70 mb-1.5">
          Offer Gap
        </div>
        <p className="text-sm text-amber-200 leading-relaxed">
          You are <span className="font-semibold">within {fmtGap}</span> of the
          Max Safe Offer. This deal may work, but only if ARV and rehab
          assumptions hold.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5">
      <div className="text-[10px] uppercase tracking-widest text-emerald-300/70 mb-1.5">
        Offer Cushion
      </div>
      <p className="text-sm text-emerald-200 leading-relaxed">
        You are <span className="font-semibold">{fmtGap} under</span> the Max
        Safe Offer. The offer has some cushion before the deal breaks.
      </p>
    </section>
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

  // Offer Gap callout — only renders when purchase_price is passed via meta.
  const purchasePriceMeta =
    typeof meta?.purchase_price === "number" && meta.purchase_price > 0
      ? meta.purchase_price
      : null;
  const offerGapBlock =
    purchasePriceMeta !== null
      ? buildOfferGapCallout(purchasePriceMeta, result.max_safe_offer)
      : null;

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
      {/* 2. Key numbers card */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6 space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="mb-4">
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-2">
              Max Safe Offer
            </div>
            <div className="font-jetbrains text-5xl font-bold text-[#E8C547] leading-none pb-1">
              ${result.max_safe_offer.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">
              Confidence
            </div>
            <div className="font-jetbrains text-lg font-medium text-white/70 leading-none">
              {result.confidence_score}
              <span className="text-sm font-normal text-white/40"> / 100</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-4">
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
        </div>
      </section>

      {/* Offer Gap callout — only renders when purchase_price is known via meta */}
      {offerGapBlock}

      <DealKillerSummary
        result={result}
        purchasePrice={purchasePriceMeta}
        photoRehabMid={typeof meta?.photo_rehab_mid === "number" ? meta.photo_rehab_mid : null}
      />

      {/* 1. Verdict card */}
      <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
        <div className="text-[11px] uppercase tracking-widest text-white/60 mb-3">
          Verdict
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <span className={verdictBadgeClass((result as any)?.overall_verdict)}>
            {(result as any)?.overall_verdict}
          </span>

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
      </section>

      {/* 3. Risk Flags card */}
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

      {/* 4. Narrative card — Why this verdict (notes + stress context) */}
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

      {/* 5. Actions card — Integrity Gate copy + grouped buttons */}
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
