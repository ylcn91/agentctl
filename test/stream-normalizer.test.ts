import { test, expect, describe } from "bun:test";
import {
  normalizeClaudeCodeEvent,
  normalizeOpenCodeEvent,
  normalizePlainTextLine,
  getNormalizer,
} from "../src/services/stream-normalizer";

describe("normalizeClaudeCodeEvent", () => {
  test("parses system event", () => {
    const result = normalizeClaudeCodeEvent({ type: "system", subtype: "init" });
    expect(result).toEqual({ chunkType: "system", content: "init" });
  });

  test("parses system event without subtype", () => {
    const result = normalizeClaudeCodeEvent({ type: "system" });
    expect(result).toEqual({ chunkType: "system", content: "session_start" });
  });

  test("parses assistant text block", () => {
    const result = normalizeClaudeCodeEvent({
      type: "assistant",
      message: { content: [{ type: "text", text: "Hello world" }] },
    });
    expect(result).toEqual({ chunkType: "text", content: "Hello world" });
  });

  test("parses assistant thinking block", () => {
    const result = normalizeClaudeCodeEvent({
      type: "assistant",
      message: { content: [{ type: "thinking", thinking: "Analyzing..." }] },
    });
    expect(result).toEqual({ chunkType: "thinking", content: "Analyzing..." });
  });

  test("parses assistant tool_use block", () => {
    const result = normalizeClaudeCodeEvent({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { path: "/tmp" } }] },
    });
    expect(result!.chunkType).toBe("tool_use");
    expect(result!.toolName).toBe("Read");
    expect(result!.toolInput).toContain("/tmp");
  });

  test("parses assistant tool_result block", () => {
    const result = normalizeClaudeCodeEvent({
      type: "assistant",
      message: { content: [{ type: "tool_result", content: "file contents here" }] },
    });
    expect(result).toEqual({ chunkType: "tool_result", content: "file contents here" });
  });

  test("parses result event with cost_usd and usage", () => {
    const result = normalizeClaudeCodeEvent({
      type: "result",
      result: "Final answer",
      cost_usd: 0.05,
      usage: { input_tokens: 100, output_tokens: 200 },
    });
    expect(result!.chunkType).toBe("system");
    expect(result!.content).toBe("Final answer");
    expect(result!.cost).toBe(0.05);
    expect(result!.tokenUsage).toEqual({ input: 100, output: 200 });
  });

  test("parses result event with total_cost_usd (real CLI format)", () => {
    const result = normalizeClaudeCodeEvent({
      type: "result",
      subtype: "success",
      result: "OK",
      total_cost_usd: 0.06574575,
      usage: { input_tokens: 2, output_tokens: 4, cache_read_input_tokens: 30234 },
    });
    expect(result!.chunkType).toBe("system");
    expect(result!.content).toBe("OK");
    expect(result!.cost).toBe(0.06574575);
    expect(result!.tokenUsage).toEqual({ input: 2, output: 4 });
  });

  test("returns null for unknown event type", () => {
    expect(normalizeClaudeCodeEvent({ type: "unknown" })).toBeNull();
  });

  test("returns null for null/undefined input", () => {
    expect(normalizeClaudeCodeEvent(null)).toBeNull();
    expect(normalizeClaudeCodeEvent(undefined)).toBeNull();
  });

  test("returns null for assistant with no content", () => {
    expect(normalizeClaudeCodeEvent({ type: "assistant", message: {} })).toBeNull();
    expect(normalizeClaudeCodeEvent({ type: "assistant", message: null })).toBeNull();
  });

  test("handles string content blocks", () => {
    const result = normalizeClaudeCodeEvent({
      type: "assistant",
      message: { content: ["plain string"] },
    });
    expect(result).toEqual({ chunkType: "text", content: "plain string" });
  });
});

describe("normalizeOpenCodeEvent", () => {
  test("parses text event", () => {
    const result = normalizeOpenCodeEvent({ type: "text", text: "Hello" });
    expect(result).toEqual({ chunkType: "text", content: "Hello" });
  });

  test("parses reasoning event", () => {
    const result = normalizeOpenCodeEvent({ type: "reasoning", reasoning: "Thinking..." });
    expect(result).toEqual({ chunkType: "thinking", content: "Thinking..." });
  });

  test("parses tool_use event", () => {
    const result = normalizeOpenCodeEvent({ type: "tool_use", name: "file_read", input: { path: "/tmp" } });
    expect(result!.chunkType).toBe("tool_use");
    expect(result!.toolName).toBe("file_read");
  });

  test("parses tool_result event", () => {
    const result = normalizeOpenCodeEvent({ type: "tool_result", output: "contents" });
    expect(result).toEqual({ chunkType: "tool_result", content: "contents" });
  });

  test("parses session.status event", () => {
    const result = normalizeOpenCodeEvent({ type: "session.status", status: "running" });
    expect(result!.chunkType).toBe("system");
    expect(result!.content).toBe("running");
  });

  test("parses session.complete event with cost", () => {
    const result = normalizeOpenCodeEvent({
      type: "session.complete",
      cost: 0.02,
      usage: { input_tokens: 50, output_tokens: 100 },
    });
    expect(result!.chunkType).toBe("system");
    expect(result!.cost).toBe(0.02);
    expect(result!.tokenUsage).toEqual({ input: 50, output: 100 });
  });

  test("returns null for unknown event type", () => {
    expect(normalizeOpenCodeEvent({ type: "unknown" })).toBeNull();
  });

  test("returns null for null/undefined input", () => {
    expect(normalizeOpenCodeEvent(null)).toBeNull();
    expect(normalizeOpenCodeEvent(undefined)).toBeNull();
  });
});

describe("normalizePlainTextLine", () => {
  test("wraps plain text as text chunk", () => {
    const result = normalizePlainTextLine("Hello world");
    expect(result).toEqual({ chunkType: "text", content: "Hello world" });
  });

  test("handles empty string", () => {
    const result = normalizePlainTextLine("");
    expect(result).toEqual({ chunkType: "text", content: "" });
  });
});

describe("getNormalizer", () => {
  test("returns claude-code normalizer", () => {
    const normalizer = getNormalizer("claude-code");
    const result = normalizer({ type: "system", subtype: "init" });
    expect(result!.chunkType).toBe("system");
  });

  test("returns opencode normalizer", () => {
    const normalizer = getNormalizer("opencode");
    const result = normalizer({ type: "text", text: "hello" });
    expect(result!.chunkType).toBe("text");
  });

  test("returns plain text normalizer for codex-cli", () => {
    const normalizer = getNormalizer("codex-cli");
    const result = normalizer("hello");
    expect(result!.chunkType).toBe("text");
    expect(result!.content).toBe("hello");
  });

  test("returns plain text normalizer for gemini-cli", () => {
    const normalizer = getNormalizer("gemini-cli");
    const result = normalizer("hello");
    expect(result!.chunkType).toBe("text");
  });

  test("handles object input for plain text providers", () => {
    const normalizer = getNormalizer("codex-cli");
    const result = normalizer({ key: "value" });
    expect(result!.chunkType).toBe("text");
    expect(result!.content).toContain("key");
  });

  test("returns null for null input on plain text providers", () => {
    const normalizer = getNormalizer("codex-cli");
    const result = normalizer(null);
    expect(result).toBeNull();
  });
});
