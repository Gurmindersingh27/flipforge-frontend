import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { getItems } from "../lib/api";
import { formatItemMoney, ITEM_STATUS_TEXT } from "../lib/itemAnalysis";
import { safeItemLink } from "../lib/savedItems";
import type { SavedItem } from "../lib/types";
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
    {!loading && !error && items.length === 0 && <div className="flips-message"><h2>No saved items yet.</h2><p>Keep your finds here so you can come back to the numbers.</p><Link to="/items" className="flips-primary">Log your first find.</Link></div>}
    <div className="flips-grid">
      {items.map(item => {
        const link = safeItemLink(item.listing_url);
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
          </div>
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
