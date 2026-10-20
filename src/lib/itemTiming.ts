export const ITEM_TIMING_LABELS = {
  availability_first_ms: "First availability check",
  availability_latest_ms: "Latest availability check",
  photo_prepare_ms: "Photo preparation",
  assessment_ms: "Estimate request",
  status_ms: "Status check",
} as const;

type TimingKey = keyof typeof ITEM_TIMING_LABELS;
type TimingKind = "availability" | "photo" | "assessment" | "status";
export type ItemTimings = Partial<Record<TimingKey, number>>;
type TimingClock = {
  now: () => number;
  measure: (name: string, options: { start: number; duration: number }) => unknown;
  clearMeasures: (name: string) => void;
};
const keys = Object.keys(ITEM_TIMING_LABELS) as TimingKey[];
const name = (key: TimingKey) => `flipforge.items.${key}`;

// One recorder per editor; nothing is persisted or sent to an endpoint.
export function createItemTiming(onChange: (values: ItemTimings) => void, clock: () => TimingClock = () => performance) {
  let values: ItemTimings = {};
  let generation = 0;
  let active = false;
  let firstAvailability = true;
  let attempts: Partial<Record<TimingKind, number>> = {};
  function clear() {
    for (const key of keys) {
      try { clock().clearMeasures(name(key)); } catch { /* Optional diagnostics. */ }
    }
  }
  function publish() {
    try { onChange({ ...values }); } catch { /* Never interrupt the item flow. */ }
  }
  return {
    activate() {
      generation++; active = true; values = {}; attempts = {}; firstAvailability = true;
      clear(); publish();
    },
    dispose() {
      generation++; active = false; values = {}; clear();
    },
    begin(kind: TimingKind): () => void {
      if (!active) return () => {};
      const current = generation;
      const attempt = attempts[kind] = (attempts[kind] ?? 0) + 1;
      const first = kind === "availability" && firstAvailability;
      if (kind === "availability") firstAvailability = false;
      let start: number;
      try { start = clock().now(); } catch { return () => {}; }
      let finished = false;
      return () => {
        if (finished || !active || generation !== current) return;
        finished = true;
        try {
          const end = clock().now();
          if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0) return;
          const elapsed = end - start;
          if (elapsed < 0 || elapsed > 600_000) return;
          const duration = Math.floor(elapsed);
          const record = (key: TimingKey) => {
            values[key] = duration;
            try {
              clock().clearMeasures(name(key));
              clock().measure(name(key), { start, duration });
            } catch { /* The phone panel still works if User Timing is unavailable. */ }
          };
          if (first) record("availability_first_ms");
          if (attempts[kind] === attempt) {
            if (kind === "availability") record("availability_latest_ms");
            else record(kind === "photo" ? "photo_prepare_ms" : kind === "assessment" ? "assessment_ms" : "status_ms");
          }
          publish();
        } catch { /* Clock or diagnostics failures cannot affect the request. */ }
      };
    },
  };
}
