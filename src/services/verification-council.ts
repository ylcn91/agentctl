
import type { LLMCaller, CouncilServiceConfig } from "./council-framework";
import { computeSpecHash } from "./verification-receipts";
import {
  buildTaskContext,
  stage1_collectReviews,
  stage2_peerReview,
  stage3_chairmanVerdict,
} from "./verification-stages";

export type VerificationVerdict = "ACCEPT" | "REJECT" | "ACCEPT_WITH_NOTES";

export interface VerificationReceipt {
  taskId: string;
  verifier: "council";
  verdict: VerificationVerdict;
  timestamp: string;
  specHash: string;
  evidenceHash: string;
}

export interface VerificationReview {
  account: string;
  verdict: VerificationVerdict;
  confidence: number;
  reasoning: string;
  issues: string[];
  strengths: string[];
}

export interface PeerEvaluation {
  reviewer: string;
  ranking: number[];
  reasoning: string;
}

export interface VerificationResult {
  verdict: VerificationVerdict;
  confidence: number;
  notes: string[];
  receipt: VerificationReceipt;
  individualReviews: VerificationReview[];
  peerEvaluations: PeerEvaluation[];
  chairmanReasoning: string;
}

export interface ReviewBundle {
  diff?: string;
  testResults?: string;
  filesChanged?: string[];
  riskNotes?: string[];
}

export interface HandoffPayloadForVerification {
  goal: string;
  acceptance_criteria: string[];
  verifiability?: "auto-testable" | "needs-review" | "subjective";
}

export function needsCouncilVerification(
  verifiability?: "auto-testable" | "needs-review" | "subjective",
): boolean {
  return verifiability === "needs-review" || verifiability === "subjective";
}

export async function verifyTaskCompletion(
  taskId: string,
  reviewBundle: ReviewBundle,
  handoffPayload: HandoffPayloadForVerification,
  config?: Partial<CouncilServiceConfig> & { llmCaller?: LLMCaller },
): Promise<VerificationResult> {
  const members = config?.members ?? [];
  const chairman = config?.chairman ?? "";

  const llmCaller = config?.llmCaller;
  if (!llmCaller) {
    throw new Error("Council verification requires an LLM caller");
  }

  const taskContext = buildTaskContext(handoffPayload, reviewBundle);

  const individualReviews = await stage1_collectReviews(members, llmCaller, taskContext);

  if (individualReviews.length === 0) {
    const receipt = createVerificationReceipt(taskId, "REJECT", handoffPayload, reviewBundle);
    return {
      verdict: "REJECT",
      confidence: 0,
      notes: ["All verification accounts failed to respond"],
      receipt,
      individualReviews: [],
      peerEvaluations: [],
      chairmanReasoning: "Unable to verify — all accounts failed",
    };
  }

  const peerEvaluations = await stage2_peerReview(members, llmCaller, taskContext, individualReviews);

  const synthesis = await stage3_chairmanVerdict(chairman, llmCaller, taskContext, individualReviews, peerEvaluations);

  const receipt = createVerificationReceipt(taskId, synthesis.verdict, handoffPayload, reviewBundle);

  return {
    verdict: synthesis.verdict,
    confidence: synthesis.confidence,
    notes: synthesis.notes,
    receipt,
    individualReviews,
    peerEvaluations,
    chairmanReasoning: synthesis.reasoning,
  };
}

function createVerificationReceipt(
  taskId: string,
  verdict: VerificationVerdict,
  handoffPayload: HandoffPayloadForVerification,
  reviewBundle: ReviewBundle,
): VerificationReceipt {
  const specHash = computeSpecHash({
    goal: handoffPayload.goal,
    acceptance_criteria: handoffPayload.acceptance_criteria,
  });
  const evidenceHash = computeSpecHash(reviewBundle);

  return {
    taskId,
    verifier: "council",
    verdict,
    timestamp: new Date().toISOString(),
    specHash,
    evidenceHash,
  };
}
