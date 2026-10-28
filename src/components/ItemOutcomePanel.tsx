import { useItemSession } from "../lib/useItemSession";
import { ItemSessionChangedError, ItemSignInError } from "../lib/itemSession";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/clerk-react";
import { getItemOutcome, ItemApiError, saveItemOutcome, UnconfirmedOutcomeSaveError } from "../lib/api";
import { formatItemMoney } from "../lib/itemAnalysis";
import { buildOutcomeFacts, OUTCOME_CHANNELS, OUTCOME_DATES, OUTCOME_EXPENSES, OUTCOME_FIGURES, OUTCOME_LABELS,
  OUTCOME_STATUSES, outcomeFieldsToClear, outcomeForm, outcomeIsUncertain } from "../lib/itemOutcomes";
import type { OutcomeForm } from "../lib/itemOutcomes";
import type { ItemOutcomeDate, ItemOutcomeFigure, ItemOutcomeNumber, ItemOutcomeResponse, ItemOutcomeStatus, ItemSaleChannel, SaveItemOutcomeRequest } from "../lib/types";
import "./ItemOutcomePanel.css";

type Phase = "loading" | "editing" | "saving" | "uncertain" | "reload" | "conflict";
type ReloadReason = "initial" | "saved" | "conflict" | "discarded";
export type OutcomeGuard = "busy" | "draft" | null;
interface Props { rootId: number; itemId: number; onGuard: (guard: OutcomeGuard) => void }
interface Attempt { owner: string; payload: SaveItemOutcomeRequest }

