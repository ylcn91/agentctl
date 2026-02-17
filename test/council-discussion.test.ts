import { test, expect, describe } from "bun:test";
import type {
  DiscussionMessage,
  ToolCallSummary,
  DiscussionConfig,
  DiscussionResult,
  DiscussionEvent,
} from "../src/services/council-discussion";
import { runCouncilDiscussion } from "../src/services/council-discussion";
import {
  formatPriorMessages,
  BoundedContentAccumulator,
  formatToolCallsSummary,
  measureMessages,
  stripToolPreviews,
  compactForDecision,
  COMPACTION_THRESHOLD_BYTES,
  MAX_MEMBER_CONTENT_CHARS,
} from "../src/services/council-formatting";

describe("DiscussionMessage type", () => {
  test("has expected shape", () => {
    const msg: DiscussionMessage = {
      id: "test-id",
      account: "alice",
      phase: "research",
      content: "Found the bug in handler.ts",
      timestamp: new Date().toISOString(),
    };
    expect(msg.id).toBe("test-id");
    expect(msg.phase).toBe("research");
    expect(msg.round).toBeUndefined();
    expect(msg.toolCalls).toBeUndefined();
  });

  test("supports optional round and toolCalls", () => {
    const msg: DiscussionMessage = {
      id: "test-id-2",
      account: "bob",
      phase: "discussion",
      round: 1,
      content: "I agree with alice's findings",
      toolCalls: [{ name: "read_file", input: "src/app.ts", output: "..." }],
      timestamp: new Date().toISOString(),
    };
    expect(msg.round).toBe(1);
    expect(msg.toolCalls).toHaveLength(1);
    expect(msg.toolCalls![0].name).toBe("read_file");
  });
});

describe("ToolCallSummary type", () => {
  test("has expected shape", () => {
    const tc: ToolCallSummary = {
      name: "grep",
      input: "error",
      output: "src/handler.ts:42: throw new Error(...)",
    };
    expect(tc.name).toBe("grep");
    expect(tc.input).toBe("error");
    expect(tc.output).toContain("handler.ts");
  });
});

describe("DiscussionConfig type", () => {
  test("has expected required fields", () => {
    const config: DiscussionConfig = {
      accounts: [],
      members: ["alice", "bob"],
      chairman: "alice",
      goal: "Analyze error handling",
    };
    expect(config.members).toHaveLength(2);
    expect(config.chairman).toBe("alice");
    expect(config.maxRounds).toBeUndefined();
  });

  test("supports optional fields with defaults", () => {
    const config: DiscussionConfig = {
      accounts: [],
      members: ["a"],
      chairman: "a",
      goal: "test",
      maxRounds: 3,
      researchTimeoutMs: 60_000,
      discussionTimeoutMs: 30_000,
      decisionTimeoutMs: 60_000,
      context: "Focus on daemon handlers",
    };
    expect(config.maxRounds).toBe(3);
    expect(config.researchTimeoutMs).toBe(60_000);
    expect(config.context).toBe("Focus on daemon handlers");
  });
});

describe("DiscussionResult type", () => {
  test("has expected shape", () => {
    const result: DiscussionResult = {
      goal: "test goal",
      research: [],
      discussion: [],
      decision: null,
      timestamp: new Date().toISOString(),
    };
    expect(result.goal).toBe("test goal");
    expect(result.decision).toBeNull();
    expect(result.research).toEqual([]);
  });
});

describe("DiscussionEvent types", () => {
  test("phase_start event", () => {
    const event: DiscussionEvent = { type: "phase_start", phase: "research" };
    expect(event.type).toBe("phase_start");
    expect(event.phase).toBe("research");
  });

  test("member_done event with tool calls", () => {
    const event: DiscussionEvent = {
      type: "member_done",
      account: "alice",
      phase: "research",
      content: "Found issues",
      toolCalls: [{ name: "read_file", input: "x", output: "y" }],
    };
    expect(event.type).toBe("member_done");
    if (event.type === "member_done") {
      expect(event.toolCalls).toHaveLength(1);
    }
  });

  test("error event", () => {
    const event: DiscussionEvent = { type: "error", message: "timeout" };
    expect(event.type).toBe("error");
    if (event.type === "error") {
      expect(event.message).toBe("timeout");
    }
  });
});

