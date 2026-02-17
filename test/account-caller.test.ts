import { test, expect, describe } from "bun:test";
import { buildProviderCommand, createAccountCaller } from "../src/services/council";
import type { AccountConfig } from "../src/types";

function makeAccount(overrides: Partial<AccountConfig> & { provider: AccountConfig["provider"] }): AccountConfig {
  return {
    name: overrides.name ?? "test-account",
    configDir: overrides.configDir ?? "/tmp/test-config",
    color: overrides.color ?? "#ffffff",
    label: overrides.label ?? "Test",
    provider: overrides.provider,
  };
}

describe("buildProviderCommand", () => {
  test("claude-code provider uses claude -p with json output", () => {
    const account = makeAccount({ provider: "claude-code", configDir: "/tmp/claude" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["claude", "-p", "--output-format", "json"]);
    expect(cmd.env.CLAUDE_CONFIG_DIR).toBe("/tmp/claude");
  });

  test("claude-code parseOutput extracts result from JSON", () => {
    const account = makeAccount({ provider: "claude-code" });
    const { parseOutput } = buildProviderCommand(account, "test");
    const output = parseOutput(JSON.stringify({ result: "hello world" }));
    expect(output).toBe("hello world");
  });

  test("claude-code parseOutput returns raw stdout when JSON has no result field", () => {
    const account = makeAccount({ provider: "claude-code" });
    const { parseOutput } = buildProviderCommand(account, "test");
    const output = parseOutput(JSON.stringify({ other: "data" }));
    expect(output).toBe(JSON.stringify({ other: "data" }));
  });

  test("claude-code parseOutput returns raw stdout for non-JSON", () => {
    const account = makeAccount({ provider: "claude-code" });
    const { parseOutput } = buildProviderCommand(account, "test");
    const output = parseOutput("plain text output");
    expect(output).toBe("plain text output");
  });

  test("codex-cli provider uses codex exec with CODEX_HOME env", () => {
    const account = makeAccount({ provider: "codex-cli", configDir: "/tmp/codex" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["codex", "exec"]);
    expect(cmd.env.CODEX_HOME).toBe("/tmp/codex");
    expect(cmd.stdinInput).toBe(true);
  });

  test("codex-cli parseOutput returns stdout as-is", () => {
    const account = makeAccount({ provider: "codex-cli" });
    const { parseOutput } = buildProviderCommand(account, "test");
    expect(parseOutput("raw output")).toBe("raw output");
  });

  test("opencode provider uses opencode run with prompt as positional arg", () => {
    const account = makeAccount({ provider: "opencode" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["opencode", "run", "--", "test prompt"]);
    expect(cmd.stdinInput).toBe(false);
  });

  test("opencode parseOutput returns stdout as-is", () => {
    const account = makeAccount({ provider: "opencode" });
    const { parseOutput } = buildProviderCommand(account, "test");
    expect(parseOutput("output")).toBe("output");
  });

  test("cursor-agent provider uses agent -p with json output", () => {
    const account = makeAccount({ provider: "cursor-agent" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["agent", "-p", "--output-format", "json"]);
    expect(cmd.stdinInput).toBe(true);
  });

  test("cursor-agent parseOutput returns stdout as-is", () => {
    const account = makeAccount({ provider: "cursor-agent" });
    const { parseOutput } = buildProviderCommand(account, "test");
    expect(parseOutput("output")).toBe("output");
  });

  test("gemini-cli provider uses gemini", () => {
    const account = makeAccount({ provider: "gemini-cli" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["gemini"]);
  });

  test("gemini-cli parseOutput returns stdout as-is", () => {
    const account = makeAccount({ provider: "gemini-cli" });
    const { parseOutput } = buildProviderCommand(account, "test");
    expect(parseOutput("output")).toBe("output");
  });

  test("openhands provider uses openhands", () => {
    const account = makeAccount({ provider: "openhands" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["openhands"]);
  });

  test("openhands parseOutput returns stdout as-is", () => {
    const account = makeAccount({ provider: "openhands" });
    const { parseOutput } = buildProviderCommand(account, "test");
    expect(parseOutput("output")).toBe("output");
  });

  test("throws for unsupported provider", () => {
    const account = { name: "x", configDir: "/tmp", color: "", label: "", provider: "unknown" as any };
    expect(() => buildProviderCommand(account, "test")).toThrow("Unsupported provider: unknown");
  });

  test("all providers return an env object", () => {
    const providers = ["claude-code", "codex-cli", "opencode", "cursor-agent", "gemini-cli", "openhands"] as const;
    for (const provider of providers) {
      const account = makeAccount({ provider });
      const cmd = buildProviderCommand(account, "test");
      expect(typeof cmd.env).toBe("object");
    }
  });
});

describe("createAccountCaller", () => {
  test("throws for unknown account name", async () => {
    const caller = createAccountCaller([
      makeAccount({ name: "alice", provider: "claude-code" }),
    ]);

    await expect(caller("bob", "system", "user")).rejects.toThrow("Account not found: bob");
  });

  test("throws for empty account list", async () => {
    const caller = createAccountCaller([]);
    await expect(caller("any", "system", "user")).rejects.toThrow("Account not found: any");
  });

  test("maps multiple accounts by name", async () => {
    const accounts = [
      makeAccount({ name: "alice", provider: "claude-code" }),
      makeAccount({ name: "bob", provider: "codex-cli" }),
    ];
    const caller = createAccountCaller(accounts, 1000);

    const aliceResult = caller("alice", "sys", "usr").catch((e: Error) => e.message);
    const bobResult = caller("bob", "sys", "usr").catch((e: Error) => e.message);

    const [a, b] = await Promise.all([aliceResult, bobResult]);
    expect(a).not.toContain("Account not found");
    expect(b).not.toContain("Account not found");
  });
});
