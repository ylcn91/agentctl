import { describe, test, expect } from "bun:test";
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
