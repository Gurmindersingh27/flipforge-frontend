import { useEffect, useRef, useState } from "react";
import { getItemInspection, ItemApiError, saveItemInspection } from "../lib/api";
import { ItemSessionChangedError, ItemSignInError } from "../lib/itemSession";
import { useItemSession } from "../lib/useItemSession";
import { INSPECTION_GUIDES } from "../lib/itemInspection";
import { captureInspection, emptyInspection, inspectionErrors, inspectionTextLength } from "../lib/savedItemInspection";
import type { ItemInspectionAnswer, ItemInspectionFacts, ItemInspectionKind, ItemInspectionResponse, SaveItemInspectionRequest } from "../lib/types";
import type { OutcomeGuard } from "./ItemOutcomePanel";
import "./ItemInspectionEditor.css";

type Phase = "loading" | "editing" | "saving" | "uncertain" | "reload" | "conflict";
type ReadReason = "initial" | "conflict" | "saved";
const ANSWERS: Record<ItemInspectionAnswer, string> = { unchecked: "Not checked", okay: "Looks OK", issue: "Issue found" };

// Parent keys the workspace by owner, session and root. No persistent drafts.
export default function ItemInspectionEditor({ rootId, onGuard }: { rootId: number; onGuard: (guard: OutcomeGuard) => void }) {
  const withSession = useItemSession();
  const [form, setForm] = useState<ItemInspectionFacts>(() => emptyInspection());
  const [latest, setLatest] = useState<ItemInspectionResponse | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef<SaveItemInspectionRequest | null>(null);
  const confirmed = useRef<ItemInspectionResponse | null>(null);
  const readReason = useRef<ReadReason>("initial");
  const locked = useRef(false);
  const sequence = useRef(0);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => { if (active) void reload(); });
    const invalidate = () => { sequence.current++; pending.current = null; confirmed.current = null; };
    return () => { active = false; invalidate(); };
    // A different owner/session/root mounts a fresh editor and invalidates awaits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    onGuard(phase === "saving" || (phase === "loading" && dirty) ? "busy" : dirty || phase === "uncertain" || phase === "conflict" ? "draft" : null);
  }, [phase, dirty, onGuard]);

  async function readLatest(generation: number) {
    const reason = readReason.current;
    setPhase("loading"); setMessage("");
    try {
      const saved = await withSession((token, signal) => getItemInspection(rootId, token, signal), () => generation === sequence.current);
      if (generation !== sequence.current) return;
      if (reason === "saved" && (!saved || !confirmed.current || saved.revision_number < confirmed.current.revision_number
        || (saved.revision_number === confirmed.current.revision_number && saved.id !== confirmed.current.id))) {
        throw new Error("The latest inspection could not be confirmed.");
      }
      setLatest(saved); setErrors({});
      if (reason === "initial" || (reason === "saved" && saved?.id === confirmed.current?.id)) {
        setForm(saved?.inputs ?? emptyInspection()); setDirty(false); setPhase("editing");
        setMessage(reason === "saved" ? "Inspection saved. Latest revision confirmed." : saved ? "Saved observations loaded." : "No saved inspection yet. Every check starts Not checked.");
      } else {
        setPhase("conflict");
        setMessage(reason === "saved"
          ? "Your save was confirmed, but a newer inspection is now saved. Your submitted observations are kept below. Compare both versions before continuing."
          : "This save conflicted with the server. Your unsaved observations are kept below. Compare them with the saved version before continuing.");
      }
    } catch (failure) {
      if (failure instanceof ItemSessionChangedError || generation !== sequence.current) return;
      setPhase("reload");
      setMessage(`${reason === "saved" ? "Your save was confirmed. " : ""}${failure instanceof Error ? failure.message : "Could not load the inspection."} Your observations have not been replaced.`);
    }
  }
  async function reload() {
    if (locked.current) return;
    locked.current = true;
    const generation = ++sequence.current;
    try { await readLatest(generation); }
    finally { if (generation === sequence.current) locked.current = false; }
  }
  async function submit(attempt: SaveItemInspectionRequest) {
    if (locked.current || pending.current !== attempt) return;
    locked.current = true;
    const generation = ++sequence.current;
    const wasUncertain = phase === "uncertain";
    setPhase("saving"); setErrors({}); setMessage("");
    try {
      const saved = await withSession((token, signal) => saveItemInspection(rootId, attempt, token, signal), () => generation === sequence.current);
      if (generation !== sequence.current) return;
      pending.current = null; confirmed.current = saved; readReason.current = "saved";
      // Replays may be old: GET must confirm latest before replacing the draft.
      await readLatest(generation);
    } catch (failure) {
      if (failure instanceof ItemSessionChangedError || generation !== sequence.current) return;
      const status = failure instanceof ItemApiError || failure instanceof ItemSignInError ? failure.status : undefined;
      if (status === 409) {
        pending.current = null; confirmed.current = null; readReason.current = "conflict";
        await readLatest(generation);
      } else if (!wasUncertain && status !== undefined && status >= 400 && status < 500) {
        pending.current = null; setPhase("editing");
        setMessage(status === 422 ? "The inspection was rejected. Check your entries and save again. Your observations are still here."
          : failure instanceof Error ? failure.message : "Save rejected. Your observations are still here.");
      } else {
        setPhase("uncertain");
        setMessage(`${failure instanceof ItemSignInError ? `${failure.message} ` : ""}The inspection may already be saved. Your submitted observations are frozen so Retry sends exactly the same save. Confirm it before editing.`);
      }
    } finally { if (generation === sequence.current) locked.current = false; }
  }
  function save() {
    if (locked.current || phase !== "editing") return;
    const found = inspectionErrors(form); setErrors(found);
    if (Object.keys(found).length) return;
    try {
      const attempt = captureInspection(form, latest?.id ?? null, crypto.randomUUID());
      pending.current = attempt; setDirty(true); void submit(attempt);
    } catch { setMessage("Could not prepare this save. Your observations are still here."); }
  }
  function edit(change: Partial<ItemInspectionFacts>) {
    if (phase !== "editing" || locked.current) return;
    setForm(old => ({ ...old, ...change })); setDirty(true); setErrors({}); setMessage("");
  }
  function changeKind(kind: ItemInspectionKind) {
    if (kind === form.kind) return;
    if ((form.brand_hint !== null || Object.values(form.answers).some(answer => answer !== "unchecked"))
      && !window.confirm("Changing category clears the current check answers and chair guide selection. Label text, notes and inspection date are kept. Continue?")) return;
    edit({ kind, brand_hint: null, answers: emptyInspection(kind).answers });
  }
  const guide = INSPECTION_GUIDES[form.kind];
  const frozen = phase !== "editing";
  const textField = (key: "label_text" | "notes", label: string, limit: number) => <div className="inspection-field">
    <label htmlFor={`inspection-${key}`}>{label}</label>
    <textarea id={`inspection-${key}`} value={form[key] ?? ""} rows={key === "notes" ? 4 : 2}
      aria-invalid={Boolean(errors[key])} aria-describedby={`inspection-${key}-help`} onChange={event => edit({ [key]: event.target.value })} />
    <p className={errors[key] ? "inspection-error" : "project-help"} id={`inspection-${key}-help`}>{errors[key] || `${inspectionTextLength(form[key] ?? "")} / ${limit.toLocaleString()} characters. Text is saved exactly as entered.`}</p>
  </div>;
  return <section className="project-workspace inspection-editor" aria-label="Project inspection" aria-busy={phase === "loading" || phase === "saving"}>
    <h2>Inspection</h2>
    <p className="project-help">Your observations, reported by you. This does not verify model, condition or authenticity. Saving an inspection is free and does not change your estimate or tracking.</p>
    {phase === "loading" && <p role="status">Loading the latest inspection…</p>}
    {message && <p role={["uncertain", "reload", "conflict"].includes(phase) ? "alert" : "status"}>{message}</p>}
    {phase === "conflict" && <div className="inspection-conflict">
      <h3>Saved on server{latest ? ` · revision ${latest.revision_number}` : " · no inspection"}</h3>
      {latest && <div className="inspection-snapshot" data-inspection-server={latest.id}>
        <p>{INSPECTION_GUIDES[latest.inputs.kind].name} · Guide selection: {latest.inputs.brand_hint === "herman_miller" ? "Herman Miller" : latest.inputs.brand_hint === "steelcase" ? "Steelcase" : "None"}</p>
        <p>Inspection date: {latest.inputs.inspected_on ?? "Not recorded"}</p>
        <p>Label text: <span>{latest.inputs.label_text ?? "Not recorded"}</span></p>
        <p>Notes: <span>{latest.inputs.notes ?? "Not recorded"}</span></p>
        <ul>{INSPECTION_GUIDES[latest.inputs.kind].checks.map(check => <li key={check.id}>{check.label}: {ANSWERS[latest.inputs.answers[check.id]]}</li>)}</ul>
      </div>}
      <div className="inspection-actions">
        <button type="button" className="flips-link" onClick={() => {
          if (!window.confirm("Replace your kept observations with the saved server version? This discards the local draft.")) return;
          setForm(latest?.inputs ?? emptyInspection()); setDirty(false); setPhase("editing"); setMessage("Showing the saved server version. Nothing new was saved.");
        }}>Use saved version</button>
        <button type="button" className="flips-primary" onClick={() => { setDirty(true); setPhase("editing"); setMessage("Your draft is kept. Review it, then Save inspection to create the next revision. This will replace every field in the latest snapshot; older revisions remain stored."); }}>Keep my draft for next revision</button>
      </div>
      <h3>Your kept observations</h3>
    </div>}
    <form noValidate onSubmit={event => { event.preventDefault(); save(); }}>
      <fieldset disabled={frozen}>
        <legend className="inspection-legend">User-reported observations</legend>
        <div className="inspection-field"><label htmlFor="inspection-kind">Furniture category</label>
          <select id="inspection-kind" value={form.kind} onChange={event => changeKind(event.target.value as ItemInspectionKind)}>
            {Object.entries(INSPECTION_GUIDES).map(([kind, value]) => <option key={kind} value={kind}>{value.name}</option>)}
          </select>
        </div>
        {form.kind === "chair" && <div className="inspection-field"><label htmlFor="inspection-brand_hint">Chair label guide (not verified brand)</label>
          <select id="inspection-brand_hint" value={form.brand_hint ?? ""} onChange={event => edit({ brand_hint: (event.target.value || null) as ItemInspectionFacts["brand_hint"] })}>
            <option value="">None / unsure</option><option value="herman_miller">Herman Miller</option><option value="steelcase">Steelcase</option>
          </select>
        </div>}
        {textField("label_text", "Label text I can read", 500)}
        <div className="inspection-field"><label htmlFor="inspection-inspected_on">Inspection date (optional)</label>
          <input id="inspection-inspected_on" type="date" value={form.inspected_on ?? ""} aria-invalid={Boolean(errors.inspected_on)} aria-describedby="inspection-date-help" onChange={event => edit({ inspected_on: event.target.value || null })} />
          <p id="inspection-date-help" className={errors.inspected_on ? "inspection-error" : "project-help"}>{errors.inspected_on || "Enter the date you inspected it. Blank means not recorded."}</p>
        </div>
        <div className="inspection-checks">{guide.checks.map(check => <div className="inspection-field" key={check.id}>
          <label htmlFor={`inspection-${check.id}`}>{check.label}</label><p className="project-help" id={`${check.id}-help`}>{check.help}</p>
          <select id={`inspection-${check.id}`} aria-describedby={`${check.id}-help`} value={form.answers[check.id]} onChange={event => edit({ answers: { ...form.answers, [check.id]: event.target.value as ItemInspectionAnswer } })}>
            {Object.entries(ANSWERS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>)}</div>
        {textField("notes", "Inspection notes", 5000)}
      </fieldset>
      {Object.keys(errors).length > 0 && <p role="alert" className="inspection-error">Check the highlighted inspection fields before saving.</p>}
      {phase === "editing" && <button type="submit" className="flips-primary" disabled={latest !== null && !dirty}>Save inspection</button>}
      {phase === "saving" && <p role="status">Saving inspection… Your observations are frozen until this save is confirmed.</p>}
    </form>
    {phase === "uncertain" && <button type="button" className="flips-primary" onClick={() => { if (pending.current) void submit(pending.current); }}>Retry same inspection save</button>}
    {phase === "reload" && <button type="button" className="flips-link" onClick={() => void reload()}>Reload inspection</button>}
    {latest && phase === "editing" && <p className="project-help" data-inspection-revision={latest.id}>Last loaded: revision {latest.revision_number} · Saved {new Date(latest.created_at).toLocaleString()} · User reported{dirty ? " · You have unsaved observations" : ""}.</p>}
  </section>;
}
