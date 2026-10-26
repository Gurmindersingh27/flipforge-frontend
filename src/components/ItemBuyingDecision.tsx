import { useEffect, useId, useRef, useState } from "react";
import { formatItemMoney, ITEM_LABELS } from "../lib/itemAnalysis";
import { formatItemHeadlineMoney, itemDecision } from "../lib/itemAssessment";
import { buildBuyingSummary, buyingMissingTargets, buyingResaleLabel } from "../lib/itemBuyingDecision";
import type { BuyingResaleSource } from "../lib/itemBuyingDecision";
import type { ItemAnalyzeResponse, ItemFinancialInput } from "../lib/types";

interface Props {
  result: ItemAnalyzeResponse;
  resaleSource: BuyingResaleSource;
  ownResale: boolean;
  onOpenCosts: () => void;
  onFocusField: (field: string) => void;
}

export default function ItemBuyingDecision({ result, resaleSource, ownResale, onOpenCosts, onFocusField }: Props) {
  const summaryId = useId();
  const [copyState, setCopyState] = useState<{ result: ItemAnalyzeResponse | null; source: BuyingResaleSource; status: "idle" | "copying" | "copied" | "failed" }>({ result: null, source: null, status: "idle" });
  const copyGeneration = useRef(0);
  useEffect(() => () => { copyGeneration.current++; }, [result, resaleSource]);
  const copyStatus = copyState.result === result && copyState.source === resaleSource ? copyState.status : "idle";
  const summary = buildBuyingSummary(result, resaleSource);
  async function copySummary() {
    if (!summary || copyStatus === "copying") return;
    const generation = ++copyGeneration.current;
    setCopyState({ result, source: resaleSource, status: "copying" });
    try {
      await navigator.clipboard.writeText(summary);
      if (generation === copyGeneration.current) setCopyState({ result, source: resaleSource, status: "copied" });
    } catch {
      if (generation === copyGeneration.current) setCopyState({ result, source: resaleSource, status: "failed" });
    }
  }
  if (result.status === "needs_info") return <>
    <p className="quick-eyebrow">FINISH YOUR BUYING ESTIMATE</p><h2>{itemDecision(result)}</h2>
    <p>Fill in these missing details before we can give you an offer.</p>
    <ul className="quick-missing-fields">{buyingMissingTargets(result.missing_inputs, ownResale).map(({ field, target }, index) => <li key={`${field}-${index}`}>
      {target ? <button type="button" className="quick-text-button" data-missing-field={field} data-field-target={target.id} onClick={() => onFocusField(field)}>{ITEM_LABELS[field as ItemFinancialInput]}</button>
        : Object.hasOwn(ITEM_LABELS, field) ? ITEM_LABELS[field as ItemFinancialInput] : field}
    </li>)}</ul>
    <button className="quick-text-button" type="button" onClick={onOpenCosts}>Profit goal: {formatItemHeadlineMoney(result.assumptions.target_profit.value)} · Change</button>
  </>;
  const { low, high } = result;
  if (!low || !high) return <p>The buying figures are not available for this result.</p>;
  const negative = low.max_offer < 0;
  const noTime = result.assumptions.hours.value === 0;
  return <>
    <p className="quick-eyebrow">YOUR BUYING LIMIT</p>
    {negative ? <h2>Even free misses your profit goal.</h2> : <div className="quick-offer"><span>Pay no more than</span><strong data-quick-offer>{formatItemMoney(low.max_offer, true)}</strong><span>Including buyer fees and tax.</span></div>}
    {negative ? <p className="quick-decision-verdict">{itemDecision(result)}</p> : <h2 className="quick-decision-verdict">{itemDecision(result)}</h2>}
    <button className="quick-text-button" type="button" onClick={onOpenCosts}>Profit goal: {formatItemHeadlineMoney(result.assumptions.target_profit.value)} · Change</button>
    <p>{result.status === "skip" ? `It misses your profit goal even if it sells well. ${low.cash_left !== null && low.cash_left < 0 ? "At their price, you'd likely lose money." : "That doesn't necessarily mean a cash loss."}` : result.status === "stretch" ? "At their price, you'd need a stronger sale to meet your goal." : "Based on these costs and the low end of the sale estimate. Check the item before buying."}</p>
    {negative && <p>This isn't a negative price to offer the seller. The calculated ceiling is in the details below.</p>}
    <div className="quick-sale-assumptions"><p>{buyingResaleLabel(resaleSource)}</p><dl>
      <div><dt>Low sale estimate</dt><dd>{formatItemMoney(low.resale)}</dd></div>
      <div><dt>High sale estimate</dt><dd>{formatItemMoney(high.resale)}</dd></div>
    </dl></div>
    {result.status !== "offer_only" && <>
      <p className="quick-small">Cash and profit below assume buying at the entered purchase price of {formatItemMoney(result.assumptions.purchase_price.value)}, including buyer fees and tax.</p>
      {noTime ? <p className="quick-keep">You'd keep <strong data-quick-keep>{formatItemMoney(low.cash_left)}</strong><small>If it sells for {formatItemMoney(low.resale)}, after costs &amp; repair buffer.</small></p> : <div className="quick-profits"><div><span>Cash left</span><strong data-quick-cash>{formatItemMoney(low.cash_left)}</strong><small>After costs &amp; repair buffer</small></div><div><span>Profit after your time</span><strong data-quick-profit>{formatItemMoney(low.profit_after_time)}</strong><small>If it sells for {formatItemMoney(low.resale)}</small></div></div>}
      {high.resale !== low.resale && <p className="quick-high">If it sells well at {formatItemMoney(high.resale)}, {noTime ? "you'd keep " : "profit after your time would be "}{formatItemMoney(high.profit_after_time)}.</p>}
    </>}
    {result.status === "offer_only" && <p>Add an asking price to see how much you'd keep. If it sells well, the offer ceiling is {formatItemMoney(high.max_offer, true)}.</p>}
    <details className="quick-result-details"><summary>Sale assumptions &amp; cost details</summary>
      <dl>
        {negative && <div><dt>Calculated ceiling · not a seller offer</dt><dd><strong data-quick-offer>{formatItemMoney(low.max_offer, true)}</strong></dd></div>}
        <div><dt>Low sale estimate</dt><dd>{formatItemMoney(low.resale)}</dd></div>
        <div><dt>High sale estimate</dt><dd>{formatItemMoney(high.resale)}</dd></div>
        <div><dt>Repairs</dt><dd>{formatItemMoney(result.assumptions.repairs.value)}</dd></div>
        <div><dt>Pickup</dt><dd>{formatItemMoney(result.assumptions.pickup.value)}</dd></div>
        <div><dt>Delivery</dt><dd>{formatItemMoney(result.assumptions.delivery.value)}</dd></div>
        <div><dt>Storage</dt><dd>{formatItemMoney(result.assumptions.storage.value)}</dd></div>
        <div><dt>Repair buffer at low sale estimate</dt><dd>{formatItemMoney(low.contingency)}</dd></div>
        <div><dt>Selling fees at low sale estimate</dt><dd>{formatItemMoney(low.selling_fees)}</dd></div>
        <div><dt>Your time value</dt><dd>{formatItemMoney(low.own_time_value)}</dd></div>
        <div><dt>Profit goal</dt><dd>{formatItemMoney(result.assumptions.target_profit.value)}</dd></div>
      </dl>
      <p className="quick-small">These are the values used for this result. Change costs and calculate again to update it.</p>
    </details>
    <p className="quick-small">{buyingResaleLabel(resaleSource)} Before income tax and costs not entered. This is a budget, not an inspection.</p>
    <details className="quick-buying-summary"><summary>Keep a buying summary</summary>
      <p className="quick-small">Current calculation only. Copying does not save the find.</p>
      <label className="quick-field" htmlFor={summaryId}>Buying summary · select to copy manually<textarea id={summaryId} data-buying-summary readOnly rows={10} value={summary} /></label>
      <button type="button" className="quick-secondary" disabled={copyStatus === "copying"} onClick={() => void copySummary()}>{copyStatus === "copying" ? "Copying…" : "Copy buying summary"}</button>
      {copyStatus === "copied" && <p role="status" className="quick-small">Copied. This does not save the find.</p>}
      {copyStatus === "failed" && <p role="alert" className="quick-error">Couldn’t copy automatically. Select the buying summary above and copy it manually.</p>}
    </details>
  </>;
}
