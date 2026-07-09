import type { AnalyzeResponse } from "../lib/types";

interface Props {
  result: AnalyzeResponse;
  purchasePrice: number | null;
}

export default function InvestorActionPlan({ result, purchasePrice }: Props) {
  const actions: string[] = [];
  const mao = result.max_safe_offer;
  const verdict = result.overall_verdict;

  // Priority 1 - overpay delta (only when purchasePrice is known and exceeds MAO)
  if (purchasePrice !== null && purchasePrice > 0 && mao > 0 && purchasePrice > mao) {
    actions.push(
      `Do not offer above $${mao.toLocaleString()} — negotiate down or walk.`
    );
  }

  // Priority 2 - verdict action (always fires, exactly one branch)
  if (verdict === "PASS") {
    actions.push(
      `Walk unless the seller accepts $${mao.toLocaleString()} or lower. At current terms this deal does not pencil.`
    );
  } else if (verdict === "CONDITIONAL") {
    actions.push(
      "Verify your ARV, rehab budget, and financing assumptions before going under contract."
    );
  } else {
    actions.push(
      "Proceed — but confirm rehab scope, ARV, and inspection findings before committing funds."
    );
  }

  // Priority 3 - low confidence
  if (actions.length < 5 && result.confidence_score < 60) {
    actions.push(
      `Confidence is ${result.confidence_score}/100. Validate ARV and rehab budget with local comps before making an offer.`
    );
  }

  // Priority 4 - always: major systems access
  if (actions.length < 5) {
    actions.push(
      "Request access to the crawlspace, attic, roof, HVAC, electrical panel, and plumbing before your final offer."
    );
  }

  // Priority 5 - always: do not waive inspection
  if (actions.length < 5) {
    actions.push("Do not waive inspection.");
  }

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-white/[0.04] p-6">
      <h3 className="font-serif-display text-base font-semibold text-white mb-3">
        Investor Action Plan
      </h3>
      <ol className="list-decimal pl-5 space-y-2 text-sm text-white/85 leading-relaxed">
        {actions.slice(0, 5).map((a, i) => (
          <li key={i}>{a}</li>
        ))}
      </ol>
    </section>
  );
}
