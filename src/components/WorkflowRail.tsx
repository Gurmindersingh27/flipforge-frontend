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
      className={`ff-panel rounded-2xl px-4 py-4 ${className}`}
    >
      <div className="mb-3 ff-kicker text-xs font-semibold uppercase tracking-widest">
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
                <span className="inline-flex h-6 w-6 items-center justify-center ff-step rounded-full text-xs font-bold">
                  {i + 1}
                </span>
                <span className="text-sm font-semibold text-white">
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
                className="mx-1 hidden h-px flex-1 bg-white/10 md:block"
              />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
