// InvestorMemoPreview — static, presentational only.
// Shown BEFORE analysis to communicate what FlipForge produces.
// This is NOT live deal data. Nothing here is wired into analyzer state.
// It is a labeled sample so the hero never implies a real analyzed deal exists.

type PreviewRow = {
  label: string;
  sample: string;
};

const ROWS: PreviewRow[] = [
  { label: "Verdict", sample: "BUY / CONDITIONAL / PASS" },
  { label: "Max Safe Offer", sample: "Your ceiling before the deal breaks" },
  { label: "Offer Gap", sample: "Overpay risk vs. offer cushion" },
  { label: "Stress Tests", sample: "ARV -10%, Rehab +15%, Hold +2mo" },
  { label: "Deal Killers", sample: "Plain-English reasons it could fail" },
];

export default function InvestorMemoPreview({
  className = "",
}: {
  className?: string;
}) {
  return (
    <div
      className={`ff-inset rounded-2xl p-5 ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-bold text-white">Investor Memo Preview</div>
        <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-300">
          Sample
        </span>
      </div>
      <div className="mt-1 text-xs text-white/55">
        What FlipForge generates once you run a deal. Illustrative only.
      </div>

      <div className="mt-4 space-y-2">
        {ROWS.map((row) => (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-4 border-b border-white/5 pb-2 last:border-b-0 last:pb-0"
          >
            <span className="ff-heading text-sm font-semibold">
              {row.label}
            </span>
            <span className="text-right text-xs text-white/60">
              {row.sample}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-white/10 pt-3 text-xs text-slate-400">
        Enter a property above to generate your real Investor Memo.
      </div>
    </div>
  );
}
