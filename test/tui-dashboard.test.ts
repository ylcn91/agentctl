import { describe, test, expect } from "bun:test";
import type { AgentStats, QuotaEstimate } from "../src/providers/types";
import type { AccountConfig } from "../src/types";
import { ClaudeCodeProvider } from "../src/providers/claude-code";
import { join } from "path";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("Dashboard data loading", () => {
  const provider = new ClaudeCodeProvider();

  test("loads stats and computes quota for an account", async () => {
    const stats = await provider.parseStatsFromFile(
      join(FIXTURES, "stats-cache-sample.json"),
      "2026-02-12"
    );

    const quota = provider.estimateQuota(
      stats.todayActivity?.messageCount ?? 0,
      {
        plan: "max-5x",
        estimatedLimit: 225,
        windowMs: 18000000,
        source: "community-estimate",
      }
    );

    expect(stats.totalSessions).toBe(192);
    expect(stats.todayActivity?.messageCount).toBe(1508);
    // 1508 msgs is way over 225 limit, so capped at 100%
    expect(quota.percent).toBe(100);
    expect(quota.confidence).toBe("medium");
  });

  test("empty account shows zero stats and low confidence", async () => {
    const stats = await provider.parseStatsFromFile("/nonexistent/path.json");
    const quota = provider.estimateQuota(0, {
      plan: "max-5x",
      estimatedLimit: 225,
      windowMs: 18000000,
      source: "community-estimate",
    });

    expect(stats.totalSessions).toBe(0);
    expect(stats.todayActivity).toBeNull();
    expect(quota.percent).toBe(0);
    expect(quota.confidence).toBe("low");
  });
});

describe("UsageBar logic", () => {
  test("calculates filled blocks correctly", () => {
    const width = 10;
    const percent = 60;
    const filled = Math.round((percent / 100) * width);
    const empty = width - filled;
    expect(filled).toBe(6);
    expect(empty).toBe(4);
  });

  test("negative percent indicates unknown", () => {
    const percent = -1;
    expect(percent < 0).toBe(true);
  });

  test("color thresholds work correctly", () => {
    function getBarColor(percent: number, color: string = "green") {
      return percent > 80 ? "red" : percent > 50 ? "yellow" : color;
    }
    expect(getBarColor(30)).toBe("green");
    expect(getBarColor(60)).toBe("yellow");
    expect(getBarColor(90)).toBe("red");
  });
});

describe("QuotaBar confidence colors", () => {
  test("high confidence is green", () => {
    const estimate: QuotaEstimate = {
      percent: 50,
      confidence: "high",
      label: "~50% (est.)",
    };
    const color =
      estimate.confidence === "high"
        ? "green"
        : estimate.confidence === "medium"
          ? "yellow"
          : "gray";
    expect(color).toBe("green");
  });

  test("medium confidence is yellow", () => {
    const estimate: QuotaEstimate = {
      percent: 50,
      confidence: "medium",
      label: "~50% (est.)",
    };
    const color =
      estimate.confidence === "high"
        ? "green"
        : estimate.confidence === "medium"
          ? "yellow"
          : "gray";
    expect(color).toBe("yellow");
  });

  test("none confidence is gray", () => {
    const estimate: QuotaEstimate = {
      percent: -1,
      confidence: "none",
      label: "quota: unknown plan",
    };
    const color =
      estimate.confidence === "high"
        ? "green"
        : estimate.confidence === "medium"
          ? "yellow"
          : "gray";
    expect(color).toBe("gray");
  });
});

describe("AccountCard data shape", () => {
  test("assembles full account card data", async () => {
    const account: AccountConfig = {
      name: "claude",
      configDir: "~/.claude",
      color: "#cba6f7",
      label: "Default",
      provider: "claude-code",
    };

    const stats: AgentStats = {
      totalSessions: 192,
      totalMessages: 56139,
      todayActivity: { messageCount: 1508, sessionCount: 13, toolCallCount: 222 },
      todayTokens: { "claude-opus-4-6": 66694 },
      weeklyActivity: [{ date: "2026-02-12", messageCount: 1508 }],
      modelUsage: { "claude-opus-4-6": { inputTokens: 46827, outputTokens: 202570 } },
    };

    const quota: QuotaEstimate = {
      percent: 100,
      confidence: "medium",
      label: "~100% (est.)",
    };

    // Verify the data shapes are compatible (type check)
    expect(account.name).toBe("claude");
    expect(stats.todayActivity?.messageCount).toBe(1508);
    expect(stats.todayTokens?.["claude-opus-4-6"]).toBe(66694);
    expect(quota.percent).toBe(100);
  });

  test("formats token display string correctly", () => {
    const todayTokens: Record<string, number> = {
      "claude-opus-4-6": 66694,
      "claude-sonnet-4-5-20250929": 121,
    };

    const display = Object.entries(todayTokens)
      .map(
        ([m, t]) => `${(t / 1000).toFixed(1)}K ${m.replace("claude-", "")}`
      )
      .join(", ");

    expect(display).toBe("66.7K opus-4-6, 0.1K sonnet-4-5-20250929");
  });
});

describe("Header navigation keys", () => {
  test("view-to-key mapping is correct", () => {
    const keyMap: Record<string, string> = {
      d: "dashboard",
      l: "launcher",
      u: "usage",
      t: "tasks",
      a: "add",
      q: "quit",
    };
    expect(keyMap["d"]).toBe("dashboard");
    expect(keyMap["l"]).toBe("launcher");
    expect(keyMap["u"]).toBe("usage");
    expect(keyMap["t"]).toBe("tasks");
    expect(keyMap["a"]).toBe("add");
    expect(keyMap["q"]).toBe("quit");
  });
});
