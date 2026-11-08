import { formatItemMoney } from "./itemAnalysis.ts";
import { isItemOutcome, OUTCOME_LABELS } from "./itemOutcomes.ts";
import type { ItemOutcomeField, ItemProjectListResponse, ItemProjectResponse, ItemProjectStage, OutcomeExplanation } from "./types.ts";

export const PROJECT_STAGES: ItemProjectStage[] = ["considering", "bought", "listed", "sold"];
export const PROJECT_STAGE_LABELS: Record<ItemProjectStage, string> = {
  considering: "Considering", bought: "Bought", listed: "Listed", sold: "Sold",
};
export const RESALE_SOURCE_LABELS = {
  assessment: "Online listing asks", national_reference: "National shipped listing asks",
  user_estimate: "Entered by you", unknown: "Source not recorded",
};
export function projectRange(low: number | null | undefined, high: number | null | undefined, unknown = "Not available"): string {
  if (low == null || high == null) return unknown;
  return low === high ? formatItemMoney(low) : `${formatItemMoney(low)} to ${formatItemMoney(high)}`;
}
export function projectMissing(fields: ItemOutcomeField[]): string {
  return fields.map(field => field === "status" ? "sale not recorded" : `${OUTCOME_LABELS[field].toLowerCase()} not recorded`).join("; ");
}
export function projectHeadline(explanation: OutcomeExplanation): string | null {
  // Preserve the server's decision about whether a dominant cause exists.
  return explanation.headline?.replace("came from value of your time", "came from the value of your time") ?? null;
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const id = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
function summary(value: unknown): boolean {
  return record(value) && id(value.root_item_id) && id(value.version_count)
    && PROJECT_STAGES.includes(value.stage as ItemProjectStage) && typeof value.updated_at === "string"
    && Number.isFinite(Date.parse(value.updated_at)) && record(value.latest_version)
    && id(value.latest_version.id) && value.latest_version.root_item_id === value.root_item_id
    && value.latest_version.schema_version === 1 && record(value.latest_version.analysis_result)
    && record(value.latest_version.inputs) && (value.calculated === null || record(value.calculated));
}
export function isItemProjectList(value: unknown, limit: number, offset: number): value is ItemProjectListResponse {
  return record(value) && value.limit === limit && value.offset === offset && Array.isArray(value.items)
    && value.items.length <= limit && value.items.every(summary)
    && new Set(value.items.map(item => item.root_item_id)).size === value.items.length
    && (value.next_offset === null || value.next_offset === offset + limit);
}
export function isItemProject(value: unknown, rootId: number): value is ItemProjectResponse {
  if (!record(value) || !summary(value.summary) || !record(value.summary) || value.summary.root_item_id !== rootId
    || !Array.isArray(value.versions) || value.versions.length !== value.summary.version_count
    || !value.versions.every(version => record(version) && id(version.id) && version.root_item_id === rootId
      && version.schema_version === 1 && record(version.inputs) && record(version.analysis_result))
    || new Set(value.versions.map(version => version.id)).size !== value.versions.length
    || value.versions[0]?.id !== (value.summary.latest_version as { id: number }).id) return false;
  if (!(value.latest_outcome === null || isItemOutcome(value.latest_outcome, rootId))) return false;
  if (value.summary.stage !== (value.latest_outcome === null ? "considering" : value.latest_outcome.inputs.status)) return false;
  if (value.comparison === null) return ["No outcome recorded", "No estimate linked", "The estimate was incomplete"].includes(String(value.comparison_unavailable_reason));
  const comparison = value.comparison;
  return record(comparison) && record(comparison.original_estimate)
    && value.latest_outcome !== null && value.comparison_unavailable_reason === null
    && comparison.original_estimate.id === value.latest_outcome.based_on_item_id
    && comparison.original_estimate.root_item_id === rootId
    && value.versions.some(version => version.id === (comparison.original_estimate as { id: number }).id)
    && Array.isArray(comparison.lines) && record(comparison.actual);
}
