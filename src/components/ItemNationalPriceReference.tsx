import { formatItemMoney } from "../lib/itemAnalysis";
import type { ItemResaleEstimate } from "../lib/types";

export default function ItemNationalPriceReference({ range, selected, disabled, onApply, onOwnEstimate }: {
  range: ItemResaleEstimate;
  selected: boolean;
  disabled: boolean;
  onApply: () => void;
  onOwnEstimate: () => void;
}) {
  return <section className="quick-resale" aria-label="National price reference" data-national-reference>
    <h3>National used asking prices · shipping excluded</h3>
    <strong>{formatItemMoney(range.low)} – {formatItemMoney(range.high)}</strong>
    <p className="quick-small">{range.eligible_count} shipped used listings support this optional reference. Pickup evidence was insufficient.</p>
    <p className="quick-small">These are advertised item prices, not completed sales. Shipping costs are excluded. Your local selling price and this item's condition may differ.</p>
    <button type="button" className="quick-secondary" data-use-national aria-pressed={selected} disabled={disabled || selected} onClick={onApply}>Use this national range</button>
    <button type="button" className="quick-text-button" disabled={disabled} onClick={onOwnEstimate}>Enter my own estimate</button>
  </section>;
}
