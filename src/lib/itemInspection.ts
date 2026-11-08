// User observations only. These checks never identify a model, authenticate an
// item, price a repair, or alter financial/assessment results.
export type InspectionKind = "chair" | "storage" | "general";
export type InspectionAnswer = "unchecked" | "okay" | "issue";
export interface InspectionCheck { id: string; label: string; help: string }
export const INSPECTION_GUIDES: Record<InspectionKind, { name: string; checks: InspectionCheck[] }> = {
  chair: { name: "Office chair", checks: [
    { id: "chair-frame", label: "Frame and base", help: "Look for cracks, loose joints and uneven contact with the floor before sitting." },
    { id: "chair-height", label: "Seat height", help: "If the chair is stable, try the height control and check whether it holds your sitting height." },
    { id: "chair-controls", label: "Tilt and controls", help: "Try the fitted levers gently. Record controls that stick, slip or do not respond." },
    { id: "chair-surfaces", label: "Seat, back and arms", help: "Look for tears, sagging, cracked plastic and loose armrests. Photograph the worst area." },
    { id: "chair-wheels", label: "Wheels and swivel", help: "Check for missing or damaged wheels, then try rolling and swiveling on a clear floor." },
  ] },
  storage: { name: "Dresser or cabinet", checks: [
    { id: "storage-frame", label: "Frame and joints", help: "Check the legs, corners and back for loose joints, cracks and wobble." },
    { id: "storage-moving", label: "Drawers and doors", help: "Try one at a time without pulling the piece off balance. Note sticking or missing parts." },
    { id: "storage-finish", label: "Finish and edges", help: "Look for peeling veneer, chips and deep damage under the surface finish." },
    { id: "storage-damp", label: "Moisture and odors", help: "Check inside and underneath for swelling, staining, pest signs and persistent smells." },
    { id: "storage-fit", label: "Size and transport", help: "Measure the piece, doorways and vehicle opening. Check which parts can be removed." },
  ] },
  general: { name: "Other furniture", checks: [
    { id: "general-frame", label: "Stability and joints", help: "Check the base, joints and underside for wobble, cracks and missing hardware." },
    { id: "general-moving", label: "Moving parts", help: "Gently try the parts fitted to this item. Leave this unchecked if there are none or you cannot test them." },
    { id: "general-surface", label: "Surface and fabric", help: "Inspect edges, seams and upholstery. Photograph damage that could change the work needed." },
    { id: "general-damp", label: "Moisture and odors", help: "Look and smell for moisture damage, pest signs and persistent odors." },
    { id: "general-fit", label: "Size and transport", help: "Measure the item, doorways and vehicle opening before arranging collection." },
  ] },
};

export interface InspectionDraft {
  kind: InspectionKind;
  label: string;
  notes: string;
  answers: Partial<Record<string, InspectionAnswer>>;
}
export function buildInspectionNotes(draft: InspectionDraft): string {
  const guide = INSPECTION_GUIDES[draft.kind];
  const observed = guide.checks.some(check => draft.answers[check.id] === "okay" || draft.answers[check.id] === "issue");
  if (!observed && !draft.label.trim() && !draft.notes.trim()) return "";
  const groups = ([
    ["okay", "Looked OK to me"], ["issue", "Issue found"], ["unchecked", "Not checked"],
  ] as const).map(([answer, title]) => {
    const checks = guide.checks.filter(check => (draft.answers[check.id] ?? "unchecked") === answer);
    return checks.length ? `${title}: ${checks.map(check => check.label.toLowerCase()).join(", ")}.` : "";
  });
  return [
    `My ${guide.name.toLowerCase()} inspection. Model/version not verified.`,
    draft.label.trim() && `Label text I can read: ${draft.label.trim()}`,
    ...groups,
    draft.notes.trim() && `My notes: ${draft.notes.trim()}`,
  ].filter(Boolean).join("\n");
}

export function appendInspectionNotes(description: string, notes: string): { value: string; error: string | null } {
  if (!notes || description.includes(notes)) return { value: description, error: null };
  // Preserve the original description exactly; never shorten or replace it.
  const value = description + (description ? "\n\n" : "") + notes;
  return value.length <= 500 ? { value, error: null } : {
    value: description,
    error: `These notes would put your description ${value.length - 500} characters over its 500-character limit. Shorten the description or the notes first. Nothing has been replaced.`,
  };
}
