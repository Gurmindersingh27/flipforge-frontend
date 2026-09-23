import { useState } from "react";
import { SAMPLE_SCENARIOS } from "../lib/sampleDeal";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function SampleDealDemo() {
  const [selected, setSelected] = useState(0);
  const baseline = SAMPLE_SCENARIOS[0];
  const scenario = SAMPLE_SCENARIOS[selected];
  const offerDrop = baseline.result.max_safe_offer - scenario.result.max_safe_offer;
  const profitDrop = baseline.result.net_profit - scenario.result.net_profit;
  const overOffer = scenario.input.purchase_price - scenario.result.max_safe_offer;

  return (
    <section aria-label="Sample deal" className="w-full overflow-hidden rounded-2xl border border-white/10 bg-slate-950/60 text-left shadow-2xl shadow-black/20">
      <div className="border-b border-white/10 px-5 py-5 sm:px-7">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-300">Interactive sample · Fictional deal</p>
        <h2 className="mt-2 text-xl font-semibold text-white">Same house. A different decision.</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-300">
          A {dollars.format(baseline.input.purchase_price)} purchase. An estimated {dollars.format(baseline.input.arv)} resale.
          Select a scenario to see what changes.
        </p>
      </div>
      <div className="grid gap-6 p-5 sm:p-7 md:grid-cols-2 md:gap-8">
        <div role="group" aria-label="Sample scenarios" className="space-y-3">
          {SAMPLE_SCENARIOS.map((option, index) => (
            <button key={option.id} type="button" aria-label={option.label}
              aria-pressed={selected === index} aria-controls="sample-deal-results"
              onClick={() => setSelected(index)}
              className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 ${selected === index ? "border-amber-400/70 bg-amber-400/10" : "border-white/10 bg-white/[0.03] hover:border-white/30 hover:bg-white/[0.06]"}`}>
              <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selected === index ? "bg-amber-400 text-slate-950" : "bg-white/10 text-slate-300"}`}>{index + 1}</span>
              <span>
                <span className="block text-sm font-semibold text-white">{option.label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-300">{option.description}</span>
              </span>
            </button>
          ))}
          <p className="px-1 text-xs leading-relaxed text-slate-400">Three fixed examples. Nothing here is saved or added to your deals.</p>
        </div>
        <div id="sample-deal-results" aria-live="polite" aria-atomic="true" className="min-w-0 rounded-xl border border-white/10 bg-white/[0.03] p-5">
          <h3 className="text-sm font-medium text-slate-300">{scenario.label}</h3>
          <dl className="mt-5">
            <dt className="text-sm text-slate-300">Max safe offer · modeled</dt>
            <dd data-sample-metric="max_safe_offer" className="mt-1 text-4xl font-bold tracking-tight text-amber-300 sm:text-5xl">{dollars.format(scenario.result.max_safe_offer)}</dd>
            <dd className="mt-2 text-sm text-slate-300">{offerDrop > 0 ? `${dollars.format(offerDrop)} lower than the original estimate` : "Based on the original estimate"}</dd>
            <dt className="mt-6 border-t border-white/10 pt-5 text-sm text-slate-300">Estimated profit at the {dollars.format(scenario.input.purchase_price)} purchase price</dt>
            <dd data-sample-metric="net_profit" className="mt-1 text-2xl font-semibold text-white">{dollars.format(scenario.result.net_profit)}</dd>
            <dd className="mt-1 text-sm text-slate-300">{profitDrop > 0 ? `${dollars.format(profitDrop)} less than the original estimate` : "Before any change to rehab or schedule"}</dd>
          </dl>
          <p className={`mt-5 rounded-lg p-3 text-sm leading-relaxed ${overOffer > 0 ? "bg-amber-400/10 text-amber-200" : "bg-white/5 text-slate-200"}`}>
            {overOffer > 0 ? `The purchase price is now ${dollars.format(overOffer)} above the modeled offer ceiling. Revisit the price and assumptions before committing.` : "The purchase price is below the modeled offer ceiling. Verify the resale estimate, scope and costs before committing."}
          </p>
        </div>
      </div>
      <div className="border-t border-white/10 px-5 py-4 sm:px-7">
        <details className="text-sm text-slate-300">
          <summary className="cursor-pointer rounded font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300">Sample assumptions and limits</summary>
          <p className="mt-3 leading-relaxed">Closing costs: 3% of purchase price. Selling costs: 8% of resale price. Loan: 90% of purchase and rehab costs at 10% annual interest. Required profit: 12% of modeled total cost. No rental income. Rehab and holding time follow your selected scenario.</p>
          <p className="mt-2 leading-relaxed">These are preset results from FlipForge’s existing analysis engine, not a real property or a verified contractor quote. They are estimates, not guaranteed outcomes.</p>
        </details>
        <p className="mt-3 text-xs leading-relaxed text-slate-400">Holding costs include loan interest only. Taxes, insurance, utilities, lender fees and draw timing are not separately modeled.</p>
      </div>
    </section>
  );
}
