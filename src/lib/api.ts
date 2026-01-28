import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DraftDeal,
  DraftFromUrlResponse,
} from "./types";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string) || "http://127.0.0.1:8000";

// OLD — keep exactly as-is
export async function analyzeDeal(
  payload: AnalyzeRequest
): Promise<AnalyzeResponse> {
  const res = await fetch(`${API_BASE_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

// NEW — Draft from URL
export async function draftFromUrl(url: string): Promise<DraftDeal> {
  const res = await fetch(`${API_BASE_URL}/api/draft-from-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Draft API error ${res.status}: ${text}`);
  }

  // backend wraps { draft: DraftDeal }
  const data: DraftFromUrlResponse = await res.json();
  return data.draft;
}

// NEW — Finalize + Analyze (handles 422 missing_fields)
export async function finalizeAndAnalyze(
  draft: DraftDeal
): Promise<
  | { ok: true; result: AnalyzeResponse }
  | { ok: false; missing_fields: string[] }
> {
  const res = await fetch(`${API_BASE_URL}/api/finalize-and-analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });

  const data = await res.json().catch(() => ({}));

  if (res.status === 422) {
    const missing =
      (data?.missing_fields as string[] | undefined) ??
      (data?.detail?.missing_fields as string[] | undefined) ??
      [];
    return { ok: false, missing_fields: Array.isArray(missing) ? missing : [] };
  }

  if (!res.ok) {
    throw new Error(`Finalize API error ${res.status}: ${JSON.stringify(data)}`);
  }

  return { ok: true, result: data as AnalyzeResponse };
}
