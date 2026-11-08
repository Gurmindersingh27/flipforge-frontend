import { useEffect, useRef, useState } from "react";
import { SignInButton, useAuth } from "@clerk/clerk-react";
import { Link, useParams } from "react-router-dom";
import { getItemProject } from "../lib/api";
import { formatItemMoney, ITEM_STATUS_TEXT } from "../lib/itemAnalysis";
import { ItemSessionChangedError } from "../lib/itemSession";
import { useItemSession } from "../lib/useItemSession";
import { PROJECT_STAGES, PROJECT_STAGE_LABELS } from "../lib/itemProjects";
import { OUTCOME_DATES, OUTCOME_LABELS, OUTCOME_NUMBERS } from "../lib/itemOutcomes";
import { safeItemLink } from "../lib/savedItems";
import type { ItemOutcomeResponse, ItemProjectResponse } from "../lib/types";
import ItemOutcomePanel from "./ItemOutcomePanel";
import type { OutcomeGuard } from "./ItemOutcomePanel";
import ItemListingDraft from "./ItemListingDraft";
import ItemVersionComparison from "./ItemVersionComparison";
import ItemOutcomeComparison, { ActualFigures } from "./ItemOutcomeComparison";
import "./MyFlipsPage.css";
import "./ItemProjectPage.css";

