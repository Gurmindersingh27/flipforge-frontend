import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { useItemSession } from "../lib/useItemSession";
import { ItemSessionChangedError } from "../lib/itemSession";
import { listItemProjects } from "../lib/api";
import { formatItemMoney, ITEM_STATUS_TEXT } from "../lib/itemAnalysis";
import { PROJECT_STAGE_LABELS } from "../lib/itemProjects";
import { safeItemLink } from "../lib/savedItems";
import type { ItemProjectSummary } from "../lib/types";
import "./MyFlipsPage.css";

function SavedList() {
  const withSession = useItemSession();
  const [projects, setProjects] = useState<ItemProjectSummary[]>([]);
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
      const page = await withSession((token, signal) => listItemProjects(token, 20, offset, signal), () => current === sequence.current);
      if (current !== sequence.current) return;
      setProjects(previous => offset === 0 ? page.items : [...previous, ...page.items.filter(item => !previous.some(p => p.root_item_id === item.root_item_id))]);
      setNext(page.next_offset);
    } catch (failure) {
      if (failure instanceof ItemSessionChangedError) return;
      if (current === sequence.current) setError(failure instanceof Error ? failure.message : "Could not load your projects.");
    } finally {
      if (current === sequence.current) { locked.current = false; setLoading(false); }
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(0); });
    const invalidate = () => { sequence.current++; locked.current = false; };
    return () => { active = false; invalidate(); };
    // The parent remounts this list on every account/session change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <>
    {!loading && !error && projects.length === 0 && <div className="flips-message"><h2>No saved items yet.</h2><p>Keep your finds here and follow each one through to the sale.</p><Link to="/items" className="flips-primary">Log your first find.</Link></div>}
    <div className="flips-grid">
      {projects.map(project => {
        const item = project.latest_version;
        const link = safeItemLink(item.listing_url);
        const profit = project.calculated?.cash_profit;
        return <article key={project.root_item_id} data-project-id={project.root_item_id} data-saved-item={item.id} className="flips-card">
          <p className="project-stage-chip" data-stage={project.stage}>{PROJECT_STAGE_LABELS[project.stage]}</p>
          <h2>{item.inputs.item_name?.trim() || `Untitled item #${project.root_item_id}`}</h2>
          <p className="flips-meta">{project.version_count} saved {project.version_count === 1 ? "estimate" : "estimates"} · Updated <time dateTime={project.updated_at}>{new Date(project.updated_at).toLocaleString("en-US")}</time></p>
          {project.stage === "sold" && <p className="flips-actual-profit">Cash profit<strong>{profit == null ? "Profit not complete yet" : formatItemMoney(profit)}</strong></p>}
          <p className="flips-status" data-status={item.analysis_result.status}>Latest estimate: {ITEM_STATUS_TEXT[item.analysis_result.status].title}</p>
          {item.analysis_result.low && project.stage !== "sold" && <p className="flips-offer">Most you should pay, including any fees or tax <strong>{formatItemMoney(item.analysis_result.low.max_offer, true)}</strong><span>At your low resale estimate.</span></p>}
          {item.analysis_result.low && item.analysis_result.low.max_offer < 0 && project.stage !== "sold" && <p className="flips-caution">Even a free item misses your target under the low resale estimate.</p>}
          {item.notes && <details className="flips-notes"><summary>Notes</summary><p>{item.notes}</p></details>}
          <div className="flips-actions">
            <Link to={`/my-flips/${project.root_item_id}`} className="flips-primary" aria-label={`Open project ${project.root_item_id}`}>Open project</Link>
            <Link to={`/items?${item.assessment ? "find" : "saved"}=${item.id}`} className="flips-link" aria-label={`Reopen saved item ${item.id}`}>Reopen estimate</Link>
            {link && <a href={link} target="_blank" rel="noopener noreferrer" className="flips-link">Listing</a>}
          </div>
        </article>;
      })}
    </div>
    {loading && <p className="flips-message" role="status">Loading saved items. The service may take a moment to start.</p>}
    {error && <div className="flips-message flips-error" role="alert"><p>{error}</p><button type="button" onClick={() => void load(retryOffset)} className="flips-link">Try loading again</button></div>}
    {!error && next !== null && <button type="button" disabled={loading} onClick={() => void load(next)} className="flips-more">Load more</button>}
  </>;
}
export default function MyFlipsPage() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  return <div className="my-flips">
    <nav className="flips-nav" aria-label="My Flips navigation"><Link to="/items" className="flips-brand">Flip<span>Forge</span><small>FIND THE POTENTIAL.</small></Link><div><Link to="/items" className="flips-link">New item</Link><Link to="/" className="flips-link">Back to Houses</Link></div></nav>
    <main className="flips-main">
      <header className="flips-intro"><p className="flips-eyebrow">FROM FIND TO FINISHED FLIP</p><h1>My Flips</h1><p>One project per item. Track what you paid, what you spent and what you earned. Your saved estimates stay inside each project.</p></header>
      {!isLoaded ? <p className="flips-message" role="status">Loading sign-in…</p> : isSignedIn ? <SavedList key={`${userId}:${sessionId}`} />
        : <div className="flips-message"><h2>Your finds, in one place.</h2><p>Sign in to return to your saved estimates and notes.</p><SignInButton mode="modal"><button className="flips-primary">Sign in to view My Flips</button></SignInButton></div>}
    </main>
  </div>;
}
