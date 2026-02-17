import { test, expect, describe } from "bun:test";
import type { AgentStream } from "../src/hooks/useAgentStreams";
import {
  evictStreams,
  pruneStaleDoneStreams,
  MAX_CHUNKS_PER_STREAM,
  MAX_STREAMS,
  STREAM_TTL_MS,
  PRUNE_INTERVAL_MS,
} from "../src/hooks/useAgentStreams";

function makeStream(id: string, overrides: Partial<AgentStream> = {}): AgentStream {
  return {
    sessionId: id,
    account: "test-account",
    provider: "claude-code",
    status: "live",
    chunks: [],
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  };
}

describe("AgentActivity component", () => {
  test("activity view is available in TUI", async () => {
    const mod = await import("../src/tui/views/activity");
    expect(mod).toBeDefined();
  });
});

describe("useAgentStreams hook", () => {
  test("module exports useAgentStreams", async () => {
    const mod = await import("../src/hooks/useAgentStreams");
    expect(mod.useAgentStreams).toBeFunction();
  });

  test("exports AgentStream and StreamChunk types", async () => {
    const mod = await import("../src/hooks/useAgentStreams");
    expect(mod).toBeDefined();
  });
});

describe("useAgentStreams constants", () => {
  test("MAX_CHUNKS_PER_STREAM is 500", () => {
    expect(MAX_CHUNKS_PER_STREAM).toBe(500);
  });

  test("MAX_STREAMS is 50", () => {
    expect(MAX_STREAMS).toBe(50);
  });

  test("STREAM_TTL_MS is 5 minutes", () => {
    expect(STREAM_TTL_MS).toBe(5 * 60 * 1000);
  });

  test("PRUNE_INTERVAL_MS is 60 seconds", () => {
    expect(PRUNE_INTERVAL_MS).toBe(60 * 1000);
  });
});

describe("evictStreams", () => {
  test("returns same map when under cap", () => {
    const map = new Map<string, AgentStream>();
    map.set("s1", makeStream("s1"));
    map.set("s2", makeStream("s2"));
    const result = evictStreams(map, 5);
    expect(result).toBe(map);
  });

  test("returns same map when exactly at cap", () => {
    const map = new Map<string, AgentStream>();
    for (let i = 0; i < 3; i++) {
      map.set(`s${i}`, makeStream(`s${i}`));
    }
    const result = evictStreams(map, 3);
    expect(result).toBe(map);
  });

  test("evicts done streams before live streams", () => {
    const map = new Map<string, AgentStream>();
    map.set("live1", makeStream("live1", { status: "live", startedAt: "2026-01-01T00:00:00Z" }));
    map.set("done1", makeStream("done1", { status: "done", endedAt: "2026-01-01T00:01:00Z" }));
    map.set("done2", makeStream("done2", { status: "done", endedAt: "2026-01-01T00:02:00Z" }));

    const result = evictStreams(map, 2);
    expect(result.size).toBe(2);
    // Oldest done stream (done1) should be evicted
    expect(result.has("done1")).toBe(false);
    expect(result.has("live1")).toBe(true);
    expect(result.has("done2")).toBe(true);
  });

  test("evicts oldest done streams first", () => {
    const map = new Map<string, AgentStream>();
    map.set("d1", makeStream("d1", { status: "done", endedAt: "2026-01-01T00:01:00Z" }));
    map.set("d2", makeStream("d2", { status: "done", endedAt: "2026-01-01T00:03:00Z" }));
    map.set("d3", makeStream("d3", { status: "done", endedAt: "2026-01-01T00:02:00Z" }));

    const result = evictStreams(map, 1);
    expect(result.size).toBe(1);
    // d2 is newest done — should survive
    expect(result.has("d2")).toBe(true);
  });

  test("evicts live streams by startedAt when all done are gone", () => {
    const map = new Map<string, AgentStream>();
    map.set("l1", makeStream("l1", { status: "live", startedAt: "2026-01-01T00:01:00Z" }));
    map.set("l2", makeStream("l2", { status: "live", startedAt: "2026-01-01T00:03:00Z" }));
    map.set("l3", makeStream("l3", { status: "live", startedAt: "2026-01-01T00:02:00Z" }));

    const result = evictStreams(map, 1);
    expect(result.size).toBe(1);
    // l2 is newest live — should survive
    expect(result.has("l2")).toBe(true);
  });

  test("evicts large number of streams down to cap", () => {
    const map = new Map<string, AgentStream>();
    for (let i = 0; i < 60; i++) {
      const ts = new Date(Date.now() - (60 - i) * 1000).toISOString();
      map.set(`s${i}`, makeStream(`s${i}`, {
        status: i < 40 ? "done" : "live",
        startedAt: ts,
        endedAt: i < 40 ? ts : undefined,
      }));
    }
    const result = evictStreams(map, MAX_STREAMS);
    expect(result.size).toBe(MAX_STREAMS);
  });
});

