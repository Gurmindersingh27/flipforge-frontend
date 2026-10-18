import { compareItemVersions } from "../lib/itemComparison";
import type { ComparisonRow } from "../lib/itemComparison";
import { safeItemLink } from "../lib/savedItems";
import type { SavedItem } from "../lib/types";

function Row({ row, link = false }: { row: ComparisonRow; link?: boolean }) {
  function value(text: string) {
    const href = link ? safeItemLink(text) : null;
    return href ? <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> : text;
  }
  return <div className="flips-compare-row" data-changed={row.changed} data-comparison-row={row.key}>
    <dt>{row.label}{row.changed && <span className="flips-change">Changed</span>}</dt>
    <dd><span className="flips-compare-side">Previous</span><p>{value(row.previous)}</p>{row.previousSource && <small>{row.previousSource}</small>}</dd>
    <dd><span className="flips-compare-side">Current</span><p>{value(row.current)}</p>{row.currentSource && <small>{row.currentSource}</small>}</dd>
    {row.difference !== null && <dd className="flips-compare-difference">Change: {row.difference}</dd>}
  </div>;
}
export default function ItemVersionComparison({ previous, current }: { previous: SavedItem; current: SavedItem }) {
  const comparison = compareItemVersions(previous, current);
  return <section className="flips-comparison" aria-label={`Compare estimates ${previous.id} and ${current.id}`}>
    <h3>Compare estimates</h3>
    <p className="flips-meta">Previous #{previous.id} → Current #{current.id}. Saved figures; neither version is recalculated or changed.</p>
    {(previous.assessment || current.assessment) && <p className="flips-evidence">Includes AI photo evidence: {previous.assessment && `previous #${previous.id}`}{previous.assessment && current.assessment && " and "}{current.assessment && `current #${current.id}`}. Evidence is not compared here.</p>}
    {comparison.onlyNotesOrLink && <p className="flips-parent">Only notes or the link changed.</p>}
    <dl><Row row={comparison.assumptions[0]} /><Row row={comparison.status} /></dl>
    {comparison.scenarios.map(scenario => <div key={scenario.key}>
      <h4>{scenario.label}</h4><dl>{scenario.rows.map(row => <Row key={row.key} row={row} />)}</dl>
      {(scenario.previousNegative || scenario.currentNegative) && <p className="flips-caution">Even a free item misses your target under this resale estimate ({scenario.previousNegative && "previous"}{scenario.previousNegative && scenario.currentNegative && " and "}{scenario.currentNegative && "current"}).</p>}
    </div>)}
    <details className="flips-notes"><summary>Compare saved assumptions</summary><dl>{comparison.assumptions.slice(1).map(row => <Row key={row.key} row={row} />)}</dl></details>
    <dl>{comparison.metadata.map(row => <Row key={row.key} row={row} link={row.key === "listing_url"} />)}</dl>
    <p className="flips-meta">These are estimates, not actual profits. Differences reflect all saved changes together, not the effect of one change.</p>
  </section>;
}
