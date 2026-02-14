import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { OpenCodeProvider } from "../src/providers/opencode";
import { CursorAgentProvider } from "../src/providers/cursor-agent";
import { createDefaultRegistry } from "../src/providers/registry";
import type { Account, LaunchOpts } from "../src/providers/types";

describe("OpenCodeProvider", () => {
  const provider = new OpenCodeProvider();

  test("has correct id and displayName", () => {
    expect(provider.id).toBe("opencode");
    expect(provider.displayName).toBe("OpenCode");
    expect(provider.icon).toBe("⌨");
    expect(provider.supportsEntire).toBe(false);
  });

  test("builds launch command with --dir", () => {
    const account: Account = {
      name: "opencode-work",
      configDir: "~/.opencode-work",
      provider: "opencode",
    };
    const opts: LaunchOpts = { dir: "/projects/app" };
    const cmd = provider.buildLaunchCommand(account, opts);
    expect(cmd).toContain("opencode");
    expect(cmd).toContain("--dir");
    expect(cmd).toContain("/projects/app");
  });

  test("builds launch command without dir", () => {
    const account: Account = {
      name: "opencode-default",
      configDir: "~/.opencode",
      provider: "opencode",
    };
    const cmd = provider.buildLaunchCommand(account, {});
    expect(cmd).toEqual(["opencode"]);
  });

  test("getUsageSource returns filesystem type with empty data", async () => {
    const account: Account = {
      name: "opencode-test",
      configDir: "/tmp/opencode-test",
      provider: "opencode",
    };
    const source = provider.getUsageSource(account);
    expect(source.type).toBe("filesystem");
    const data = await source.read();
    expect(data.totalSessions).toBe(0);
    expect(data.totalMessages).toBe(0);
    expect(data.dailyActivity).toEqual([]);
    expect(data.modelUsage).toEqual({});
  });

  test("getQuotaPolicy returns unknown type", () => {
    const policy = provider.getQuotaPolicy();
    expect(policy.type).toBe("unknown");
    const estimate = policy.estimateRemaining(
      { totalSessions: 0, totalMessages: 0, dailyActivity: [], dailyModelTokens: [], modelUsage: {} },
      { recentMessageCount: 100, estimatedLimit: 200 }
    );
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
    expect(estimate.label).toBe("quota: varies by LLM provider");
  });

  test("parseStatsFromFile returns empty stats", async () => {
    const stats = await provider.parseStatsFromFile("/nonexistent");
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.todayActivity).toBeNull();
    expect(stats.todayTokens).toBeNull();
    expect(stats.weeklyActivity).toEqual([]);
    expect(stats.modelUsage).toEqual({});
  });

  test("estimateQuota returns unknown", () => {
    const estimate = provider.estimateQuota(100, {
      plan: "unknown",
      estimatedLimit: 0,
      windowMs: 3600000,
      source: "community-estimate",
    });
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
  });
});

describe("CursorAgentProvider", () => {
  const provider = new CursorAgentProvider();

  test("has correct id and displayName", () => {
    expect(provider.id).toBe("cursor-agent");
    expect(provider.displayName).toBe("Cursor Agent");
    expect(provider.icon).toBe("▶");
    expect(provider.supportsEntire).toBe(false);
  });

  test("builds launch command without api key", () => {
    const original = process.env.CURSOR_API_KEY;
    delete process.env.CURSOR_API_KEY;

    const account: Account = {
      name: "cursor-default",
      configDir: "~/.cursor",
      provider: "cursor-agent",
    };
    const cmd = provider.buildLaunchCommand(account, {});
    expect(cmd).toEqual(["agent"]);
    expect(cmd).not.toContain("--api-key");

    if (original !== undefined) process.env.CURSOR_API_KEY = original;
  });

  test("builds launch command with --api-key when env set", () => {
    const original = process.env.CURSOR_API_KEY;
    process.env.CURSOR_API_KEY = "test-key-123";

    const account: Account = {
      name: "cursor-work",
      configDir: "~/.cursor-work",
      provider: "cursor-agent",
    };
    const cmd = provider.buildLaunchCommand(account, {});
    expect(cmd).toContain("agent");
    expect(cmd).toContain("--api-key");
    expect(cmd).toContain("test-key-123");

    if (original !== undefined) {
      process.env.CURSOR_API_KEY = original;
    } else {
      delete process.env.CURSOR_API_KEY;
    }
  });

  test("getUsageSource returns filesystem type with empty data", async () => {
    const account: Account = {
      name: "cursor-test",
      configDir: "/tmp/cursor-test",
      provider: "cursor-agent",
    };
    const source = provider.getUsageSource(account);
    expect(source.type).toBe("filesystem");
    const data = await source.read();
    expect(data.totalSessions).toBe(0);
    expect(data.totalMessages).toBe(0);
    expect(data.dailyActivity).toEqual([]);
    expect(data.modelUsage).toEqual({});
  });

  test("getQuotaPolicy returns unknown type", () => {
    const policy = provider.getQuotaPolicy();
    expect(policy.type).toBe("unknown");
    const estimate = policy.estimateRemaining(
      { totalSessions: 0, totalMessages: 0, dailyActivity: [], dailyModelTokens: [], modelUsage: {} },
      { recentMessageCount: 100, estimatedLimit: 200 }
    );
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
    expect(estimate.label).toBe("quota: varies by LLM provider");
  });

  test("parseStatsFromFile returns empty stats", async () => {
    const stats = await provider.parseStatsFromFile("/nonexistent");
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.todayActivity).toBeNull();
    expect(stats.todayTokens).toBeNull();
    expect(stats.weeklyActivity).toEqual([]);
    expect(stats.modelUsage).toEqual({});
  });

  test("estimateQuota returns unknown", () => {
    const estimate = provider.estimateQuota(100, {
      plan: "unknown",
      estimatedLimit: 0,
      windowMs: 3600000,
      source: "community-estimate",
    });
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
  });
});

describe("Registry with all providers", () => {
  test("createDefaultRegistry returns all 6 providers", () => {
    const registry = createDefaultRegistry();
    const ids = registry.listIds();
    expect(ids).toContain("claude-code");
    expect(ids).toContain("codex-cli");
    expect(ids).toContain("openhands");
    expect(ids).toContain("gemini-cli");
    expect(ids).toContain("opencode");
    expect(ids).toContain("cursor-agent");
    expect(ids.length).toBe(6);
  });
});
