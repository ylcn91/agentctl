import { describe, test, expect, afterAll } from "bun:test";
import { ClaudeCodeProvider } from "../src/providers/claude-code";
import { join } from "path";

const FIXTURES = join(import.meta.dir, "fixtures");

describe("ClaudeCodeProvider", () => {
  const provider = new ClaudeCodeProvider();

  test("parses stats-cache.json correctly", async () => {
    const stats = await provider.parseStatsFromFile(
      join(FIXTURES, "stats-cache-sample.json"),
      "2026-02-12"
    );
    expect(stats.totalSessions).toBe(192);
    expect(stats.totalMessages).toBe(56139);
    expect(stats.todayActivity?.messageCount).toBe(1508);
  });

  test("extracts daily model tokens", async () => {
    const stats = await provider.parseStatsFromFile(
      join(FIXTURES, "stats-cache-sample.json"),
      "2026-02-12"
    );
    expect(stats.todayTokens).toBeDefined();
    expect(stats.todayTokens!["claude-opus-4-6"]).toBe(66694);
  });

  test("returns empty stats for missing file", async () => {
    const stats = await provider.parseStatsFromFile("/nonexistent/path.json");
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.todayActivity).toBeNull();
  });

  test("returns empty stats for malformed JSON", async () => {
    const tmpPath = join(FIXTURES, "malformed.json");
    await Bun.write(tmpPath, "{ not valid json");
    try {
      const stats = await provider.parseStatsFromFile(tmpPath);
      expect(stats.totalSessions).toBe(0);
    } finally {
      try { await Bun.file(tmpPath).delete(); } catch {}
    }
  });

  test("estimates quota with confidence", () => {
    const estimate = provider.estimateQuota(150, {
      plan: "max-5x",
      estimatedLimit: 225,
      windowMs: 18000000,
      source: "community-estimate",
    });
    expect(estimate.percent).toBeCloseTo(66.67, 0);
    expect(estimate.confidence).toBe("medium");
  });

  test("unknown plan returns confidence none", () => {
    const estimate = provider.estimateQuota(150, {
      plan: "unknown",
      estimatedLimit: 0,
      windowMs: 18000000,
      source: "community-estimate",
    });
    expect(estimate.percent).toBe(-1);
    expect(estimate.confidence).toBe("none");
  });
});

describe("stats-cache parser edge cases", () => {
  const provider = new ClaudeCodeProvider();
  const tmpDir = join(import.meta.dir, ".test-stats-edge");

  async function writeTmpStats(filename: string, data: any): Promise<string> {
    const { mkdirSync } = await import("fs");
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, filename);
    await Bun.write(path, JSON.stringify(data));
    return path;
  }

  afterAll(async () => {
    const { rmSync } = await import("fs");
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  test("handles empty object stats file", async () => {
    const path = await writeTmpStats("empty-obj.json", {});
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.totalSessions).toBe(0);
    expect(stats.totalMessages).toBe(0);
    expect(stats.todayActivity).toBeNull();
    expect(stats.weeklyActivity).toEqual([]);
    expect(stats.modelUsage).toEqual({});
  });

  test("handles wrong version field gracefully", async () => {
    const path = await writeTmpStats("wrong-version.json", {
      version: 999,
      totalSessions: 5,
      totalMessages: 100,
      dailyActivity: [{ date: "2026-02-12", messageCount: 50, sessionCount: 2, toolCallCount: 10 }],
      modelUsage: {},
    });
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.totalSessions).toBe(5);
    expect(stats.totalMessages).toBe(100);
    expect(stats.todayActivity?.messageCount).toBe(50);
  });

  test("handles future dates in dailyActivity", async () => {
    const path = await writeTmpStats("future-dates.json", {
      totalSessions: 1,
      totalMessages: 10,
      dailyActivity: [
        { date: "2099-12-31", messageCount: 100, sessionCount: 1, toolCallCount: 0 },
        { date: "2026-02-12", messageCount: 5, sessionCount: 1, toolCallCount: 0 },
      ],
      modelUsage: {},
    });
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.todayActivity?.messageCount).toBe(5);
    expect(stats.weeklyActivity).toHaveLength(2);
  });

  test("handles negative numbers in stats", async () => {
    const path = await writeTmpStats("negative-nums.json", {
      totalSessions: -5,
      totalMessages: -100,
      dailyActivity: [{ date: "2026-02-12", messageCount: -50, sessionCount: -1, toolCallCount: -10 }],
      modelUsage: { "claude-opus-4-6": { inputTokens: -1000, outputTokens: -2000 } },
    });
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.totalSessions).toBe(-5);
    expect(stats.totalMessages).toBe(-100);
    expect(stats.todayActivity?.messageCount).toBe(-50);
    expect(stats.modelUsage["claude-opus-4-6"].inputTokens).toBe(-1000);
  });

  test("handles missing dailyActivity array", async () => {
    const path = await writeTmpStats("no-daily.json", {
      totalSessions: 10,
      totalMessages: 200,
      modelUsage: {},
    });
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.todayActivity).toBeNull();
    expect(stats.weeklyActivity).toEqual([]);
  });

  test("handles missing modelUsage", async () => {
    const path = await writeTmpStats("no-model.json", {
      totalSessions: 10,
      totalMessages: 200,
      dailyActivity: [],
    });
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.modelUsage).toEqual({});
  });

  test("handles dailyActivity entries with missing messageCount", async () => {
    const path = await writeTmpStats("missing-count.json", {
      totalSessions: 1,
      totalMessages: 1,
      dailyActivity: [{ date: "2026-02-12", sessionCount: 1, toolCallCount: 0 }],
      modelUsage: {},
    });
    const stats = await provider.parseStatsFromFile(path, "2026-02-12");
    expect(stats.todayActivity).not.toBeNull();
    expect(stats.todayActivity?.messageCount).toBeUndefined();
    expect(stats.weeklyActivity[0].messageCount).toBe(0);
  });
});
