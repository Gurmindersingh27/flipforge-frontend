import { useMemo, useState } from "react";
import type { AnalyzeResponse, RiskFlag, StressTestScenario } from "./lib/types";

function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "-";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function formatPctDecimalToPct(n: number, digits = 1): string {
  // API returns decimals (0.20 = 20%)
  if (!Number.isFinite(n)) return "-";
  return `${(n * 100).toFixed(digits)}%`;
}

function badgeClassForVerdict(v: string) {
  const base =
    "inline-flex items-center rounded-full px-2 py-1 text-xs font-semibold border";
  if (v === "BUY") return `${base} border-emerald-500/40 text-emerald-300 bg-emerald-500/10`;
  if (v === "CONDITIONAL")
    return `${base} border-amber-500/40 text-amber-300 bg-amber-500/10`;
  return `${base} border-red-500/40 text-red-300 bg-red-500/10`;
}

function severityClass(sev: RiskFlag["severity"]) {
  const base = "inline-flex items-center rounded-full px-2 py-1 text-xs border";
  if (sev === "critical") return `${base} border-red-500/40 text-red-200 bg-red-500/10`;
  if (sev === "moderate") return `${base} border-amber-500/40 text-amber-200 bg-amber-500/10`;
  return `${base} border-slate-500/40 text-slate-200 bg-slate-500/10`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function ProgressBar({ value }: { value: number }) {
  const pct = clamp(value, 0, 100);
  return (
    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
      <div className="h-full bg-white/60" style={{ width: `${pct}%` }} />
    </div>
  );
}

function metricCard(label: string, value: string, sub?: string) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-xs text-white/60">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs text-white/50">{sub}</div> : null}
    </div>
  );
}

function StrategyCard({
  title,
  score,
  verdict,
  isBest,
}: {
  title: string;
  score: number;
  verdict: string;
  isBest?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-2xl border p-4",
        isBest ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5",
      ].join(" ")}
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{title}</div>
        <span className={badgeClassForVerdict(verdict)}>{verdict}</span>
      </div>
      <div className="mt-3 text-3xl font-bold">{Math.round(score)}</div>
      <div className="mt-1 text-xs text-white/50">Score (0–100)</div>
    </div>
  );
}

