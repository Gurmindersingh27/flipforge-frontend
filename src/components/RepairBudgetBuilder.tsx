import { useState } from "react";

type Level = 0 | 1 | 2 | 3;

const LEVEL_LABELS = ["None", "Light", "Medium", "Heavy"] as const;
const CONTINGENCY_LABELS = ["None (0%)", "Light (10%)", "Medium (15%)", "Heavy (20%)"] as const;
const CONTINGENCY_PCTS = [0, 0.10, 0.15, 0.20] as const;

interface Category {
  label: string;
  type: "flat" | "per-bath" | "per-sqft";
  levels: [[number, number], [number, number], [number, number], [number, number]];
}

const CATEGORIES: Category[] = [
  { label: "Kitchen",            type: "flat",     levels: [[0,0],[3000,7000],[12000,20000],[28000,45000]] },
  { label: "Bathrooms",          type: "per-bath",  levels: [[0,0],[1500,3000],[5000,9000],[12000,20000]] },
  { label: "Flooring",           type: "per-sqft",  levels: [[0,0],[2.00,4.00],[4.00,6.50],[7.00,12.00]] },
  { label: "Paint / Drywall",    type: "flat",     levels: [[0,0],[2000,4000],[4500,8000],[9000,15000]] },
  { label: "Roof",               type: "flat",     levels: [[0,0],[1000,3000],[7000,12000],[14000,22000]] },
  { label: "HVAC",               type: "flat",     levels: [[0,0],[800,2000],[4000,8000],[10000,18000]] },
  { label: "Electrical",         type: "flat",     levels: [[0,0],[1000,2500],[4000,8000],[12000,20000]] },
  { label: "Plumbing",           type: "flat",     levels: [[0,0],[1000,2000],[3000,7000],[9000,18000]] },
  { label: "Windows / Exterior", type: "flat",     levels: [[0,0],[2000,5000],[6000,12000],[15000,28000]] },
];

interface RepairBudgetBuilderProps {
  onApply: (value: number) => void;
}

