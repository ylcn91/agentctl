import { test, expect, describe } from "bun:test";
import {
  CouncilService,
  parseJSONFromLLM,
  calculateAggregateRankings,
} from "../src/services/council";
import type { LLMCaller } from "../src/services/council";
import {
  verifyTaskCompletion,
  type ReviewBundle,
  type HandoffPayloadForVerification,
} from "../src/services/verification-council";

// Realistic account names that look like real deployment accounts
const REALISTIC_MEMBERS = ["claude-primary", "codex-review", "gemini-analysis"];
const CHAIRMAN = "claude-primary";

function makeStage1Response(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    complexity: "high",
    estimatedDurationMinutes: 90,
    requiredSkills: ["typescript", "react", "database-design"],
    recommendedApproach: "Break into microservices with shared schema",
    risks: ["Data migration complexity", "API compatibility"],
    suggestedProvider: "claude-code",
    ...overrides,
  });
}

function makeStage2Response(ranking: number[] = [0, 1, 2]) {
  return JSON.stringify({
    ranking,
    reasoning: "Ranked by depth of risk analysis and feasibility assessment",
  });
}

function makeSynthesisResponse(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    consensusComplexity: "high",
    consensusDurationMinutes: 85,
    consensusSkills: ["typescript", "react", "database-design"],
    recommendedApproach: "Incremental migration with feature flags",
    recommendedProvider: "claude-code",
    confidence: 0.82,
    dissenting_views: ["One member suggested lower complexity for the auth module"],
    ...overrides,
  });
}

describe("council full pipeline with realistic accounts", () => {
  test("full analyze pipeline with realistic account names and mock responses", async () => {
    const callLog: { account: string; stage: string }[] = [];

    const mockCaller: LLMCaller = async (account, system, _user) => {
      if (system.includes("task analysis expert")) {
        callLog.push({ account, stage: "stage1" });
        return makeStage1Response({
          complexity: account === "claude-primary" ? "critical" : "high",
        });
      } else if (system.includes("peer reviewer")) {
        callLog.push({ account, stage: "stage2" });
        return makeStage2Response([0, 2, 1]);
      } else if (system.includes("chairman")) {
        callLog.push({ account, stage: "stage3" });
        return makeSynthesisResponse({ confidence: 0.9 });
      }
      return "{}";
    };

    const service = new CouncilService(
      { members: REALISTIC_MEMBERS, chairman: CHAIRMAN },
      mockCaller,
    );

    const result = await service.analyze(
      "Migrate user authentication from session-based to JWT with OAuth2 support",
      "Production system with 50k active users, zero-downtime requirement",
    );

    // All 3 members participated in stage 1
    const stage1Calls = callLog.filter((c) => c.stage === "stage1");
    expect(stage1Calls).toHaveLength(3);
    expect(stage1Calls.map((c) => c.account).sort()).toEqual(REALISTIC_MEMBERS.slice().sort());

    // All 3 members participated in stage 2
    const stage2Calls = callLog.filter((c) => c.stage === "stage2");
    expect(stage2Calls).toHaveLength(3);

    // Only chairman in stage 3
    const stage3Calls = callLog.filter((c) => c.stage === "stage3");
    expect(stage3Calls).toHaveLength(1);
    expect(stage3Calls[0].account).toBe(CHAIRMAN);

    // Verify result
    expect(result.individualAnalyses).toHaveLength(3);
    expect(result.peerRankings).toHaveLength(3);
    expect(result.aggregateRankings).toHaveLength(3);
    expect(result.synthesis.confidence).toBe(0.9);
    expect(result.synthesis.chairman).toBe(CHAIRMAN);
  });

  test("handles mixed failures where some accounts succeed and some fail", async () => {
    const mockCaller: LLMCaller = async (account, system, _user) => {
      if (system.includes("task analysis expert")) {
        if (account === "codex-review") {
          throw new Error("Rate limited — try again later");
        }
        if (account === "gemini-analysis") {
          return "I cannot produce JSON output right now."; // unparseable
        }
        return makeStage1Response();
      } else if (system.includes("peer reviewer")) {
        return makeStage2Response([0]);
      } else if (system.includes("chairman")) {
        return makeSynthesisResponse();
      }
      return "{}";
    };

    const service = new CouncilService(
      { members: REALISTIC_MEMBERS, chairman: CHAIRMAN },
      mockCaller,
    );

    const result = await service.analyze("Build a notification system");

    // codex-review threw, gemini-analysis returned unparseable text
    // Only claude-primary succeeded
    expect(result.individualAnalyses).toHaveLength(1);
    expect(result.individualAnalyses[0].account).toBe("claude-primary");

    // Pipeline still completes
    expect(result.synthesis.chairman).toBe(CHAIRMAN);
  });
});

