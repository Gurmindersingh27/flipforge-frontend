// Only a request UUID is retained. Photos, tokens, inputs and evidence stay out
// of storage. Access is best effort because browsers can disable sessionStorage.
const prefix = "flipforge:item-assessment:";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function readAssessmentRecovery(userId: string): string | null {
  try {
    const value = sessionStorage.getItem(prefix + userId);
    if (value === null) return null;
    if (uuid.test(value)) return value;
    sessionStorage.removeItem(prefix + userId);
  } catch { /* Recovery is optional; retain the in-memory flow. */ }
  return null;
}

export function rememberAssessment(userId: string, id: string): boolean {
  if (!uuid.test(id)) return false;
  try {
    sessionStorage.setItem(prefix + userId, id);
    return true;
  } catch { return false; }
}

export function clearAssessmentRecovery(userId: string, expectedId?: string): void {
  try {
    // A stale callback must not clear a newer request or an unrelated saved find.
    if (expectedId !== undefined && sessionStorage.getItem(prefix + userId) !== expectedId) return;
    sessionStorage.removeItem(prefix + userId);
  } catch { /* Disabled storage must not break sign-out, saving or estimating. */ }
}