function fmt(n: number): string {
  if (n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export default function RepairBudgetBuilder({ onApply }: RepairBudgetBuilderProps) {
  const [open, setOpen] = useState(false);
  const [bathroomCount, setBathroomCount] = useState(1);
  const [sqft, setSqft] = useState(0);
  const [selections, setSelections] = useState<Level[]>(Array(CATEGORIES.length).fill(0) as Level[]);
  const [contingency, setContingency] = useState<Level>(0);

  function setLevel(idx: number, level: Level) {
    const next = [...selections] as Level[];
    next[idx] = level;
    setSelections(next);
  }

  const categoryTotals: [number, number, number][] = CATEGORIES.map((cat, i) => {
    const [low, high] = cat.levels[selections[i]];
    let catLow: number, catHigh: number;
    if (cat.type === "per-bath") {
      catLow = low * bathroomCount;
      catHigh = high * bathroomCount;
    } else if (cat.type === "per-sqft") {
      catLow = low * sqft;
      catHigh = high * sqft;
    } else {
      catLow = low;
      catHigh = high;
    }
    return [catLow, (catLow + catHigh) / 2, catHigh];
  });

  const subtotalLow  = categoryTotals.reduce((s, [l]) => s + l, 0);
  const subtotalMid  = categoryTotals.reduce((s, [, m]) => s + m, 0);
  const subtotalHigh = categoryTotals.reduce((s, [,, h]) => s + h, 0);

  const pct = CONTINGENCY_PCTS[contingency];
  const totalLow  = subtotalLow  + subtotalLow  * pct;
  const totalMid  = subtotalMid  + subtotalMid  * pct;
  const totalHigh = subtotalHigh + subtotalHigh * pct;

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-amber-400/80 hover:text-amber-300 transition-colors underline underline-offset-2"
        >
          Build Repair Budget →
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/70">
          Repair Budget Builder
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          ✕ Close
        </button>
      </div>

      {/* Top inputs: bathroom count + sqft */}
      <div className="flex flex-wrap gap-6 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">Bathrooms</span>
          <button
            type="button"
            onClick={() => setBathroomCount(Math.max(1, bathroomCount - 1))}
            className="w-6 h-6 rounded border border-white/10 text-white/60 hover:text-white flex items-center justify-center text-base leading-none"
          >
            −
          </button>
          <span className="text-sm font-semibold text-white w-4 text-center">{bathroomCount}</span>
          <button
            type="button"
            onClick={() => setBathroomCount(Math.min(4, bathroomCount + 1))}
            className="w-6 h-6 rounded border border-white/10 text-white/60 hover:text-white flex items-center justify-center text-base leading-none"
          >
            +
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Sqft</label>
          <input
            type="number"
            min={0}
            step={100}
            placeholder="e.g. 1,400"
            value={sqft === 0 ? "" : sqft}
            onChange={(e) =>
              setSqft(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))
            }
            className="w-28 rounded-lg bg-slate-900 border border-white/10 px-2 py-1 text-sm"
          />
        </div>
      </div>

      {/* Category table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-white/40 border-b border-white/10">
              <th className="text-left pb-2 pr-3 font-normal w-36">Category</th>
              {LEVEL_LABELS.map((l) => (
                <th key={l} className="pb-2 font-normal text-center w-14">{l}</th>
              ))}
              <th className="pb-2 font-normal text-right">Low</th>
              <th className="pb-2 font-normal text-right">Mid</th>
              <th className="pb-2 font-normal text-right">High</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((cat, i) => {
              const [catLow, catMid, catHigh] = categoryTotals[i];
              const level = selections[i];
              const showSqftNote = cat.type === "per-sqft" && level !== 0 && sqft === 0;
              const rowLabel =
                cat.type === "per-bath" ? `Bathrooms × ${bathroomCount}` : cat.label;

              return (
                <tr key={cat.label} className="border-b border-white/5">
                  <td className="py-2 pr-3 text-white/80">
                    {rowLabel}
                    {showSqftNote && (
                      <div className="text-[10px] text-amber-400/70 mt-0.5">
                        Enter sqft above to estimate.
                      </div>
                    )}
                  </td>
                  {([0, 1, 2, 3] as Level[]).map((lvl) => (
                    <td key={lvl} className="py-2 text-center">
                      <button
                        type="button"
                        onClick={() => setLevel(i, lvl)}
                        className={`w-4 h-4 rounded-full border transition-colors ${
                          level === lvl
                            ? "border-amber-400 bg-amber-400"
                            : "border-white/20 bg-transparent hover:border-white/40"
                        }`}
                      />
                    </td>
                  ))}
                  <td className="py-2 text-right tabular-nums text-white/50">{fmt(catLow)}</td>
                  <td className="py-2 text-right tabular-nums text-white/80 font-medium">{fmt(catMid)}</td>
                  <td className="py-2 text-right tabular-nums text-white/50">{fmt(catHigh)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Subtotal row */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10 text-xs">
        <span className="text-white/40">Subtotal</span>
        <div className="flex gap-4">
          <span className="tabular-nums text-white/40 w-20 text-right">{fmt(subtotalLow)}</span>
          <span className="tabular-nums text-white/60 font-medium w-20 text-right">{fmt(subtotalMid)}</span>
          <span className="tabular-nums text-white/40 w-20 text-right">{fmt(subtotalHigh)}</span>
        </div>
      </div>

      {/* Contingency selector */}
      <div className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <span className="text-xs text-white/40 mr-1">Contingency</span>
          {CONTINGENCY_LABELS.map((label, lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => setContingency(lvl as Level)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] border transition-colors ${
                contingency === lvl
                  ? "border-amber-400/60 bg-amber-400/15 text-amber-200"
                  : "border-white/10 text-white/40 hover:text-white/60"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-white/30">
            Contingency ({Math.round(pct * 100)}%)
          </span>
          <div className="flex gap-4">
            <span className="tabular-nums text-white/30 w-20 text-right">
              {fmt(subtotalLow * pct)}
            </span>
            <span className="tabular-nums text-white/50 w-20 text-right">
              {fmt(subtotalMid * pct)}
            </span>
            <span className="tabular-nums text-white/30 w-20 text-right">
              {fmt(subtotalHigh * pct)}
            </span>
          </div>
        </div>
      </div>

      {/* Total */}
      <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/20">
        <span className="text-sm font-semibold text-white/70">Total</span>
        <div className="flex gap-4">
          <span className="tabular-nums text-xs text-white/40 w-20 text-right">{fmt(totalLow)}</span>
          <span className="tabular-nums text-sm font-bold text-amber-300 w-20 text-right">{fmt(totalMid)}</span>
          <span className="tabular-nums text-xs text-white/40 w-20 text-right">{fmt(totalHigh)}</span>
        </div>
      </div>

      {/* Apply button */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => {
            onApply(Math.round(totalMid));
            setOpen(false);
          }}
          className="rounded-xl px-4 py-2 text-sm font-semibold bg-[#E8C547] text-slate-900 shadow-sm shadow-[#E8C547]/20 hover:bg-[#d4b33e] active:scale-95 transition-all duration-150"
        >
          Use Mid as Rehab Budget — {fmt(Math.round(totalMid))}
        </button>
      </div>

      {/* Disclaimer */}
      <p className="mt-3 text-[11px] text-white/30 leading-relaxed">
        Estimates based on Southeast US contractor pricing, 2026. Planning tool only — verify with a licensed contractor before finalizing.
      </p>
    </div>
  );
}
