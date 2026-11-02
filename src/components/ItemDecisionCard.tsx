import type { Ref } from "react";
import { formatItemHeadlineMoney, quickAssumptionsSummary, suggestedRepairTotal, verifiedPriceCount } from "../lib/itemAssessment";
import { parseItemNumber } from "../lib/itemAnalysis";
import type { SavedItemForm } from "../lib/savedItems";
import type { ItemAnalyzeResponse, ItemAssessmentConfirmation, ItemAssessmentResult, ItemFinancialInput } from "../lib/types";

export type RepairChoice = "unreviewed" | "catalog" | "custom";

interface Props {
  cardRef: Ref<HTMLHeadingElement>;
  evidence: ItemAssessmentResult;
  result: ItemAnalyzeResponse | null;
  source: ItemAssessmentConfirmation["resale_source"];
  form: SavedItemForm;
  repairChoice: RepairChoice;
  disabled: boolean;
  recovered: boolean;
  onCalculate: (useCatalog?: boolean) => void;
  onEditRepairs: () => void;
  onReviewSources: () => void;
  onReviewCosts: () => void;
  onReviewChecks: () => void;
  onReviewResale: () => void;
}

function amount(form: SavedItemForm, field: ItemFinancialInput) {
  try { return parseItemNumber(form.values[field], field); }
  catch { return null; } // The editor presents the specific validation error.
}

export default function ItemDecisionCard({ cardRef, evidence, result, source, form, repairChoice, disabled,
  recovered, onCalculate, onEditRepairs, onReviewSources, onReviewCosts, onReviewChecks, onReviewResale }: Props) {
  const verified = verifiedPriceCount(evidence.listings);
  const low = amount(form, "resale_low"), high = amount(form, "resale_high");
  const range = low === null || high === null || high < low ? null : low === high ? formatItemHeadlineMoney(low)
    : `${formatItemHeadlineMoney(low)}–${formatItemHeadlineMoney(high)}`;
  const manual = source === "user_estimate" && range !== null;
  const ceiling = result?.low?.max_offer;
  const materials = Number(suggestedRepairTotal(evidence));
  const enteredBudget = amount(form, "repairs");
  const budget = repairChoice === "unreviewed" ? null : repairChoice === "custom" ? enteredBudget : materials;
  const firstCheck = evidence.repair_unknowns[0];
  const confirmUnknowns = Boolean(firstCheck) && repairChoice !== "catalog";
  const needsRepairTotal = confirmUnknowns && materials === 0 && enteredBudget === null;
  const national = evidence.resale == null && evidence.national_resale;
  const resaleNote = source === "assessment" && evidence.resale ? `${evidence.resale.eligible_count} pickup listings · asking prices`
    : source === "national_reference" && national ? `${national.eligible_count} shipped used listings · shipping excluded`
    : manual ? "Entered by you" : national ? "Too few pickup listings. A national reference is available." : "Too few qualifying pickup listings.";
  return <section className="quick-decision-card" aria-label="Item decision card">
    <h1 ref={cardRef} tabIndex={-1}>{evidence.item_name}</h1>
    {recovered && <p className="quick-card-caption">Recovered estimate · review costs again</p>}
    <div className={`quick-card-limit${ceiling !== undefined && ceiling >= 0 ? " ready" : ""}`}>
      {manual && <p data-manual-basis>Based on your {range} resale estimate</p>}
      {ceiling !== undefined ? (ceiling < 0 ? <h2>Even free misses your profit goal.</h2> :
        <h2>Offer up to <strong data-quick-offer>{formatItemHeadlineMoney(ceiling)}</strong></h2>)
        : <h2>{range ? "Confirm costs for an offer" : "No buying limit yet"}</h2>}
      {ceiling !== undefined && ceiling >= 0 && <p>Including buyer fees and tax.</p>}
    </div>
    <dl className="quick-card-figures">
      <div><dt>{manual ? "Your resale estimate" : "Estimated resale"}</dt>
        <dd>{range ?? (verified === null ? "Verified count unavailable · 3 needed" : `${verified} verified ${verified === 1 ? "price" : "prices"} · 3 needed`)}</dd>
        <dd className="quick-card-caption">{resaleNote}</dd>
      </div>
      <div><dt>{result && budget !== null ? "Confirmed rehab" : repairChoice === "custom" && budget !== null ? "Your repair budget" : "Estimated rehab"}</dt>
        <dd>{budget === null ? "Still unknown" : formatItemHeadlineMoney(budget)}</dd>
        <dd className="quick-card-caption">{firstCheck && budget === null ? (evidence.repair_suggestions.length
          ? `About ${formatItemHeadlineMoney(materials)} in materials. Check the remaining work.` : "No catalog work priced yet.")
          : repairChoice === "custom" && budget !== null ? "Budget for this find"
          : firstCheck && result ? "Catalog materials · other work checked by you" : "Catalog materials allowance"}</dd>
      </div>
    </dl>
    {firstCheck && ceiling === undefined && <div className="quick-card-check"><span>First check</span><p>{firstCheck}</p>
      {evidence.repair_unknowns.length > 1 && <button type="button" className="quick-text-button" onClick={onReviewChecks}>See all checks ({evidence.repair_unknowns.length})</button>}
    </div>}
    <div className="quick-card-actions">
      {confirmUnknowns && materials > 0 && ceiling === undefined && <button type="button" className={budget === null ? "quick-primary" : "quick-text-button"} disabled={disabled}
        onClick={() => onCalculate(true)}>Use {formatItemHeadlineMoney(materials)} — I checked the rest</button>}
      {ceiling === undefined && (!confirmUnknowns || enteredBudget !== null) && range && <button type="button" className="quick-primary"
        disabled={disabled} onClick={() => onCalculate()}>Confirm costs &amp; calculate</button>}
      {!range && national && <button type="button" className="quick-text-button" onClick={onReviewResale}>Review national reference</button>}
      {ceiling === undefined && <button type="button" className={needsRepairTotal ? "quick-primary" : "quick-text-button"} disabled={disabled} onClick={onEditRepairs}>Enter a different total</button>}
    </div>
    <p className="quick-card-caption">{quickAssumptionsSummary(form)} · <button type="button" className="quick-text-button" onClick={onReviewCosts}>Review costs</button></p>
    <button type="button" className="quick-card-sources" onClick={onReviewSources}>Review {evidence.listings.length} price {evidence.listings.length === 1 ? "source" : "sources"}</button>
  </section>;
}
