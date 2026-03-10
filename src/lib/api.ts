import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DraftDeal,
  DraftFromUrlResponse,
} from "./types";

/**
 * API base URL resolution:
 * - Vercel/Prod: set VITE_API_BASE_URL (e.g. https://flipforge-api.onrender.com)
 * - Local fallback: http://127.0.0.1:8000
 */
const API_BASE_URL = (() => {
  const raw =
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
    "http://127.0.0.1:8000";
  // normalize: remove trailing slash
  return raw.replace(/\/+$/, "");
})();

/**
 * Optional fetch helper:
 * - Adds timeout to avoid infinite hangs
 * - Keeps code minimal and predictable
 */
async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 30_000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
      // If you ever use cookies/auth later, uncomment this:
      // credentials: "include",
    });
  } finally {
    clearTimeout(id);
  }
}

// OLD — keep exactly as-is
export async function analyzeDeal(
  payload: AnalyzeRequest
): Promise<AnalyzeResponse> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/analyze`, {
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
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/draft-from-url`, {
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
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/finalize-and-analyze`, {
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

/**
 * NEW — Export Lender Report PDF
 * Assumes backend has an endpoint like:
 *   POST /api/lender-report/pdf
 * that returns application/pdf
 *
 * If your backend route is different, change only the URL string below.
 */
export async function exportLenderReportPdf(
  payload: AnalyzeRequest
): Promise<Blob> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/lender-report/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PDF API error ${res.status}: ${text || "(no body)"}`);
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/pdf")) {
    // Sometimes an error returns JSON/HTML with 200; catch it.
    const text = await res.text().catch(() => "");
    throw new Error(
      `PDF endpoint did not return PDF. content-type=${contentType}. body=${text.slice(
        0,
        500
      )}`
    );
  }

  return res.blob();
}
