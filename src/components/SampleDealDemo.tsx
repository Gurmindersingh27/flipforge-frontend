import { useState } from "react";
import { SAMPLE_SCENARIOS } from "../lib/sampleDeal";

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
// One zero-based scale for every preset, with room beyond the purchase marker.
const offerScale = Math.ceil(Math.max(...SAMPLE_SCENARIOS.map(option =>
  Math.max(option.result.max_safe_offer, option.input.purchase_price))) * 1.1 / 10000) * 10000;

export default function SampleDealDemo() {
  const [selected, setSelected] = useState(1);
  const baseline = SAMPLE_SCENARIOS[0];
  const scenario = SAMPLE_SCENARIOS[selected];
  const offerDrop = baseline.result.max_safe_offer - scenario.result.max_safe_offer;
  const profitDrop = baseline.result.net_profit - scenario.result.net_profit;
  const overOffer = scenario.input.purchase_price - scenario.result.max_safe_offer;

  return (
    <section aria-label="Sample deal" className="ff-panel w-full overflow-hidden rounded-2xl text-left">
      <div className="border-b border-white/10 px-5 py-5 sm:px-7">
        <p className="ff-kicker text-xs font-semibold uppercase tracking-widest">Interactive sample · Fictional deal</p>
        <h2 className="ff-heading mt-2 text-xl font-semibold">Same house. A different decision.</h2>
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
              className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-300 ${selected === index ? "border-amber-400/70 bg-amber-400/10" : "border-transparent bg-transparent hover:border-white/15 hover:bg-white/[0.04]"}`}>
              <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${selected === index ? "bg-amber-400 text-slate-950" : "bg-white/10 text-slate-300"}`}>{index + 1}</span>
              <span>
                <span className="block text-sm font-semibold text-white">{option.label}</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-300">{option.description}</span>
              </span>
            </button>
          ))}
          <p className="px-1 text-xs leading-relaxed text-slate-400">Three fixed examples. Nothing here is saved or added to your deals.</p>
          <figure aria-labelledby="sample-offer-caption" className="pt-5">
            <figcaption id="sample-offer-caption" className="text-sm font-semibold text-white">Modeled offer comparison</figcaption>
            <p className="mt-2 flex items-center gap-2 text-xs text-slate-300">
              <span aria-hidden="true" className="h-4 border-l-2 border-dashed border-white" />
              Dashed marker: {dollars.format(scenario.input.purchase_price)} purchase price
            </p>
            <div className="mt-4 space-y-4">
              {[baseline, scenario].map((option, index) => (
                <div key={index} data-sample-offer-row={index === 0 ? "baseline" : "selected"}>
                  <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                    <span className="text-slate-300">{index === 0 ? "Original estimate" : `Selected: ${option.label}`}</span>
                    <span className="font-semibold tabular-nums text-white">{dollars.format(option.result.max_safe_offer)}</span>
                  </div>
                  <div aria-hidden="true" className="relative h-3 rounded-sm bg-white/10">
                    <div data-sample-offer-bar className={`h-full rounded-sm ${index === 0 ? "bg-slate-300" : "bg-amber-300"}`}
                      style={{ width: `${option.result.max_safe_offer / offerScale * 100}%` }} />
                    <span data-sample-purchase-marker className="absolute -top-1 h-5 border-l-2 border-dashed border-white"
                      style={{ left: `${scenario.input.purchase_price / offerScale * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 flex justify-between text-xs tabular-nums text-slate-400"><span>$0</span><span>{dollars.format(offerScale)}</span></p>
            <p className="mt-1 text-xs text-slate-400">Both bars use the same scale.</p>
          </figure>
        </div>
        <div id="sample-deal-results" aria-live="polite" aria-atomic="true" className="ff-inset min-w-0 rounded-xl p-5 sm:p-6">
          <h3 className="text-sm font-medium text-slate-300">{scenario.label}</h3>
          <dl className="mt-5">
            <dt className="text-sm text-slate-300">Max safe offer · modeled</dt>
            <dd data-sample-metric="max_safe_offer" className="ff-heading mt-1 text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{dollars.format(scenario.result.max_safe_offer)}</dd>
            <dd className="mt-2 text-sm text-slate-300">Targets a {scenario.input.required_profit_margin_pct * 100}% return on modeled total cost.</dd>
            <dd className="mt-2 text-sm text-slate-300">{offerDrop > 0 ? `${dollars.format(offerDrop)} lower than the original estimate` : "Based on the original estimate"}</dd>
            <dt className="mt-6 border-t border-white/10 pt-5 text-sm text-slate-300">Estimated profit at the {dollars.format(scenario.input.purchase_price)} purchase price</dt>
            <dd data-sample-metric="net_profit" className="mt-1 text-2xl font-semibold text-white">{dollars.format(scenario.result.net_profit)}</dd>
            <dd className="mt-1 text-sm text-slate-300">{profitDrop > 0 ? `${dollars.format(profitDrop)} less than the original estimate` : "Before any change to rehab or schedule"}</dd>
          </dl>
          <p className={`mt-5 rounded-lg p-3 text-sm leading-relaxed ${overOffer > 0 ? "ff-warning" : "text-slate-200"}`}>
            <strong className="mb-1 block">{overOffer > 0 ? "Review purchase price" : "Before you commit"}</strong>
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
