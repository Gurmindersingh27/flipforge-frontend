import { formatItemMoney, formatItemPercent, ITEM_FIELDS, ITEM_LABELS } from "../lib/itemAnalysis";
import { OUTCOME_LABELS } from "../lib/itemOutcomes";
import { projectHeadline, projectMissing, projectRange, RESALE_SOURCE_LABELS } from "../lib/itemProjects";
import type { ItemAnalyzeResponse, ItemOutcomeResponse, OutcomeComparison, OutcomeExplanation } from "../lib/types";

function EstimateFigures({ result }: { result: ItemAnalyzeResponse | null }) {
  return <dl className="project-figures">
    <div><dt>Purchase price</dt><dd>{result?.assumptions.purchase_price.value == null ? "No price entered" : formatItemMoney(result.assumptions.purchase_price.value)}</dd></div>
    <div><dt>Resale estimate</dt><dd>{projectRange(result?.low?.resale, result?.high?.resale)}</dd></div>
    <div><dt>Cash profit</dt><dd>{projectRange(result?.low?.cash_left, result?.high?.cash_left)}</dd></div>
    <div><dt>Profit after your time</dt><dd>{projectRange(result?.low?.profit_after_time, result?.high?.profit_after_time)}</dd></div>
  </dl>;
}
export function ActualFigures({ outcome }: { outcome: ItemOutcomeResponse }) {
  return <dl className="project-figures">
    {(["cash_invested", "cash_profit", "profit_after_time", "days_held", "days_to_sell"] as const).map(key => {
      const labels = { cash_invested: "Cash invested", cash_profit: "Cash profit", profit_after_time: "Profit after your time", days_held: "Days held", days_to_sell: "Days to sell" };
      const value = outcome.calculated[key];
      return <div key={key}><dt>{labels[key]}</dt><dd data-project-actual={key}>{value === null ? "Not complete" : key.startsWith("days_") ? `${value} days` : formatItemMoney(value)}</dd>
        {value === null && <dd className="project-help">{projectMissing(outcome.calculated.missing_fields[key])}.</dd>}</div>;
    })}
  </dl>;
}
function Explanation({ value, title }: { value: OutcomeExplanation; title: string }) {
  const headline = projectHeadline(value);
  return <section className="project-explanation" aria-label={title}>
    <h3>{title}</h3>
    <p className="project-help">Expected profit at {formatItemMoney(value.baseline_sale_price)} resale, using what you paid. A sale inside the estimate uses your sale price; a sale outside it uses the nearest end of the range.</p>
    {headline && <p className="project-headline">{headline}</p>}
    <dl className="project-effects"><div><dt>Expected baseline</dt><dd>{formatItemMoney(value.baseline_profit)}</dd></div>
      {value.effects.map(effect => <div key={effect.key} data-project-effect={effect.key}><dt>{effect.label}</dt><dd>{effect.amount > 0 ? "+" : ""}{formatItemMoney(effect.amount)}</dd></div>)}
      <div className="project-total"><dt>Total difference</dt><dd>{value.total_effect > 0 ? "+" : ""}{formatItemMoney(value.total_effect)}</dd></div>
      <div className="project-total"><dt>Actual profit</dt><dd>{formatItemMoney(value.actual_profit)}</dd></div>
    </dl>
    <p className="project-help">Positive changes add profit; negative changes reduce it. Sale effects include expected percentage fees; the selling-fee effect compares fees at your actual sale price.</p>
  </section>;
}
export default function ItemOutcomeComparison({ comparison, outcome }: { comparison: OutcomeComparison; outcome: ItemOutcomeResponse }) {
  const original = comparison.original_estimate;
  return <section className="project-comparison" aria-label="Estimate versus actual">
    <h2>Estimate vs. actual</h2>
    <p className="project-help">Based on saved estimate #{original.id}. Resale source: <strong>{RESALE_SOURCE_LABELS[comparison.resale_source]}</strong>. These figures reflect saved tracking.</p>
    <div className="project-summary-grid">
      <section><h3>Original estimate</h3><p className="project-help">As saved on {new Date(original.created_at).toLocaleDateString("en-US")}.</p><EstimateFigures result={original.analysis_result} /></section>
      <section><h3>Expected at your purchase price</h3><p className="project-help">The same saved assumptions, with what you actually paid.</p>
        {comparison.expected_at_purchase_price ? <EstimateFigures result={comparison.expected_at_purchase_price} /> : <p>Purchase price not recorded.</p>}</section>
      <section><h3>Actual</h3><ActualFigures outcome={outcome} /></section>
    </div>
    <details className="flips-notes"><summary>Original saved assumptions</summary><dl className="project-figures">
      {ITEM_FIELDS.map(key => { const field = original.analysis_result.assumptions[key]; return <div key={key}><dt>{ITEM_LABELS[key]}</dt><dd>{field.value === null ? "Not entered" : key.endsWith("_pct") ? formatItemPercent(field.value) : key === "hours" ? `${field.value} hours` : formatItemMoney(field.value)}</dd></div>; })}
    </dl></details>
    <h3>Where the numbers changed</h3>
    <p className="project-help">Purchase is the common basis. Repairs include the planned contingency; other expenses had no estimate allowance. Dates are actuals only.</p>
    <dl className="project-lines">{comparison.lines.map(line => <div className="project-line" key={line.key} data-project-line={line.key}>
      <dt>{line.label}</dt>
      <dd><span>Expected at your purchase price</span>{projectRange(line.expected_low, line.expected_high)}</dd>
      <dd><span>Actual</span>{line.actual === null ? "Not recorded" : formatItemMoney(line.actual)}{line.missing_fields.length > 0 && <small>{line.missing_fields.map(key => OUTCOME_LABELS[key]).join(", ")} not recorded.</small>}</dd>
      {line.difference_low !== null && line.difference_high !== null && <dd className="project-line-change"><span>Change to profit versus the low / high estimate</span>{projectRange(line.difference_low, line.difference_high)}</dd>}
    </div>)}</dl>
    {comparison.cash_explanation ? <Explanation value={comparison.cash_explanation} title="Cash profit difference" /> : <p className="project-help" data-project-incomplete>Cash profit is not complete: {projectMissing(comparison.actual.missing_fields.cash_profit)}. The recorded line differences above do not establish a total.</p>}
    {comparison.after_time_explanation ? <Explanation value={comparison.after_time_explanation} title="Difference after your time" /> : <p className="project-help">Profit after your time is not complete: {projectMissing(comparison.actual.missing_fields.profit_after_time)}.</p>}
  </section>;
}
