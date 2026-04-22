import { useState } from "react";
import type { AnalyzeResponse } from "./lib/types";
import { generateNegotiationScript } from "./lib/api";

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
    return `${base} border-[#E8C547]/50 text-[#E8C547] bg-[#E8C547]/10 shadow-[0_0_14px_rgba(232,197,71,0.3)]`;
  if (verdict === "CONDITIONAL")
    return `${base} border-amber-400/60 text-amber-300 bg-amber-400/10 shadow-[0_0_10px_rgba(251,191,36,0.2)]`;
  if (verdict === "PASS")
    return `${base} border-red-500/50 text-red-300 bg-red-500/10 shadow-[0_0_10px_rgba(239,68,68,0.2)]`;
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

  const verdictReason =
    (result as any)?.verdict_reason ||
    (result as any)?.verdictReason ||
    "";

  const whyBullets: string[] = [];

  if (result.net_profit <= 0) {
    whyBullets.push("Deal loses money in the base case.");
  } else {
    whyBullets.push("Deal is profitable assuming inputs are accurate.");
  }

  // Add verdict reason (authoritative line)
  if (verdictReason) {
    whyBullets.unshift(verdictReason);
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
    <div className="space-y-6">
      {/* 1. Top summary bar */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-white/60">Verdict:</span>
        <span className={verdictBadgeClass((result as any)?.overall_verdict)}>
          {(result as any)?.overall_verdict}
        </span>

        {rehab && (
          <>
            <span className="text-sm text-white/60">Rehab Reality:</span>
            <span className={rehabBadgeClass(rehab.severity)}>
              {rehab.severity}
            </span>
          </>
        )}

        {bp && (
          <>
            <span className="text-sm text-white/60">Breakpoint:</span>
            <span className={breakpointBadgeClass(bp.is_fragile)}>
              {bp.first_break_scenario
                ? bp.first_break_scenario
                : "Holds under mild stress"}
            </span>
          </>
        )}
      </div>

      {/* 2. Metric cards */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-2xl border border-white/10 border-l-2 border-l-[#E8C547]/50 bg-white/5 p-3 pl-4 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
          <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">Max Safe Offer</div>
          <div className="font-jetbrains text-2xl font-semibold text-[#E8C547]">
            ${result.max_safe_offer.toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-white/10 border-l-2 border-l-[#E8C547]/25 bg-white/5 p-3 pl-4 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
          <div className="text-[10px] uppercase tracking-widest text-white/50 mb-1">Confidence Score</div>
          <div className="font-jetbrains text-2xl font-semibold text-white">
            {result.confidence_score}
            <span className="text-base font-normal text-white/40"> / 100</span>
          </div>
        </div>
      </div>

      {/* 3. Risk Flags — typed_flags preferred, fallback to risk_flags strings */}
      {((result.typed_flags?.length ?? 0) > 0 || (result.risk_flags?.length ?? 0) > 0) && (
        <div>
          <h3 className="font-serif-display text-sm font-semibold text-white mb-2">Risk Flags</h3>
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
        </div>
      )}

      {/* 4. Why this verdict */}
      <div>
        <h3 className="font-serif-display text-sm font-semibold text-white mb-2">
          Why this verdict
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-white/80">
          {whyBullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      {/* 5. Notes */}
      {result.notes?.length > 0 && (
        <div>
          <h3 className="font-serif-display text-sm font-semibold text-white mb-2">Notes</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/70">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 6. Integrity Gate — moved below narrative */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-3 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">
              Integrity Gate
            </div>
            <div className="mt-1 text-xs text-white/60">
              {canReport && canScript
                ? "Lender Report and Negotiation Script are available."
                : "Outputs are disabled — deal did not meet viability threshold."}
            </div>
          </div>

          <div className="flex gap-2">
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
                  ? "bg-white text-slate-900 border-white/10"
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
                  ? "bg-white/10 text-white border-white/10"
                  : "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
              }`}
              onClick={onGenerateScript}
            >
              {scriptLoading ? "Generating…" : "Negotiation Script"}
            </button>
          </div>
        </div>

        {(!canReport || !canScript) && (
          <div className="mt-3 text-xs text-white/60">
            <span className="text-white/80">Suppressed:</span>{" "}
            {!canReport ? "Lender Report" : ""}
            {!canReport && !canScript ? " • " : ""}
            {!canScript ? "Negotiation Script" : ""}
          </div>
        )}
      </div>

      {/* Negotiation Script output — adjacent to Integrity Gate */}
      {scriptError && (
        <div className="text-xs text-red-400 px-1">{scriptError}</div>
      )}
      {script && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 hover:-translate-y-0.5 hover:shadow-lg transition-all duration-200">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-semibold text-white">Negotiation Script</div>
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
        </div>
      )}
    </div>
  );
}
