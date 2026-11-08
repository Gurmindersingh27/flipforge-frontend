import { INSPECTION_GUIDES } from "./itemInspection.ts";
import type { ItemInspectionFacts, ItemInspectionKind, ItemInspectionResponse, SaveItemInspectionRequest } from "./types.ts";

const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const inspectionTextLength = (text: string) => Array.from(text).length;
const text = (v: unknown, limit: number) => v === null || (typeof v === "string" && !v.includes("\0") && inspectionTextLength(v) <= limit);
export function inspectionDate(v: unknown): boolean {
  if (v === null) return true;
  if (typeof v !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const time = Date.parse(v + "T00:00:00Z");
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === v;
}
export function emptyInspection(kind: ItemInspectionKind = "general"): ItemInspectionFacts {
  return { guide_version: "furniture-v1", kind, brand_hint: null, label_text: null, notes: null, inspected_on: null,
    answers: Object.fromEntries(INSPECTION_GUIDES[kind].checks.map(check => [check.id, "unchecked"])) };
}
export function isInspectionFacts(value: unknown): value is ItemInspectionFacts {
  if (!record(value) || value.guide_version !== "furniture-v1" || !["chair", "storage", "general"].includes(value.kind as string)
    || !text(value.label_text, 500) || !text(value.notes, 5000) || !inspectionDate(value.inspected_on)
    || ![null, "herman_miller", "steelcase"].includes(value.brand_hint as string | null)
    || (value.kind !== "chair" && value.brand_hint !== null) || !record(value.answers)) return false;
  const ids = INSPECTION_GUIDES[value.kind as ItemInspectionKind].checks.map(check => check.id);
  return Object.keys(value).length === 7 && Object.keys(value.answers).length === ids.length
    && ids.every(id => ["unchecked", "okay", "issue"].includes((value.answers as Record<string, unknown>)[id] as string));
}
export function isItemInspection(value: unknown, rootId: number): value is ItemInspectionResponse {
  return record(value) && uuid(value.id) && value.root_item_id === rootId && Number.isSafeInteger(rootId) && rootId > 0
    && value.schema_version === 1 && value.source === "user_reported" && Number.isSafeInteger(value.revision_number)
    && (value.revision_number as number) > 0
    && (value.revision_number === 1 ? value.previous_id === null : uuid(value.previous_id) && value.previous_id !== value.id)
    && typeof value.created_at === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|\+00:00)$/.test(value.created_at)
    && inspectionDate(value.created_at.slice(0, 10)) && Number.isFinite(Date.parse(value.created_at))
    && isInspectionFacts(value.inputs);
}
export function sameInspection(a: ItemInspectionFacts, b: ItemInspectionFacts): boolean {
  return a.guide_version === b.guide_version && a.kind === b.kind && a.brand_hint === b.brand_hint
    && a.label_text === b.label_text && a.notes === b.notes && a.inspected_on === b.inspected_on
    && Object.keys(a.answers).length === Object.keys(b.answers).length
    && Object.keys(a.answers).every(key => a.answers[key] === b.answers[key]);
}
export function inspectionErrors(facts: ItemInspectionFacts): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const [key, limit] of [["label_text", 500], ["notes", 5000]] as const) {
    if (!text(facts[key], limit)) errors[key] = `Use at most ${limit.toLocaleString()} characters, without NUL characters.`;
  }
  if (!inspectionDate(facts.inspected_on)) errors.inspected_on = "Enter a real date in YYYY-MM-DD format, or leave it blank.";
  if (!isInspectionFacts(facts) && !Object.keys(errors).length) errors.answers = "Check the inspection category and answers.";
  return errors;
}
/** Detached and frozen once: every retry (including auth refresh) reuses this object. */
export function captureInspection(facts: ItemInspectionFacts, predecessor: string | null, requestId: string): SaveItemInspectionRequest {
  if (!isInspectionFacts(facts) || !uuid(requestId) || !(predecessor === null || uuid(predecessor))) throw new Error("Check the inspection before saving.");
  return Object.freeze({ ...facts, answers: Object.freeze({ ...facts.answers }), expected_previous_id: predecessor, request_id: requestId });
}
