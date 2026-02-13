import { describe, test, expect } from "bun:test";
import { ClaudeCodeProvider } from "../src/providers/claude-code";
import type {
  UsageSource,
  QuotaPolicy,
  Account,
  LaunchOpts,
} from "../src/providers/types";
import { join } from "path";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("Provider interface abstractions", () => {
  const provider = new ClaudeCodeProvider();

  describe("UsageSource", () => {
    test("ClaudeCodeProvider returns filesystem usage source", () => {
      const account: Account = {
        name: "test-claude",
        configDir: "/tmp/test-claude-config",
        provider: "claude-code",
      };
      const source = provider.getUsageSource(account);
      expect(source.type).toBe("filesystem");
    });

    test("usage source reads data from stats-cache.json", async () => {
      const account: Account = {
        name: "test-fixture",
        configDir: FIXTURES,
        provider: "claude-code",
      };
      const source = provider.getUsageSource(account);
      const data = await source.read();
      expect(data.totalSessions).toBe(192);
      expect(data.totalMessages).toBe(56139);
    });

    test("usage source returns empty data for missing config", async () => {
      const account: Account = {
        name: "ghost",
        configDir: "/nonexistent",
        provider: "claude-code",
      };
      const source = provider.getUsageSource(account);
      const data = await source.read();
      expect(data.totalSessions).toBe(0);
      expect(data.totalMessages).toBe(0);
    });
  });

  describe("QuotaPolicy", () => {
    test("ClaudeCodeProvider returns rolling-window quota policy", () => {
      const policy = provider.getQuotaPolicy();
      expect(policy.type).toBe("rolling-window");
      expect(policy.windowMs).toBe(5 * 60 * 60 * 1000);
    });

    test("rolling-window policy estimates remaining quota", () => {
      const policy = provider.getQuotaPolicy();
      const estimate = policy.estimateRemaining(
        { totalSessions: 0, totalMessages: 0, dailyActivity: [], dailyModelTokens: [], modelUsage: {} },
        { recentMessageCount: 150, estimatedLimit: 225 }
      );
      expect(estimate.percent).toBeCloseTo(66.67, 0);
      expect(estimate.confidence).toBe("medium");
    });

    test("unknown plan quota policy returns confidence none", () => {
      const policy = provider.getQuotaPolicy({ plan: "unknown", estimatedLimit: 0 });
      const estimate = policy.estimateRemaining(
        { totalSessions: 0, totalMessages: 0, dailyActivity: [], dailyModelTokens: [], modelUsage: {} },
        { recentMessageCount: 150, estimatedLimit: 0 }
      );
      expect(estimate.percent).toBe(-1);
      expect(estimate.confidence).toBe("none");
    });
  });

  describe("buildLaunchCommand (provider-agnostic)", () => {
    test("builds command from Account and LaunchOpts", () => {
      const account: Account = {
        name: "work",
        configDir: "~/.claude-work",
        provider: "claude-code",
      };
      const opts: LaunchOpts = { dir: "/projects/app", resume: false };
      const cmd = provider.buildLaunchCommand(account, opts);
      expect(cmd).toContain("claude");
      expect(cmd.some((s) => s.includes("CLAUDE_CONFIG_DIR"))).toBe(true);
    });

    test("includes resume flag when requested", () => {
      const account: Account = {
        name: "work",
        configDir: "~/.claude-work",
        provider: "claude-code",
      };
      const cmd = provider.buildLaunchCommand(account, { resume: true });
      expect(cmd).toContain("--resume");
    });
  });
});
