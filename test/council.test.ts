import { test, expect, describe } from "bun:test";
import {
  CouncilService,
  LLMCaller,
  parseJSONFromLLM,
  calculateAggregateRankings,
} from "../src/services/council";

function createMockCaller(responses: Map<string, string>): LLMCaller {
  return async (account, _system, _user) => {
    return responses.get(account) ?? '{"error": "no mock for account"}';
  };
}

const MEMBERS = ["claude", "codex", "opencode"];
const CHAIRMAN = "claude";

function makeStage1Response(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    complexity: "medium",
    estimatedDurationMinutes: 45,
    requiredSkills: ["typescript", "testing"],
    recommendedApproach: "Implement with TDD",
    risks: ["scope creep"],
    suggestedProvider: "claude-code",
    ...overrides,
  });
}

function makeStage2Response(ranking: number[] = [0, 1, 2]) {
  return JSON.stringify({
    ranking,
    reasoning: "Analysis ranked by thoroughness and risk coverage",
  });
}

function makeSynthesisResponse(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    consensusComplexity: "medium",
    consensusDurationMinutes: 40,
    consensusSkills: ["typescript", "testing"],
    recommendedApproach: "TDD with incremental implementation",
    recommendedProvider: "claude-code",
    confidence: 0.85,
    dissenting_views: ["One account suggested higher complexity"],
    ...overrides,
  });
}

describe("parseJSONFromLLM", () => {
  test("handles raw JSON", () => {
    const input = '{"key": "value", "num": 42}';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ key: "value", num: 42 });
  });

  test("handles fenced JSON blocks", () => {
    const input = 'Here is my analysis:\n```json\n{"complexity": "high", "duration": 60}\n```\nHope that helps!';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ complexity: "high", duration: 60 });
  });

  test("handles fenced blocks without json label", () => {
    const input = '```\n{"key": "value"}\n```';
    const result = parseJSONFromLLM(input);
    expect(result).toEqual({ key: "value" });
  });

  test("returns null for invalid input", () => {
    expect(parseJSONFromLLM("not json at all")).toBeNull();
    expect(parseJSONFromLLM("```\nnot json\n```")).toBeNull();
    expect(parseJSONFromLLM("")).toBeNull();
  });
});

describe("CouncilService constructor", () => {
  test("throws without LLM caller", () => {
    expect(() => {
      new CouncilService({ members: MEMBERS, chairman: CHAIRMAN });
    }).toThrow("Council requires an LLM caller");
  });

  test("works with custom LLM caller", () => {
    const mockCaller = createMockCaller(new Map());
    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );
    expect(service).toBeDefined();
  });
});

