import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { saveItem, UnconfirmedItemSaveError } from "../lib/api";
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
export default function ItemSavePanel({ form, initial, parentId, editVersion, onErrors, onBusy, onSaved, assessment, light, disabled }: Props) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [link, setLink] = useState(initial?.listing_url ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const locked = useRef(false);
  useEffect(() => () => { sequence.current++; }, []);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setMessage("Saving is taking longer than usual while the service starts. Please wait."), 8000);
    return () => clearTimeout(timer);
  }, [busy]);

  async function save() {
    if (locked.current || !isSignedIn || uncertain || disabled) return;
    const built = buildItemSave(form, notes, link, parentId);
    setErrors(built.ok ? {} : built.errors); onErrors(built.ok ? {} : built.errors);
    if (!built.ok) return;
    locked.current = true; const current = ++sequence.current;
    setBusy(true); onBusy(true); setMessage(""); setSavedVersion(null);
    try {
      const token = await getToken();
      if (current !== sequence.current) return;
      if (!token) throw new Error("Sign in again to save this item.");
      const saved = await saveItem({ ...built.payload, ...assessment }, token);
      if (current !== sequence.current) return;
      setSavedVersion(editVersion); setMessage(`Saved version #${saved.id}.`); onSaved(saved);
    } catch (error) {
      if (current !== sequence.current) return;
      setUncertain(error instanceof UnconfirmedItemSaveError);
      setMessage(error instanceof Error ? error.message : "Save failed. Your inputs are still here.");
    } finally {
      if (current === sequence.current) { locked.current = false; setBusy(false); onBusy(false); }
    }
  }
  const inputClass = "mt-2 w-full min-w-0 rounded-lg border border-white/20 bg-[#0f1115] p-3 text-base";
  return <section aria-label="Save item" className={`${light ? "quick-save" : "ff-panel"} min-w-0 space-y-4 rounded-2xl p-4 sm:p-6`}>
    <h2 className="text-lg font-semibold">Keep this find</h2>
    <p className="text-sm text-white/75">Incomplete finds can be saved. Saved items can’t be deleted yet. Keep seller phone numbers and home addresses out of notes.</p>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <div><label htmlFor="item-listing-url">Listing link (optional)</label>
        <input id="item-listing-url" type="url" value={link} maxLength={2048} className={inputClass} aria-invalid={Boolean(errors.listing_url)}
          onChange={event => { setLink(event.target.value); setSavedVersion(null); setErrors({}); if (!uncertain) setMessage(""); }} />
        {errors.listing_url && <p role="alert" className="text-sm text-red-300">{errors.listing_url}</p>}</div>
      <div><label htmlFor="item-notes">Item notes (optional)</label>
        <textarea id="item-notes" value={notes} maxLength={5000} rows={3} className={inputClass} aria-invalid={Boolean(errors.notes)}
          onChange={event => { setNotes(event.target.value); setSavedVersion(null); setErrors({}); if (!uncertain) setMessage(""); }} />
        {errors.notes && <p role="alert" className="text-sm text-red-300">{errors.notes}</p>}</div>
    </fieldset>
    {isLoaded && (isSignedIn ? <button type="button" disabled={disabled || busy || uncertain || savedVersion === editVersion}
      onClick={save} className="min-h-11 rounded-xl bg-amber-300 px-5 py-3 font-semibold text-slate-950 disabled:opacity-60">
      {busy ? "Saving…" : savedVersion === editVersion ? "Saved" : parentId ? "Save new version" : "Save item"}
    </button> : <SignInButton mode="modal"><button type="button" className="min-h-11 rounded-lg border border-white/30 px-4 py-2">Sign in to save item</button></SignInButton>)}
    {message && (savedVersion === null || savedVersion === editVersion) && <p role={uncertain || (!busy && savedVersion === null) ? "alert" : "status"} className="whitespace-pre-line text-sm">{message}</p>}
    {uncertain && <p className="text-sm">Open My Flips and reopen the saved version if it appears. This page will not repeat an unconfirmed save.</p>}
    <Link to="/my-flips" className="inline-block min-h-11 py-2 text-amber-200 underline">My Flips</Link>
  </section>;
}