function StressTable({ items }: { items: StressTestScenario[] }) {
  if (!items?.length) return null;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
      <div className="px-4 py-3 border-b border-white/10">
        <div className="text-sm font-semibold">Stress Tests</div>
        <div className="text-xs text-white/50">
          Same deal, different bad days. If these fail, you should be nervous.
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-xs text-white/60">
            <tr className="border-b border-white/10">
              <th className="text-left px-4 py-3">Scenario</th>
              <th className="text-right px-4 py-3">Net Profit</th>
              <th className="text-right px-4 py-3">Profit %</th>
              <th className="text-right px-4 py-3">Ann. ROI</th>
              <th className="text-right px-4 py-3">Hold</th>
              <th className="text-right px-4 py-3">Verdict</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.name} className="border-b border-white/10 last:border-b-0">
                <td className="px-4 py-3">{s.name}</td>
                <td className="px-4 py-3 text-right">{formatMoney(s.net_profit)}</td>
                <td className="px-4 py-3 text-right">{formatPctDecimalToPct(s.profit_pct)}</td>
                <td className="px-4 py-3 text-right">{formatPctDecimalToPct(s.annualized_roi)}</td>
                <td className="px-4 py-3 text-right">{s.holding_months} mo</td>
                <td className="px-4 py-3 text-right">
                  <span className={badgeClassForVerdict(s.verdict)}>{s.verdict}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AnalysisResult({ result }: { result: AnalyzeResponse }) {
  const [showDebug, setShowDebug] = useState(false);

  const bestStrategyLabel = useMemo(() => {
    const s = result.best_strategy;
    if (s === "flip") return "FLIP";
    if (s === "brrrr") return "BRRRR";
    return "WHOLESALE";
  }, [result.best_strategy]);

  const whyBullets = useMemo(() => {
    const bullets: string[] = [];

    bullets.push(
      `Profit margin is ${formatPctDecimalToPct(result.profit_pct)} and annualized ROI is ${formatPctDecimalToPct(
        result.annualized_roi
      )}.`
    );

    bullets.push(
      `Max safe offer is ${formatMoney(result.max_safe_offer)} (treat this as your ceiling, not your target).`
    );

    bullets.push(`Best strategy is ${bestStrategyLabel} based on the highest strategy score.`);

    if (result.typed_flags?.length) {
      const crit = result.typed_flags.filter((f) => f.severity === "critical").length;
      const mod = result.typed_flags.filter((f) => f.severity === "moderate").length;
      bullets.push(`Risk flags detected: ${crit} critical, ${mod} moderate.`);
    } else {
      bullets.push("No material risk flags were detected from the current inputs.");
    }

    // Append backend notes if present (short + useful)
    if (result.notes?.length) {
      for (const n of result.notes.slice(0, 3)) bullets.push(n);
    }

    return bullets;
  }, [
    result.profit_pct,
    result.annualized_roi,
    result.max_safe_offer,
    result.typed_flags,
    result.notes,
    bestStrategyLabel,
  ]);

  return (
    <div className="mt-6 space-y-5">
      {/* Top verdict bar */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-white/60">Verdict:</span>
            <span className={badgeClassForVerdict(result.overall_verdict)}>
              {result.overall_verdict}
            </span>
            <span className="text-sm text-white/60">Best Strategy:</span>
            <span className="text-sm font-semibold">{bestStrategyLabel}</span>
          </div>

          <div className="w-full md:w-72">
            <div className="flex items-center justify-between text-xs text-white/60 mb-2">
              <span>Confidence</span>
              <span className="font-semibold text-white/80">{result.confidence_score}</span>
            </div>
            <ProgressBar value={result.confidence_score} />
          </div>
        </div>
      </div>

      {/* Core metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {metricCard("Net Profit", formatMoney(result.net_profit))}
        {metricCard("Max Safe Offer", formatMoney(result.max_safe_offer))}
        {metricCard("Profit %", formatPctDecimalToPct(result.profit_pct))}
        {metricCard("Annualized ROI %", formatPctDecimalToPct(result.annualized_roi))}
      </div>

      {/* Why */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold">Why this verdict</div>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-white/80">
          {whyBullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      {/* Strategy scores */}
      <div className="space-y-3">
        <div className="text-sm font-semibold">Strategy Scores</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StrategyCard
            title="Flip"
            score={result.flip_score}
            verdict={result.flip_verdict}
            isBest={result.best_strategy === "flip"}
          />
          <StrategyCard
            title="BRRRR"
            score={result.brrrr_score}
            verdict={result.brrrr_verdict}
            isBest={result.best_strategy === "brrrr"}
          />
          <StrategyCard
            title="Wholesale"
            score={result.wholesale_score}
            verdict={result.wholesale_verdict}
            isBest={result.best_strategy === "wholesale"}
          />
        </div>
      </div>

      {/* Risk flags */}
      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="text-sm font-semibold">Risk Flags</div>
        {result.typed_flags?.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {result.typed_flags.map((f) => (
              <span key={f.code} className={severityClass(f.severity)} title={f.code}>
                {f.label}
              </span>
            ))}
          </div>
        ) : (
          <div className="mt-3 text-sm text-white/70">No material risk flags detected.</div>
        )}
      </div>

      {/* Stress tests */}
      <StressTable items={result.stress_tests || []} />

      {/* Debug */}
      <div className="rounded-2xl border border-white/10 bg-white/5">
        <button
          type="button"
          onClick={() => setShowDebug((v) => !v)}
          className="w-full text-left px-4 py-3 text-sm font-semibold"
        >
          {showDebug ? "▼" : "▶"} Developer Details (debug)
        </button>
        {showDebug ? (
          <pre className="px-4 pb-4 text-xs text-white/70 overflow-x-auto">
            {JSON.stringify(result, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
