import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { analyzeItem, getItem } from "../lib/api";
import {
  formatItemMoney, formatItemPercent, hasPersonalDefault,
  ITEM_FIELDS, ITEM_LABELS, ITEM_PREFERENCES, ITEM_STATUS_TEXT,
} from "../lib/itemAnalysis";
import { buildSavedItemInputs, newSavedItemForm, restoreItemForm, safeItemLink } from "../lib/savedItems";
import type { SavedItemForm } from "../lib/savedItems";
import type { ItemAnalyzeResponse, ItemFinancialInput, ItemPreference, ItemScenario, SavedItem } from "../lib/types";
import ItemSavePanel from "./ItemSavePanel";

const inputClass = "w-full min-w-0 rounded-lg border border-white/20 bg-[#0f1115] px-3 py-2.5 text-base text-white focus-visible:outline-2 focus-visible:outline-amber-300 disabled:opacity-60";
const panelClass = "ff-panel min-w-0 rounded-2xl p-4 sm:p-6";
const groups: { title: string; note: string; fields: ItemFinancialInput[] }[] = [
  { title: "Price and resale", note: "Use your own resale estimates. Leave purchase blank if you only want the maximum offers.", fields: ["purchase_price", "resale_low", "resale_high"] },
  { title: "Cash expenses", note: "Enter 0 only when you have confirmed there is no cost. Repairs include materials and hired repair labor, not your own time.", fields: ["repairs", "pickup", "delivery", "storage"] },
  { title: "Your time and profit target", note: "Count pickup, repairs, listing, buyer coordination and delivery in your hours. The target is additional profit after valuing your time.", fields: ["hours", "hourly_value", "target_profit"] },
  { title: "Fees and repair buffer", note: "Selling fees apply to resale. The contingency buffer applies only to repairs.", fields: ["fee_pct", "fee_fixed", "contingency_pct"] },
];

function Scenario({ value, high, offersOnly }: { value: ItemScenario; high?: boolean; offersOnly: boolean }) {
  return <section aria-label={high ? "If it sells well" : "Low resale results"} className={`${panelClass} ${high ? "" : "border-amber-300/40"}`}>
    <h3 className="text-base font-semibold text-white">{high ? "If it sells well" : "At your low resale estimate"}</h3>
    <p className="mt-1 text-sm text-white/70">Resale: {formatItemMoney(value.resale)}</p>
    <p className="mt-5 text-sm text-white/80">Most you should pay, including any fees or tax</p>
    <p data-item-offer className="mt-2 break-words font-jetbrains text-3xl font-semibold text-amber-200">{formatItemMoney(value.max_offer, true)}</p>
    {value.max_offer < 0 && <p className="mt-2 text-sm text-amber-100">Even a free item misses your profit target under this resale scenario. This is not a negative price to offer the seller.</p>}
    {!offersOnly && <>
      <dl className="mt-6 space-y-4">
        <div><dt className="text-sm text-white/70">Cash left after expenses and repair buffer</dt><dd data-item-cash className="mt-1 break-words font-jetbrains text-xl">{formatItemMoney(value.cash_left)}</dd></div>
        <div><dt className="text-sm text-white/70">Profit after valuing your time</dt><dd data-item-profit className="mt-1 break-words font-jetbrains text-xl">{formatItemMoney(value.profit_after_time)}</dd></div>
        <div><dt className="text-sm text-white/70">Shortfall against your profit target</dt><dd data-item-shortfall className="mt-1 break-words font-jetbrains">{formatItemMoney(value.target_shortfall)}</dd></div>
      </dl>
      <details className="mt-5 text-sm text-white/75">
        <summary className="cursor-pointer rounded py-2 focus-visible:outline-2 focus-visible:outline-amber-300">Cost breakdown</summary>
        <dl className="mt-2 space-y-2">
          <div><dt>Repair contingency</dt><dd>{formatItemMoney(value.contingency)}</dd></div>
          <div><dt>Selling fees</dt><dd>{formatItemMoney(value.selling_fees)}</dd></div>
          <div><dt>Value of your time</dt><dd>{formatItemMoney(value.own_time_value)}</dd></div>
        </dl>
      </details>
    </>}
  </section>;
}

export default function ItemsPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [params] = useSearchParams();
  const saved = params.get("saved");
  const [identity, setIdentity] = useState({ userId: isLoaded ? userId ?? null : null, generation: 0 });
  const resolvedUser = userId ?? null;
  if (isLoaded && identity.userId !== resolvedUser) {
    // Anonymous drafts survive sign-in. Leaving an established account clears
    // the entire editor, including pending saves and any private saved data.
    setIdentity({ userId: resolvedUser, generation: identity.generation + (identity.userId === null ? 0 : 1) });
  }
  if (saved !== null && !isLoaded) return <p role="status">Loading sign-in…</p>;
  if (saved !== null && !isSignedIn) return <div className="space-y-4 py-8"><p>Sign in to reopen this saved item.</p><SignInButton mode="modal"><button className="min-h-11 rounded-lg border border-white/30 px-4 py-2">Sign in to reopen item</button></SignInButton><Link to="/items" className="block py-2 text-amber-200 underline">New item</Link></div>;
  return <ItemsEditor key={`${identity.generation}:${saved ?? "new"}`} savedId={saved} />;
}

