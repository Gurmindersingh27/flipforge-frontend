import type { AnalyzeResponse, Verdict } from "../lib/types";

interface Props {
  result: AnalyzeResponse;
  purchasePrice: number | null;
  photoRehabMid?: number | null;
}

function verdictRank(v: Verdict | string): number {
  if (v === "BUY") return 2;
  if (v === "CONDITIONAL") return 1;
  return 0;
}

export default function DealKillerSummary({ result, purchasePrice, photoRehabMid }: Props) {
  const bullets: string[] = [];

  // Priority 1 - purchase price above max safe offer
  if (
    purchasePrice !== null &&
    purchasePrice > 0 &&
    result.max_safe_offer > 0 &&
    purchasePrice > result.max_safe_offer
  ) {
    bullets.push(
      "Purchase price is above the max safe offer — the deal does not pencil at the current price. See Offer Safety for the gap."
    );
  }

  // Priority 2 - negative net profit
  if (bullets.length < 3 && result.net_profit <= 0) {
    const loss = Math.abs(result.net_profit).toLocaleString();
    bullets.push(`This deal loses money. Net profit is -$${loss} at current assumptions.`);
  }

  // Priority 3 - thin profit margin (below 15%)
  if (bullets.length < 3 && result.net_profit > 0 && result.profit_pct < 0.15) {
    const pct = (result.profit_pct * 100).toFixed(1);
    bullets.push(`Profit margin is thin at ${pct}%. Below 15% leaves no room for surprises.`);
  }

  // Priority 4 - stress test downgrade
  if (bullets.length < 3 && result.stress_tests?.length > 0) {
    const baseVerdict = result.stress_tests[0].verdict;
    const baseRank = verdictRank(baseVerdict);
    const downgraded = result.stress_tests
      .slice(1)
      .find((s) => verdictRank(s.verdict) < baseRank);
    if (downgraded) {
      bullets.push(
        `The deal weakens under stress. If ${downgraded.name}, the numbers no longer work.`
      );
    }
  }

  // Priority 5 - critical or moderate risk flags
  if (bullets.length < 3) {
    const critOrMod = result.typed_flags?.find(
      (f) => f.severity === "critical" || f.severity === "moderate"
    );
    if (critOrMod) {
      bullets.push(`Risk flag: ${critOrMod.label}`);
    } else if ((result.risk_flags?.length ?? 0) > 0) {
      bullets.push(`Risk flag: ${result.risk_flags[0]}`);
    }
  }

  // Priority 6 - low confidence
  if (bullets.length < 3 && result.confidence_score < 60) {
    bullets.push(
      `Confidence is low at ${result.confidence_score}/100. Key assumptions are unverified.`
    );
  }

  // Priority 7 - photo rehab uncertainty
  if (bullets.length < 3 && photoRehabMid != null && photoRehabMid > 0) {
    const mid = photoRehabMid.toLocaleString();
    bullets.push(
      `Rehab needs verification. Current math uses about $${mid} in rehab, but photos did not confirm roof, HVAC, electrical, plumbing, attic, or crawlspace. Do not waive inspection.`
    );
  }

  // Return null on a clean BUY with no qualifying issues
  if (bullets.length === 0) return null;

  const verdict = result.overall_verdict;
  const title =
    verdict === "PASS"
      ? "What Kills This Deal"
      : verdict === "CONDITIONAL"
      ? "What Makes This Risky"
      : "What Could Still Go Wrong";

  const borderColor =
    verdict === "PASS"
      ? "border-red-500/30 bg-red-500/[0.07]"
      : verdict === "CONDITIONAL"
      ? "border-amber-500/30 bg-amber-500/[0.07]"
      : "border-white/[0.08] bg-white/[0.04]";

  const titleColor =
    verdict === "PASS"
      ? "text-red-300"
      : verdict === "CONDITIONAL"
      ? "text-amber-300"
      : "text-white/80";

  return (
    <section className={`rounded-2xl border ${borderColor} p-6`}>
      <h3 className={`font-serif-display text-base font-semibold mb-3 ${titleColor}`}>
        {title}
      </h3>
      <ul className="list-disc pl-5 space-y-2 text-sm text-white/85 leading-relaxed">
        {bullets.slice(0, 3).map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </section>
  );
}
