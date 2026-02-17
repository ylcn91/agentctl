
import {
  parseJSONFromLLM,
  collectFromAccounts,
  anonymizeForPeerReview,
} from "./council-framework";
import type { LLMCaller } from "./council-framework";
import type {
  VerificationVerdict,
  VerificationReview,
  PeerEvaluation,
  ReviewBundle,
  HandoffPayloadForVerification,
} from "./verification-council";

const VERIFICATION_STAGE1_PROMPT = `You are a code review expert verifying task completion. You will be given:
1. The task goal and acceptance criteria
2. A review bundle containing diffs, test results, and risk notes

Evaluate whether the task has been completed successfully. Respond with a JSON object:
- verdict: "ACCEPT" | "REJECT" | "ACCEPT_WITH_NOTES"
- confidence: number (0-1)
- reasoning: string (brief explanation)
- issues: string[] (problems found, empty if none)
- strengths: string[] (good aspects of the work)

Respond ONLY with valid JSON, no other text.`;

const VERIFICATION_STAGE2_PROMPT = `You are a peer reviewer evaluating task verification reviews. You will see multiple anonymized reviews (labeled Review A, Review B, etc.). Rank them from most thorough/accurate to least.

Respond with a JSON object:
- ranking: number[] (indices 0-based, sorted best-to-worst)
- reasoning: string

Respond ONLY with valid JSON, no other text.`;

const VERIFICATION_STAGE3_PROMPT = `You are the chairman of a verification council. You have received individual reviews and peer rankings for a task completion verification.

Produce a final verdict. Consider:
- The majority view across reviewers
- The quality of reasoning (weighted by peer rankings)
- Whether issues raised are genuine blockers or minor notes

Respond with a JSON object:
- verdict: "ACCEPT" | "REJECT" | "ACCEPT_WITH_NOTES"
- confidence: number (0-1)
- notes: string[] (actionable notes for the task author)
- reasoning: string (explanation of the final verdict)

Respond ONLY with valid JSON, no other text.`;

export function buildTaskContext(
  handoffPayload: HandoffPayloadForVerification,
  reviewBundle: ReviewBundle,
): string {
  const parts: string[] = [
    `Task Goal: ${handoffPayload.goal}`,
    `Acceptance Criteria:\n${handoffPayload.acceptance_criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}`,
  ];

  if (reviewBundle.diff) {
    parts.push(`Diff:\n${reviewBundle.diff}`);
  }
  if (reviewBundle.testResults) {
    parts.push(`Test Results:\n${reviewBundle.testResults}`);
  }
  if (reviewBundle.filesChanged?.length) {
    parts.push(`Files Changed: ${reviewBundle.filesChanged.join(", ")}`);
  }
  if (reviewBundle.riskNotes?.length) {
    parts.push(`Risk Notes:\n${reviewBundle.riskNotes.map((n) => `  - ${n}`).join("\n")}`);
  }

  return parts.join("\n\n");
}

function normalizeVerdict(raw: string | undefined): VerificationVerdict {
  if (!raw) return "REJECT";
  const upper = raw.toUpperCase().trim();
  if (upper === "ACCEPT") return "ACCEPT";
  if (upper === "ACCEPT_WITH_NOTES") return "ACCEPT_WITH_NOTES";
  return "REJECT";
}

export async function stage1_collectReviews(
  accounts: string[],
  llmCaller: LLMCaller,
  taskContext: string,
): Promise<VerificationReview[]> {
  return collectFromAccounts(accounts, async (account) => {
    const response = await llmCaller(account, VERIFICATION_STAGE1_PROMPT, taskContext);
    const parsed = parseJSONFromLLM(response);
    if (!parsed) {
      throw new Error(`Failed to parse verification response from ${account}`);
    }
    return {
      account,
      verdict: normalizeVerdict(parsed.verdict),
      confidence: parsed.confidence ?? 0.5,
      reasoning: parsed.reasoning ?? "",
      issues: parsed.issues ?? [],
      strengths: parsed.strengths ?? [],
    } as VerificationReview;
  });
}

export async function stage2_peerReview(
  accounts: string[],
  llmCaller: LLMCaller,
  taskContext: string,
  reviews: VerificationReview[],
): Promise<PeerEvaluation[]> {
  const anonymized = anonymizeForPeerReview(
    reviews.map((r) => ({
      fields: {
        Verdict: r.verdict,
        Confidence: String(r.confidence),
        Reasoning: r.reasoning,
        Issues: r.issues.length > 0 ? r.issues : ["none"],
        Strengths: r.strengths.length > 0 ? r.strengths : ["none"],
      },
    })),
    "Review",
  );

  const userPrompt = `${taskContext}\n\nHere are the verification reviews to evaluate:\n\n${anonymized}`;

  return collectFromAccounts(accounts, async (account) => {
    const response = await llmCaller(account, VERIFICATION_STAGE2_PROMPT, userPrompt);
    const parsed = parseJSONFromLLM(response);
    if (!parsed) {
      throw new Error(`Failed to parse peer review from ${account}`);
    }
    return {
      reviewer: account,
      ranking: parsed.ranking ?? [],
      reasoning: parsed.reasoning ?? "",
    } as PeerEvaluation;
  });
}

export async function stage3_chairmanVerdict(
  chairman: string,
  llmCaller: LLMCaller,
  taskContext: string,
  reviews: VerificationReview[],
  peerEvals: PeerEvaluation[],
): Promise<{ verdict: VerificationVerdict; confidence: number; notes: string[]; reasoning: string }> {
  const reviewsText = reviews
    .map((r, i) => {
      return `Review ${i + 1} (${r.account}):\n- Verdict: ${r.verdict}\n- Confidence: ${r.confidence}\n- Reasoning: ${r.reasoning}\n- Issues: ${r.issues.join("; ") || "none"}\n- Strengths: ${r.strengths.join("; ") || "none"}`;
    })
    .join("\n\n");

  const peersText = peerEvals
    .map((p) => `Reviewer ${p.reviewer}: Ranking [${p.ranking.join(", ")}] — ${p.reasoning}`)
    .join("\n");

  const userPrompt = `${taskContext}\n\nIndividual Reviews:\n${reviewsText}\n\nPeer Rankings:\n${peersText}`;

  const response = await llmCaller(chairman, VERIFICATION_STAGE3_PROMPT, userPrompt);
  const parsed = parseJSONFromLLM(response);
  if (!parsed) {
    throw new Error("Failed to parse chairman verification verdict");
  }

  return {
    verdict: normalizeVerdict(parsed.verdict),
    confidence: parsed.confidence ?? 0.5,
    notes: parsed.notes ?? [],
    reasoning: parsed.reasoning ?? "",
  };
}
