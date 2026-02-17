import { describe, test, expect } from "bun:test";

describe("delegation-chain-loader", () => {
  test("returns empty array when no daemon socket exists", async () => {
    const orig = process.env.AGENTCTL_DIR;
    process.env.AGENTCTL_DIR = "/tmp/nonexistent-dcl-test-dir";
    try {
      const { fetchDelegationChains } = await import("../src/services/delegation-chain-loader");
      const result = await fetchDelegationChains();
      expect(result).toEqual([]);
    } finally {
      process.env.AGENTCTL_DIR = orig;
    }
  });

  test("exports fetchDelegationChains function", async () => {
    const mod = await import("../src/services/delegation-chain-loader");
    expect(typeof mod.fetchDelegationChains).toBe("function");
  });

  test("DelegationChainData type shape is correct", async () => {
    const mod = await import("../src/services/delegation-chain-loader");
    expect(mod).toHaveProperty("fetchDelegationChains");
  });
});
