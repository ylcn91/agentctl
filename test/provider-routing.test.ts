import { describe, test, expect } from "bun:test";
import {
  scoreAccount,
  rankAccounts,
  PROVIDER_STRENGTHS,
  type AccountCapability,
} from "../src/services/account-capabilities";

function makeCapability(overrides: Partial<AccountCapability> = {}): AccountCapability {
  return {
    accountName: "test-account",
    skills: ["typescript", "testing", "devops"],
    totalTasks: 10,
    acceptedTasks: 9,
    rejectedTasks: 1,
    avgDeliveryMs: 180_000,
    lastActiveAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("PROVIDER_STRENGTHS", () => {
  test("has all 6 providers", () => {
    const providers = Object.keys(PROVIDER_STRENGTHS);
    expect(providers).toContain("claude-code");
    expect(providers).toContain("gemini-cli");
    expect(providers).toContain("codex-cli");
    expect(providers).toContain("openhands");
    expect(providers).toContain("opencode");
    expect(providers).toContain("cursor-agent");
    expect(providers).toHaveLength(6);
  });

  test("each provider has at least one strength", () => {
    for (const [provider, strengths] of Object.entries(PROVIDER_STRENGTHS)) {
      expect(strengths.length).toBeGreaterThan(0);
    }
  });
});

describe("provider fit scoring", () => {
  test("provider matching all required skills gets full 20 points", () => {
    const cap = makeCapability({
      providerType: "claude-code",
      skills: ["typescript", "refactoring"],
    });
    const result = scoreAccount(cap, ["typescript", "refactoring"]);
    // Both skills are in claude-code's strengths
    const providerReason = result.reasons.find((r) => r.startsWith("provider fit:"));
    expect(providerReason).toContain("2/2");
    expect(providerReason).toContain("20pts");
  });

  test("provider matching some required skills gets proportional points", () => {
    const cap = makeCapability({
      providerType: "claude-code",
      skills: ["typescript", "python"],
    });
    // typescript is a claude-code strength, python is not
    const result = scoreAccount(cap, ["typescript", "python"]);
    const providerReason = result.reasons.find((r) => r.startsWith("provider fit:"));
    expect(providerReason).toContain("1/2");
    expect(providerReason).toContain("10pts");
  });

  test("provider matching no required skills gets 0 provider fit points", () => {
    const cap = makeCapability({
      providerType: "claude-code",
      skills: ["python", "data-analysis"],
    });
    // Neither python nor data-analysis are claude-code strengths
    const result = scoreAccount(cap, ["python", "data-analysis"]);
    const providerReason = result.reasons.find((r) => r.startsWith("provider fit:"));
    expect(providerReason).toContain("0/2");
    expect(providerReason).toContain("0pts");
  });

  test("no providerType gives neutral 10 points", () => {
    const cap = makeCapability(); // no providerType
    const result = scoreAccount(cap, ["typescript", "testing"]);
    const providerReason = result.reasons.find((r) => r.startsWith("provider fit:"));
    expect(providerReason).toContain("neutral");
    expect(providerReason).toContain("10pts");
  });

  test("no required skills gives neutral 10 points even with provider", () => {
    const cap = makeCapability({ providerType: "claude-code" });
    const result = scoreAccount(cap, []);
    const providerReason = result.reasons.find((r) => r.startsWith("provider fit:"));
    expect(providerReason).toContain("neutral");
    expect(providerReason).toContain("10pts");
  });
});

describe("trust score", () => {
  test("trust score of 100 gives 10 points", () => {
    const cap = makeCapability({ trustScore: 100 });
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.startsWith("trust:"));
    expect(trustReason).toContain("100/100");
    expect(trustReason).toContain("10pts");
  });

  test("trust score of 50 gives 5 points", () => {
    const cap = makeCapability({ trustScore: 50 });
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.startsWith("trust:"));
    expect(trustReason).toContain("50/100");
    expect(trustReason).toContain("5pts");
  });

  test("trust score of 0 gives 0 points", () => {
    const cap = makeCapability({ trustScore: 0 });
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.startsWith("trust:"));
    expect(trustReason).toContain("0/100");
    expect(trustReason).toContain("0pts");
  });

  test("no trust score gives neutral 5 points", () => {
    const cap = makeCapability(); // no trustScore
    const result = scoreAccount(cap, []);
    const trustReason = result.reasons.find((r) => r.startsWith("trust:"));
    expect(trustReason).toContain("neutral");
    expect(trustReason).toContain("5pts");
  });
});

describe("full ranking with provider awareness", () => {
  test("claude-code ranks higher for typescript tasks", () => {
    const caps = [
      makeCapability({
        accountName: "codex-agent",
        providerType: "codex-cli",
        skills: ["typescript", "code-generation"],
        totalTasks: 10,
        acceptedTasks: 9,
        trustScore: 80,
      }),
      makeCapability({
        accountName: "claude-agent",
        providerType: "claude-code",
        skills: ["typescript", "refactoring"],
        totalTasks: 10,
        acceptedTasks: 9,
        trustScore: 80,
      }),
    ];
    const ranked = rankAccounts(caps, ["typescript", "refactoring"]);
    expect(ranked[0].accountName).toBe("claude-agent");
  });

  test("cursor-agent ranks higher for frontend tasks", () => {
    const caps = [
      makeCapability({
        accountName: "claude-agent",
        providerType: "claude-code",
        skills: ["react", "css"],
        totalTasks: 10,
        acceptedTasks: 9,
        trustScore: 80,
      }),
      makeCapability({
        accountName: "cursor-agent-1",
        providerType: "cursor-agent",
        skills: ["react", "css"],
        totalTasks: 10,
        acceptedTasks: 9,
        trustScore: 80,
      }),
    ];
    const ranked = rankAccounts(caps, ["react", "css", "frontend"]);
    expect(ranked[0].accountName).toBe("cursor-agent-1");
  });

  test("higher trust score breaks tie", () => {
    const caps = [
      makeCapability({
        accountName: "low-trust",
        skills: ["typescript"],
        trustScore: 30,
      }),
      makeCapability({
        accountName: "high-trust",
        skills: ["typescript"],
        trustScore: 90,
      }),
    ];
    const ranked = rankAccounts(caps, ["typescript"]);
    expect(ranked[0].accountName).toBe("high-trust");
  });
});