describe("council peer review anonymization", () => {
  test("stage 2 prompts use Analysis A/B/C labels, not account names", async () => {
    const capturedPrompts: string[] = [];

    const mockCaller: LLMCaller = async (account, system, user) => {
      if (system.includes("task analysis expert")) {
        return makeStage1Response();
      } else if (system.includes("peer reviewer")) {
        capturedPrompts.push(user);
        return makeStage2Response([0, 1, 2]);
      } else if (system.includes("chairman")) {
        return makeSynthesisResponse();
      }
      return "{}";
    };

    const service = new CouncilService(
      { members: REALISTIC_MEMBERS, chairman: CHAIRMAN },
      mockCaller,
    );

    await service.analyze("Implement caching layer");

    expect(capturedPrompts.length).toBeGreaterThan(0);

    for (const prompt of capturedPrompts) {
      // Should contain anonymized labels
      expect(prompt).toContain("Analysis A");
      expect(prompt).toContain("Analysis B");
      expect(prompt).toContain("Analysis C");

      // Should NOT contain account names
      for (const member of REALISTIC_MEMBERS) {
        expect(prompt).not.toContain(member);
      }
    }
  });
});

describe("calculateAggregateRankings with ties", () => {
  test("tied average ranks produce same averageRank value", () => {
    const accounts = ["account-a", "account-b", "account-c"];
    // Rankings where account-a and account-c tie:
    // Reviewer 1: [0, 1, 2] => a=1, b=2, c=3
    // Reviewer 2: [2, 1, 0] => c=1, b=2, a=3
    // a avg = (1+3)/2 = 2, b avg = (2+2)/2 = 2, c avg = (3+1)/2 = 2
    const rankings = [
      { reviewer: "r1", ranking: [0, 1, 2], reasoning: "A is best" },
      { reviewer: "r2", ranking: [2, 1, 0], reasoning: "C is best" },
    ];

    const aggregate = calculateAggregateRankings(rankings, accounts);

    expect(aggregate).toHaveLength(3);
    // All three accounts should have the same average rank
    expect(aggregate[0].averageRank).toBe(2);
    expect(aggregate[1].averageRank).toBe(2);
    expect(aggregate[2].averageRank).toBe(2);
  });

  test("two-way tie with one clear winner", () => {
    const accounts = ["alpha", "beta", "gamma"];
    // Reviewer 1: [0, 1, 2] => alpha=1, beta=2, gamma=3
    // Reviewer 2: [0, 2, 1] => alpha=1, gamma=2, beta=3
    // alpha avg = (1+1)/2 = 1, beta avg = (2+3)/2 = 2.5, gamma avg = (3+2)/2 = 2.5
    const rankings = [
      { reviewer: "r1", ranking: [0, 1, 2], reasoning: "ok" },
      { reviewer: "r2", ranking: [0, 2, 1], reasoning: "ok" },
    ];

    const aggregate = calculateAggregateRankings(rankings, accounts);

    expect(aggregate[0].account).toBe("alpha");
    expect(aggregate[0].averageRank).toBe(1);

    // beta and gamma tied at 2.5
    const betaGamma = aggregate.slice(1);
    expect(betaGamma.every((a) => a.averageRank === 2.5)).toBe(true);
  });

  test("single reviewer ranking is deterministic", () => {
    const accounts = ["x", "y", "z"];
    const rankings = [
      { reviewer: "solo", ranking: [2, 0, 1], reasoning: "z best, x second, y third" },
    ];

    const aggregate = calculateAggregateRankings(rankings, accounts);

    expect(aggregate[0].account).toBe("z");
    expect(aggregate[0].averageRank).toBe(1);
    expect(aggregate[1].account).toBe("x");
    expect(aggregate[1].averageRank).toBe(2);
    expect(aggregate[2].account).toBe("y");
    expect(aggregate[2].averageRank).toBe(3);
  });
});

