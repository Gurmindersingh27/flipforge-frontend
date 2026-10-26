import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { getItem, getItems } from "../lib/api";
import { formatItemMoney, ITEM_STATUS_TEXT } from "../lib/itemAnalysis";
import { safeItemLink } from "../lib/savedItems";
import type { SavedItem } from "../lib/types";
import ItemVersionComparison from "./ItemVersionComparison";
import ItemOutcomePanel from "./ItemOutcomePanel";
import ItemListingDraft from "./ItemListingDraft";
import type { OutcomeGuard } from "./ItemOutcomePanel";
import "./MyFlipsPage.css";

function SavedList() {
  const { getToken } = useAuth();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retryOffset, setRetryOffset] = useState(0);
  const sequence = useRef(0);
  const locked = useRef(false);
  const [comparisons, setComparisons] = useState<Record<string, { open: boolean; loading: boolean; error: string; parent?: SavedItem }>>({});
  const comparisonGeneration = useRef(0);
  const comparisonPending = useRef(new Set<string>());
  const [trackingItem, setTrackingItem] = useState<number | null>(null);
  const [trackingGuard, setTrackingGuard] = useState<OutcomeGuard>(null);

  const [listingItem, setListingItem] = useState<number | null>(null);
  const [listingDirty, setListingDirty] = useState(false);
  function draftListing(itemId: number) {
    if (listingDirty && !window.confirm("Discard your unsaved listing draft? Copy it first if you want to keep it.")) return;
    setListingDirty(false);
    setListingItem(old => old === itemId ? null : itemId);
  }

  function track(itemId: number) {
    if (trackingGuard === "busy") return;
    if (trackingGuard === "draft" && !window.confirm("Close tracking and discard your unsaved entries? A save already sent may still have succeeded.")) return;
    setTrackingGuard(null);
    setTrackingItem(old => old === itemId ? null : itemId);
  }

  async function compare(item: SavedItem) {
    if (item.parent_item_id === null) return;
    const key = `${item.id}:${item.parent_item_id}`;
    if (comparisonPending.current.has(key)) return;
    if (comparisons[key]?.parent) {
      setComparisons(old => ({ ...old, [key]: { ...old[key], open: !old[key].open } }));
      return;
    }
    const generation = comparisonGeneration.current;
    comparisonPending.current.add(key);
    setComparisons(old => ({ ...old, [key]: { open: true, loading: true, error: "" } }));
    try {
      const token = await getToken();
      if (generation !== comparisonGeneration.current) return;
      if (!token) throw new Error("Sign in again to compare your saved estimates.");
      const parent = await getItem(item.parent_item_id, token);
      if (generation !== comparisonGeneration.current) return;
      if (parent.id !== item.parent_item_id || parent.root_item_id !== item.root_item_id) throw new Error("Previous version could not be confirmed.");
      setComparisons(old => ({ ...old, [key]: { open: true, loading: false, error: "", parent } }));
    } catch (failure) {
      if (generation === comparisonGeneration.current) setComparisons(old => ({ ...old, [key]: {
        open: true, loading: false, error: failure instanceof Error ? failure.message : "Could not load the previous version.",
      } }));
    } finally {
      if (generation === comparisonGeneration.current) comparisonPending.current.delete(key);
    }
  }

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
    const invalidate = () => { sequence.current++; locked.current = false; comparisonGeneration.current++; comparisonPending.current.clear(); };
    void Promise.resolve().then(() => { if (active) void load(0); });
    return () => { active = false; invalidate(); };
    // The parent remounts this component for every account change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>
    {!loading && !error && items.length === 0 && <div className="flips-message"><h2>No saved items yet.</h2><p>Keep your finds here so you can come back to the numbers.</p><Link to="/items" className="flips-primary">Log your first find.</Link></div>}
    <div className="flips-grid">
      {items.map(item => {
        const link = safeItemLink(item.listing_url);
        const comparison = comparisons[`${item.id}:${item.parent_item_id}`];
        return <article key={item.id} data-saved-item={item.id} className="flips-card">
          <h2>{item.inputs.item_name?.trim() || `Untitled item #${item.id}`}</h2>
          <p className="flips-meta">Version #{item.id} · <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-US")}</time></p>
          {item.parent_item_id !== null && <p className="flips-parent">New version of #{item.parent_item_id}</p>}
          <p className="flips-status" data-status={item.analysis_result.status}>{ITEM_STATUS_TEXT[item.analysis_result.status].title}</p>
          {item.analysis_result.low && <p className="flips-offer">Most you should pay, including any fees or tax <strong>{formatItemMoney(item.analysis_result.low.max_offer, true)}</strong><span>At your low resale estimate.</span></p>}
          {item.analysis_result.low && item.analysis_result.low.max_offer < 0 && <p className="flips-caution">Even a free item misses your target under the low resale estimate.</p>}
          {item.notes && <details className="flips-notes"><summary>Notes</summary><p>{item.notes}</p></details>}
          <div className="flips-actions">
            <Link to={`/items?${item.assessment ? "find" : "saved"}=${item.id}`} className="flips-primary" aria-label={`Reopen saved item ${item.id}`}>Reopen</Link>
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="flips-link">Listing</a>}
            {item.parent_item_id !== null && <button type="button" className="flips-link" disabled={comparison?.loading}
              aria-expanded={comparison?.open ?? false} aria-controls={`comparison-${item.id}`} onClick={() => void compare(item)}>
              {comparison?.parent && comparison.open ? "Hide comparison" : `Compare with #${item.parent_item_id}`}
            </button>}
            <button type="button" className="flips-link" disabled={trackingGuard === "busy"}
              aria-expanded={trackingItem === item.id} aria-controls={`tracking-${item.id}`} onClick={() => track(item.id)}>
              {trackingItem === item.id ? "Close tracking" : "Track this find"}
            </button>
            <button type="button" className="flips-link" aria-expanded={listingItem === item.id}
              aria-controls={`listing-${item.id}`} onClick={() => draftListing(item.id)}>
              {listingItem === item.id ? "Close listing draft" : "Prepare sale listing"}
            </button>
          </div>
          <div id={`listing-${item.id}`}>
            {listingItem === item.id && <ItemListingDraft key={item.id} onDirtyChange={setListingDirty} />}
          </div>
          <div id={`tracking-${item.id}`}>
            {trackingItem === item.id && <ItemOutcomePanel key={item.id} rootId={item.root_item_id} itemId={item.id} onGuard={setTrackingGuard} />}
          </div>
          {item.parent_item_id !== null && <div id={`comparison-${item.id}`}>
            {comparison?.open && <>
              {comparison.loading && <p role="status">Loading previous estimate…</p>}
              {comparison.error && <div role="alert"><p>{comparison.error}</p><button type="button" className="flips-link" onClick={() => void compare(item)}>Retry comparison</button></div>}
              {comparison.parent && <ItemVersionComparison previous={comparison.parent} current={item} />}
            </>}
          </div>}
        </article>;
      })}
    </div>
    {loading && <p className="flips-message" role="status">Loading saved items. The service may take a moment to start.</p>}
    {error && <div className="flips-message flips-error" role="alert"><p>{error}</p><button type="button" onClick={() => load(retryOffset)} className="flips-link">Try loading again</button></div>}
    {!error && next !== null && <button type="button" disabled={loading} onClick={() => load(next)} className="flips-more">Load more</button>}
  </>;
}
export default function MyFlipsPage() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  return <div className="my-flips">
    <nav className="flips-nav" aria-label="My Flips navigation"><Link to="/items" className="flips-brand">Flip<span>Forge</span><small>FIND THE POTENTIAL.</small></Link><div><Link to="/items" className="flips-link">New item</Link><Link to="/" className="flips-link">Back to Houses</Link></div></nav>
    <main className="flips-main">
      <header className="flips-intro"><p className="flips-eyebrow">PICK UP WHERE YOU LEFT OFF</p><h1>My Flips</h1><p>Your saved item versions, newest first. Saved items can’t be deleted yet.</p></header>
      {!isLoaded ? <p className="flips-message" role="status">Loading sign-in…</p> : isSignedIn ? <SavedList key={userId} />
        : <div className="flips-message"><h2>Your finds, in one place.</h2><p>Sign in to return to your saved estimates and notes.</p><SignInButton mode="modal"><button className="flips-primary">Sign in to view My Flips</button></SignInButton></div>}
    </main>
  </div>;
}
