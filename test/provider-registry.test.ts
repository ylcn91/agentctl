import { describe, test, expect } from "bun:test";
import { ProviderRegistry } from "../src/providers/registry";
import { ClaudeCodeProvider } from "../src/providers/claude-code";
import type { AgentProvider } from "../src/providers/types";

describe("ProviderRegistry", () => {
  test("registers and retrieves a provider", () => {
    const registry = new ProviderRegistry();
    const provider = new ClaudeCodeProvider();
    registry.register(provider);
    expect(registry.get("claude-code")).toBe(provider);
  });

  test("returns undefined for unregistered provider", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  test("lists all registered providers", () => {
    const registry = new ProviderRegistry();
    registry.register(new ClaudeCodeProvider());
    const ids = registry.listIds();
    expect(ids).toEqual(["claude-code"]);
  });

  test("rejects duplicate registration", () => {
    const registry = new ProviderRegistry();
    registry.register(new ClaudeCodeProvider());
    expect(() => registry.register(new ClaudeCodeProvider())).toThrow(
      "Provider 'claude-code' is already registered"
    );
  });
});
