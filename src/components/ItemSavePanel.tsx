import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { ItemApiError, saveItem, UnconfirmedItemSaveError } from "../lib/api";
import { buildItemSave } from "../lib/savedItems";
import type { SavedItemForm } from "../lib/savedItems";
import type { SavedItem, SaveItemRequest } from "../lib/types";

interface Props {
  form: SavedItemForm;
  initial: SavedItem | null;
  parentId: number | null;
  editVersion: number;
  onErrors: (errors: Record<string, string>) => void;
  onBusy: (busy: boolean) => void;
  onSaved: (saved: SavedItem) => void;
  assessment?: Pick<SaveItemRequest, "assessment_id" | "assessment_confirmation">;
  light?: boolean;
  disabled?: boolean;
}
interface SaveAttempt {
  payload: SaveItemRequest;
  owner: string;
  editVersion: number;
}
export default function ItemSavePanel({ form, initial, parentId, editVersion, onErrors, onBusy, onSaved, assessment, light, disabled }: Props) {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [link, setLink] = useState(initial?.listing_url ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [discarded, setDiscarded] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const locked = useRef(false);
  const pending = useRef<SaveAttempt | null>(null);
  // Both Items editors remount on observed sign-out/account changes. Drop the
  // captured request as well as invalidating any token/response still in flight.
  useEffect(() => () => { sequence.current++; pending.current = null; }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setMessage("Saving is taking longer than usual while the service starts. Please wait."), 8000);
    return () => clearTimeout(timer);
  }, [busy]);

  async function save() {
    if (locked.current || !isLoaded || !isSignedIn || !userId || uncertain || disabled) return;
    const built = buildItemSave(form, notes, link, parentId);
    setErrors(built.ok ? {} : built.errors); onErrors(built.ok ? {} : built.errors);
    if (!built.ok) return;
    const attempt = { payload: structuredClone({ ...built.payload, ...assessment, request_id: crypto.randomUUID() }),
      owner: userId, editVersion };
    pending.current = attempt;
    await submit(attempt);
  }
  async function submit(attempt: SaveAttempt) {
    if (locked.current || !isLoaded || !isSignedIn || attempt.owner !== userId || pending.current !== attempt) return;
    locked.current = true; const current = ++sequence.current;
    setBusy(true); onBusy(true); setMessage(""); setSavedVersion(null);
    let keepPending = uncertain;
    try {
      const token = await getToken();
      if (current !== sequence.current) return;
      if (!token) throw new Error("Sign in again to save this item.");
      const saved = await saveItem(attempt.payload, token);
      if (current !== sequence.current) return;
      keepPending = false; pending.current = null; setUncertain(false);
      setSavedVersion(attempt.editVersion); setMessage(`Saved version #${saved.id}.`); onSaved(saved);
    } catch (error) {
      if (current !== sequence.current) return;
      // Only app rejections after the backend replay lookup resolve an earlier
      // uncertain POST. Auth, rate limits, outages and token failures do not.
      const resolvesPending = error instanceof ItemApiError && [404, 409, 422].includes(error.status);
      keepPending = error instanceof UnconfirmedItemSaveError || (uncertain && !resolvesPending);
      if (!keepPending) pending.current = null;
      setUncertain(keepPending);
      const failure = error instanceof Error ? error.message : "Save failed. Your inputs are still here.";
      setMessage(keepPending && !(error instanceof UnconfirmedItemSaveError)
        ? `${failure}\nThis item may already be saved. Retry this save or check My Flips before discarding.` : failure);
    } finally {
      // Keep the parent editor locked while unresolved, but permit an explicit
      // retry of the captured payload even though normal saving is disabled.
      if (current === sequence.current) { locked.current = false; setBusy(false); onBusy(keepPending); }
    }
  }
  function discard() {
    if (locked.current || !uncertain) return;
    sequence.current++; pending.current = null; setUncertain(false); setSavedVersion(null);
    setMessage(""); setDiscarded(true); onBusy(false);
  }
  const inputClass = "mt-2 w-full min-w-0 rounded-lg border border-white/20 bg-[#0f1115] p-3 text-base";
  return <section aria-label="Save item" className={`${light ? "quick-save" : "ff-panel"} min-w-0 space-y-4 rounded-2xl p-4 sm:p-6`}>
    <h2 className="text-lg font-semibold">Keep this find</h2>
    <p className="text-sm text-white/75">Incomplete finds can be saved. Saved items can’t be deleted yet. Keep seller phone numbers and home addresses out of notes.</p>
    <fieldset disabled={busy || uncertain} className="min-w-0 space-y-4">
      <div><label htmlFor="item-listing-url">Listing link (optional)</label>
        <input id="item-listing-url" type="url" value={link} maxLength={2048} className={inputClass} aria-invalid={Boolean(errors.listing_url)}
          onChange={event => { setLink(event.target.value); setSavedVersion(null); setErrors({}); if (!uncertain) setMessage(""); }} />
        {errors.listing_url && <p role="alert" className="text-sm text-red-300">{errors.listing_url}</p>}</div>
      <div><label htmlFor="item-notes">Item notes (optional)</label>
        <textarea id="item-notes" value={notes} maxLength={5000} rows={3} className={inputClass} aria-invalid={Boolean(errors.notes)}
          onChange={event => { setNotes(event.target.value); setSavedVersion(null); setErrors({}); if (!uncertain) setMessage(""); }} />
        {errors.notes && <p role="alert" className="text-sm text-red-300">{errors.notes}</p>}</div>
    </fieldset>
    {isLoaded && (isSignedIn ? uncertain ? <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => { if (pending.current) void submit(pending.current); }}
        className="min-h-11 rounded-xl bg-amber-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-60">{busy ? "Retrying…" : "Retry this save"}</button>
      <button type="button" disabled={busy} onClick={discard}
        className="min-h-11 rounded-lg border border-current px-4 py-2 disabled:opacity-60">Discard and edit</button>
    </div> : <button type="button" disabled={disabled || busy || savedVersion === editVersion}
      onClick={save} className="min-h-11 rounded-xl bg-amber-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-60">
      {busy ? "Saving…" : savedVersion === editVersion ? "Saved" : parentId ? "Save new version" : "Save item"}
    </button> : <SignInButton mode="modal"><button type="button" className="min-h-11 rounded-lg border border-white/30 px-4 py-2">Sign in to save item</button></SignInButton>)}
    {message && (savedVersion === null || savedVersion === editVersion) && <p role={uncertain || (!busy && savedVersion === null) ? "alert" : "status"} className="whitespace-pre-line text-sm">{message}</p>}
    {uncertain && <p className="text-sm">Retry the same save without creating a duplicate version. Discarding unlocks editing but does not delete a save that already succeeded.</p>}
    {discarded && <p role="alert" className="text-sm">The discarded attempt may already be saved. Check My Flips before saving again.</p>}
    <Link to="/my-flips" className="inline-block min-h-11 py-2 text-amber-200 underline">My Flips</Link>
  </section>;
}
