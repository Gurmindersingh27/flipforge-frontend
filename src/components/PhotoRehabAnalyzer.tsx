import { useRef, useState } from "react";
import { analyzePhotosForRehab } from "../lib/api";
import type { PhotoRehabAnalysisResponse } from "../lib/types";

interface PhotoRehabAnalyzerProps {
  onApply: (mid: number) => void;
  sqft?: number;
}

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 8;
const MAX_SIZE_BYTES = 3 * 1024 * 1024;

function fmt(n: number): string {
  if (n === 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function conditionColor(c: string): string {
  if (c === "light") return "border-emerald-500/40 text-emerald-200 bg-emerald-500/10";
  if (c === "medium") return "border-amber-500/40 text-amber-200 bg-amber-500/10";
  if (c === "heavy") return "border-red-500/40 text-red-200 bg-red-500/10";
  return "border-white/10 text-white/60 bg-white/5";
}

function severityColor(s: string): string {
  if (s === "critical") return "text-red-300";
  if (s === "moderate") return "text-amber-300";
  return "text-white/60";
}

const CATEGORY_LABELS: Record<string, string> = {
  kitchen: "Kitchen",
  bathrooms: "Bathrooms",
  flooring: "Flooring",
  paint_drywall: "Paint / Drywall",
  roof: "Roof",
  hvac: "HVAC",
  electrical: "Electrical",
  plumbing: "Plumbing",
  windows_exterior: "Windows / Exterior",
};

export default function PhotoRehabAnalyzer({ onApply, sqft: propSqft }: PhotoRehabAnalyzerProps) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [sqft, setSqft] = useState<number>(propSqft ?? 0);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PhotoRehabAnalysisResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const [showRooms, setShowRooms] = useState(false);
  const [showItems, setShowItems] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function validateFiles(incoming: File[]): string | null {
    if (incoming.length === 0) return "Select at least 1 photo.";
    if (incoming.length > MAX_PHOTOS) return `Maximum ${MAX_PHOTOS} photos. You selected ${incoming.length}.`;
    for (const f of incoming) {
      if (!ALLOWED_TYPES.has(f.type)) return `"${f.name}" is not a supported image type. Use JPEG, PNG, or WEBP.`;
      if (f.size > MAX_SIZE_BYTES) return `"${f.name}" exceeds 3MB (${(f.size / 1024 / 1024).toFixed(1)}MB).`;
    }
    return null;
  }

  function onFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    const err = validateFiles(selected);
    if (err) {
      setError(err);
      setFiles([]);
      return;
    }
    setError("");
    setFiles(selected);
    setResult(null);
    setApplied(false);
  }

  function removeFile(idx: number) {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  }

  async function onAnalyze() {
    setError("");
    setResult(null);
    setApplied(false);

    const err = validateFiles(files);
    if (err) { setError(err); return; }

    try {
      setLoading(true);
      const res = await analyzePhotosForRehab({
        photos: files,
        sqft: sqft > 0 ? sqft : undefined,
        user_notes: notes.trim() || undefined,
      });
      setResult(res);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Photo analysis failed.";
      if (msg.includes("503") || msg.includes("ai_not_configured")) {
        setError("AI analysis is not configured on the server. Contact admin.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleApply() {
    if (!result) return;
    onApply(result.totals.mid);
    setApplied(true);
  }

  if (!open) {
    return (
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-xs text-amber-400/80 hover:text-amber-300 transition-colors underline underline-offset-2"
        >
          Analyze Photos for Rehab Estimate →
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold uppercase tracking-wide text-white/70">
          Photo Rehab Analyzer
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-white/40 hover:text-white/70 transition-colors"
        >
          x Close
        </button>
      </div>
      <div className="text-xs text-white/50 mb-4">
        Upload property photos to estimate visible rehab scope.
      </div>

      {/* File input */}
      <div className="space-y-3">
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={onFilesChange}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-dashed border-white/20 bg-white/[0.02] px-4 py-3 text-xs text-white/60 hover:border-white/40 hover:text-white/80 transition-colors w-full text-center"
          >
            {files.length > 0
              ? `${files.length} photo${files.length > 1 ? "s" : ""} selected - click to change`
              : "Click to select photos (JPEG, PNG, WEBP - max 8, max 3MB each)"}
          </button>
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-white/60">
                {f.name.length > 20 ? f.name.slice(0, 17) + "..." : f.name}
                <button type="button" onClick={() => removeFile(i)} className="text-white/30 hover:text-white/60 ml-0.5">x</button>
              </span>
            ))}
          </div>
        )}

        {/* Optional inputs */}
        <div className="flex flex-wrap gap-4">
          {propSqft == null && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400">Sqft</label>
              <input
                type="number"
                min={0}
                step={100}
                placeholder="e.g. 1,400"
                value={sqft === 0 ? "" : sqft}
                onChange={(e) => setSqft(e.target.value === "" ? 0 : Math.max(0, Number(e.target.value)))}
                className="w-28 rounded-lg bg-slate-900 border border-white/10 px-2 py-1 text-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <label className="text-xs text-slate-400 whitespace-nowrap">Notes</label>
            <input
              type="text"
              placeholder="Optional context..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg bg-slate-900 border border-white/10 px-2 py-1 text-sm"
            />
          </div>
        </div>

        {/* Analyze button */}
        <button
          type="button"
          onClick={onAnalyze}
          disabled={loading || files.length === 0}
          className="rounded-xl px-4 py-2 text-sm font-semibold border border-white/[0.15] bg-white/[0.08] text-white hover:bg-white/[0.12] transition-colors disabled:bg-white/[0.04] disabled:text-white/40 disabled:cursor-not-allowed"
        >
          {loading ? `Analyzing ${files.length} photo${files.length > 1 ? "s" : ""}...` : "Analyze Photos"}
        </button>

        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>

      {/* Results */}
      {result && (
        <div className="mt-4 space-y-4">
          {/* Provider status warnings */}
          {result.provider_status === "dev_stub" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Demo/stub data - real AI analysis is not active. Results are sample data only.
            </div>
          )}
          {result.provider_status === "ai_not_configured" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              AI analysis is not configured on the server. These are not real results.
            </div>
          )}
          {result.provider_status === "ai_error" && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
              AI analysis encountered an error. Please try again.
            </div>
          )}

          {/* Summary row */}
          <div className="flex flex-wrap items-center gap-3">
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${conditionColor(result.overall_condition)}`}>
              {result.overall_condition.toUpperCase()}
            </span>
            <span className="text-xs text-white/50">
              Confidence: {result.confidence_score}/100
            </span>
            <span className="text-xs text-white/40">
              {result.photos_analyzed} photo{result.photos_analyzed !== 1 ? "s" : ""} analyzed
            </span>
          </div>

          <div className="text-sm text-white/80">{result.summary}</div>

          {/* Totals */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="text-xs uppercase tracking-wide text-white/50 mb-2">Rehab Estimate</div>
            <div className="flex items-end justify-between gap-4">
              <div className="text-center">
                <div className="text-xs text-white/40">Low</div>
                <div className="text-sm tabular-nums text-white/60">{fmt(result.totals.low)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-white/40">Mid</div>
                <div className="text-lg font-bold tabular-nums text-amber-300">{fmt(result.totals.mid)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-white/40">High</div>
                <div className="text-sm tabular-nums text-white/60">{fmt(result.totals.high)}</div>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-white/5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/40">
              <span>Subtotal: {fmt(result.totals.subtotal_low)} - {fmt(result.totals.subtotal_high)}</span>
              <span>Contingency: {result.totals.contingency_pct}%</span>
            </div>
          </div>

          {/* Missing photo warnings */}
          {result.missing_photo_warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="text-xs font-semibold text-amber-200/80 mb-1">Missing Coverage</div>
              {result.missing_photo_warnings.map((w, i) => (
                <div key={i} className="text-xs text-amber-200/60">{w}</div>
              ))}
            </div>
          )}

          {/* Risk flags */}
          {result.risk_flags.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-semibold text-white/50">Risk Flags</div>
              {result.risk_flags.map((f, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`font-semibold ${severityColor(f.severity)}`}>{f.label}</span>
                  <span className="text-white/40">{f.explanation}</span>
                </div>
              ))}
            </div>
          )}

          {/* Rehab line items (collapsible) */}
          {result.rehab_items.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowItems((v) => !v)}
                className="text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                {showItems ? "Hide line items" : "Show line items"} ({result.rehab_items.length})
              </button>
              {showItems && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-white/40 border-b border-white/10">
                        <th className="text-left pb-1 pr-3 font-normal">Category</th>
                        <th className="pb-1 font-normal text-center">Severity</th>
                        <th className="pb-1 font-normal text-right">Low</th>
                        <th className="pb-1 font-normal text-right">Mid</th>
                        <th className="pb-1 font-normal text-right">High</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rehab_items.map((item, i) => (
                        <tr key={i} className="border-b border-white/5">
                          <td className="py-1.5 pr-3 text-white/70">{CATEGORY_LABELS[item.category] || item.category}</td>
                          <td className="py-1.5 text-center text-white/50">{item.severity}</td>
                          <td className="py-1.5 text-right tabular-nums text-white/40">{fmt(item.low)}</td>
                          <td className="py-1.5 text-right tabular-nums text-white/70 font-medium">{fmt(item.mid)}</td>
                          <td className="py-1.5 text-right tabular-nums text-white/40">{fmt(item.high)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Room findings (collapsible) */}
          {result.rooms.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowRooms((v) => !v)}
                className="text-xs text-white/50 hover:text-white/80 transition-colors"
              >
                {showRooms ? "Hide room findings" : "Show room findings"} ({result.rooms.length})
              </button>
              {showRooms && (
                <div className="mt-2 space-y-2">
                  {result.rooms.map((room, i) => (
                    <div key={i} className="rounded-lg border border-white/5 bg-white/[0.02] p-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-white/70 capitalize">{room.area_name}</span>
                        <span className={`inline-flex rounded-full px-1.5 py-0 text-[10px] border ${conditionColor(room.detected_condition)}`}>
                          {room.detected_condition}
                        </span>
                      </div>
                      {room.visible_issues.length > 0 && (
                        <div className="mt-1 text-[11px] text-white/50">
                          {room.visible_issues.join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          {result.notes.length > 0 && (
            <div className="space-y-0.5">
              {result.notes.map((n, i) => (
                <div key={i} className="text-[11px] text-white/40">{n}</div>
              ))}
            </div>
          )}

          {/* Disclaimer */}
          <p className="text-[11px] text-white/30 leading-relaxed">{result.disclaimer}</p>

          {/* Apply button */}
          <div>
            <button
              type="button"
              onClick={handleApply}
              disabled={applied || result.totals.mid === 0}
              className="rounded-xl px-4 py-2 text-sm font-semibold bg-[#E8C547] text-slate-900 shadow-sm shadow-[#E8C547]/20 hover:bg-[#d4b33e] active:scale-95 transition-all duration-150 disabled:bg-[#E8C547]/35 disabled:text-[#F6E27A]/70 disabled:cursor-not-allowed"
            >
              {applied
                ? `Applied ${fmt(result.totals.mid)} as Rehab Budget`
                : `Use Mid as Rehab Budget - ${fmt(result.totals.mid)}`}
            </button>
            {result.totals.mid === 0 && !applied && (
              <div className="mt-1 text-[11px] text-white/40">
                Mid estimate is $0. Provide more photos or sqft for a useful estimate.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
