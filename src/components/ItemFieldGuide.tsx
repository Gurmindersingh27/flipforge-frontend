import { useState } from "react";
import { appendInspectionNotes, buildInspectionNotes, INSPECTION_GUIDES } from "../lib/itemInspection";
import type { InspectionAnswer, InspectionKind } from "../lib/itemInspection";
import "./ItemFieldGuide.css";

export default function ItemFieldGuide({ description, onDescription, disabled }: {
  description: string; onDescription: (value: string) => void; disabled: boolean;
}) {
  const [kind, setKind] = useState<InspectionKind>("general");
  const [brand, setBrand] = useState("unknown");
  const [label, setLabel] = useState("");
  const [notes, setNotes] = useState("");
  const [answers, setAnswers] = useState<Partial<Record<string, InspectionAnswer>>>({});
  const [added, setAdded] = useState("");
  const guide = INSPECTION_GUIDES[kind];
  const text = buildInspectionNotes({ kind, label, notes, answers });
  const appended = appendInspectionNotes(description, text);
  const alreadyAdded = Boolean(text && description.includes(text));
  const earlierNotesRemain = Boolean(added && added !== text && description.includes(added));
  const remaining = guide.checks.filter(check => !answers[check.id] || answers[check.id] === "unchecked").length;
  return <details className="item-field-guide" data-field-guide>
    <summary>Photo &amp; inspection guide <span>Free · Optional</span></summary>
    <div className="field-guide-body">
      <p className="field-guide-intro">A few checks while the item is in front of you. Opening this guide costs nothing.</p>
      <ol className="field-guide-photos" aria-label="Suggested photo order">
        <li><strong>Whole item</strong><span>Use this as Main. Include the base and back if you can.</span></li>
        <li><strong>Label or maker’s mark</strong><span>Get the entire label sharp and readable, without glare.</span></li>
        <li><strong>Worst wear</strong><span>Show the damage close enough to see it clearly.</span></li>
      </ol>
      <fieldset disabled={disabled} className="field-guide-form">
        <label className="quick-field" htmlFor="field-guide-kind">What are you checking?
          <select id="field-guide-kind" value={kind} onChange={event => setKind(event.target.value as InspectionKind)}>
            {Object.entries(INSPECTION_GUIDES).map(([value, item]) => <option key={value} value={value}>{item.name}</option>)}
          </select>
        </label>
        <section className="field-guide-label" aria-label="Find the label">
          <h3>Find the label</h3>
          {kind === "chair" ? <>
            <label className="quick-field" htmlFor="field-guide-brand">Brand on the listing or item
              <select id="field-guide-brand" value={brand} onChange={event => setBrand(event.target.value)}>
                <option value="unknown">Other / not sure</option><option value="herman-miller">Herman Miller</option><option value="steelcase">Steelcase</option>
              </select>
            </label>
            {brand === "herman-miller" ? <p>Look underneath the seat for the manufacturing label. Photograph the complete product number, FO number and manufacture date. <a href="https://www.hermanmiller.com/customer-service/warranty-and-service/" target="_blank" rel="noopener noreferrer">Herman Miller label examples ↗</a></p>
              : brand === "steelcase" ? <p>Look under the seat for the manufacturing sticker. Photograph the full label, including its PO number and any model or date text. <a href="https://sg.steelcase.com/pages/warranty-claim" target="_blank" rel="noopener noreferrer">Steelcase label guidance ↗</a></p>
              : <p>Start underneath the seat and around the frame. Look for a maker’s name and a product or model number. The label may be missing.</p>}
          </> : <p>Look underneath, on the back and inside any drawers for a label, stamp or maker’s mark. Photograph the whole mark and nearby construction.</p>}
          <p>A brand name or partial label does not establish the exact model, generation or authenticity. If the model is unclear, keep it unconfirmed and ask for a clearer label or help from the manufacturer.</p>
          <label className="quick-field" htmlFor="field-guide-label-text">Label text you can read <span className="quick-muted">(optional)</span>
            <input id="field-guide-label-text" maxLength={100} value={label} onChange={event => setLabel(event.target.value)} placeholder="Copy only what is legible. Leave guesses out." autoComplete="off" />
          </label>
        </section>
        <h3>Check it in person</h3>
        <p className="field-guide-help">Your observations, not findings from a photo. Stop if the item looks unstable or damaged; leave anything you cannot test as Not checked.</p>
        <p className="field-guide-progress" aria-live="polite">{remaining} of {guide.checks.length} checks still unrecorded. This is not a safety or authenticity score.</p>
        <div className="field-guide-checks">{guide.checks.map(check => <fieldset key={check.id} className="field-guide-check">
          <legend>{check.label}</legend><p>{check.help}</p>
          <div className="field-guide-answers">{([ ["unchecked", "Not checked"], ["okay", "Looks OK"], ["issue", "Issue found"] ] as const).map(([value, title]) => <label key={value}>
            <input type="radio" name={check.id} value={value} checked={(answers[check.id] ?? "unchecked") === value} onChange={() => setAnswers(old => ({ ...old, [check.id]: value }))} />{title}
          </label>)}</div>
        </fieldset>)}</div>
        <label className="quick-field" htmlFor="field-guide-notes">What needs a closer look? <span className="quick-muted">(optional)</span>
          <textarea id="field-guide-notes" maxLength={160} rows={2} value={notes} onChange={event => setNotes(event.target.value)} placeholder="Height slowly drops. Right arm pad is split. Model unclear." />
        </label>
        {text && <div className="field-guide-preview"><h3>Notes to add</h3><p>{text}</p></div>}
        <p className="field-guide-help">Guide entries stay on this page only. Add them to your description to include them when you request an estimate. Nothing is sent by this button.</p>
        {appended.error && <p className="quick-error" role="status">{appended.error}</p>}
        {earlierNotesRemain && <p className="field-guide-help" role="status">Your guide has changed. Edit the notes already in your description, or remove those earlier notes before adding these. They have not been updated automatically.</p>}
        <button type="button" className="quick-secondary" disabled={!text || alreadyAdded || earlierNotesRemain || Boolean(appended.error)} onClick={() => { onDescription(appended.value); setAdded(text); }}>
          {alreadyAdded ? "Notes are in your description" : "Add notes to description"}
        </button>
        {added === text && alreadyAdded && <p className="field-guide-help" role="status">Added below your existing description. Your photos and prices are unchanged.</p>}
      </fieldset>
    </div>
  </details>;
}
