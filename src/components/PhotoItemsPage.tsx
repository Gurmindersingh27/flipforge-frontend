import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SignInButton, useAuth, UserButton } from "@clerk/clerk-react";
import { analyzeItem, assessItem, getItem, getItemAIBudget, getItemAssessment, ItemAssessmentError } from "../lib/api";
import { formatItemMoney, ITEM_LABELS, parseItemNumber } from "../lib/itemAnalysis";
import { buildAssessmentRequest, itemDecision, newQuickItemForm, prepareItemPhoto, suggestedRepairTotal } from "../lib/itemAssessment";
import { buildSavedItemInputs, restoreItemForm, safeItemLink } from "../lib/savedItems";
import type { SavedItemForm } from "../lib/savedItems";
import type { ItemAIBudget, ItemAnalyzeResponse, ItemAssessmentConfirmation, ItemAssessmentPhoto, ItemAssessmentResponse, ItemAssessmentResult, ItemFinancialInput, SavedItem } from "../lib/types";
import ItemsPage from "./ItemsPage";
import ItemSavePanel from "./ItemSavePanel";
import "./PhotoItemsPage.css";

function Camera() {
  return <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 5l1-2h6l1 2h4a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z" /><circle cx="12" cy="12" r="4" /></svg>;
}
function Shell({ children }: { children: ReactNode }) {
  const { isSignedIn } = useAuth();
  return <div className="items-quick">
    <nav className="quick-nav" aria-label="Items navigation">
      <Link className="quick-brand" to="/items">Flip<span>Forge</span><small>FIND THE POTENTIAL.</small></Link>
      <div><Link to="/my-flips">My Flips</Link><Link to="/">Houses</Link>{isSignedIn && <UserButton />}</div>
    </nav>
    {children}
    <footer className="quick-footer"><span>A little work. A little upside.</span><Link to="/items?manual=1">Full manual calculator</Link></footer>
  </div>;
}
export default function PhotoItemsPage() {
  const [params] = useSearchParams();
  if (params.has("manual") || params.has("saved")) return <ItemsPage />;
  return <QuickAccount findId={params.get("find")} />;
}
function QuickAccount({ findId }: { findId: string | null }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const [identity, setIdentity] = useState({ user: isLoaded ? userId ?? null : null, generation: 0 });
  if (isLoaded && identity.user !== (userId ?? null)) {
    setIdentity({ user: userId ?? null, generation: identity.generation + (identity.user === null ? 0 : 1) });
  }
  if (findId !== null && !isLoaded) return <Shell><main className="quick-main"><p role="status">Loading sign-in…</p></main></Shell>;
  if (findId !== null && !isSignedIn) return <Shell><main className="quick-main"><h1>Pick up where you left off.</h1><p>Sign in to reopen this saved find.</p><SignInButton mode="modal"><button className="quick-primary">Sign in to reopen item</button></SignInButton></main></Shell>;
  return <Shell><QuickEditor key={`${identity.generation}:${findId ?? "new"}`} findId={findId} /></Shell>;
}

