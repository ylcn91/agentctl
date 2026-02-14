import { test, expect, describe, beforeEach } from "bun:test";
import {
  CouncilService,
  CouncilConfig,
  LLMCaller,
  parseJSONFromLLM,
} from "../src/services/council";

function createMockCaller(responses: Map<string, string>): LLMCaller {
  return async (model, _system, _user) => {
    return responses.get(model) ?? '{"error": "no mock for model"}';
  };
}

const MODELS = [
  "anthropic/claude-3.5-sonnet",
  "google/gemini-pro",
  "openai/gpt-4o",
];
const CHAIRMAN = "anthropic/claude-3.5-sonnet";

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
    dissenting_views: ["One model suggested higher complexity"],
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
  test("throws without API key and without custom caller", () => {
    const origEnv = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    expect(() => {
      new CouncilService({ models: MODELS, chairman: CHAIRMAN });
    }).toThrow("Council requires an OpenRouter API key");

    if (origEnv) process.env.OPENROUTER_API_KEY = origEnv;
  });

  test("works with custom LLM caller (no API key needed)", () => {
    const mockCaller = createMockCaller(new Map());
    const service = new CouncilService(
      { models: MODELS, chairman: CHAIRMAN },
      mockCaller
    );
    expect(service).toBeDefined();
  });

  test("works with API key in config", () => {
    const service = new CouncilService(
      { models: MODELS, chairman: CHAIRMAN, apiKey: "test-key" }
    );
    expect(service).toBeDefined();
  });
});

describe("CouncilService.stage1_collectAnalyses", () => {
  test("collects analyses from all models in parallel", async () => {
    const calledModels: string[] = [];
    const mockCaller: LLMCaller = async (model, _system, _user) => {
      calledModels.push(model);
      return makeStage1Response({ complexity: model.includes("claude") ? "high" : "medium" });
    };

    const service = new CouncilService(
      { models: MODELS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = await service.stage1_collectAnalyses("Build a REST API");

    expect(analyses).toHaveLength(3);
    expect(calledModels).toContain("anthropic/claude-3.5-sonnet");
    expect(calledModels).toContain("google/gemini-pro");
    expect(calledModels).toContain("openai/gpt-4o");

    const claudeAnalysis = analyses.find((a) => a.model === "anthropic/claude-3.5-sonnet");
    expect(claudeAnalysis?.complexity).toBe("high");
    expect(claudeAnalysis?.requiredSkills).toContain("typescript");
  });

  test("handles model failure gracefully (skips failed model)", async () => {
    const mockCaller: LLMCaller = async (model, _system, _user) => {
      if (model === "google/gemini-pro") {
        throw new Error("Model unavailable");
      }
      return makeStage1Response();
    };

    const service = new CouncilService(
      { models: MODELS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = await service.stage1_collectAnalyses("Build a REST API");

    expect(analyses).toHaveLength(2);
    expect(analyses.find((a) => a.model === "google/gemini-pro")).toBeUndefined();
  });
});

describe("CouncilService.stage2_peerReview", () => {
  test("produces anonymized peer rankings", async () => {
    const prompts: string[] = [];
    const mockCaller: LLMCaller = async (model, _system, user) => {
      prompts.push(user);
      return makeStage2Response([0, 2, 1]);
    };

    const service = new CouncilService(
      { models: MODELS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = MODELS.map((m) => ({
      model: m,
      complexity: "medium" as const,
      estimatedDurationMinutes: 30,
      requiredSkills: ["ts"],
      recommendedApproach: "TDD",
      risks: ["none"],
    }));

    const rankings = await service.stage2_peerReview("Build API", analyses);

    expect(rankings).toHaveLength(3);
    // Verify anonymization: prompts should contain "Analysis A", "Analysis B" etc., not model names
    for (const prompt of prompts) {
      expect(prompt).toContain("Analysis A");
      expect(prompt).toContain("Analysis B");
      expect(prompt).not.toContain("anthropic/claude-3.5-sonnet");
      expect(prompt).not.toContain("google/gemini-pro");
    }

    expect(rankings[0].reviewer).toBe("anthropic/claude-3.5-sonnet");
    expect(rankings[0].ranking).toEqual([0, 2, 1]);
    expect(rankings[0].reasoning).toContain("thoroughness");
  });
});

describe("CouncilService.stage3_synthesize", () => {
  test("produces chairman synthesis", async () => {
    const mockCaller: LLMCaller = async (model, _system, _user) => {
      expect(model).toBe(CHAIRMAN);
      return makeSynthesisResponse();
    };

    const service = new CouncilService(
      { models: MODELS, chairman: CHAIRMAN },
      mockCaller
    );

    const analyses = MODELS.map((m) => ({
      model: m,
      complexity: "medium" as const,
      estimatedDurationMinutes: 30,
      requiredSkills: ["ts"],
      recommendedApproach: "TDD",
      risks: ["none"],
    }));

    const rankings = MODELS.map((m) => ({
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
    expect(synthesis.dissenting_views).toContain("One model suggested higher complexity");
  });
});

describe("CouncilService.analyze (full pipeline)", () => {
  test("runs all 3 stages", async () => {
    const stagesCalled: string[] = [];

    const mockCaller: LLMCaller = async (model, system, _user) => {
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
      { models: MODELS, chairman: CHAIRMAN },
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
    expect(result.synthesis.chairman).toBe(CHAIRMAN);
    expect(result.synthesis.confidence).toBe(0.85);
  });
});
