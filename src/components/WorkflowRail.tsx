// WorkflowRail — presentational only.
// Renders the FlipForge underwriting flow as a static visual rail:
// Property -> Photos/Rehab -> Deal Assumptions -> Analyze -> Investor Memo.
// This is NOT a stepper. There is no currentStep/activeStep state, no gating,
// no locked/unlocked sections, and no routing. It is a visual map of the page.

type RailStep = {
  label: string;
  hint: string;
};

const STEPS: RailStep[] = [
  { label: "Property", hint: "Address or listing URL" },
  { label: "Photos / Rehab Intelligence", hint: "Estimate visible scope" },
  { label: "Deal Assumptions", hint: "Numbers, financing, criteria" },
  { label: "Generate Investor Memo", hint: "Run the underwriting" },
  { label: "Investor Memo Results", hint: "Verdict, offer, risk" },
];

export default function WorkflowRail({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-amber-500/20 bg-black/40 px-4 py-4 ${className}`}
    >
      <div className="mb-3 text-xs font-semibold uppercase tracking-widest text-amber-300/80">
        Underwriting Flow
      </div>
      <ol className="flex items-stretch gap-2 overflow-x-auto">
        {STEPS.map((step, i) => (
          <li
            key={step.label}
            className="flex min-w-40 flex-1 items-center gap-3"
          >
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/10 text-xs font-bold text-amber-300">
                  {i + 1}
                </span>
                <span className="whitespace-nowrap text-sm font-semibold text-white">
                  {step.label}
                </span>
              </div>
              <span className="mt-1 pl-8 text-xs text-white/50">
                {step.hint}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="mx-1 hidden h-px flex-1 bg-gradient-to-r from-amber-400/40 to-transparent md:block"
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
