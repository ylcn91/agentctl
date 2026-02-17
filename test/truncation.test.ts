
import { test, expect, describe, beforeEach } from "bun:test";

const TEST_HUB_DIR = "/tmp/agentctl-test-truncation";

const savedAgentctlDir = process.env.AGENTCTL_DIR;
process.env.AGENTCTL_DIR = TEST_HUB_DIR;

import {
  truncateOutput,
  cleanupSpillFiles,
  getSpillDir,
  MAX_LINES,
  MAX_BYTES,
} from "../src/services/truncation";

import { mkdir, rm, readdir, readFile } from "node:fs/promises";

if (savedAgentctlDir === undefined) {
  delete process.env.AGENTCTL_DIR;
} else {
  process.env.AGENTCTL_DIR = savedAgentctlDir;
}

const spillDir = `${TEST_HUB_DIR}/tool-output`;

beforeEach(async () => {
  // Set env for each test since other tests may have changed it
  process.env.AGENTCTL_DIR = TEST_HUB_DIR;
  // Clean up spill directory before each test
  await rm(spillDir, { recursive: true, force: true });
  await mkdir(spillDir, { recursive: true });
});

// ── Constants ──

describe("constants", () => {
  test("MAX_LINES is 2000", () => {
    expect(MAX_LINES).toBe(2000);
  });

  test("MAX_BYTES is 50KB", () => {
    expect(MAX_BYTES).toBe(50 * 1024);
  });

  test("getSpillDir returns correct path", () => {
    expect(getSpillDir()).toBe(`${TEST_HUB_DIR}/tool-output`);
  });
});

// ── truncateOutput: pass-through ──

describe("truncateOutput — under limit", () => {
  test("short text passes through unchanged", async () => {
    const text = "hello world\nsecond line";
    const result = await truncateOutput(text);
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(text);
  });

  test("empty string passes through", async () => {
    const result = await truncateOutput("");
    expect(result.truncated).toBe(false);
    expect(result.content).toBe("");
  });

  test("exactly at line limit passes through", async () => {
    const lines = Array.from({ length: MAX_LINES }, (_, i) => `line ${i}`);
    const text = lines.join("\n");
    // Only passes if also under byte limit
    if (Buffer.byteLength(text, "utf-8") <= MAX_BYTES) {
      const result = await truncateOutput(text);
      expect(result.truncated).toBe(false);
    }
  });
});

// ── truncateOutput: line limit ──

describe("truncateOutput — over line limit", () => {
  test("truncates when exceeding line count", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i}`);
    const text = lines.join("\n");
    const result = await truncateOutput(text, { maxLines: 10, maxBytes: 1_000_000 });
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");
    // Head direction: first 10 lines should be present
    expect(result.content).toContain("L0");
    expect(result.content).toContain("L9");
    expect(result.content).not.toContain("\nL10\n");
    expect(result.content).toContain("90 lines truncated");
    expect(result.content).toContain("Full output saved to:");
  });

  test("truncates tail direction keeps last N lines", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}`);
    const text = lines.join("\n");
    const result = await truncateOutput(text, { maxLines: 10, maxBytes: 1_000_000, direction: "tail" });
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");
    // Tail direction: last 10 lines should be present
    expect(result.content).toContain("L49");
    expect(result.content).toContain("L40");
    expect(result.content).toContain("40 lines truncated");
  });
});

// ── truncateOutput: byte limit ──

describe("truncateOutput — over byte limit", () => {
  test("truncates when exceeding byte limit", async () => {
    // Each line is ~100 bytes, 10 lines = ~1000 bytes. Set byte limit to 500.
    const lines = Array.from({ length: 10 }, (_, i) => `line-${i}-${"x".repeat(90)}`);
    const text = lines.join("\n");
    const result = await truncateOutput(text, { maxLines: 100_000, maxBytes: 500 });
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");
    expect(result.content).toContain("bytes truncated");
    expect(result.content).toContain("Full output saved to:");
  });

  test("byte limit respected with multibyte characters", async () => {
    // Each emoji is 4 bytes UTF-8. Create lines with many emojis.
    const emojiLine = "\u{1F525}".repeat(50); // 200 bytes per line
    const lines = Array.from({ length: 20 }, () => emojiLine);
    const text = lines.join("\n");
    const result = await truncateOutput(text, { maxLines: 100_000, maxBytes: 500 });
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");
    // The kept portion should be under the byte limit
    const keptPortion = result.content.split("\n\n...")[0];
    expect(Buffer.byteLength(keptPortion, "utf-8")).toBeLessThanOrEqual(500);
  });
});