describe("pruneStaleDoneStreams", () => {
  test("returns same map when no stale streams", () => {
    const now = Date.now();
    const map = new Map<string, AgentStream>();
    map.set("s1", makeStream("s1", {
      status: "done",
      endedAt: new Date(now - 1000).toISOString(), // 1 second ago
    }));
    const result = pruneStaleDoneStreams(map, STREAM_TTL_MS, now);
    expect(result).toBe(map); // same reference — no pruning
  });

  test("removes done streams older than TTL", () => {
    const now = Date.now();
    const map = new Map<string, AgentStream>();
    map.set("old", makeStream("old", {
      status: "done",
      endedAt: new Date(now - STREAM_TTL_MS - 1000).toISOString(), // 6 minutes ago
    }));
    map.set("recent", makeStream("recent", {
      status: "done",
      endedAt: new Date(now - 1000).toISOString(), // 1 second ago
    }));

    const result = pruneStaleDoneStreams(map, STREAM_TTL_MS, now);
    expect(result.size).toBe(1);
    expect(result.has("old")).toBe(false);
    expect(result.has("recent")).toBe(true);
  });

  test("does not prune live streams regardless of age", () => {
    const now = Date.now();
    const map = new Map<string, AgentStream>();
    map.set("live-old", makeStream("live-old", {
      status: "live",
      startedAt: new Date(now - STREAM_TTL_MS - 60_000).toISOString(),
    }));
    const result = pruneStaleDoneStreams(map, STREAM_TTL_MS, now);
    expect(result).toBe(map);
    expect(result.has("live-old")).toBe(true);
  });

  test("does not prune done streams without endedAt", () => {
    const now = Date.now();
    const map = new Map<string, AgentStream>();
    map.set("no-end", makeStream("no-end", { status: "done" }));
    const result = pruneStaleDoneStreams(map, STREAM_TTL_MS, now);
    expect(result).toBe(map);
    expect(result.has("no-end")).toBe(true);
  });

  test("prunes multiple stale streams at once", () => {
    const now = Date.now();
    const map = new Map<string, AgentStream>();
    for (let i = 0; i < 10; i++) {
      map.set(`old-${i}`, makeStream(`old-${i}`, {
        status: "done",
        endedAt: new Date(now - STREAM_TTL_MS - (i + 1) * 1000).toISOString(),
      }));
    }
    map.set("fresh", makeStream("fresh", {
      status: "done",
      endedAt: new Date(now - 1000).toISOString(),
    }));
    const result = pruneStaleDoneStreams(map, STREAM_TTL_MS, now);
    expect(result.size).toBe(1);
    expect(result.has("fresh")).toBe(true);
  });
});

describe("daemon-client-stream", () => {
  test("module exports createStreamingConnection", async () => {
    const mod = await import("../src/services/daemon-client-stream");
    expect(mod.createStreamingConnection).toBeFunction();
  });
});