describe("verification pipeline integration", () => {
  const handoffPayload: HandoffPayloadForVerification = {
    goal: "Add rate limiting middleware to all API endpoints",
    acceptance_criteria: [
      "Rate limiter applied to /api/* routes",
      "Configurable limits per endpoint",
      "Returns 429 with Retry-After header",
      "Unit tests for rate limiter",
    ],
  };

  const reviewBundle: ReviewBundle = {
    diff: "diff --git a/src/middleware/rate-limit.ts\n+export function rateLimiter(config) { ... }",
    testResults: "12 passed, 0 failed",
    filesChanged: ["src/middleware/rate-limit.ts", "src/routes/api.ts", "test/rate-limit.test.ts"],
    riskNotes: ["High traffic endpoints may need tuning"],
  };

  test("ACCEPT consensus produces ACCEPT receipt", async () => {
    const mockCaller: LLMCaller = async (_account, systemPrompt) => {
      if (systemPrompt.includes("peer reviewer")) {
        return JSON.stringify({ ranking: [0, 1, 2], reasoning: "All solid reviews" });
      }
      if (systemPrompt.includes("chairman")) {
        return JSON.stringify({
          verdict: "ACCEPT",
          confidence: 0.95,
          notes: ["Well implemented rate limiting"],
          reasoning: "All criteria met with good test coverage",
        });
      }
      return JSON.stringify({
        verdict: "ACCEPT",
        confidence: 0.9,
        reasoning: "All acceptance criteria met",
        issues: [],
        strengths: ["Good error handling", "Configurable limits"],
      });
    };

    const result = await verifyTaskCompletion(
      "task-rate-limit",
      reviewBundle,
      handoffPayload,
      { members: ["a", "b", "c"], chairman: "a", llmCaller: mockCaller },
    );

    expect(result.verdict).toBe("ACCEPT");
    expect(result.receipt.verdict).toBe("ACCEPT");
    expect(result.receipt.taskId).toBe("task-rate-limit");
    expect(result.receipt.verifier).toBe("council");
    expect(result.confidence).toBe(0.95);
    expect(result.individualReviews).toHaveLength(3);
    expect(result.individualReviews.every((r) => r.verdict === "ACCEPT")).toBe(true);
  });

  test("REJECT consensus produces REJECT receipt with notes", async () => {
    const mockCaller: LLMCaller = async (_account, systemPrompt) => {
      if (systemPrompt.includes("peer reviewer")) {
        return JSON.stringify({ ranking: [0, 1], reasoning: "ok" });
      }
      if (systemPrompt.includes("chairman")) {
        return JSON.stringify({
          verdict: "REJECT",
          confidence: 0.85,
          notes: ["Missing Retry-After header implementation", "No integration tests"],
          reasoning: "Criteria #3 and #4 not fully met",
        });
      }
      return JSON.stringify({
        verdict: "REJECT",
        confidence: 0.7,
        reasoning: "Missing Retry-After header",
        issues: ["No Retry-After header", "Limited test coverage"],
        strengths: ["Basic rate limiting works"],
      });
    };

    const result = await verifyTaskCompletion(
      "task-reject",
      reviewBundle,
      handoffPayload,
      { members: ["a", "b"], chairman: "a", llmCaller: mockCaller },
    );

    expect(result.verdict).toBe("REJECT");
    expect(result.receipt.verdict).toBe("REJECT");
    expect(result.notes).toContain("Missing Retry-After header implementation");
    expect(result.notes).toContain("No integration tests");
  });

  test("mixed verdicts where chairman decides ACCEPT_WITH_NOTES", async () => {
    let stage1CallCount = 0;
    const mockCaller: LLMCaller = async (_account, systemPrompt) => {
      if (systemPrompt.includes("peer reviewer")) {
        return JSON.stringify({ ranking: [0, 1, 2], reasoning: "Mixed quality" });
      }
      if (systemPrompt.includes("chairman")) {
        return JSON.stringify({
          verdict: "ACCEPT_WITH_NOTES",
          confidence: 0.7,
          notes: ["Add integration tests before deploying to production"],
          reasoning: "Core functionality works but test coverage needs improvement",
        });
      }
      stage1CallCount++;
      // Alternate between ACCEPT and REJECT verdicts
      if (stage1CallCount % 2 === 1) {
        return JSON.stringify({
          verdict: "ACCEPT",
          confidence: 0.85,
          reasoning: "Looks good overall",
          issues: [],
          strengths: ["Clean implementation"],
        });
      }
      return JSON.stringify({
        verdict: "REJECT",
        confidence: 0.65,
        reasoning: "Needs more tests",
        issues: ["Insufficient test coverage"],
        strengths: ["Code structure is good"],
      });
    };

    const result = await verifyTaskCompletion(
      "task-mixed",
      reviewBundle,
      handoffPayload,
      { members: ["a", "b", "c"], chairman: "a", llmCaller: mockCaller },
    );

    expect(result.verdict).toBe("ACCEPT_WITH_NOTES");
    expect(result.confidence).toBe(0.7);
    expect(result.notes).toContain("Add integration tests before deploying to production");

    // Verify we got mixed individual verdicts
    const verdicts = result.individualReviews.map((r) => r.verdict);
    expect(verdicts).toContain("ACCEPT");
    expect(verdicts).toContain("REJECT");
  });

  test("verification stage 2 anonymizes reviews (no account names in prompt)", async () => {
    const stage2Prompts: string[] = [];

    const mockCaller: LLMCaller = async (account, systemPrompt, userPrompt) => {
      if (systemPrompt.includes("peer reviewer")) {
        stage2Prompts.push(userPrompt);
        return JSON.stringify({ ranking: [0, 1], reasoning: "ok" });
      }
      if (systemPrompt.includes("chairman")) {
        return JSON.stringify({
          verdict: "ACCEPT",
          confidence: 0.9,
          notes: [],
          reasoning: "All good",
        });
      }
      return JSON.stringify({
        verdict: "ACCEPT",
        confidence: 0.9,
        reasoning: "ok",
        issues: [],
        strengths: ["solid"],
      });
    };

    const memberNames = ["secret-account-1", "secret-account-2"];
    await verifyTaskCompletion(
      "task-anon",
      reviewBundle,
      handoffPayload,
      { members: memberNames, chairman: "secret-account-1", llmCaller: mockCaller },
    );

    expect(stage2Prompts.length).toBeGreaterThan(0);
    for (const prompt of stage2Prompts) {
      // Anonymized labels should be present
      expect(prompt).toContain("Review A");
      expect(prompt).toContain("Review B");
      // Account names should NOT appear in stage 2 prompts
      for (const name of memberNames) {
        expect(prompt).not.toContain(name);
      }
    }
  });

  test("receipt hashes are deterministic for same inputs", async () => {
    const mockCaller: LLMCaller = async (_account, systemPrompt) => {
      if (systemPrompt.includes("peer reviewer")) {
        return JSON.stringify({ ranking: [0], reasoning: "ok" });
      }
      if (systemPrompt.includes("chairman")) {
        return JSON.stringify({ verdict: "ACCEPT", confidence: 0.9, notes: [], reasoning: "ok" });
      }
      return JSON.stringify({ verdict: "ACCEPT", confidence: 0.9, reasoning: "ok", issues: [], strengths: [] });
    };

    const r1 = await verifyTaskCompletion(
      "task-a",
      reviewBundle,
      handoffPayload,
      { members: ["m"], chairman: "m", llmCaller: mockCaller },
    );
    const r2 = await verifyTaskCompletion(
      "task-b",
      reviewBundle,
      handoffPayload,
      { members: ["m"], chairman: "m", llmCaller: mockCaller },
    );

    // Same handoff payload -> same specHash
    expect(r1.receipt.specHash).toBe(r2.receipt.specHash);
    // Same review bundle -> same evidenceHash
    expect(r1.receipt.evidenceHash).toBe(r2.receipt.evidenceHash);
  });
});