function Project({ rootId }: { rootId: number }) {
  const withSession = useItemSession();
  const [project, setProject] = useState<ItemProjectResponse | null>(null);
  const currentProject = useRef<ItemProjectResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const refreshingOutcome = useRef<string | null | undefined>(undefined);
  const [tracking, setTracking] = useState<{ itemId: number | null } | null>(null);
  const [guard, setGuard] = useState<OutcomeGuard>(null);
  const [listingItem, setListingItem] = useState<number | null>(null);
  const [listingDirty, setListingDirty] = useState(false);
  const [comparisons, setComparisons] = useState<number[]>([]);
  const [notice, setNotice] = useState("");

  async function load() {
    const generation = ++sequence.current;
    setLoading(true); setError("");
    try {
      const value = await withSession((token, signal) => getItemProject(rootId, token, signal), () => generation === sequence.current);
      if (generation !== sequence.current) return;
      currentProject.current = value; setProject(value);
    } catch (failure) {
      if (failure instanceof ItemSessionChangedError) return;
      if (generation === sequence.current) setError(failure instanceof Error ? failure.message : "Could not load this project.");
    } finally {
      if (generation === sequence.current) { setLoading(false); refreshingOutcome.current = undefined; }
    }
  }
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void load(); });
    const invalidate = () => { sequence.current++; };
    return () => { active = false; invalidate(); };
    // A new owner, session or root gets a fresh component and request generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!guard) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const leaving = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (guard === "busy" || !window.confirm("Leave this project and discard unsaved tracking? A save already sent may still have succeeded.")) {
        event.preventDefault(); event.stopPropagation();
        if (guard === "busy") setNotice("Finish checking the tracking save before leaving this project.");
      }
    };
    window.addEventListener("beforeunload", beforeUnload); document.addEventListener("click", leaving, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", leaving, true); };
  }, [guard]);
  function track(itemId: number | null, toggle = true) {
    if (guard === "busy") return;
    if (guard === "draft" && !window.confirm("Close tracking and discard your unsaved entries? A save already sent may still have succeeded.")) return;
    setGuard(null); setNotice("");
    setTracking(old => toggle && old?.itemId === itemId ? null : { itemId });
    requestAnimationFrame(() => document.getElementById("project-tracking")?.scrollIntoView({ block: "start" }));
  }
  function draft(itemId: number) {
    if (listingDirty && !window.confirm("Discard your unsaved listing draft? Copy it first if you want to keep it.")) return;
    setListingDirty(false); setListingItem(old => old === itemId ? null : itemId);
    requestAnimationFrame(() => document.getElementById("project-listing")?.scrollIntoView({ block: "start" }));
  }
  function outcomeChanged(outcome: ItemOutcomeResponse | null) {
    const id = outcome?.id ?? null;
    if (id === currentProject.current?.latest_outcome?.id || (id === null && currentProject.current?.latest_outcome === null) || refreshingOutcome.current === id) return;
    refreshingOutcome.current = id;
    void load();
  }
  const valid = project !== null && !loading && !error;
  const stage = project?.summary.stage;
  const basis = project?.latest_outcome ? project.latest_outcome.based_on_item_id : project?.summary.latest_version.id ?? null;
  return <>
    {loading && <p role="status" className="flips-message">{project ? "Updating the saved project…" : "Loading your project…"}</p>}
    {error && <div className="flips-message flips-error" role="alert"><p>{error}</p>{project && <p>The comparison is hidden until the saved project can be refreshed. Your tracking entries are kept below.</p>}<button className="flips-link" onClick={() => void load()}>Retry project</button></div>}
    {project && <>
      <header className="flips-intro"><p className="flips-eyebrow">MY PROJECT</p><h1>{project.summary.latest_version.inputs.item_name?.trim() || `Untitled item #${rootId}`}</h1>
        <p>{project.summary.version_count} saved {project.summary.version_count === 1 ? "estimate" : "estimates"} · Project #{rootId}</p></header>
      {valid && <>
        <ol className="project-stages" aria-label="Saved project stage">{PROJECT_STAGES.map(value => <li key={value} aria-current={stage === value ? "step" : undefined} data-stage={value}>{PROJECT_STAGE_LABELS[value]}</li>)}</ol>
        <section className="project-next" aria-label="Next step"><h2>{stage === "sold" ? "Your results" : "Keep this flip moving"}</h2>
          {stage === "sold" && <p>Review what you earned and the costs behind it. You can correct the saved tracking below.</p>}
          {stage !== "sold" && <button className="flips-primary" disabled={guard === "busy"} onClick={() => track(basis, false)}>{stage === "considering" ? "Bought it? Record what you paid" : stage === "bought" ? "Track costs as you go" : "Sold it? Record the sale"}</button>}
          {stage === "bought" && <p>Ready to list? <button className="flips-link" onClick={() => draft(project.summary.latest_version.id)}>Prepare listing text</button></p>}
        </section>
        {project.comparison && project.latest_outcome ? <ItemOutcomeComparison comparison={project.comparison} outcome={project.latest_outcome} /> : <section className="project-comparison" aria-label="Project results"><h2>{project.latest_outcome ? "Your actuals" : "Ready when you buy"}</h2><p>{project.comparison_unavailable_reason}. {project.latest_outcome ? "Your recorded actuals are shown below." : "Record a purchase to start tracking this flip."}</p>{project.latest_outcome && <ActualFigures outcome={project.latest_outcome} />}</section>}
        {project.latest_outcome && <details className="project-recorded flips-notes"><summary>All recorded actuals</summary><dl className="project-figures">{[...OUTCOME_NUMBERS, ...OUTCOME_DATES].map(key => {
          const value = project.latest_outcome!.inputs[key];
          return <div key={key}><dt>{OUTCOME_LABELS[key]}</dt><dd>{value === null ? "Not recorded" : typeof value === "string" ? value : key === "hours" ? `${value} hours` : formatItemMoney(value)}</dd></div>;
        })}</dl></details>}
      </>}
      {notice && <p role="status">{notice}</p>}
      <section id="project-tracking" className="project-workspace" aria-label="Project tracking">
        <h2>Tracking</h2><p className="project-help">{basis === null ? "No estimate is linked." : `Uses estimate #${basis}.`} Choose another saved estimate below only if you want future tracking linked to it.</p>
        <button className="flips-link" disabled={guard === "busy"} aria-expanded={tracking !== null} aria-controls="project-tracking-editor" onClick={() => tracking ? track(tracking.itemId) : track(basis)}>{tracking ? "Close tracking" : "Track this find"}</button>
        <div id="project-tracking-editor">{tracking && <ItemOutcomePanel key={tracking.itemId ?? "unlinked"} rootId={rootId} itemId={tracking.itemId} onGuard={setGuard} onOutcomeChange={outcomeChanged} />}</div>
      </section>
      <section id="project-listing" className="project-workspace" aria-label="Project sale listing"><h2>Selling</h2>
        <button className="flips-link" aria-expanded={listingItem !== null} aria-controls={`listing-${project.summary.latest_version.id}`} onClick={() => draft(listingItem ?? project.summary.latest_version.id)}>{listingItem === null ? "Prepare sale listing" : "Close listing draft"}</button>
        <div id={`listing-${project.summary.latest_version.id}`}>{listingItem !== null && <ItemListingDraft key={listingItem} onDirtyChange={setListingDirty} />}</div>
      </section>
      <section className="project-versions" aria-label="Saved estimates"><h2>Saved estimates</h2><p className="project-help">Your original snapshots stay unchanged. Reopen one to create a new estimate.</p>
        <div className="flips-grid">{project.versions.map(item => {
          const previous = project.versions.find(version => version.id === item.parent_item_id);
          const open = comparisons.includes(item.id);
          const link = safeItemLink(item.listing_url);
          return <article className="flips-card" key={item.id} data-saved-item={item.id}>
            <h3>Estimate #{item.id}</h3><p className="flips-meta"><time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-US")}</time>{item.parent_item_id !== null && ` · New version of #${item.parent_item_id}`}</p>
            <p className="flips-status" data-status={item.analysis_result.status}>{ITEM_STATUS_TEXT[item.analysis_result.status].title}</p>
            {item.notes && <details className="flips-notes"><summary>Notes</summary><p>{item.notes}</p></details>}
            <div className="flips-actions">
              <Link className="flips-link" aria-label={`Reopen saved item ${item.id}`} to={`/items?${item.assessment ? "find" : "saved"}=${item.id}`}>Reopen estimate</Link>
              {link && <a className="flips-link" href={link} target="_blank" rel="noopener noreferrer">Listing</a>}
              {previous && <button className="flips-link" aria-expanded={open} aria-controls={`comparison-${item.id}`} onClick={() => setComparisons(old => open ? old.filter(id => id !== item.id) : [...old, item.id])}>{open ? "Hide comparison" : `Compare with #${previous.id}`}</button>}
              <button className="flips-link" disabled={guard === "busy"} aria-controls={`tracking-${item.id}`} onClick={() => track(item.id, false)}>Track against this estimate</button>
            </div>
            <div id={`tracking-${item.id}`} />
            {previous && <div id={`comparison-${item.id}`}>{open && <ItemVersionComparison previous={previous} current={item} />}</div>}
          </article>;
        })}</div>
      </section>
    </>}
  </>;
}

export default function ItemProjectPage() {
  const { rootId: rawId } = useParams();
  const rootId = rawId && /^[1-9]\d*$/.test(rawId) ? Number(rawId) : NaN;
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  return <div className="my-flips item-project">
    <nav className="flips-nav" aria-label="Project navigation"><Link className="flips-brand" to="/my-flips">Flip<span>Forge</span><small>FIND THE POTENTIAL.</small></Link><div><Link className="flips-link" to="/my-flips">My Flips</Link><Link className="flips-link" to="/items">New item</Link><Link className="flips-link" to="/">Back to Houses</Link></div></nav>
    <main className="flips-main">{!Number.isSafeInteger(rootId) ? <p role="alert" className="flips-message">Item not found.</p> : !isLoaded ? <p role="status" className="flips-message">Loading sign-in…</p> : !isSignedIn ? <div className="flips-message"><h1>Your project</h1><SignInButton mode="modal"><button className="flips-primary">Sign in to view this project</button></SignInButton></div> : <Project key={`${userId}:${sessionId}:${rootId}`} rootId={rootId} />}</main>
  </div>;
}
