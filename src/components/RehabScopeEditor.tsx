import { useId, useState } from "react";
import type { RehabScope, RehabScopeItem } from "../lib/types";
import { newScope, scopeTotals, scopeError, lineTotal, stampQuote, SCOPE_CATEGORY_SUGGESTIONS } from "../lib/rehabScope";

const money = (n: number) => Number.isFinite(n) ? n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }) : "—";
const field = "mt-1 w-full rounded-lg border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white";

export default function RehabScopeEditor({ scope, budget = 0, onChange, readOnly = false }: {
  scope: RehabScope | null; budget?: number;
  onChange?: (scope: RehabScope | null) => void; readOnly?: boolean;
}) {
  const categoryListId = useId();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [contractor, setContractor] = useState("");
  const [quoteDate, setQuoteDate] = useState("");
  const [convertAllowances, setConvertAllowances] = useState(false);
  const [replaceQuoteDetails, setReplaceQuoteDetails] = useState(false);
  const [stampMessage, setStampMessage] = useState("");
  function resetConsent() {
    setConvertAllowances(false); setReplaceQuoteDetails(false); setStampMessage("");
  }
  if (!scope) return readOnly ? <p className="text-sm text-white/50">No itemized scope saved for this version.</p> : (
    <button type="button" onClick={() => onChange?.(newScope(budget))} className="mt-3 rounded-xl border border-amber-400/40 px-4 py-2 text-sm text-amber-200">Start itemized budget</button>
  );
  const totals = scopeTotals(scope);
  const error = scopeError(scope);
  function updateItem(id: string, patch: Partial<RehabScopeItem>) {
    resetConsent();
    onChange?.({ ...scope!, items: scope!.items.map(item => item.id === id ? { ...item, ...patch } : item) });
  }
  function addItem() {
    onChange?.({ ...scope!, items: [...scope!.items, {
      id: crypto.randomUUID(), category: "New work", description: "", quantity: 1,
      unit: "allowance", unit_cost: 0, basis: "allowance", source: "", quote_date: null, notes: "",
    }] });
  }
  const selected = scope.items.filter(item => selectedIds.includes(item.id));
  function applyQuoteDetails() {
    try {
      const updated = stampQuote(scope!, contractor, quoteDate, selected.map(item => item.id), { convertAllowances, replaceQuoteDetails });
      onChange?.(updated);
      setStampMessage(`Quote details applied to ${selected.length} selected line${selected.length === 1 ? "" : "s"}. Amounts are unchanged.`);
      setSelectedIds([]); setConvertAllowances(false); setReplaceQuoteDetails(false);
    } catch (error) {
      setStampMessage(error instanceof Error ? error.message : "Could not apply quote details.");
    }
  }
  return (
    <section className="mt-4 space-y-4 rounded-2xl border border-amber-400/25 bg-slate-950/60 p-4" aria-label="Itemized rehab scope">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-amber-200">Itemized rehab scope</h3>
        {!readOnly && <button type="button" onClick={() => onChange?.(null)} className="text-xs text-white/60 underline">Use lump-sum budget</button>}
      </div>
      <p className="text-xs text-white/60">Scope saves with the analyzed deal. A quote records its source; it does not verify contractor scope or pricing. Contingency is applied once.</p>
      {!readOnly && <>
        <datalist id={categoryListId}>{SCOPE_CATEGORY_SUGGESTIONS.map(category => <option key={category} value={category} />)}</datalist>
        <details className="rounded-xl border border-white/15 p-3">
          <summary className="cursor-pointer text-sm font-medium text-amber-200">Apply quote details to selected lines</summary>
          <p className="mt-3 text-xs text-white/60">Select the lines below that this quote covers. Quantities and prices carry over unchanged. Enter the contractor's quoted quantities and prices first; applying a name and date does not supply a price. Other lines keep their own sources and estimate basis.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-white/60">Contractor / source<input aria-label="Bulk quote contractor" className={field} value={contractor} maxLength={500} onChange={e => { setContractor(e.target.value); resetConsent(); }} /></label>
            <label className="text-xs text-white/60">Quote date<input aria-label="Bulk quote date" type="date" className={field} value={quoteDate} onChange={e => { setQuoteDate(e.target.value); resetConsent(); }} /></label>
          </div>
          <p className="mt-3 text-xs text-white/70">{selected.length} line{selected.length === 1 ? "" : "s"} selected.</p>
          {selected.some(item => item.basis === "allowance") && <label className="mt-3 flex items-start gap-2 text-xs text-white/80"><input type="checkbox" aria-label="Confirm allowance conversion" checked={convertAllowances} onChange={e => setConvertAllowances(e.target.checked)} />I checked the contractor quote: each selected allowance's current quantity, unit price and total match it. Keep these amounts unchanged and replace their planning sources.</label>}
          {selected.some(item => item.basis === "quote" && ((item.source.trim() && item.source.trim() !== contractor.trim()) || (item.quote_date && item.quote_date !== quoteDate))) && <label className="mt-3 flex items-start gap-2 text-xs text-white/80"><input type="checkbox" aria-label="Confirm quote details replacement" checked={replaceQuoteDetails} onChange={e => setReplaceQuoteDetails(e.target.checked)} />Replace existing contractor / date on these selected quoted lines.</label>}
          <button type="button" disabled={!selected.length} onClick={applyQuoteDetails} className="mt-3 rounded-lg border border-amber-400/40 px-3 py-2 text-sm text-amber-200 disabled:opacity-40">Apply quote details</button>
          {stampMessage && <p role="status" className="mt-2 text-xs text-amber-100">{stampMessage}</p>}
        </details>
      </>}
      {scope.items.map((item, index) => (
        <fieldset key={item.id} disabled={readOnly} className="min-w-0 rounded-xl border border-white/10 p-3">
          <legend className="px-2 text-sm text-white/80">{index + 1}. {item.category || "Work item"} · {money(lineTotal(item))}</legend>
          {!readOnly && <label className="mb-3 flex items-center gap-2 text-xs text-white/70"><input type="checkbox" aria-label={`Select quote line ${index + 1}`} checked={selectedIds.includes(item.id)} onChange={e => { setSelectedIds(ids => e.target.checked ? [...ids, item.id] : ids.filter(id => id !== item.id)); resetConsent(); }} />Use bulk quote details for this line</label>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-white/60">Category<input aria-label={`Category ${index + 1}`} list={readOnly ? undefined : categoryListId} className={field} value={item.category} maxLength={100} onChange={e => updateItem(item.id, { category: e.target.value })} /></label>
            <label className="text-xs text-white/60">Quantity<input aria-label={`Quantity ${index + 1}`} type="number" min="0" max="1000000" step="any" className={field} value={item.quantity} onChange={e => updateItem(item.id, { quantity: Number(e.target.value) })} /></label>
            <label className="text-xs text-white/60">Unit<input aria-label={`Unit ${index + 1}`} className={field} value={item.unit} maxLength={40} onChange={e => updateItem(item.id, { unit: e.target.value })} /></label>
            <label className="text-xs text-white/60">Unit cost ($)<input aria-label={`Unit cost ${index + 1}`} type="number" min="0" max="100000000" step="0.01" className={field} value={item.unit_cost} onChange={e => updateItem(item.id, { unit_cost: Number(e.target.value) })} /></label>
            <label className="text-xs text-white/60 sm:col-span-2">Scope / description<input aria-label={`Description ${index + 1}`} className={field} value={item.description} maxLength={1000} onChange={e => updateItem(item.id, { description: e.target.value })} /></label>
            <label className="text-xs text-white/60">Basis<select aria-label={`Basis ${index + 1}`} className={field} value={item.basis} onChange={e => updateItem(item.id, { basis: e.target.value as RehabScopeItem["basis"] })}><option value="allowance">Planning allowance</option><option value="quote">Contractor quote</option></select></label>
            <label className="text-xs text-white/60">Quote date{item.basis === "quote" ? " *" : ""}<input aria-label={`Quote date ${index + 1}`} type="date" className={field} value={item.quote_date ?? ""} onChange={e => updateItem(item.id, { quote_date: e.target.value || null })} /></label>
            <label className="text-xs text-white/60 sm:col-span-2">Source / contractor{item.basis === "quote" ? " *" : ""}<input aria-label={`Source ${index + 1}`} className={field} value={item.source} maxLength={500} onChange={e => updateItem(item.id, { source: e.target.value })} /></label>
            <label className="text-xs text-white/60 sm:col-span-2">Notes / exclusions<input aria-label={`Notes ${index + 1}`} className={field} value={item.notes} maxLength={2000} onChange={e => updateItem(item.id, { notes: e.target.value })} /></label>
          </div>
          {!readOnly && <button type="button" onClick={() => onChange?.({ ...scope, items: scope.items.filter(i => i.id !== item.id) })} className="mt-3 text-xs text-rose-300">Remove item {index + 1}</button>}
        </fieldset>
      ))}
      {!readOnly && <button type="button" disabled={scope.items.length >= 100} onClick={addItem} className="rounded-lg border border-white/20 px-3 py-2 text-sm text-white disabled:opacity-40">Add scope item</button>}
      <div className="grid items-end gap-4 sm:grid-cols-3">
        <label className="text-xs text-white/60">Contingency (%)<input aria-label="Scope contingency" disabled={readOnly} type="number" min="0" max="100" step="0.1" className={field} value={Number((scope.contingency_pct * 100).toFixed(4))} onChange={e => onChange?.({ ...scope, contingency_pct: Number(e.target.value) / 100 })} /></label>
        <div className="text-sm text-white/60">Scope subtotal<br /><span className="text-white">{money(totals.subtotal)}</span></div>
        <div className="text-sm text-white/60">Rehab including contingency<br /><strong className="text-xl text-amber-200">{money(totals.total)}</strong></div>
      </div>
      <label className="block text-xs text-white/60">Budget notes<textarea aria-label="Budget notes" disabled={readOnly} className={field} value={scope.notes} maxLength={4000} onChange={e => onChange?.({ ...scope, notes: e.target.value })} /></label>
      {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
      {!readOnly && <p className="text-xs text-white/50">Editing this scope updates the rehab input. Generate a new memo to update the result, then save it.</p>}
    </section>
  );
}