function QuickEditor({ findId }: { findId: string | null }) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<ItemAssessmentPhoto[]>([]);
  const [budget, setBudget] = useState<ItemAIBudget | null>(null);
  const [budgetNote, setBudgetNote] = useState("");
  const [pilotDenied, setPilotDenied] = useState(false);
  const [assessment, setAssessment] = useState<ItemAssessmentResponse | null>(null);
  const [evidence, setEvidence] = useState<ItemAssessmentResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [form, setForm] = useState(newQuickItemForm);
  const [manual, setManual] = useState(false);
  const [repairEdit, setRepairEdit] = useState(false);
  const [ownResale, setOwnResale] = useState(true);
  const [confirmation, setConfirmation] = useState<ItemAssessmentConfirmation | null>(null);
  const [initial, setInitial] = useState<SavedItem | null>(null);
  const [snapshot, setSnapshot] = useState<SavedItem | null>(null);
  const [result, setResult] = useState<ItemAnalyzeResponse | null>(null);
  const [editVersion, setEditVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(findId ? "reopen" : null);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const sequence = useRef(0);
  const locked = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const costsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => () => { sequence.current++; locked.current = false; }, []);
  useEffect(() => { if (result) resultRef.current?.focus(); }, [result]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let active = true;
    void (async () => {
      try {
        const token = await getToken();
        if (!active || !token) return;
        const status = await getItemAIBudget(token);
        if (!active) return;
        setBudget(status);
        if (!status.available) {
          setBudgetNote(status.message ?? (status.reason === "assessment_busy" ? "Another estimate is still running. Enter your own numbers while you wait." : "AI estimates aren't available yet. You can still work out an offer below."));
          setManual(true);
        }
      } catch (failure) {
        if (active) { setPilotDenied(failure instanceof ItemAssessmentError && failure.status === 403); setBudgetNote(failure instanceof Error ? failure.message : "AI isn't available. The manual estimate still works."); setManual(true); }
      }
    })();
    return () => { active = false; };
  }, [getToken, isLoaded, isSignedIn]);

  useEffect(() => {
    if (findId === null) return;
    let active = true;
    void (async () => {
      try {
        if (!/^[1-9]\d*$/.test(findId) || !Number.isSafeInteger(Number(findId))) throw new Error("Item not found.");
        const token = await getToken();
        if (!active) return;
        if (!token) throw new Error("Sign in again to reopen this item.");
        const saved = await getItem(Number(findId), token);
        if (!active) return;
        setForm(restoreItemForm(saved.inputs)); setInitial(saved); setSnapshot(saved);
        setResult(saved.analysis_result); setManual(true); setRepairEdit(true);
        setEvidence(saved.assessment?.evidence ?? null);
        setConfirmation(saved.assessment?.confirmation ?? null);
        setOwnResale(saved.assessment?.confirmation.resale_source !== "assessment");
        if (saved.assessment) setAssessment({ id: saved.assessment.assessment_id, schema_version: 1, status: "completed", result: saved.assessment.evidence, failure_code: null, actual_cost: null, message: null });
      } catch (failure) { if (active) setError(failure instanceof Error ? failure.message : "Could not reopen this find."); }
      finally { if (active) setBusy(null); }
    })();
    return () => { active = false; };
  }, [findId, getToken, loadAttempt]);

  function edit(update: (old: SavedItemForm) => SavedItemForm) {
    sequence.current++; setResult(null); setErrors({}); setError("");
    setForm(update); setEditVersion(value => value + 1);
  }
  function field(field: ItemFinancialInput, label: string, bothResale = false) {
    return <label className="quick-field" key={field} htmlFor={`quick-${field}`}>{label}
      <input id={`quick-${field}`} value={form.values[field]} type="text" inputMode="decimal" autoComplete="off"
        aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? `quick-${field}-error` : undefined}
        onChange={event => edit(old => ({ ...old, values: { ...old.values, [field]: event.target.value, ...(bothResale ? { resale_high: event.target.value } : {}) },
          useDefault: { ...old.useDefault, ...(field in old.useDefault ? { [field]: false } : {}) } }))} />
      {errors[field] && <span id={`quick-${field}-error`} className="quick-error">{errors[field]}</span>}
    </label>;
  }
  async function addPhotos(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = "";
    if (!files.length || locked.current) return;
    if (photos.length + files.length > 3) { setError("Use up to three photos. Remove one before adding another."); return; }
    const current = ++sequence.current; locked.current = true; setBusy("photo"); setError("");
    try {
      const prepared = await Promise.all(files.map(prepareItemPhoto));
      if (sequence.current === current) setPhotos(old => [...old, ...prepared]);
    } catch (failure) { if (sequence.current === current) setError((failure as Error).message); }
    finally { if (sequence.current === current) { locked.current = false; setBusy(null); } }
  }
  function acceptAssessment(response: ItemAssessmentResponse) {
    if (response.schema_version !== 1 || !["processing", "uncertain", "failed", "completed"].includes(response.status) || (response.status === "completed" && !response.result)) throw new Error("The estimate wasn't confirmed. Check its status before trying again.");
    setAssessment(response);
    if (response.status === "processing" || response.status === "uncertain") {
      setError(response.message ?? "Your estimate is still running. Check its status in a moment."); setManual(true); return;
    }
    setPendingId(null);
    if (!response.result) { setError(response.message ?? "AI couldn't finish. Enter your own estimate below."); setManual(true); return; }
    setEvidence(response.result); setForm(restoreItemForm(response.result.inputs)); setResult(null);
    setConfirmation(null); setOwnResale(response.result.resale === null);
    setRepairEdit(response.result.repair_unknowns.length > 0); setManual(true); setErrors({}); setError("");
    setEditVersion(value => value + 1);
  }
  async function estimate(checkOnly = false) {
    if (locked.current || !isSignedIn || (!checkOnly && pendingId)) return;
    let payload;
    try { if (!checkOnly) payload = buildAssessmentRequest(crypto.randomUUID(), description, form.values.purchase_price, photos); }
    catch (failure) { setError((failure as Error).message); return; }
    const current = ++sequence.current; locked.current = true; setBusy("ai"); setError("");
    let sent = false;
    try {
      const token = await getToken();
      if (current !== sequence.current) return;
      if (!token) throw new Error("Sign in again to estimate this find.");
      if (payload) { setPendingId(payload.request_id); sent = true; }
      const response = payload ? await assessItem(payload, token) : await getItemAssessment(pendingId!, token);
      if (current !== sequence.current) return;
      acceptAssessment(response);
      void getItemAIBudget(token).then(status => {
        if (current === sequence.current) { setBudget(status); setBudgetNote(status.message ?? ""); }
      }).catch(() => {});
    } catch (failure) {
      if (current !== sequence.current) return;
      const rejected = failure instanceof ItemAssessmentError && (failure.status < 500 || failure.status === 503);
      if (!checkOnly && rejected) setPendingId(null);
      setError(failure instanceof Error ? failure.message : "AI couldn't finish. Enter your own estimate below.");
      if (sent || checkOnly || rejected) setManual(true);
    } finally { if (current === sequence.current) { locked.current = false; setBusy(null); } }
  }
  async function calculate() {
    if (locked.current) return;
    let next = form;
    let repairs: ItemAssessmentConfirmation["repairs"] = [];
    if (evidence && !repairEdit) {
      next = { ...form, values: { ...form.values, repairs: suggestedRepairTotal(evidence) } };
      repairs = evidence.repair_suggestions.map(({ job_id, materials_cost }) => ({ job_id, materials_cost }));
    } else if (evidence) {
      try {
        const amount = parseItemNumber(form.values.repairs, "repairs");
        if (amount === null) throw new Error("Enter a repair budget, or 0 if no work is needed.");
        repairs = [{ job_id: "custom", materials_cost: amount }];
      } catch (failure) { setErrors({ repairs: (failure as Error).message }); return; }
    }
    const built = buildSavedItemInputs(next);
    if (!built.ok) { setErrors(built.errors); return; }
    const current = ++sequence.current; locked.current = true; setBusy("calculate"); setError(""); setErrors({}); setResult(null);
    try {
      const response = await analyzeItem(built.payload);
      if (sequence.current !== current) return;
      setForm(next); setResult(response);
      setConfirmation(evidence ? { repairs, resale_source: ownResale ? "user_estimate" : "assessment", preset_acknowledged: true } : null);
    } catch (failure) { if (sequence.current === current) setError((failure as Error).message); }
    finally { if (sequence.current === current) { locked.current = false; setBusy(null); } }
  }

  if (findId && !initial) return <main className="quick-main"><h1>Your saved find</h1>{busy ? <p role="status">Reopening your item…</p> : <div role="alert"><p>{error}</p><button className="quick-secondary" onClick={() => { setBusy("reopen"); setError(""); setLoadAttempt(n => n + 1); }}>Try reopening again</button></div>}<Link to="/my-flips">Back to My Flips</Link></main>;
  const blocked = Boolean(busy);
  const aiAvailable = !pilotDenied && (!budget || budget.available);
  return <main className="quick-main">
    <header className="quick-intro"><p className="quick-eyebrow">A GOOD FIND STARTS HERE</p><h1>{snapshot ? "Back to your find." : <>See potential?<br /><em>Let's work it out.</em></>}</h1><p>Snap a photo. Tell us what you know.<br />Get a starting offer and a plan for the work.</p></header>
    <div className="quick-layout">
      <div className="quick-flow">
        {!snapshot && !evidence && <section className="quick-card" aria-label="Photo estimate">
          <fieldset disabled={blocked || pendingId !== null}>
            <div className="quick-section-title"><span className="quick-step">01</span><h2>What did you find?</h2><span className="quick-muted">Up to 3 photos</span></div>
            <div className="quick-photos">
              {photos.map((photo, index) => <div className="quick-photo" key={index}><img src={`data:${photo.media_type};base64,${photo.data}`} alt={`Your item, photo ${index + 1}`} /><button className="quick-remove" type="button" aria-label={`Remove photo ${index + 1}`} onClick={() => setPhotos(old => old.filter((_, i) => i !== index))}>×</button></div>)}
              {photos.length < 3 && <label className={`quick-upload ${photos.length ? "has-photos" : ""}`}><Camera /><strong>{photos.length ? "Add another" : "Add a photo"}</strong><span>Take one or choose from your phone</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple aria-label="Add item photos" onChange={addPhotos} /></label>}
            </div>
            <label className="quick-field" htmlFor="quick-description">Tell me about it<textarea id="quick-description" rows={3} maxLength={500} value={description} onChange={event => setDescription(event.target.value)} placeholder="Wood chair at a garage sale. Scratched seat. They want $20." /></label>
            <div className="quick-input-note"><span>Tap the mic on your keyboard to talk.</span><span>{description.length}/500</span></div>
            <label className="quick-field quick-asking" htmlFor="quick-asking">Asking price <span className="quick-muted">if you didn't mention it</span><div className="quick-money-input"><span>$</span><input id="quick-asking" type="text" inputMode="decimal" value={form.values.purchase_price} onChange={event => edit(old => ({ ...old, values: { ...old.values, purchase_price: event.target.value } }))} placeholder="Optional" /></div><small>Include any buyer fees or tax.</small></label>
          </fieldset>
          {isLoaded && !isSignedIn ? <SignInButton mode="modal"><button className="quick-primary">Sign in for a photo estimate <span aria-hidden="true">↗</span></button></SignInButton>
            : <button data-quick-assess className="quick-primary" disabled={!isLoaded || blocked || pendingId !== null || !aiAvailable} onClick={() => void estimate()}>{busy === "ai" ? "Looking at your find…" : "What do you think?"}<span aria-hidden="true">↗</span></button>}
          <p className="quick-small">Photos go to Anthropic for this estimate. FlipForge doesn't save them.</p>
        </section>}
        {pendingId && <div className="quick-notice" role="status"><strong>Your photo estimate hasn't finished.</strong><p>Check the same estimate without paying for another. You can enter your own numbers below while you wait.</p><button className="quick-secondary" disabled={blocked} onClick={() => void estimate(true)}>Check estimate status</button></div>}
        {budgetNote && !evidence && <div className="quick-notice" role="status">{budgetNote}</div>}
        {budget?.warning && <p className="quick-notice" role="status">The pilot is near its $20 monthly AI budget. Manual estimates keep working.</p>}
        {error && <p className="quick-error quick-notice" role="alert">{error}</p>}
        {busy === "photo" && <p role="status">Preparing your photos…</p>}
        {busy === "ai" && <p role="status">Finding similar listings. This can take a minute while the service starts.</p>}
        {!manual && !evidence && <button type="button" className="quick-text-button" onClick={() => setManual(true)}>I'll enter my own estimate</button>}

        {(manual || evidence) && <section className="quick-card" aria-label="Confirm estimate">
          <fieldset disabled={blocked}>
            <div className="quick-section-title"><span className="quick-step">{evidence ? "02" : "01"}</span><h2>{evidence ? evidence.item_name : "Let's work out an offer."}</h2></div>
            {snapshot && <p className="quick-muted">Saved version #{snapshot.id}. Photos aren't kept. Saving changes creates a new version.</p>}
            {evidence && <><p className="quick-muted">Photo-based draft. Check the material and condition in person.</p>{photos.length > 0 && <img className="quick-find-photo" src={`data:${photos[0].media_type};base64,${photos[0].data}`} alt="Your find" />}</>}
            {!evidence && <label className="quick-field" htmlFor="quick-item-name">What is it?<input id="quick-item-name" value={form.item_name} maxLength={200} placeholder="e.g. Wood chair" onChange={event => edit(old => ({ ...old, item_name: event.target.value }))} /></label>}
            {evidence?.resale && !ownResale && <div className="quick-resale"><p>Similar items are listed for</p><strong>{formatItemMoney(evidence.resale.low)} - {formatItemMoney(evidence.resale.high)}</strong><p className="quick-small">Based on online asking prices, not confirmed sales. Pickup offered; distance isn't verified.</p><button type="button" className="quick-text-button" onClick={() => { setOwnResale(true); edit(old => ({ ...old, values: { ...old.values, resale_low: "", resale_high: "" } })); }}>Use my own sale estimate</button></div>}
            {ownResale && field("resale_low", "What do you think it'll sell for?", true)}
            {ownResale && <p className="quick-small">Labeled as your estimate. You can change it later.</p>}
            {field("purchase_price", "What are they asking, including fees or tax?")}
            <div className="quick-repairs"><h3>The work to do</h3>
              {evidence && !repairEdit ? <>
                {evidence.repair_suggestions.length ? <ul>{evidence.repair_suggestions.map(repair => <li key={repair.job_id}><div><strong>{repair.label}</strong><p>{repair.reason}</p></div><span>{formatItemMoney(repair.materials_cost)}</span></li>)}</ul> : <p>No repair jobs suggested. Check for wobble, cracks and hidden damage before confirming no work.</p>}
                <p className="quick-small">Suggested materials only, not a contractor quote.</p>
                <button type="button" className="quick-text-button" onClick={() => { setRepairEdit(true); edit(old => ({ ...old, values: { ...old.values, repairs: suggestedRepairTotal(evidence) } })); }}>Change repair budget</button>
              </> : <>{evidence?.repair_unknowns.map(note => <p className="quick-notice" key={note}>{note}</p>)}{field("repairs", "What will repairs cost?")}<p className="quick-small">Include materials and hired help. Enter 0 only if no work is needed.</p></>}
            </div>
            <details ref={costsRef} className="quick-details"><summary>Change costs & profit goal</summary>
              <div className="quick-fields">{field("target_profit", "Profit you'd like to make ($)")}{field("pickup", "Pickup cost ($)")}{field("delivery", "Delivery cost ($)")}{field("storage", "Storage cost ($)")}{field("hours", "Your time (hours)")}{field("hourly_value", "Value of your time ($/hour)")}{field("fee_pct", "Selling fees (%)")}{field("fee_fixed", "Fixed selling fee ($)")}{field("contingency_pct", "Repair buffer (%)")}</div>
              <p className="quick-small">Blank means unknown. Fees apply to the sale price; the buffer applies only to repairs.</p>
            </details>
            <div className="quick-assumptions"><strong>Before we work it out</strong><p>Starting setup: local pickup, $0 transport/storage, no selling fees, no charge for your time, a 15% repair buffer and a $30 profit goal. Use “Change costs & profit goal” above if yours differ.</p><p>Your entered changes replace that starting setup. Confirm the repairs and these costs below.</p></div>
            {Object.keys(errors).length > 0 && <div className="quick-error" role="alert">{Object.entries(errors).map(([key, message]) => <p key={key}>{ITEM_LABELS[key as ItemFinancialInput] ?? key}: {message}</p>)}</div>}
            <button data-quick-calculate className="quick-primary" type="button" onClick={() => void calculate()}>{busy === "calculate" ? "Working it out…" : evidence && !confirmation ? "Looks right - show my offer" : "Calculate my offer"}<span aria-hidden="true">→</span></button>
          </fieldset>
        </section>}
      </div>

      <aside className="quick-answer-column">
        {result ? <section ref={resultRef} tabIndex={-1} className={`quick-answer tone-${result.status}`} aria-label="Your offer" data-quick-status={result.status}>
          <p className="quick-eyebrow">YOUR STARTING POINT</p><h2>{itemDecision(result)}</h2>
          <button className="quick-text-button" type="button" onClick={() => { if (costsRef.current) costsRef.current.open = true; document.getElementById("quick-target_profit")?.focus(); }}>Profit goal: {formatItemMoney(result.assumptions.target_profit.value)} · Change</button>
          {result.status === "needs_info" ? <><p>Fill in these missing details before we can give you an offer.</p><ul>{result.missing_inputs.map(key => <li key={key}>{ITEM_LABELS[key]}</li>)}</ul></> : result.low && result.high && <>
            <p>{result.status === "skip" ? "It misses your profit goal even if it sells well. That doesn't necessarily mean a cash loss." : result.status === "stretch" ? "At their price, you'd need a stronger sale to meet your goal." : "Based on these costs and the low end of the sale estimate. Check the item before buying."}</p>
            <div className="quick-offer"><span>Most you should pay, including any fees or tax</span><strong data-quick-offer>{formatItemMoney(result.low.max_offer, true)}</strong></div>
            {result.low.max_offer < 0 && <p>Even free misses your profit goal at the low sale estimate. This isn't a negative price to offer the seller.</p>}
            {result.status !== "offer_only" && <><div className="quick-profits"><div><span>Cash left</span><strong data-quick-cash>{formatItemMoney(result.low.cash_left)}</strong><small>After costs & repair buffer</small></div><div><span>Profit after your time</span><strong data-quick-profit>{formatItemMoney(result.low.profit_after_time)}</strong><small>If it sells for {formatItemMoney(result.low.resale)}</small></div></div><p className="quick-high">If it sells well at {formatItemMoney(result.high.resale)}, profit after your time would be {formatItemMoney(result.high.profit_after_time)}.</p></>}
            {result.status === "offer_only" && <p>Add an asking price to see how much you'd keep. If it sells well, the offer ceiling is {formatItemMoney(result.high.max_offer, true)}.</p>}
            <p className="quick-small">{ownResale ? "Sale price: your estimate." : "Sale prices: online listings, not confirmed sales."} Before income tax and costs not entered. This is a budget, not an inspection.</p>
          </>}
        </section> : <section className="quick-explainer"><span className="quick-spark" aria-hidden="true">✳</span><h2>Less guessing.<br />More good finds.</h2><p>We'll help you work out three things:</p><ol><li><span>01</span> What it might sell for</li><li><span>02</span> What needs fixing</li><li><span>03</span> What you should pay</li></ol><p className="quick-small">You have the final say. Check the condition, confirm the repairs and adjust anything that doesn't fit.</p></section>}
        {evidence && <details className="quick-card quick-sources"><summary>See the price sources ({evidence.listings.length})</summary><p className="quick-small">Asking prices only. Shipping listings are reference material and don't set your range.</p>{evidence.listings.map((listing, i) => {
          const link = safeItemLink(listing.url);
          return <article key={`${listing.url}-${i}`}><p className="quick-source-label">{listing.source} · {listing.market === "national_shipping" ? "National / shipping" : listing.market === "local_pickup" ? "Pickup offered" : "Location unknown"}</p>{link ? <a href={link} target="_blank" rel="noopener noreferrer">{listing.title} ↗</a> : <strong>{listing.title}</strong>}<p>{formatItemMoney(listing.price)} · {listing.condition}</p><small>Retrieved {new Date(listing.retrieved_at).toLocaleDateString("en-US")}{!listing.eligible ? " · Reference only" : ""}</small></article>;
        })}</details>}
        {(manual || evidence) && <ItemSavePanel key={initial?.id ?? "new"} light disabled={!result || blocked} form={form} initial={initial} parentId={snapshot?.id ?? null} editVersion={editVersion}
          assessment={assessment?.status === "completed" && confirmation ? { assessment_id: assessment.id, assessment_confirmation: confirmation } : undefined}
          onErrors={setErrors} onBusy={saving => { locked.current = saving; setBusy(saving ? "save" : null); }}
          onSaved={saved => { setSnapshot(saved); setResult(saved.analysis_result); }} />}
        {(evidence || snapshot) && <a className="quick-text-button" href="/items">Start another find</a>}
      </aside>
    </div>
  </main>;
}
