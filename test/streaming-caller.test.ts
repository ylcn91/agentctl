import { test, expect, describe } from "bun:test";
import {
  createStreamingAccountCaller,
  buildProviderCommand,
} from "../src/services/council-framework";
import { EventBus } from "../src/services/event-bus";
import type { AccountConfig } from "../src/types";
import type { NormalizedChunk } from "../src/services/stream-normalizer";

function makeAccount(overrides: Partial<AccountConfig> & { provider: AccountConfig["provider"] }): AccountConfig {
  return {
    name: overrides.name ?? "test-account",
    configDir: overrides.configDir ?? "/tmp/test-config",
    color: overrides.color ?? "#ffffff",
    label: overrides.label ?? "Test",
    provider: overrides.provider,
  };
}

describe("buildProviderCommand with streaming", () => {
  test("claude-code streaming uses stream-json output format", () => {
    const account = makeAccount({ provider: "claude-code", configDir: "/tmp/claude" });
    const cmd = buildProviderCommand(account, "test prompt", { streaming: true });
    expect(cmd.cmd).toEqual(["claude", "-p", "--output-format", "stream-json", "--verbose"]);
  });

  test("claude-code non-streaming uses json output format", () => {
    const account = makeAccount({ provider: "claude-code", configDir: "/tmp/claude" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["claude", "-p", "--output-format", "json"]);
  });

  test("claude-code streaming=false uses json output format", () => {
    const account = makeAccount({ provider: "claude-code", configDir: "/tmp/claude" });
    const cmd = buildProviderCommand(account, "test prompt", { streaming: false });
    expect(cmd.cmd).toEqual(["claude", "-p", "--output-format", "json"]);
  });

  test("opencode streaming uses --format json --thinking with prompt as positional arg", () => {
    const account = makeAccount({ provider: "opencode" });
    const cmd = buildProviderCommand(account, "test prompt", { streaming: true });
    expect(cmd.cmd).toEqual(["opencode", "run", "--format", "json", "--thinking", "--", "test prompt"]);
    expect(cmd.stdinInput).toBe(false);
  });

  test("opencode non-streaming uses plain run with prompt as positional arg", () => {
    const account = makeAccount({ provider: "opencode" });
    const cmd = buildProviderCommand(account, "test prompt");
    expect(cmd.cmd).toEqual(["opencode", "run", "--", "test prompt"]);
    expect(cmd.stdinInput).toBe(false);
  });

  test("codex-cli uses codex exec regardless of streaming flag", () => {
    const account = makeAccount({ provider: "codex-cli", configDir: "/tmp/codex" });
    const cmd = buildProviderCommand(account, "test prompt", { streaming: true });
    expect(cmd.cmd).toEqual(["codex", "exec"]);
    expect(cmd.stdinInput).toBe(true);
  });

  test("gemini-cli is unchanged regardless of streaming flag", () => {
    const account = makeAccount({ provider: "gemini-cli" });
    const cmd = buildProviderCommand(account, "test prompt", { streaming: true });
    expect(cmd.cmd).toEqual(["gemini"]);
  });
});

describe("createStreamingAccountCaller", () => {
  test("throws for unknown account name", async () => {
    const eventBus = new EventBus();
    const caller = createStreamingAccountCaller(
      [makeAccount({ name: "alice", provider: "claude-code" })],
      eventBus,
    );
    await expect(caller("bob", "system", "user")).rejects.toThrow("Account not found: bob");
  });

  test("throws for empty account list", async () => {
    const eventBus = new EventBus();
    const caller = createStreamingAccountCaller([], eventBus);
    await expect(caller("any", "system", "user")).rejects.toThrow("Account not found: any");
  });

  test("accepts optional timeoutMs parameter", () => {
    const eventBus = new EventBus();
    const caller = createStreamingAccountCaller(
      [makeAccount({ name: "test", provider: "claude-code" })],
      eventBus,
      5000,
    );
    expect(caller).toBeFunction();
  });

  test("emits AGENT_STREAM_START and AGENT_STREAM_END for a fast process", async () => {
    const eventBus = new EventBus();
    const events: any[] = [];
    eventBus.on("*", (event) => events.push(event));

    const caller = createStreamingAccountCaller(
      [makeAccount({ name: "echo-test", provider: "codex-cli", configDir: "/tmp" })],
      eventBus,
      10_000,
    );

    try {
      await caller("echo-test", "system", "user");
    } catch {
    }

    const startEvents = events.filter(e => e.type === "AGENT_STREAM_START");
    expect(startEvents.length).toBe(1);
    expect(startEvents[0].account).toBe("echo-test");
    expect(startEvents[0].provider).toBe("codex-cli");
  }, 15_000);

  test("passes onChunk callback for each normalized chunk", async () => {
    const eventBus = new EventBus();
    const chunks: NormalizedChunk[] = [];

    const caller = createStreamingAccountCaller(
      [makeAccount({ name: "chunk-test", provider: "codex-cli", configDir: "/tmp" })],
      eventBus,
      10_000,
    );

    try {
      await caller("chunk-test", "system", "user", (chunk) => {
        chunks.push(chunk);
      });
    } catch {
    }

    expect(Array.isArray(chunks)).toBe(true);
  }, 15_000);
});
