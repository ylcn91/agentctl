import { describe, test, expect } from "bun:test";

describe("health-loader", () => {
  test("returns empty array when no daemon socket exists", async () => {
    const orig = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = "/tmp/nonexistent-hl-test-dir";
    try {
      const { fetchHealthStatus } = await import("../src/services/health-loader");
      const result = await fetchHealthStatus();
      expect(result).toEqual([]);
    } finally {
      process.env.AGENTCTL_DIR = orig;
    }
  });

  test("exports fetchHealthStatus function", async () => {
    const mod = await import("../src/services/health-loader");
    expect(typeof mod.fetchHealthStatus).toBe("function");
  });
});