// ── truncateOutput: spill file ──

describe("truncateOutput — spill file creation", () => {
  test("creates spill file with full content", async () => {
    const lines = Array.from({ length: 50 }, (_, i) => `data-${i}`);
    const text = lines.join("\n");
    const result = await truncateOutput(text, { maxLines: 5 });
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");

    // Spill file should exist and contain original content
    const spillContent = await readFile(result.spillPath, "utf-8");
    expect(spillContent).toBe(text);
  });

  test("spill file has timestamp-based name", async () => {
    const text = "x\n".repeat(100);
    const before = Date.now();
    const result = await truncateOutput(text, { maxLines: 5 });
    const after = Date.now();
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");

    const filename = result.spillPath.split("/").pop()!;
    expect(filename).toMatch(/^tool_\d+\.txt$/);
    const ts = parseInt(filename.match(/tool_(\d+)\.txt/)![1], 10);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("result content includes hint about spill file", async () => {
    const text = "x\n".repeat(100);
    const result = await truncateOutput(text, { maxLines: 5 });
    expect(result.truncated).toBe(true);
    if (!result.truncated) throw new Error("expected truncated");
    expect(result.content).toContain("Use Grep to search the full content");
    expect(result.content).toContain("Read with offset/limit");
  });
});

// ── cleanupSpillFiles ──

describe("cleanupSpillFiles", () => {
  test("removes files older than maxAgeDays", async () => {
    const oldTimestamp = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
    const recentTimestamp = Date.now() - 1000; // 1 second ago
    await Bun.write(`${spillDir}/tool_${oldTimestamp}.txt`, "old data");
    await Bun.write(`${spillDir}/tool_${recentTimestamp}.txt`, "recent data");

    const cleaned = await cleanupSpillFiles(7);
    expect(cleaned).toBe(1);

    const remaining = await readdir(spillDir);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toBe(`tool_${recentTimestamp}.txt`);
  });

  test("keeps files within retention window", async () => {
    const recentTimestamp = Date.now() - 1000;
    await Bun.write(`${spillDir}/tool_${recentTimestamp}.txt`, "recent");

    const cleaned = await cleanupSpillFiles(7);
    expect(cleaned).toBe(0);
    const remaining = await readdir(spillDir);
    expect(remaining).toHaveLength(1);
  });

  test("handles missing spill directory gracefully", async () => {
    await rm(spillDir, { recursive: true, force: true });
    const cleaned = await cleanupSpillFiles(7);
    expect(cleaned).toBe(0);
  });

  test("ignores non-matching filenames", async () => {
    await Bun.write(`${spillDir}/not_a_tool_file.txt`, "data");
    await Bun.write(`${spillDir}/tool_abc.txt`, "bad timestamp");
    const oldTs = Date.now() - 10 * 24 * 60 * 60 * 1000;
    await Bun.write(`${spillDir}/tool_${oldTs}.txt`, "old data");

    const cleaned = await cleanupSpillFiles(7);
    expect(cleaned).toBe(1); // only the valid old one
    const remaining = await readdir(spillDir);
    expect(remaining).toHaveLength(2); // the two non-matching files remain
  });

  test("batch cleanup of multiple old files", async () => {
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const ts = now - (10 + i) * 24 * 60 * 60 * 1000; // 10-14 days ago
      await Bun.write(`${spillDir}/tool_${ts}.txt`, `old-${i}`);
    }
    const recentTs = now - 1000;
    await Bun.write(`${spillDir}/tool_${recentTs}.txt`, "recent");

    const cleaned = await cleanupSpillFiles(7);
    expect(cleaned).toBe(5);
    const remaining = await readdir(spillDir);
    expect(remaining).toHaveLength(1);
  });

  test("respects custom maxAgeDays", async () => {
    const ts2daysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    await Bun.write(`${spillDir}/tool_${ts2daysAgo}.txt`, "2 days old");

    // With 7-day retention, should keep
    let cleaned = await cleanupSpillFiles(7);
    expect(cleaned).toBe(0);

    // With 1-day retention, should remove
    cleaned = await cleanupSpillFiles(1);
    expect(cleaned).toBe(1);
  });
});
