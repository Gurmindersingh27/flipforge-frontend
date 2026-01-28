import { useMemo, useState } from "react";
import type { AnalyzeResponse, Verdict, Strategy, RiskFlag, StressTestScenario } from "../lib/types";
import { SHIELD } from "../shield";

type Props = {
  result: AnalyzeResponse;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

function findWorstStress(r: AnalyzeResponse): StressTestScenario | null {
  if (!Array.isArray(r.stress_tests) || r.stress_tests.length === 0) return null;
  // Pick the first scenario that is not BUY (simple + blunt).
  const bad = r.stress_tests.find((s) => s.verdict !== "BUY");
  return bad ?? null;
}

function pickTopFlag(r: AnalyzeResponse): RiskFlag | null {
  if (!Array.isArray(r.typed_flags) || r.typed_flags.length === 0) return null;
  const order = { critical: 0, moderate: 1, mild: 2 } as const;
  const sorted = [...r.typed_flags].sort(
    (a, b) => order[a.severity] - order[b.severity]
  );
  return sorted[0] ?? null;
}

/**
 * Dumb messenger:
 * - no business logic
 * - uses response fields + Shield constants to display a header
 */
export default function ShieldHeader({ result }: Props) {
  const [copied, setCopied] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);

  // metric copy feedback
  const [metricCopied, setMetricCopied] = useState<string | null>(null);

  // ✅ Authority: overall_verdict is the single source of truth for the headline
  const verdictKey = (result.overall_verdict ?? "CONDITIONAL") as Verdict;
  const v = SHIELD.verdicts[verdictKey] ?? SHIELD.verdicts.CONDITIONAL;

  // Prefer net_profit if present; fallback to gross_profit
  const profit = Number(result.net_profit ?? result.gross_profit ?? 0);

  // profit_pct is stored as a decimal in your UI
  const profitPct = Number(result.profit_pct ?? 0);

  const annualizedRoi = Number(result.annualized_roi ?? 0);

  const confidence = clamp(Number(result.confidence_score ?? 0), 0, 100);

  // Your UI uses typed_flags
  const riskCount = Array.isArray(result.typed_flags) ? result.typed_flags.length : 0;

  const bestStrategy = (result.best_strategy ?? ("flip" as any)) as Strategy;

  // copy max safe offer
  const offer = Number(result.max_safe_offer ?? 0);
  const offerText = fmtMoney(offer);

  // ==========================
  // Phase 2.1 Additions (SAFE)
  // ==========================

  const strategyVerdict = useMemo(() => pickStrategyVerdict(result), [result]);
  const conflict = useMemo(() => verdictKey !== strategyVerdict, [verdictKey, strategyVerdict]);

  const worstStress = useMemo(() => findWorstStress(result), [result]);
  const topFlag = useMemo(() => pickTopFlag(result), [result]);

  // prefer backend-provided verdict_reason (institutional voice)
  const verdictReason = (result as any)?.verdict_reason || (result as any)?.verdictReason || "";

  const contextualSubline = useMemo(() => {
    // If there is no conflict, we don't need extra messaging. Keep it clean.
    if (!conflict) return "";

    // If backend provided a reason, use it.
    if (typeof verdictReason === "string" && verdictReason.trim().length > 0) {
      return verdictReason.trim();
    }

    // Otherwise, blunt auto-reasoning
    const parts: string[] = [];

    if (worstStress) {
      parts.push(`Breaks under "${worstStress.name}" stress (${worstStress.verdict}).`);
    }

    if (result.breakpoints?.first_break_scenario) {
      parts.push(`First breakpoint: ${result.breakpoints.first_break_scenario}.`);
    }

    if (topFlag) {
      parts.push(`Top risk: ${topFlag.label} (${topFlag.severity}).`);
    }

    if (parts.length === 0) {
      parts.push("Overall verdict overrides strategy due to risk + stress-test fragility.");
    }

    return parts.join(" ");
  }, [conflict, verdictReason, worstStress, topFlag, result.breakpoints?.first_break_scenario]);

  async function onCopyOffer() {
    const ok = await copyToClipboard(String(Math.round(offer)));
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } else {
      setCopied(false);
    }
  }

  async function onCopySummary() {
    const summary = [
      `${verdictKey}`,
      `Offer ${offerText}`,
      `Net ${fmtMoney(profit)}`,
      `Profit ${fmtPctDecimalToPct(profitPct)}`,
      `ROI ${fmtPctDecimalToPct(annualizedRoi)}`,
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

  // click-to-copy for metrics
  async function onCopyMetric(key: string, text: string) {
    const ok = await copyToClipboard(text);
    if (ok) {
      setMetricCopied(key);
      window.setTimeout(() => setMetricCopied(null), 900);
    }
  }

  return (
    <div
      className={[
        "w-full rounded-2xl border p-4 md:p-5",
        "bg-slate-950/60 backdrop-blur",
        v.borderClass,
        "border-white/10 bg-white/5",
      ].join(" ")}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className={["mt-0.5 h-3 w-3 rounded-full", v.dotClass].join(" ")} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={["text-sm font-semibold tracking-wide", v.textClass].join(" ")}>
                {v.label}
              </span>

              <span className="text-xs text-white/60">•</span>

              <span className="text-xs text-white/80">
                Best strategy:{" "}
                <span className="font-semibold text-white">{strategyName(bestStrategy)}</span>{" "}
                <span className="text-white/50">({strategyVerdict})</span>
              </span>

              <span className="text-xs text-white/60">•</span>

              <span className="text-xs text-white/80">
                Confidence:{" "}
                <span className="font-semibold text-white">{confidence}</span>/100
              </span>
            </div>

            {/* Keep original subtitle */}
            <div className="mt-1 text-xs text-white/60">{v.subtitle}</div>

            {/* ✅ Phase 2.1: Contextual subline when strategy disagrees with overall */}
            {conflict && contextualSubline && (
              <div className="mt-2 text-xs text-amber-200/90">
                {contextualSubline}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onCopyOffer}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10"
                title="Copy max safe offer number to clipboard"
              >
                {copied ? "Copied ✓" : `Copy Offer ${offerText}`}
              </button>

              <button
                type="button"
                onClick={onCopySummary}
                className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-white/80 hover:text-white hover:bg-white/10"
                title="Copy a one-line deal summary"
              >
                {summaryCopied ? "Summary Copied ✓" : "Copy Summary"}
              </button>

              <span className="text-[11px] text-white/50">Tip: click metrics to copy.</span>
            </div>
          </div>
        </div>

        {/* ADDED: expanded metrics (keeps existing 3, adds Offer + ROI) */}
        <div className="grid grid-cols-3 gap-2 md:gap-3 md:grid-cols-5">
          <Metric
            label="Net profit"
            value={metricCopied === "net" ? "Copied ✓" : fmtMoney(profit)}
            onClick={() => onCopyMetric("net", fmtMoney(profit))}
          />
          <Metric
            label="Profit %"
            value={metricCopied === "pp" ? "Copied ✓" : fmtPctDecimalToPct(profitPct)}
            onClick={() => onCopyMetric("pp", fmtPctDecimalToPct(profitPct))}
          />
          <Metric
            label="Risk flags"
            value={metricCopied === "rf" ? "Copied ✓" : `${riskCount}`}
            onClick={() => onCopyMetric("rf", `${riskCount}`)}
          />

          {/* ADDED */}
          <Metric
            label="Max offer"
            value={metricCopied === "offer" ? "Copied ✓" : offerText}
            onClick={() => onCopyMetric("offer", offerText)}
          />
          <Metric
            label="Ann. ROI"
            value={metricCopied === "roi" ? "Copied ✓" : fmtPctDecimalToPct(annualizedRoi)}
            onClick={() => onCopyMetric("roi", fmtPctDecimalToPct(annualizedRoi))}
          />
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left hover:bg-white/10"
      title="Click to copy"
    >
      <div className="text-[11px] uppercase tracking-wide text-white/60">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-white">{value}</div>
    </button>
  );
}