describe("runCouncilDiscussion", () => {
  test("is exported as a function", () => {
    expect(runCouncilDiscussion).toBeFunction();
  });

  test("emits error when no members provided", async () => {
    const events: DiscussionEvent[] = [];
    await runCouncilDiscussion(
      {
        accounts: [],
        members: [],
        chairman: "chair",
        goal: "test goal",
      },
      (e) => events.push(e),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent!.type).toBe("error");
    if (errorEvent!.type === "error") {
      expect(errorEvent!.message).toContain("No members");
    }

    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
  });

  test("emits phase_start for research as first meaningful event when members exist", async () => {
    const events: DiscussionEvent[] = [];
    await runCouncilDiscussion(
      {
        accounts: [{ name: "ghost", configDir: "/tmp/ghost", color: "#fff", label: "G", provider: "claude-code" }],
        members: ["ghost"],
        chairman: "ghost",
        goal: "test goal",
        researchTimeoutMs: 2000,
        discussionTimeoutMs: 2000,
        decisionTimeoutMs: 2000,
      },
      (e) => events.push(e),
    );

    const phaseStart = events.find((e) => e.type === "phase_start");
    expect(phaseStart).toBeDefined();
    if (phaseStart?.type === "phase_start") {
      expect(phaseStart.phase).toBe("research");
    }
  });

  test("returns DiscussionResult even on error", async () => {
    const events: DiscussionEvent[] = [];
    const result = await runCouncilDiscussion(
      {
        accounts: [],
        members: [],
        chairman: "chair",
        goal: "error test",
      },
      (e) => events.push(e),
    );

    expect(result.goal).toBe("error test");
    expect(result.research).toEqual([]);
    expect(result.discussion).toEqual([]);
    expect(result.decision).toBeNull();
    expect(result.timestamp).toBeDefined();
  });

  test("defaults maxRounds to 2", () => {
    const config: DiscussionConfig = {
      accounts: [],
      members: ["a"],
      chairman: "a",
      goal: "test",
    };
    expect(config.maxRounds).toBeUndefined();
  });
});

describe("BoundedContentAccumulator", () => {
  test("joins short content unchanged", () => {
    const acc = new BoundedContentAccumulator();
    acc.push("hello ");
    acc.push("world");
    expect(acc.join()).toBe("hello world");
  });

  test("tracks total length", () => {
    const acc = new BoundedContentAccumulator();
    acc.push("abc");
    acc.push("de");
    expect(acc.length).toBe(5);
  });

  test("truncates to tail when exceeding limit", () => {
    const acc = new BoundedContentAccumulator();
    acc.push("A".repeat(3000));
    acc.push("B".repeat(2000));
    const result = acc.join(4000);
    expect(result).toContain("1000 chars omitted");
    expect(result.length).toBeGreaterThan(4000);
    expect(result).toContain("B".repeat(2000));
  });

  test("respects default MAX_MEMBER_CONTENT_CHARS", () => {
    const acc = new BoundedContentAccumulator();
    acc.push("X".repeat(5000));
    const result = acc.join();
    expect(result).toContain("chars omitted");
    expect(result).toContain("1000 chars omitted");
  });

  test("empty accumulator returns empty string", () => {
    const acc = new BoundedContentAccumulator();
    expect(acc.join()).toBe("");
    expect(acc.length).toBe(0);
  });

  test("exactly at limit passes through", () => {
    const acc = new BoundedContentAccumulator();
    acc.push("X".repeat(4000));
    expect(acc.join(4000)).toBe("X".repeat(4000));
  });
});

describe("formatPriorMessages", () => {
  test("formats research messages with headers", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: "Found a bug", timestamp: new Date().toISOString(),
    }];
    const result = formatPriorMessages(msgs);
    expect(result).toContain("[Research by alice]");
    expect(result).toContain("Found a bug");
  });

  test("formats discussion messages with round number", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "bob", phase: "discussion", round: 2,
      content: "I agree", timestamp: new Date().toISOString(),
    }];
    const result = formatPriorMessages(msgs);
    expect(result).toContain("[bob — Round 2]");
  });

  test("includes tool call count in header", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: "analysis",
      toolCalls: [
        { name: "read_file", input: "x", output: "y" },
        { name: "grep", input: "z", output: "w" },
      ],
      timestamp: new Date().toISOString(),
    }];
    const result = formatPriorMessages(msgs);
    expect(result).toContain("Used 2 tool calls");
    expect(result).toContain("read_file, grep");
  });

  test("truncates long research messages (head + tail)", () => {
    const longContent = "X".repeat(5000);
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: longContent, timestamp: new Date().toISOString(),
    }];
    const result = formatPriorMessages(msgs);
    expect(result).toContain("chars omitted");
    expect(result.length).toBeLessThan(longContent.length);
  });

  test("truncates long discussion messages (head only)", () => {
    const longContent = "Y".repeat(3000);
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "bob", phase: "discussion", round: 1,
      content: longContent, timestamp: new Date().toISOString(),
    }];
    const result = formatPriorMessages(msgs);
    expect(result).toContain("chars truncated");
    expect(result.length).toBeLessThan(longContent.length);
  });

  test("short messages pass through unchanged", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: "short", timestamp: new Date().toISOString(),
    }];
    const result = formatPriorMessages(msgs);
    expect(result).toContain("short");
    expect(result).not.toContain("omitted");
    expect(result).not.toContain("truncated");
  });
});

