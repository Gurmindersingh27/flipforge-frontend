import type { AnalyzeResponse } from "./lib/types";

interface Props {
  result: AnalyzeResponse;
  // Optional meta from App/page.tsx so the PDF can show URL/address/hold/LTC/rate/carry.
  meta?: Record<string, any>;
}

const API_BASE = "http://127.0.0.1:8000";

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
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border";
  if (verdict === "BUY")
    return `${base} border-emerald-500/40 text-emerald-200 bg-emerald-500/10`;
  if (verdict === "CONDITIONAL")
    return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  if (verdict === "PASS")
    return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
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

  // ✅ CHANGE: If allowed_outputs is missing (legacy/manual analyze), default to enabled.
  const allowed = (result as any)?.allowed_outputs as
    | { lender_report?: boolean; negotiation_script?: boolean }
    | undefined;

  const canReport = allowed ? !!allowed.lender_report : true;
  const canScript = allowed ? !!allowed.negotiation_script : true;

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

  if (rehab) {
    whyBullets.push(
      `Rehab Reality: ${rehab.severity} (${(rehab.rehab_ratio * 100).toFixed(
        0
      )}% of purchase price).`
    );
  }

  if (bp?.first_break_scenario) {
    whyBullets.push(
      `Breakpoint: ${bp.first_break_scenario} is the first scenario that kills this deal.`
    );
  } else {
    whyBullets.push("Breakpoint: Deal holds up under mild stress.");
  }

  // Add verdict reason (authoritative line)
  if (verdictReason) {
    whyBullets.unshift(verdictReason);
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
      {/* Top summary bar */}
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

      {/* Integrity Gate Actions */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">
              Integrity Gate
            </div>
            <div className="mt-1 text-xs text-white/60">
              Institutional outputs are suppressed when the deal is non-viable.
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
              disabled={!canScript}
              title={
                canScript
                  ? "Generate negotiation script"
                  : "Suppressed by Integrity Gate"
              }
              className={`rounded-xl px-4 py-2 text-sm font-semibold border ${
                canScript
                  ? "bg-white/10 text-white border-white/10"
                  : "bg-white/5 text-white/40 border-white/10 cursor-not-allowed"
              }`}
              onClick={() => {
                // Placeholder: wire your script generator later
                alert("Negotiation Script generation not wired yet.");
              }}
            >
              Negotiation Script
            </button>
          </div>
        </div>

        {!canReport || !canScript ? (
          <div className="mt-3 text-xs text-white/60">
            <span className="text-white/80">Suppressed:</span>{" "}
            {!canReport ? "Lender Report" : ""}
            {!canReport && !canScript ? " • " : ""}
            {!canScript ? "Negotiation Script" : ""}
          </div>
        ) : (
          <div className="mt-3 text-xs text-white/60">
            Outputs enabled. Proceed with caution if flagged as CONDITIONAL.
          </div>
        )}
      </div>

      {/* Why this verdict */}
      <div>
        <h3 className="text-sm font-semibold text-white mb-2">
          Why this verdict
        </h3>
        <ul className="list-disc pl-5 space-y-1 text-sm text-white/80">
          {whyBullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      {/* Notes (unchanged, still shown) */}
      {result.notes?.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-white mb-2">Notes</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm text-white/70">
            {result.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