export default function ItemOutcomePanel({ rootId, itemId, onGuard }: Props) {
  const { userId } = useAuth();
  const withSession = useItemSession();
  const [phase, setPhase] = useState<Phase>("loading");
  const [form, setForm] = useState<OutcomeForm>(() => outcomeForm());
  const [latest, setLatest] = useState<ItemOutcomeResponse | null>(null);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discarded, setDiscarded] = useState(false);
  const [reloadReason, setReloadReason] = useState<ReloadReason>("initial");
  const sequence = useRef(0);
  const locked = useRef(false);
  const pending = useRef<Attempt | null>(null);
  // The parent keys the list by account and this panel by the viewed estimate.
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void reload("initial"); });
    const invalidate = () => { sequence.current++; pending.current = null; locked.current = false; };
    return () => { active = false; invalidate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onGuard(["loading", "saving", "uncertain"].includes(phase) ? "busy" : dirty || phase === "conflict" || phase === "reload" ? "draft" : null);
  }, [phase, dirty, onGuard]);

  async function readLatest(reason: ReloadReason, generation: number) {
    setReloadReason(reason); setPhase("loading");
    try {
      const saved = await withSession((token, signal) => getItemOutcome(rootId, token, signal), () => generation === sequence.current);
      if (generation !== sequence.current) return;
      setLatest(saved); setErrors({});
      if (reason === "initial" || reason === "saved") {
        setForm(outcomeForm(saved?.inputs)); setDirty(false); setPhase("editing");
        setMessage(reason === "saved" ? "Tracking saved. Showing the latest outcome." : "");
      } else {
        // Keep the full unsaved draft; never merge or save it automatically.
        setPhase("conflict");
        setMessage(reason === "conflict" ? "This find was updated since you started editing. Your unsaved changes are kept."
          : "Latest tracking loaded. Your unsaved changes are kept. Choose which version to use.");
      }
    } catch (error) { if (error instanceof ItemSessionChangedError) return;
      if (generation !== sequence.current) return;
      setPhase("reload");
      setMessage(`${reason === "saved" ? "Your save was confirmed. " : ""}${error instanceof Error ? error.message : "Could not load tracking."} Reload before saving.`);
    }
  }
  async function reload(reason: ReloadReason) {
    if (locked.current) return;
    locked.current = true;
    const generation = ++sequence.current;
    try { await readLatest(reason, generation); }
    finally { if (generation === sequence.current) locked.current = false; }
  }
  async function save() {
    if (locked.current || !userId || !["editing", "conflict"].includes(phase)) return;
    const built = buildOutcomeFacts(form);
    if (!built.ok) { setErrors(built.errors); return; }
    try {
      const attempt: Attempt = { owner: userId, payload: { ...built.facts, based_on_item_id: itemId,
        expected_previous_id: latest?.id ?? null, request_id: crypto.randomUUID() } };
      pending.current = attempt;
      await submit(attempt);
    } catch { setMessage("Could not prepare this save. Your entries are still here."); }
  }
  async function submit(attempt: Attempt) {
    if (locked.current || attempt.owner !== userId || pending.current !== attempt) return;
    locked.current = true;
    const generation = ++sequence.current;
    const wasUncertain = phase === "uncertain";
    const wasConflict = phase === "conflict";
    setPhase("saving"); setMessage(""); setErrors({});
    try {
      const saved = await withSession((token, signal) => saveItemOutcome(rootId, attempt.payload, token, signal), () => generation === sequence.current);
      if (generation !== sequence.current) return;
      pending.current = null; setLatest(saved);
      // A successful replay may be an older snapshot. Refresh before the next edit.
      await readLatest("saved", generation);
    } catch (error) { if (error instanceof ItemSessionChangedError) return;
      if (generation !== sequence.current) return;
      const status = error instanceof ItemSignInError || error instanceof ItemApiError ? error.status : undefined;
      const keep = outcomeIsUncertain(wasUncertain, error instanceof UnconfirmedOutcomeSaveError, status);
      if (keep) {
        setPhase("uncertain");
        setMessage(`${error instanceof ItemSignInError ? `${error.message} ` : ""}This outcome may already be saved. Retry this save to confirm it, or discard and reload before editing.`);
      } else {
        pending.current = null;
        if (status === 409) await readLatest("conflict", generation);
        else { setPhase(wasConflict ? "conflict" : "editing"); setMessage(error instanceof Error ? error.message : "Save failed. Your entries are still here."); }
      }
    } finally { if (generation === sequence.current) locked.current = false; }
  }
  function edit<K extends keyof OutcomeForm>(key: K, value: OutcomeForm[K]) {
    setForm(old => ({ ...old, [key]: value })); setDirty(true); setErrors({}); setMessage("");
  }
  function statusChange(status: ItemOutcomeStatus) {
    const clear = outcomeFieldsToClear(form, status);
    if (clear.length && !window.confirm(`Changing to ${status} clears: ${clear.map(key => OUTCOME_LABELS[key]).join(", ")}. Continue?`)) return;
    setForm(old => ({ ...old, ...Object.fromEntries(clear.map(key => [key, ""])), status }));
    setDirty(true); setErrors({}); setMessage("");
  }
  const frozen = phase !== "editing";
  const draftBasis = dirty || latest === null;
  const basis = draftBasis ? itemId : latest.based_on_item_id;
  const field = (key: ItemOutcomeNumber | ItemOutcomeDate) => <div className="outcome-field" key={key}>
    <label htmlFor={`outcome-${key}`}>{OUTCOME_LABELS[key]}</label>
    <input id={`outcome-${key}`} type={OUTCOME_DATES.includes(key as ItemOutcomeDate) ? "date" : "text"}
      inputMode={OUTCOME_DATES.includes(key as ItemOutcomeDate) ? undefined : "decimal"} value={form[key]}
      aria-invalid={Boolean(errors[key])} aria-describedby={errors[key] ? `outcome-error-${key}` : undefined}
      onChange={event => edit(key, event.target.value)} />
    {errors[key] && <p className="outcome-error" id={`outcome-error-${key}`}>{errors[key]}</p>}
  </div>;
  return <section className="item-outcome" aria-label="Track this find" aria-busy={phase === "loading" || phase === "saving"}>
    <h3>Track this find</h3>
    <p className="outcome-shared">Tracking applies to all versions of this find · {basis === null ? "no estimate linked" : `based on estimate #${basis}`}</p>
    {latest?.based_on_item_id !== itemId && latest !== null && <p className="outcome-help">Your next save will be based on estimate #{itemId}, the version you opened.</p>}
    <p className="outcome-help">Actual amounts in USD. Leave blanks for unknowns; enter 0 when there was no cost.</p>
    {phase === "loading" && <p role="status">Loading latest tracking…</p>}
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset disabled={frozen}>
        <legend className="outcome-sr-only">Actual outcome</legend>
        <div className="outcome-statuses" role="group" aria-label="Find status">
          {OUTCOME_STATUSES.map(status => <button type="button" key={status} aria-pressed={form.status === status} onClick={() => statusChange(status)}>{status[0].toUpperCase() + status.slice(1)}</button>)}
        </div>
        {field("purchase_price")}
        {form.status === "sold" && <div className="outcome-fields">
          {field("sale_price")}
          <div className="outcome-field"><label htmlFor="outcome-sale_channel">Sale channel</label>
            <select id="outcome-sale_channel" value={form.sale_channel} onChange={event => edit("sale_channel", event.target.value as ItemSaleChannel | "")}>
              <option value="">Unknown</option>{Object.entries(OUTCOME_CHANNELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </div>
        </div>}
        <details><summary>Expenses</summary><div className="outcome-fields">{OUTCOME_EXPENSES.map(field)}</div></details>
        <details><summary>Your time</summary><div className="outcome-fields">{field("hours")}{field("hourly_value")}</div></details>
        <details><summary>Dates</summary><div className="outcome-fields">{field("purchased_on")}{form.status !== "bought" && field("listed_on")}{form.status === "sold" && field("sold_on")}</div></details>
      </fieldset>
      {Object.keys(errors).length > 0 && <p className="outcome-error" role="alert">Check these fields: {Object.keys(errors).map(key => OUTCOME_LABELS[key as keyof typeof OUTCOME_LABELS] ?? key).join(", ")}. Expand the relevant section to edit.</p>}
      {phase === "editing" && <button className="flips-primary" type="submit" disabled={latest !== null && !dirty}>Save tracking</button>}
      {phase === "saving" && <p role="status">Saving tracking…</p>}
    </form>
    {message && <p role={phase === "editing" && !errors.status ? "status" : "alert"}>{message}</p>}
    {phase === "uncertain" && <div className="outcome-actions">
      <button type="button" className="flips-primary" onClick={() => { if (pending.current) void submit(pending.current); }}>Retry this save</button>
      <button type="button" className="flips-link" onClick={() => { pending.current = null; setDiscarded(true); void reload("discarded"); }}>Discard and edit</button>
    </div>}
    {phase === "reload" && <button type="button" className="flips-link" onClick={() => void reload(reloadReason)}>Reload tracking</button>}
    {phase === "conflict" && <div className="outcome-actions">
      <button type="button" className="flips-link" onClick={() => { setForm(outcomeForm(latest?.inputs)); setDirty(false); setPhase("editing"); setMessage(""); setErrors({}); }}>Use latest</button>
      <button type="button" className="flips-primary" onClick={() => void save()}>Save my version</button>
    </div>}
    {discarded && <p role="alert" className="outcome-help">The discarded attempt may already be saved. Discarding does not delete it.</p>}
    {latest && <div className="outcome-saved" data-outcome-revision={latest.id}>
      <h4>Last saved · {latest.inputs.status} · revision {latest.revision_number}</h4>
      <p className="outcome-help">{latest.based_on_item_id === null ? "No estimate linked" : `Based on estimate #${latest.based_on_item_id}`}. Figures reflect saved actuals{dirty ? ", not your unsaved entries" : ""}.</p>
      <dl>{(Object.keys(OUTCOME_FIGURES) as ItemOutcomeFigure[]).map(key => <div key={key}>
        <dt>{OUTCOME_FIGURES[key]}</dt><dd data-outcome-figure={key}>{latest.calculated[key] === null ? "Not calculated" : key.startsWith("days_") ? `${latest.calculated[key]} days` : formatItemMoney(latest.calculated[key])}</dd>
        {latest.calculated[key] === null && <dd className="outcome-help">Needed: {latest.calculated.missing_fields[key].map(field => OUTCOME_LABELS[field]).join(", ")}.</dd>}
      </div>)}</dl>
    </div>}
  </section>;
}