function ItemsEditor({ savedId }: { savedId: string | null }) {
  const { getToken } = useAuth();
  const [form, setForm] = useState(newSavedItemForm);
  const [snapshot, setSnapshot] = useState<SavedItem | null>(null);
  const [initial, setInitial] = useState<SavedItem | null>(null);
  const [reopening, setReopening] = useState(savedId !== null);
  const [reopenError, setReopenError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [editVersion, setEditVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedResult, setSavedResult] = useState(false);
  const [result, setResult] = useState<ItemAnalyzeResponse | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [requestError, setRequestError] = useState("");
  const [loading, setLoading] = useState(false);
  const [slow, setSlow] = useState(false);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const resultsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (savedId === null) return;
    let active = true;
    void (async () => {
      try {
        if (!/^[1-9]\d*$/.test(savedId) || !Number.isSafeInteger(Number(savedId))) throw new Error("Item not found.");
        const token = await getToken();
        if (!active) return;
        if (!token) throw new Error("Sign in again to reopen this item.");
        const saved = await getItem(Number(savedId), token);
        if (!active) return;
        setForm(restoreItemForm(saved.inputs)); setSnapshot(saved); setInitial(saved);
        setResult(saved.analysis_result); setSavedResult(true); setReopenError("");
      } catch (error) {
        if (active) setReopenError(error instanceof Error ? error.message : "Could not reopen this item.");
      } finally { if (active) setReopening(false); }
    })();
    return () => { active = false; };
  }, [savedId, getToken, loadAttempt]);

  useEffect(() => () => { sequence.current++; inFlight.current = false; }, []);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);
  useEffect(() => { if (result) resultsRef.current?.focus(); }, [result]);

  function edit(update: (previous: SavedItemForm) => SavedItemForm) {
    // Editing invalidates an outstanding request immediately, not after a render.
    sequence.current++;
    inFlight.current = false;
    setLoading(false); setSlow(false); setResult(null); setErrors({}); setRequestError("");
    setForm(update);
    setEditVersion(value => value + 1); setSavedResult(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || saving) return;
    const current = ++sequence.current;
    setResult(null); setRequestError(""); setErrors({}); setSlow(false);
    const built = buildSavedItemInputs(form);
    if (!built.ok) { setErrors(built.errors); return; }
    inFlight.current = true;
    setLoading(true);
    try {
      const response = await analyzeItem(built.payload);
      if (current === sequence.current) { setResult(response); setSavedResult(false); }
    } catch (error) {
      if (current === sequence.current) setRequestError(error instanceof Error ? error.message : "Analysis failed. Your inputs are still here. Try again.");
    } finally {
      if (current === sequence.current) { inFlight.current = false; setLoading(false); setSlow(false); }
    }
  }

  function fieldInput(field: ItemFinancialInput) {
    const preference = ITEM_PREFERENCES.includes(field as ItemPreference) ? field as ItemPreference : null;
    const personal = preference !== null && hasPersonalDefault(form, preference);
    const application = field === "hourly_value" || field === "contingency_pct";
    const inherited = preference !== null && form.useDefault[preference];
    const showDefault = preference !== null && (application || personal);
    const defaultText = personal && preference ? `Personal default: ${form.personalDefaults[preference]}${field.endsWith("_pct") ? "%" : ""}`
      : field === "hourly_value" ? "Application default: $20/hour" : "Application default: 15%";
    return <div key={field} className="min-w-0">
      <label htmlFor={`item-${field}`} className="mb-2 block text-sm font-medium text-white/90">{ITEM_LABELS[field]}</label>
      <input id={`item-${field}`} name={field} type="text" inputMode="decimal" autoComplete="off"
        value={inherited ? "" : form.values[field]} disabled={inherited}
        placeholder={inherited ? "Using default" : "Unknown"}
        aria-describedby={`${field}-hint${errors[field] ? ` ${field}-error` : ""}`} aria-invalid={Boolean(errors[field])}
        onChange={event => edit(previous => ({ ...previous, values: { ...previous.values, [field]: event.target.value } }))}
        className={inputClass} />
      {showDefault && preference && <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-white/80">
        <input type="checkbox" checked={inherited} aria-label={`${personal ? "Use my personal default" : "Use default"} for ${ITEM_LABELS[field]}`}
          onChange={event => edit(previous => ({ ...previous, useDefault: { ...previous.useDefault, [preference]: event.target.checked } }))}
          className="h-4 w-4 accent-amber-300" />
        {personal ? "Use my personal default" : "Use default"}
      </label>}
      <p id={`${field}-hint`} className="mt-1 text-xs text-white/65">
        {inherited ? defaultText : "Blank means unknown. Enter 0 only if confirmed."}
      </p>
      {errors[field] && <p id={`${field}-error`} className="mt-1 text-sm text-red-300">{errors[field]}</p>}
    </div>;
  }

  if (reopening || reopenError) return <main className="space-y-4 py-8"><Link to="/my-flips" className="text-amber-200 underline">My Flips</Link>{reopening ? <p role="status">Reopening your saved item. The service may take a moment to start.</p> : <div role="alert"><p>{reopenError}</p><button type="button" onClick={() => { setReopening(true); setReopenError(""); setLoadAttempt(value => value + 1); }} className="min-h-11 py-2 text-amber-200 underline">Try reopening again</button></div>}</main>;

  return <div className="min-h-screen min-w-0 bg-[#0f1115] text-slate-100">
    <nav aria-label="Items navigation" className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-4">
      <Link to="/" className="text-sm font-bold text-white">Flip<span className="text-amber-400">Forge</span></Link>
      <Link to="/my-flips" className="rounded py-2 text-sm text-amber-200 underline">My Flips</Link>
      <Link to="/items" className="rounded py-2 text-sm text-amber-200 underline">Photo estimate</Link>
      <Link to="/" className="rounded py-2 text-sm text-white/80 underline underline-offset-4">Back to Houses</Link>
    </nav>
    <main className="mx-auto max-w-5xl min-w-0 space-y-6 py-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-200">Items / Manual furniture calculator</p>
        <h1 className="mt-3 font-serif-display text-white" style={{ fontSize: "clamp(1.8rem, 4vw, 2.5rem)", lineHeight: 1.15 }}>Is this flip worth your time?</h1>
        <p className="mt-3 max-w-2xl text-sm text-white/75">Enter your estimates to see your purchase budget, cash left and profit after your time. No sign-in needed to calculate. Items are saved only when you choose Save.</p>
        {snapshot && <p className="mt-3 text-sm text-amber-200">Version #{snapshot.id}. Saving again creates a new linked version; this saved version stays unchanged.</p>}
        {initial && safeItemLink(initial.listing_url) && <a href={safeItemLink(initial.listing_url)!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block py-2 text-sm underline">Saved listing</a>}
      </header>
      <form onSubmit={submit} noValidate className="space-y-5">
        <fieldset disabled={saving} className="min-w-0 space-y-5">
        <section className={panelClass} aria-label="Item details">
          <h2 className="text-lg font-semibold">The item</h2>
          <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            {(["item_name", "category"] as const).map(field => <div key={field} className="min-w-0">
              <label htmlFor={`item-${field}`} className="mb-2 block text-sm">{field === "item_name" ? "Item name (optional)" : "Category (optional)"}</label>
              <textarea id={`item-${field}`} rows={2} value={form[field]} maxLength={field === "item_name" ? 200 : 100}
                onChange={event => edit(previous => ({ ...previous, [field]: event.target.value, literalEmptyText: { ...previous.literalEmptyText, [field]: false } }))} className={inputClass} />
              {errors[field] && <p className="mt-1 text-sm text-red-300">{errors[field]}</p>}
            </div>)}
          </div>
        </section>
        {groups.map(group => <fieldset key={group.title} className={panelClass}>
          <legend className="px-1 text-lg font-semibold">{group.title}</legend>
          <p className="text-sm text-white/70">{group.note}</p>
          <div className="mt-4 grid min-w-0 gap-5 sm:grid-cols-2">{group.fields.map(fieldInput)}</div>
        </fieldset>)}
        <details className={panelClass}>
          <summary className="cursor-pointer rounded py-1 font-semibold focus-visible:outline-2 focus-visible:outline-amber-300">Personal defaults for this page</summary>
          <p className="mt-3 text-sm text-white/70">Optional. Enter a default here, then select “Use my personal default” above. Blank means no personal default supplied. Unsaved values disappear when you leave or reload this page. Saving keeps them with this item only.</p>
          <div className="mt-4 grid min-w-0 gap-5 sm:grid-cols-2">
            {ITEM_PREFERENCES.map(field => <div key={field} className="min-w-0">
              <label htmlFor={`personal-${field}`} className="mb-2 block text-sm">Personal default: {ITEM_LABELS[field]}</label>
              <input id={`personal-${field}`} type="text" inputMode="decimal" value={form.personalDefaults[field]} autoComplete="off"
                aria-invalid={Boolean(errors[`personal_${field}`])} aria-describedby={errors[`personal_${field}`] ? `personal-${field}-error` : undefined}
                onChange={event => edit(previous => {
                  const next = { ...previous, personalDefaults: { ...previous.personalDefaults, [field]: event.target.value } };
                  if ((field === "fee_pct" || field === "target_profit") && !hasPersonalDefault(next, field)) {
                    next.useDefault = { ...previous.useDefault, [field]: false };
                  }
                  return next;
                })} className={inputClass} />
              {errors[`personal_${field}`] && <p id={`personal-${field}-error`} className="mt-1 text-sm text-red-300">{errors[`personal_${field}`]}</p>}
            </div>)}
          </div>
        </details>
        {Object.keys(errors).length > 0 && <div role="alert" className="rounded-xl border border-red-300/30 p-4 text-sm text-red-200">Check the highlighted inputs. Use plain numbers without currency symbols or commas.</div>}
        {requestError && <div role="alert" className="whitespace-pre-line rounded-xl border border-red-300/30 p-4 text-sm text-red-200">{requestError}</div>}
        <button type="submit" disabled={loading} className="min-h-11 w-full rounded-xl bg-amber-300 px-5 py-3 font-semibold text-[#0f1115] hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-amber-200 disabled:opacity-60 sm:w-auto">
          {loading ? "Calculating…" : "Calculate my flip"}
        </button>
        {loading && <p role="status" className="text-sm text-white/75">{slow ? "This is taking longer than usual while the service starts. Your inputs are still here." : "Calculating your offers…"}</p>}
        </fieldset>
      </form>
      <ItemSavePanel form={form} initial={initial} parentId={snapshot?.id ?? null} editVersion={editVersion} onErrors={setErrors}
        onBusy={busy => { setSaving(busy); if (busy) { sequence.current++; inFlight.current = false; setLoading(false); } }}
        onSaved={saved => { setSnapshot(saved); setResult(saved.analysis_result); setSavedResult(true); }} />
      {result && <section ref={resultsRef} tabIndex={-1} aria-label="Items analysis result" data-item-status={result.status} className="min-w-0 space-y-4 rounded-xl focus-visible:outline-2 focus-visible:outline-amber-300">
        <header className={panelClass}>
          {savedResult && <p className="mb-2 text-sm text-amber-200">Saved result for version #{snapshot?.id}</p>}
          <h2 className="text-xl font-semibold">{ITEM_STATUS_TEXT[result.status].title}</h2>
          <p className="mt-2 text-sm text-white/80">{ITEM_STATUS_TEXT[result.status].explanation}</p>
          <p className="mt-2 text-xs text-white/65">Based only on your estimates. Not an inspection, price prediction or AI assessment.</p>
          {result.status === "needs_info" && <ul className="mt-4 list-inside list-disc space-y-2 text-sm">
            {result.missing_inputs.map(field => <li key={field}>{ITEM_LABELS[field]}{
              ITEM_PREFERENCES.includes(field as ItemPreference) && !form.useDefault[field as ItemPreference] && !form.values[field].trim()
                ? " - default is off and no value was entered." : " - no value supplied."}</li>)}
          </ul>}
        </header>
        {result.status !== "needs_info" && result.low && result.high && <div className="grid min-w-0 gap-4 md:grid-cols-2">
          <Scenario value={result.low} offersOnly={result.status === "offer_only"} />
          <Scenario value={result.high} high offersOnly={result.status === "offer_only"} />
        </div>}
        <details className={panelClass}>
          <summary className="cursor-pointer rounded py-1 font-semibold focus-visible:outline-2 focus-visible:outline-amber-300">Assumptions used</summary>
          <dl className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            {(["item_name", "category", ...ITEM_FIELDS] as const).map(field => {
              const assumption = result.assumptions[field];
              const value = assumption.value;
              const text = value === null ? "Unknown" : typeof value === "string" ? value
                : field.endsWith("_pct") ? formatItemPercent(value) : field === "hours" ? `${value} hours` : formatItemMoney(value);
              return <div key={field} className="min-w-0 break-words">
                <dt className="text-sm text-white/70">{field === "item_name" ? "Item name" : field === "category" ? "Category" : ITEM_LABELS[field]}</dt>
                <dd className="mt-1 text-sm">{text}<span className="ml-2 text-xs text-white/65">{
                  assumption.source === "user_entered" ? "You entered" : assumption.source === "default"
                    ? assumption.default_origin === "personal" ? "Personal default" : "Application default" : "Unknown"
                }</span></dd>
              </div>;
            })}
          </dl>
        </details>
        <p className="text-xs text-white/65">Cash left includes the repair contingency reserve. Figures are before income tax and any costs you have not entered. This is not a working-capital forecast.</p>
      </section>}
    </main>
  </div>;
}
