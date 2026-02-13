import { describe, test, expect } from "bun:test";
import { isEntireInstalled, parseCheckpointMetadata } from "../src/services/entire";

describe("entire integration", () => {
  test("detects if entire CLI is installed", async () => {
    const installed = await isEntireInstalled();
    expect(typeof installed).toBe("boolean");
    // This test is environment-dependent - just verify it returns a boolean
  });

  test("parses checkpoint metadata JSON", () => {
    const raw = {
      checkpoint_id: "732abe6dd3e4",
      session_id: "uuid-123",
      strategy: "manual-commit",
      branch: "feat/auth",
      files_touched: ["src/auth.ts"],
      token_usage: { input_tokens: 163, output_tokens: 8557, api_call_count: 107 },
    };
    const parsed = parseCheckpointMetadata(raw);
    expect(parsed.checkpointId).toBe("732abe6dd3e4");
    expect(parsed.branch).toBe("feat/auth");
    expect(parsed.tokenUsage.outputTokens).toBe(8557);
  });

  test("parseCheckpointMetadata handles missing fields gracefully", () => {
    const parsed = parseCheckpointMetadata({});
    expect(parsed.checkpointId).toBe("");
    expect(parsed.branch).toBe("");
    expect(parsed.tokenUsage.outputTokens).toBe(0);
  });

  test("parseCheckpointMetadata handles null input", () => {
    const parsed = parseCheckpointMetadata(null);
    expect(parsed.checkpointId).toBe("");
  });

  test("parseCheckpointMetadata handles undefined input", () => {
    const parsed = parseCheckpointMetadata(undefined);
    expect(parsed.checkpointId).toBe("");
    expect(parsed.sessionId).toBe("");
    expect(parsed.branch).toBe("");
    expect(parsed.filesTouched).toEqual([]);
    expect(parsed.tokenUsage.inputTokens).toBe(0);
  });

  test("parseCheckpointMetadata handles string input", () => {
    const parsed = parseCheckpointMetadata("not an object");
    expect(parsed.checkpointId).toBe("");
  });

  test("parseCheckpointMetadata with missing checkpoint_id only", () => {
    const parsed = parseCheckpointMetadata({
      session_id: "uuid-abc",
      branch: "main",
      files_touched: ["a.ts"],
      token_usage: { input_tokens: 10, output_tokens: 20, api_call_count: 5 },
    });
    expect(parsed.checkpointId).toBe("");
    expect(parsed.sessionId).toBe("uuid-abc");
    expect(parsed.branch).toBe("main");
  });

  test("parseCheckpointMetadata with missing session_id only", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc123",
      branch: "dev",
      files_touched: ["b.ts"],
      token_usage: { input_tokens: 1, output_tokens: 2, api_call_count: 3 },
    });
    expect(parsed.checkpointId).toBe("abc123");
    expect(parsed.sessionId).toBe("");
  });

  test("parseCheckpointMetadata with missing branch only", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc123",
      session_id: "uuid-def",
      files_touched: ["c.ts"],
      token_usage: { input_tokens: 1, output_tokens: 2, api_call_count: 3 },
    });
    expect(parsed.branch).toBe("");
    expect(parsed.checkpointId).toBe("abc123");
  });

  test("parseCheckpointMetadata with missing files_touched only", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc123",
      session_id: "uuid-ghi",
      branch: "feat/x",
      token_usage: { input_tokens: 1, output_tokens: 2, api_call_count: 3 },
    });
    expect(parsed.filesTouched).toEqual([]);
  });

  test("parseCheckpointMetadata with non-array files_touched", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc123",
      files_touched: "not-an-array",
      token_usage: { input_tokens: 1, output_tokens: 2, api_call_count: 3 },
    });
    expect(parsed.filesTouched).toEqual([]);
  });

  test("parseCheckpointMetadata with missing token_usage only", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc123",
      session_id: "uuid-jkl",
      branch: "main",
      files_touched: ["d.ts"],
    });
    expect(parsed.tokenUsage.inputTokens).toBe(0);
    expect(parsed.tokenUsage.outputTokens).toBe(0);
    expect(parsed.tokenUsage.apiCallCount).toBe(0);
  });

  test("parseCheckpointMetadata with partial token_usage", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc",
      token_usage: { input_tokens: 100 },
    });
    expect(parsed.tokenUsage.inputTokens).toBe(100);
    expect(parsed.tokenUsage.outputTokens).toBe(0);
    expect(parsed.tokenUsage.apiCallCount).toBe(0);
  });

  test("parseCheckpointMetadata preserves created_at when present", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc",
      created_at: "2026-02-12T10:00:00Z",
    });
    expect(parsed.createdAt).toBe("2026-02-12T10:00:00Z");
  });

  test("parseCheckpointMetadata has undefined createdAt when missing", () => {
    const parsed = parseCheckpointMetadata({
      checkpoint_id: "abc",
    });
    expect(parsed.createdAt).toBeUndefined();
  });
});
