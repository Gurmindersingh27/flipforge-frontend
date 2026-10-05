import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { getItems } from "../lib/api";
import { formatItemMoney, ITEM_STATUS_TEXT } from "../lib/itemAnalysis";
import { safeItemLink } from "../lib/savedItems";
import type { SavedItem } from "../lib/types";

function SavedList() {
  const { getToken } = useAuth();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryOffset, setRetryOffset] = useState(0);
  const sequence = useRef(0);
  const locked = useRef(false);

  async function load(offset: number) {
    if (locked.current) return;
    locked.current = true; const current = ++sequence.current;
    setLoading(true); setError(""); setRetryOffset(offset);
    try {
      const token = await getToken();
      if (current !== sequence.current) return;
      if (!token) throw new Error("Sign in again to load your saved items.");
      const page = await getItems(token, offset);
      if (current !== sequence.current) return;
      setItems(previous => offset === 0 ? page.items : [...previous, ...page.items.filter(item => !previous.some(p => p.id === item.id))]);
      setNext(page.next_offset);
    } catch (failure) {
      if (current === sequence.current) setError(failure instanceof Error ? failure.message : "Could not load your saved items.");
    } finally {
      if (current === sequence.current) { locked.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    // Defer the initial load so Strict Mode cleanup invalidates its first pass.
    let active = true;
    const invalidate = () => { sequence.current++; locked.current = false; };
    void Promise.resolve().then(() => { if (active) void load(0); });
    return () => { active = false; invalidate(); };
    // The parent remounts this component for every account change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>
    {!loading && !error && items.length === 0 && <p>No saved items yet. <Link to="/items" className="text-amber-200 underline">Log your first find.</Link></p>}
    <div className="grid min-w-0 gap-4 md:grid-cols-2">
      {items.map(item => {
        const link = safeItemLink(item.listing_url);
        return <article key={item.id} data-saved-item={item.id} className="ff-panel min-w-0 space-y-3 rounded-2xl p-5">
          <h2 className="break-words text-lg font-semibold">{item.inputs.item_name?.trim() || `Untitled item #${item.id}`}</h2>
          <p className="text-sm text-white/65">Version #{item.id} · {new Date(item.created_at).toLocaleString("en-US")}</p>
          {item.parent_item_id !== null && <p className="text-sm text-white/75">New version of #{item.parent_item_id}</p>}
          <p>{ITEM_STATUS_TEXT[item.analysis_result.status].title}</p>
          {item.analysis_result.low && <p className="text-sm">Most you should pay, including any fees or tax <strong className="mt-1 block font-jetbrains text-xl text-amber-200">{formatItemMoney(item.analysis_result.low.max_offer, true)}</strong><span className="text-white/65">At your low resale estimate.</span></p>}
          {item.analysis_result.low && item.analysis_result.low.max_offer < 0 && <p className="text-sm text-white/70">Even a free item misses your target under the low resale estimate.</p>}
          {item.notes && <details><summary className="cursor-pointer py-2 text-sm">Notes</summary><p className="whitespace-pre-wrap break-words text-sm">{item.notes}</p></details>}
          <div className="flex flex-wrap gap-4">
            <Link to={`/items?saved=${item.id}`} className="min-h-11 py-2 text-amber-200 underline" aria-label={`Reopen saved item ${item.id}`}>Reopen</Link>
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="min-h-11 py-2 text-white/80 underline">Listing</a>}
          </div>
        </article>;
      })}
    </div>
    {loading && <p role="status">Loading saved items. The service may take a moment to start.</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => load(retryOffset)} className="min-h-11 py-2 text-amber-200 underline">Try loading again</button></div>}
    {!error && next !== null && <button type="button" disabled={loading} onClick={() => load(next)} className="min-h-11 rounded-lg border border-white/30 px-4 py-2 disabled:opacity-60">Load more</button>}
  </>;
}
export default function MyFlipsPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  return <main className="mx-auto min-h-screen max-w-5xl space-y-6 py-6 text-slate-100">
    <nav className="flex flex-wrap gap-5" aria-label="My Flips navigation"><Link to="/items" className="min-h-11 py-2 text-amber-200 underline">New item</Link><Link to="/" className="min-h-11 py-2 text-white/80 underline">Back to Houses</Link></nav>
    <h1 className="font-serif-display text-3xl">My Flips</h1>
    <p className="text-sm text-white/75">Your saved item versions, newest first. Saved items can’t be deleted yet.</p>
    {!isLoaded ? <p role="status">Loading sign-in…</p> : isSignedIn ? <SavedList key={userId} />
      : <SignInButton mode="modal"><button className="min-h-11 rounded-lg border border-white/30 px-4 py-2">Sign in to view My Flips</button></SignInButton>}
  </main>;
}
