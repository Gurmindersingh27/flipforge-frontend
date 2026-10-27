import type { Ref } from "react";
import { formatItemMoney } from "../lib/itemAnalysis";
import { safeItemLink } from "../lib/savedItems";
import type { ItemAssessmentResult } from "../lib/types";

const reasons: Record<string, string> = {
  unsupported_price: "No supporting search quote verifies this price.",
  not_comparable: "Not a comparable single item.",
  not_local_pickup: "Not identified as a local-pickup listing.",
  zero_price: "The listed price is zero.",
};

export default function ItemPriceEvidence({ evidence, panelRef, onBackToEstimate }: {
  evidence: ItemAssessmentResult;
  panelRef?: Ref<HTMLDetailsElement>;
  onBackToEstimate?: () => void;
}) {
  const date = new Date(evidence.assessed_at);
  return <details ref={panelRef} id="quick-price-sources" className="quick-card quick-sources">
    <summary>See the price sources ({evidence.listings.length})</summary>
    <p className="quick-small">{evidence.resale
      ? `${evidence.resale.eligible_count} listings support the range.`
      : "Not enough supported pickup listings to set a range."}</p>
    {onBackToEstimate && <button type="button" className="quick-text-button" onClick={onBackToEstimate}>Back to sale estimate</button>}
    <p className="quick-small">Asking prices only, not confirmed sales. Pickup offered does not verify distance. Shipping listings are reference material and don’t set your range.</p>
    <p className="quick-small">{Number.isNaN(date.getTime()) ? "Assessment date unavailable." : `Found during the assessment on ${date.toLocaleDateString("en-US")}.`} This is when FlipForge processed the answer, not a listing’s posting date or a check that it is still available.</p>
    {evidence.listings.map((listing, index) => {
      const link = safeItemLink(listing.url);
      const quote = listing.supporting_quotes?.find(text => text.trim());
      return <article key={`${listing.url}-${index}`}>
        <p className="quick-source-label">{listing.source} · {listing.market === "national_shipping" ? "National / shipping" : listing.market === "local_pickup" ? "Pickup offered" : "Location unknown"}</p>
        {link ? <a href={link} target="_blank" rel="noopener noreferrer">{listing.title} ↗</a> : <strong>{listing.title}</strong>}
        <p>{formatItemMoney(listing.price)} · {listing.condition}</p>
        <p className="quick-small">{listing.eligible ? "Eligible price evidence" : "Reference only"}</p>
        {!listing.eligible && <p className="quick-small">Main reason: {listing.exclusion_reason && Object.hasOwn(reasons, listing.exclusion_reason) ? reasons[listing.exclusion_reason] : "This listing was excluded from the range; a recognized reason is unavailable."}</p>}
        {quote && <blockquote><span>Search excerpt</span>{quote.length > 240 ? `${quote.slice(0, 240)}…` : quote}</blockquote>}
      </article>;
    })}
  </details>;
}
