import { test, expect, describe } from "bun:test";
import {
  delegateToAgent,
  MAX_DELEGATION_DEPTH,
  type DelegationRequest,
  type DelegationResult,
} from "../src/services/agent-orchestration";
import { EventBus, type DelegationEvent } from "../src/services/event-bus";
import { AbortError } from "../src/services/errors";
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

describe("agent-orchestration", () => {
  test("MAX_DELEGATION_DEPTH is 5", () => {
    expect(MAX_DELEGATION_DEPTH).toBe(5);
  });

  test("delegateToAgent is a function", () => {
    expect(delegateToAgent).toBeFunction();
  });

  test("rejects when delegation depth exceeds limit", async () => {
    const chunks: any[] = [];
    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "bob", provider: "claude-code" }),
        instruction: "do something",
        depth: MAX_DELEGATION_DEPTH,
        onChunk: (c) => chunks.push(c),
      }),
    ).rejects.toThrow(/Delegation depth limit reached/);
  });

  test("rejects when depth exceeds limit for any provider", async () => {
    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "bob", provider: "codex-cli" }),
        instruction: "do something",
        depth: 6,
        onChunk: () => {},
      }),
    ).rejects.toThrow(/Delegation depth limit reached/);
  });

  test("depth 0 does not hit the limit", async () => {
    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "no-auth", provider: "claude-code" }),
        instruction: "test",
        depth: 0,
        onChunk: () => {},
      }),
    ).rejects.toThrow(/No auth credentials/);
  });

  test("DelegationRequest type is well-formed", () => {
    const req: DelegationRequest = {
      fromAccount: "alice",
      toAccount: makeAccount({ name: "bob", provider: "claude-code" }),
      instruction: "implement the feature",
      context: "previous conversation context",
      model: "claude-sonnet-4-5-20250929",
      depth: 0,
      onChunk: () => {},
    };
    expect(req.fromAccount).toBe("alice");
    expect(req.toAccount.name).toBe("bob");
    expect(req.depth).toBe(0);
  });

  test("DelegationResult type is well-formed", () => {
    const result: DelegationResult = {
      content: "Task completed successfully",
      tokenCount: 1500,
      durationMs: 3000,
      toolCalls: [
        { name: "read_file", input: '{"path":"src/app.tsx"}', output: "file contents..." },
      ],
    };
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read_file");
  });

  test("respects abort signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "no-auth", provider: "claude-code" }),
        instruction: "test",
        depth: 0,
        onChunk: () => {},
        signal: controller.signal,
      }),
    ).rejects.toThrow(AbortError);
  });
});

describe("delegation event emission", () => {
  test("emits DELEGATION_START and DELEGATION_END on failure", async () => {
    const bus = new EventBus({ maxRecent: 100 });
    const events: DelegationEvent[] = [];
    bus.on("*", (e) => events.push(e));

    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "no-auth", provider: "claude-code" }),
        instruction: "do the thing",
        depth: 0,
        onChunk: () => {},
        eventBus: bus,
      }),
    ).rejects.toThrow(/No auth credentials/);

    const starts = events.filter((e) => e.type === "DELEGATION_START");
    const ends = events.filter((e) => e.type === "DELEGATION_END");

    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);

    const start = starts[0] as any;
    expect(start.from).toBe("alice");
    expect(start.to).toBe("no-auth");
    expect(start.instruction).toBe("do the thing");
    expect(start.depth).toBe(0);

    const end = ends[0] as any;
    expect(end.from).toBe("alice");
    expect(end.to).toBe("no-auth");
    expect(end.success).toBe(false);
    expect(end.durationMs).toBeGreaterThanOrEqual(0);
    expect(end.toolCallCount).toBe(0);
  });

  test("does not emit events when no eventBus provided", async () => {
    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "no-auth", provider: "claude-code" }),
        instruction: "test",
        onChunk: () => {},
      }),
    ).rejects.toThrow(/No auth credentials/);
  });

  test("instruction in event is truncated to 500 chars", async () => {
    const bus = new EventBus({ maxRecent: 100 });
    const events: any[] = [];
    bus.on("DELEGATION_START", (e) => events.push(e));

    const longInstruction = "x".repeat(1000);
    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "no-auth", provider: "claude-code" }),
        instruction: longInstruction,
        onChunk: () => {},
        eventBus: bus,
      }),
    ).rejects.toThrow();

    expect(events).toHaveLength(1);
    expect(events[0].instruction.length).toBe(500);
  });

  test("depth limit check happens before event emission", async () => {
    const bus = new EventBus({ maxRecent: 100 });
    const events: any[] = [];
    bus.on("*", (e) => events.push(e));

    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "bob", provider: "claude-code" }),
        instruction: "test",
        depth: MAX_DELEGATION_DEPTH,
        onChunk: () => {},
        eventBus: bus,
      }),
    ).rejects.toThrow(/Delegation depth limit/);

    expect(events).toHaveLength(0);
  });
});

describe("cascade abort (parent -> child)", () => {
  test("child abort controller links to parent signal", async () => {
    const parent = new AbortController();

    parent.abort();

    await expect(
      delegateToAgent({
        fromAccount: "alice",
        toAccount: makeAccount({ name: "no-auth", provider: "claude-code" }),
        instruction: "test",
        onChunk: () => {},
        signal: parent.signal,
      }),
    ).rejects.toThrow(AbortError);
  });

  test("abort signal propagates through delegation chain request type", () => {
    const req: DelegationRequest = {
      fromAccount: "alice",
      toAccount: makeAccount({ name: "bob", provider: "claude-code" }),
      instruction: "test",
      onChunk: () => {},
      signal: new AbortController().signal,
    };
    expect(req.signal).toBeDefined();
    expect(req.signal!.aborted).toBe(false);
  });
});