describe("CouncilService.stage1_collectAnalyses", () => {
  test("collects analyses from all accounts in parallel", async () => {
    const calledAccounts: string[] = [];
    const mockCaller: LLMCaller = async (account, _system, _user) => {
      calledAccounts.push(account);
      return makeStage1Response({ complexity: account === "claude" ? "high" : "medium" });
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = await service.stage1_collectAnalyses("Build a REST API");

    expect(analyses).toHaveLength(3);
    expect(calledAccounts).toContain("claude");
    expect(calledAccounts).toContain("codex");
    expect(calledAccounts).toContain("opencode");

    const claudeAnalysis = analyses.find((a) => a.account === "claude");
    expect(claudeAnalysis?.complexity).toBe("high");
    expect(claudeAnalysis?.requiredSkills).toContain("typescript");
  });

  test("handles account failure gracefully (skips failed account)", async () => {
    const mockCaller: LLMCaller = async (account, _system, _user) => {
      if (account === "codex") {
        throw new Error("Account unavailable");
      }
      return makeStage1Response();
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = await service.stage1_collectAnalyses("Build a REST API");

    expect(analyses).toHaveLength(2);
    expect(analyses.find((a) => a.account === "codex")).toBeUndefined();
  });

  test("handles unparseable LLM response gracefully", async () => {
    const mockCaller: LLMCaller = async (account, _system, _user) => {
      if (account === "opencode") {
        return "I cannot produce JSON right now, sorry.";
      }
      return makeStage1Response();
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = await service.stage1_collectAnalyses("Build a REST API");

    expect(analyses).toHaveLength(2);
    expect(analyses.find((a) => a.account === "opencode")).toBeUndefined();
  });

  test("includes context in prompt when provided", async () => {
    let capturedPrompt = "";
    const mockCaller: LLMCaller = async (_account, _system, user) => {
      capturedPrompt = user;
      return makeStage1Response();
    };

    const service = new CouncilService(
      { members: ["account-a"], chairman: CHAIRMAN },
      mockCaller
    );

    await service.stage1_collectAnalyses("Build API", "Using Express.js with PostgreSQL");
    expect(capturedPrompt).toContain("Build API");
    expect(capturedPrompt).toContain("Using Express.js with PostgreSQL");
  });
});

describe("CouncilService.stage2_peerReview", () => {
  test("produces anonymized peer rankings", async () => {
    const prompts: string[] = [];
    const mockCaller: LLMCaller = async (account, _system, user) => {
      prompts.push(user);
      return makeStage2Response([0, 2, 1]);
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = MEMBERS.map((m) => ({
      account: m,
      complexity: "medium" as const,
      estimatedDurationMinutes: 30,
      requiredSkills: ["ts"],
      recommendedApproach: "TDD",
      risks: ["none"],
    }));

    const rankings = await service.stage2_peerReview("Build API", analyses);

    expect(rankings).toHaveLength(3);
    // Verify anonymization: prompts should contain "Analysis A", "Analysis B" etc., not account names
    for (const prompt of prompts) {
      expect(prompt).toContain("Analysis A");
      expect(prompt).toContain("Analysis B");
      expect(prompt).not.toContain("claude");
      expect(prompt).not.toContain("codex");
    }

    expect(rankings[0].reviewer).toBe("claude");
    expect(rankings[0].ranking).toEqual([0, 2, 1]);
    expect(rankings[0].reasoning).toContain("thoroughness");
  });

  test("handles reviewer failure gracefully", async () => {
    const mockCaller: LLMCaller = async (account, _system, _user) => {
      if (account === "codex") {
        throw new Error("Rate limited");
      }
      return makeStage2Response([0, 1, 2]);
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = MEMBERS.map((m) => ({
      account: m,
      complexity: "medium" as const,
      estimatedDurationMinutes: 30,
      requiredSkills: ["ts"],
      recommendedApproach: "TDD",
      risks: ["none"],
    }));

    const rankings = await service.stage2_peerReview("Build API", analyses);

    expect(rankings).toHaveLength(2);
    expect(rankings.find((r) => r.reviewer === "codex")).toBeUndefined();
  });
});

describe("calculateAggregateRankings", () => {
  test("computes average rank from peer reviews", () => {
    const accounts = ["account-a", "account-b", "account-c"];
    const rankings = [
      { reviewer: "account-a", ranking: [0, 1, 2], reasoning: "A best" },
      { reviewer: "account-b", ranking: [0, 2, 1], reasoning: "A best" },
      { reviewer: "account-c", ranking: [2, 0, 1], reasoning: "C best" },
    ];

    const aggregate = calculateAggregateRankings(rankings, accounts);

    expect(aggregate).toHaveLength(3);
    // Rankings are [best-to-worst index arrays]:
    //   [0, 1, 2] => account-a rank 1, account-b rank 2, account-c rank 3
    //   [0, 2, 1] => account-a rank 1, account-c rank 2, account-b rank 3
    //   [2, 0, 1] => account-c rank 1, account-a rank 2, account-b rank 3
    // account-a: ranks 1, 1, 2 => avg 4/3 = 1.33
    const accountA = aggregate.find((a) => a.account === "account-a");
    expect(accountA?.averageRank).toBe(1.33);
    expect(accountA?.rankCount).toBe(3);
    // account-b: ranks 2, 3, 3 => avg 8/3 = 2.67
    const accountB = aggregate.find((a) => a.account === "account-b");
    expect(accountB?.averageRank).toBe(2.67);
    // account-c: ranks 3, 2, 1 => avg 6/3 = 2
    const accountC = aggregate.find((a) => a.account === "account-c");
    expect(accountC?.averageRank).toBe(2);
    // Sorted by average rank (lower is better)
    expect(aggregate[0].account).toBe("account-a");
    expect(aggregate[2].account).toBe("account-b");
  });

  test("handles empty rankings", () => {
    const aggregate = calculateAggregateRankings([], ["account-a"]);
    expect(aggregate).toHaveLength(0);
  });

  test("ignores out-of-bounds indices", () => {
    const accounts = ["account-a", "account-b"];
    const rankings = [
      { reviewer: "x", ranking: [0, 1, 99], reasoning: "with invalid index" },
    ];

    const aggregate = calculateAggregateRankings(rankings, accounts);

    expect(aggregate).toHaveLength(2);
    expect(aggregate.find((a) => a.account === "account-a")?.averageRank).toBe(1);
    expect(aggregate.find((a) => a.account === "account-b")?.averageRank).toBe(2);
  });

  test("handles single reviewer", () => {
    const accounts = ["account-a", "account-b"];
    const rankings = [
      { reviewer: "account-a", ranking: [1, 0], reasoning: "B is best" },
    ];

    const aggregate = calculateAggregateRankings(rankings, accounts);

    expect(aggregate[0].account).toBe("account-b");
    expect(aggregate[0].averageRank).toBe(1);
    expect(aggregate[1].account).toBe("account-a");
    expect(aggregate[1].averageRank).toBe(2);
  });
});

describe("CouncilService.stage3_synthesize", () => {
  test("produces chairman synthesis", async () => {
    const mockCaller: LLMCaller = async (account, _system, _user) => {
      expect(account).toBe(CHAIRMAN);
      return makeSynthesisResponse();
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = MEMBERS.map((m) => ({
      account: m,
      complexity: "medium" as const,
      estimatedDurationMinutes: 30,
      requiredSkills: ["ts"],
      recommendedApproach: "TDD",
      risks: ["none"],
    }));

    const rankings = MEMBERS.map((m) => ({
      reviewer: m,
      ranking: [0, 1, 2],
      reasoning: "Good analysis",
    }));

    const synthesis = await service.stage3_synthesize("Build API", analyses, rankings);

    expect(synthesis.chairman).toBe(CHAIRMAN);
    expect(synthesis.consensusComplexity).toBe("medium");
    expect(synthesis.consensusDurationMinutes).toBe(40);
    expect(synthesis.consensusSkills).toContain("typescript");
    expect(synthesis.recommendedProvider).toBe("claude-code");
    expect(synthesis.confidence).toBe(0.85);
    expect(synthesis.dissenting_views).toContain("One account suggested higher complexity");
  });

  test("throws when chairman response is unparseable", async () => {
    const mockCaller: LLMCaller = async () => "Not valid JSON at all";

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    await expect(
      service.stage3_synthesize("Build API", [], [])
    ).rejects.toThrow("Failed to parse chairman synthesis");
  });
});

describe("CouncilService.analyze (full pipeline)", () => {
  test("runs all 3 stages and includes aggregate rankings", async () => {
    const stagesCalled: string[] = [];

    const mockCaller: LLMCaller = async (account, system, _user) => {
      if (system.includes("task analysis expert")) {
        stagesCalled.push("stage1");
        return makeStage1Response();
      } else if (system.includes("peer reviewer")) {
        stagesCalled.push("stage2");
        return makeStage2Response();
      } else if (system.includes("chairman")) {
        stagesCalled.push("stage3");
        return makeSynthesisResponse();
      }
      return "{}";
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const result = await service.analyze("Build a REST API", "Using Express.js");

    // Verify all stages ran
    expect(stagesCalled).toContain("stage1");
    expect(stagesCalled).toContain("stage2");
    expect(stagesCalled).toContain("stage3");

    // Verify result structure
    expect(result.taskGoal).toBe("Build a REST API");
    expect(result.timestamp).toBeTruthy();
    expect(result.individualAnalyses).toHaveLength(3);
    expect(result.peerRankings).toHaveLength(3);
    expect(result.aggregateRankings).toHaveLength(3);
    expect(result.synthesis.chairman).toBe(CHAIRMAN);
    expect(result.synthesis.confidence).toBe(0.85);
  });

  test("returns fallback when all accounts fail in stage 1", async () => {
    const mockCaller: LLMCaller = async () => {
      throw new Error("All accounts down");
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const result = await service.analyze("Build a REST API");

    expect(result.individualAnalyses).toHaveLength(0);
    expect(result.peerRankings).toHaveLength(0);
    expect(result.aggregateRankings).toHaveLength(0);
    expect(result.synthesis.confidence).toBe(0);
    expect(result.synthesis.recommendedApproach).toContain("all accounts failed");
  });

  test("degrades gracefully when some stage 1 accounts fail", async () => {
    let callCount = 0;
    const mockCaller: LLMCaller = async (account, system, _user) => {
      if (system.includes("task analysis expert")) {
        callCount++;
        if (callCount === 1) throw new Error("First account failed");
        return makeStage1Response();
      } else if (system.includes("peer reviewer")) {
        return makeStage2Response([0, 1]);
      } else if (system.includes("chairman")) {
        return makeSynthesisResponse();
      }
      return "{}";
    };

    const service = new CouncilService(
      { members: MEMBERS, chairman: CHAIRMAN },
      mockCaller
    );

    const result = await service.analyze("Build a REST API");

    // One account failed, so only 2 analyses
    expect(result.individualAnalyses).toHaveLength(2);
    // Pipeline still completed
    expect(result.synthesis.chairman).toBe(CHAIRMAN);
  });
});