describe("formatToolCallsSummary", () => {
  test("returns empty string for no tool calls", () => {
    expect(formatToolCallsSummary([])).toBe("");
  });

  test("formats tool calls as bulleted list", () => {
    const result = formatToolCallsSummary([
      { name: "read_file", input: "src/app.ts", output: "content" },
      { name: "grep", input: "error pattern", output: "matches" },
    ]);
    expect(result).toContain("- read_file: src/app.ts");
    expect(result).toContain("- grep: error pattern");
  });

  test("truncates long inputs to 80 chars", () => {
    const result = formatToolCallsSummary([
      { name: "bash", input: "X".repeat(200), output: "" },
    ]);
    const line = result.split("\n")[0];
    expect(line.length).toBeLessThanOrEqual(90);
  });
});

describe("measureMessages", () => {
  test("measures total byte length of messages", () => {
    const msgs: DiscussionMessage[] = [
      { id: "1", account: "a", phase: "research", content: "abc", timestamp: new Date().toISOString() },
      { id: "2", account: "b", phase: "research", content: "defgh", timestamp: new Date().toISOString() },
    ];
    expect(measureMessages(msgs)).toBe(8);
  });

  test("handles multibyte characters", () => {
    const msgs: DiscussionMessage[] = [
      { id: "1", account: "a", phase: "research", content: "\u{1F600}", timestamp: new Date().toISOString() },
    ];
    expect(measureMessages(msgs)).toBe(4);
  });

  test("returns 0 for empty array", () => {
    expect(measureMessages([])).toBe(0);
  });
});

describe("stripToolPreviews", () => {
  test("adds tool summary to research messages with tool calls", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: "Found issues",
      toolCalls: [
        { name: "read_file", input: "src/app.ts", output: "..." },
        { name: "grep", input: "error", output: "..." },
      ],
      timestamp: new Date().toISOString(),
    }];
    const result = stripToolPreviews(msgs);
    expect(result[0].content).toContain("Tools used:");
    expect(result[0].content).toContain("- read_file: src/app.ts");
    expect(result[0].content).toContain("- grep: error");
  });

  test("passes through discussion messages unchanged", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "bob", phase: "discussion", round: 1,
      content: "I agree",
      timestamp: new Date().toISOString(),
    }];
    const result = stripToolPreviews(msgs);
    expect(result[0].content).toBe("I agree");
  });

  test("passes through research messages without tool calls", () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: "No tools used",
      timestamp: new Date().toISOString(),
    }];
    const result = stripToolPreviews(msgs);
    expect(result[0].content).toBe("No tools used");
  });
});

describe("compactForDecision", () => {
  const fakeCreds = { type: "api-key" as const, apiKey: "test-key" };

  test("returns uncompacted text when below threshold", async () => {
    const msgs: DiscussionMessage[] = [{
      id: "1", account: "alice", phase: "research",
      content: "short content",
      timestamp: new Date().toISOString(),
    }];
    const { text, compacted } = await compactForDecision(msgs, "test goal", {
      accountName: "alice", creds: fakeCreds,
    });
    expect(compacted).toBe(false);
    expect(text).toContain("short content");
  });

  test("compaction threshold is 20KB", () => {
    expect(COMPACTION_THRESHOLD_BYTES).toBe(20_000);
  });
});

describe("constants", () => {
  test("MAX_MEMBER_CONTENT_CHARS is 4000", () => {
    expect(MAX_MEMBER_CONTENT_CHARS).toBe(4000);
  });
});
