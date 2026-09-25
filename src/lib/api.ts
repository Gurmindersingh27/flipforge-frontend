import type {
  AnalyzeRequest,
  AnalyzeResponse,
  DraftDeal,
  DraftFromUrlResponse,
  EnrichAddressResponse,
  NegotiationScriptRequest,
  NegotiationScriptResponse,
  PhotoRehabAnalysisResponse,
  SaveDealRequest,
  SavedDeal,
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
  timeoutMs = 60_000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort("timeout"), timeoutMs);

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

// First requests can include service startup. Keep the deadline active while
// consuming the response body, and never replay requests automatically.
async function withStartupDeadline<T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMessage: string
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const result = await request(controller.signal);
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    return result;
  } catch (error: unknown) {
    if (controller.signal.aborted) throw new Error(timeoutMessage);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeDeal(
  payload: AnalyzeRequest
): Promise<AnalyzeResponse> {
  return withStartupDeadline(async (signal) => {
    const res = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status}: ${text}`);
    }

    return await res.json();
  }, "Analysis took too long. Your inputs are still here. Try generating the memo again.");
}

// NEW — Draft from URL
export async function draftFromUrl(url: string): Promise<DraftDeal> {
  return withStartupDeadline(async (signal) => {
    const res = await fetch(`${API_BASE_URL}/api/draft-from-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Draft API error ${res.status}: ${text}`);
    }

    // backend wraps { draft: DraftDeal }
    const data: DraftFromUrlResponse = await res.json();
    return data.draft;
  }, "Fetching the draft took too long. Try Fetch Draft again or enter the numbers manually.");
}

// NEW — Finalize + Analyze (handles 422 missing_fields)
export async function finalizeAndAnalyze(
  draft: DraftDeal
): Promise<
  | { ok: true; result: AnalyzeResponse }
  | { ok: false; missing_fields: string[] }
> {
  return withStartupDeadline(async (signal) => {
    const res = await fetch(`${API_BASE_URL}/api/finalize-and-analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
      signal,
    });

    const data = await res.json().catch((error: unknown) => {
      if (signal.aborted || res.ok) throw error;
      return {};
    });

    if (res.status === 422) {
      const missing =
        (data?.missing_fields as string[] | undefined) ??
        (data?.detail?.missing_fields as string[] | undefined) ??
        [];
      return { ok: false as const, missing_fields: Array.isArray(missing) ? missing : [] };
    }

    if (!res.ok) {
      throw new Error(`Finalize API error ${res.status}: ${JSON.stringify(data)}`);
    }

    return { ok: true as const, result: data as AnalyzeResponse };
  }, "Analysis took too long. Your inputs are still here. Try generating the memo again.");
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
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/export/lender-report`, {
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

// NEW — Generate Negotiation Script
export async function generateNegotiationScript(
  payload: NegotiationScriptRequest
): Promise<NegotiationScriptResponse> {
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/generate/negotiation-script`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Script API error ${res.status}: ${text || "(no body)"}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Saved Deals — auth-gated. Caller must supply a Clerk session token.
// Obtain via: const { getToken } = useAuth(); const token = await getToken();
// ---------------------------------------------------------------------------

export class UnconfirmedSaveError extends Error {
  constructor() {
    super("Save confirmation was not received. This deal may already be saved. Check Saved Deals before creating another version.");
    this.name = "UnconfirmedSaveError";
  }
}

export async function saveDeal(
  payload: SaveDealRequest,
  token: string
): Promise<SavedDeal> {
  let rejectedStatus: number | null = null;
  let rejectionBody = "";
  try {
    return await withStartupDeadline(async (signal) => {
      const res = await fetch(`${API_BASE_URL}/api/deals/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        // A client rejection is known not to be a successful save. A server
        // failure or lost response cannot establish whether the write committed.
        if (res.status >= 400 && res.status < 500) rejectedStatus = res.status;
        rejectionBody = await res.text();
        throw new Error("Save rejected");
      }
      const saved: SavedDeal = await res.json();
      if (!saved || !Number.isInteger(saved.id) || saved.id <= 0) {
        throw new UnconfirmedSaveError();
      }
      return saved;
    }, "Save confirmation took too long.");
  } catch {
    if (rejectedStatus !== null) {
      throw new Error(`Save deal error ${rejectedStatus}: ${rejectionBody || "(no body)"}`);
    }
    throw new UnconfirmedSaveError();
  }
}

// A first read may include service startup. Bound the whole response, including
// its body, and leave retries to the user. Save requests do not use this helper.
async function readSavedDeal<T>(path: string, token: string, errorLabel: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${errorLabel} ${res.status}: ${text || "(no body)"}`);
    }
    return await res.json();
  } catch (error: unknown) {
    if (controller.signal.aborted) {
      throw new Error("Loading saved deals took too long. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDeals(token: string): Promise<SavedDeal[]> {
  return readSavedDeal<SavedDeal[]>("/api/deals", token, "Get deals error");
}

export async function getDeal(id: number, token: string): Promise<SavedDeal> {
  return readSavedDeal<SavedDeal>(`/api/deals/${id}`, token, "Get deal error");
}

// ---------------------------------------------------------------------------
// Address enrichment — RentCast passthrough
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Photo Rehab Analyzer — multipart/form-data (no manual Content-Type)
// ---------------------------------------------------------------------------

export async function analyzePhotosForRehab(params: {
  photos: File[];
  sqft?: number;
  region?: string;
  property_type?: string;
  user_notes?: string;
}): Promise<PhotoRehabAnalysisResponse> {
  const formData = new FormData();
  for (const photo of params.photos) {
    formData.append("photos", photo);
  }
  if (params.sqft != null) formData.append("sqft", String(params.sqft));
  if (params.region) formData.append("region", params.region);
  if (params.property_type) formData.append("property_type", params.property_type);
  if (params.user_notes) formData.append("user_notes", params.user_notes);

  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/photo-rehab-analysis`,
    { method: "POST", body: formData },
    120_000,
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Photo rehab error ${res.status}: ${text || "(no body)"}`);
  }

  return res.json();
}

// ---------------------------------------------------------------------------
// Address enrichment — RentCast passthrough
// ---------------------------------------------------------------------------

export async function enrichAddress(
  address: string
): Promise<EnrichAddressResponse> {
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/enrich-address`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Enrich API error ${res.status}: ${text || "(no body)"}`);
  }

  return res.json();
}
