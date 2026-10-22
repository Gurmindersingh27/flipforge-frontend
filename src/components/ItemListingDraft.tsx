import { useEffect, useId, useRef, useState } from "react";
import { buildListingDraft, emptyListingDraft, listingPriceValid } from "../lib/itemListingDraft";
import type { ListingDraftFields } from "../lib/itemListingDraft";

export default function ItemListingDraft({ onDirtyChange }: { onDirtyChange: (dirty: boolean) => void }) {
  const id = useId();
  const [fields, setFields] = useState(emptyListingDraft);
  const [editedText, setEditedText] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copying" | "copied" | "failed">("idle");
  const copyGeneration = useRef(0);
  const text = editedText ?? buildListingDraft(fields);
  const validPrice = listingPriceValid(fields.askingPrice);
  useEffect(() => () => { copyGeneration.current++; }, []);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    const leaving = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === "_blank" || anchor.hasAttribute("download") || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      if (!window.confirm("Leave this page and discard your unsaved listing draft?")) {
        event.preventDefault(); event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", leaving, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", leaving, true); };
  }, [dirty]);
  function changed() {
    copyGeneration.current++; setCopyStatus("idle"); setDirty(true); onDirtyChange(true);
  }
  function field(key: keyof ListingDraftFields, label: string, multiline = false) {
    const props = { id: `${id}-${key}`, value: fields[key], maxLength: key === "description" || key === "defects" ? 1500 : 250,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { changed(); setFields(old => ({ ...old, [key]: event.target.value })); } };
    return <label className="listing-field" htmlFor={props.id}>{label}{multiline ? <textarea {...props} rows={3} /> : <input {...props} inputMode={key === "askingPrice" ? "decimal" : "text"} aria-invalid={key === "askingPrice" && !validPrice ? true : undefined} />}</label>;
  }
  async function copy() {
    if (!text.trim() || !validPrice || copyStatus === "copying") return;
    const generation = ++copyGeneration.current;
    setCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(text);
      if (generation === copyGeneration.current) setCopyStatus("copied");
    } catch {
      if (generation === copyGeneration.current) setCopyStatus("failed");
    }
  }
  return <section className="item-listing-draft" aria-label="Sale listing draft">
    <h3>Prepare your sale listing</h3>
    <p className="listing-note">Temporary draft · not saved or published. Copy it before leaving.</p>
    <p>Enter only details you have checked. The fields start blank; AI guesses, private notes and the original listing link are not copied.</p>
    <div className="listing-fields">
      {field("title", "Confirmed item name / listing title")}
      {field("dimensions", "Measured dimensions (include units)")}
      {field("description", "Description you can confirm", true)}
      {field("condition", "Condition you have checked")}
      {field("defects", "Known defects to disclose", true)}
      {field("askingPrice", "Your asking price ($)")}
      {field("pickupArrangement", "Buyer pickup arrangements")}
    </div>
    <p className="listing-note">Choose your own asking price. Buyer pickup arrangements are separate from your cost to collect the item. Describe repairs as completed only if you have verified they are done.</p>
    {!validPrice && <p role="alert">Enter an asking price of 0 or more, with up to two decimal places, or leave it blank.</p>}
    <label className="listing-field" htmlFor={`${id}-text`}>Listing text · review and edit before copying
      <textarea id={`${id}-text`} data-listing-text value={text} rows={10} maxLength={6000} onChange={event => { changed(); setEditedText(event.target.value); }} />
    </label>
    {editedText !== null && <><p className="listing-note">You edited the listing text directly. Field changes will appear only if you rebuild it.</p><button className="flips-link" type="button" onClick={() => {
      if (!window.confirm("Replace your edited listing text with the current fields?")) return;
      changed(); setEditedText(null);
    }}>Rebuild text from fields</button></>}
    <button className="flips-primary" type="button" disabled={!text.trim() || !validPrice || copyStatus === "copying"} onClick={() => void copy()}>{copyStatus === "copying" ? "Copying…" : "Copy listing text"}</button>
    {copyStatus === "copied" && <p role="status">Copied. Review it before publishing. This draft is still not saved.</p>}
    {copyStatus === "failed" && <p role="alert">Couldn’t copy automatically. Select the listing text above and copy it manually.</p>}
  </section>;
}
