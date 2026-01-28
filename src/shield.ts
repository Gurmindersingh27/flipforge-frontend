export const SHIELD = {
  verdicts: {
    BUY: {
      label: "BUY",
      subtitle: "Numbers look solid. Move to comps + scope validation.",
      borderClass: "border-emerald-600/40",
      textClass: "text-emerald-300",
      dotClass: "bg-emerald-400",
    },
    CONDITIONAL: {
      label: "CONDITIONAL",
      subtitle: "Close, but something’s tight. Validate assumptions before offering.",
      borderClass: "border-amber-600/40",
      textClass: "text-amber-300",
      dotClass: "bg-amber-400",
    },
    PASS: {
      label: "PASS",
      subtitle: "Doesn’t meet your safety margin. Don’t force it.",
      borderClass: "border-red-600/40",
      textClass: "text-red-300",
      dotClass: "bg-red-400",
    },
  },
} as const;
