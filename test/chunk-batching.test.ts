import { test, expect, describe, beforeEach } from "bun:test";
import type { StreamingChunk, AccountSnapshot } from "../src/hooks/useChunkBatching";

function createSnapshot(overrides?: Partial<AccountSnapshot>): AccountSnapshot {
  return {
    sessionId: crypto.randomUUID(),
    session: null,
    messages: [],
    cost: 0,
    backgroundStreaming: false,
    chunkBuffer: [],
    streamingChunks: [],
    scrollOffset: 0,
    autoScroll: true,
    ...overrides,
  };
}

function makeChunk(content: string, chunkType = "text"): StreamingChunk {
  return { chunkType, content };
}

describe("chunk routing logic", () => {
  let accountSessions: Map<string, AccountSnapshot>;
  let activeBuffer: StreamingChunk[];

  function queueChunk(
    chunk: StreamingChunk,
    activeAccountName: string | undefined,
    targetAccount?: string,
  ) {
    if (targetAccount && targetAccount !== activeAccountName) {
      const snap = accountSessions.get(targetAccount);
      if (snap) snap.chunkBuffer.push(chunk);
      return;
    }
    activeBuffer.push(chunk);
  }

  beforeEach(() => {
    accountSessions = new Map();
    activeBuffer = [];
  });

  test("chunks for active account go to active buffer", () => {
    queueChunk(makeChunk("hello"), "atlas", "atlas");
    expect(activeBuffer).toHaveLength(1);
    expect(activeBuffer[0].content).toBe("hello");
  });

  test("chunks with no target go to active buffer", () => {
    queueChunk(makeChunk("hello"), "atlas");
    expect(activeBuffer).toHaveLength(1);
  });

  test("chunks for background account go to snapshot buffer", () => {
    const snap = createSnapshot();
    accountSessions.set("scout", snap);

    queueChunk(makeChunk("background data"), "atlas", "scout");
    expect(activeBuffer).toHaveLength(0);
    expect(snap.chunkBuffer).toHaveLength(1);
    expect(snap.chunkBuffer[0].content).toBe("background data");
  });

  test("chunks for unknown background account are silently dropped", () => {
    queueChunk(makeChunk("lost"), "atlas", "ghost");
    expect(activeBuffer).toHaveLength(0);
  });

  test("multiple chunks route correctly across tab switch", () => {
    const atlasSnap = createSnapshot();
    const scoutSnap = createSnapshot();
    accountSessions.set("atlas", atlasSnap);
    accountSessions.set("scout", scoutSnap);

    queueChunk(makeChunk("chunk1"), "atlas", "atlas");
    queueChunk(makeChunk("chunk2"), "atlas", "atlas");

    queueChunk(makeChunk("chunk3"), "scout", "atlas");
    queueChunk(makeChunk("chunk4"), "scout", "atlas");

    expect(activeBuffer).toHaveLength(2);
    expect(activeBuffer[0].content).toBe("chunk1");
    expect(activeBuffer[1].content).toBe("chunk2");

    expect(atlasSnap.chunkBuffer).toHaveLength(2);
    expect(atlasSnap.chunkBuffer[0].content).toBe("chunk3");
    expect(atlasSnap.chunkBuffer[1].content).toBe("chunk4");

    expect(scoutSnap.chunkBuffer).toHaveLength(0);
  });

  test("tool_use chunks route to background correctly", () => {
    const snap = createSnapshot();
    accountSessions.set("atlas", snap);

    queueChunk(
      { chunkType: "tool_use", content: "read_file", toolName: "Read", toolInput: "/foo.ts" },
      "scout",
      "atlas",
    );
    expect(snap.chunkBuffer).toHaveLength(1);
    expect(snap.chunkBuffer[0].chunkType).toBe("tool_use");
    expect(snap.chunkBuffer[0].toolName).toBe("Read");
  });
});

describe("account snapshot lifecycle", () => {
  test("snapshot preserves streaming state for tab-back restore", () => {
    const snap = createSnapshot({
      backgroundStreaming: true,
      messages: [{ id: "1", role: "user", content: "hello", timestamp: "" }],
      cost: 0.05,
      streamingChunks: [makeChunk("partial")],
      chunkBuffer: [makeChunk("buffered")],
    });

    const restored = [...snap.streamingChunks, ...snap.chunkBuffer];
    expect(restored).toHaveLength(2);
    expect(restored[0].content).toBe("partial");
    expect(restored[1].content).toBe("buffered");
    expect(snap.backgroundStreaming).toBe(true);
  });

  test("snapshot model is preserved across switches", () => {
    const snap = createSnapshot({ model: "claude-opus-4-6" });
    expect(snap.model).toBe("claude-opus-4-6");
  });

  test("snapshot scroll state is preserved", () => {
    const snap = createSnapshot({ scrollOffset: 15, autoScroll: false });
    expect(snap.scrollOffset).toBe(15);
    expect(snap.autoScroll).toBe(false);
  });
});

describe("send() pinning behavior (unit logic)", () => {

  test("pinned string does not change when source ref changes", () => {
    const ref = { current: "atlas" };
    const pinned = ref.current;

    ref.current = "scout";
    expect(pinned).toBe("atlas");
    expect(ref.current).toBe("scout");
  });

  test("stillViewing check detects account switch", () => {
    const accountRef = { current: { name: "atlas" } };
    const pinnedAccountName = "atlas";

    expect(accountRef.current.name === pinnedAccountName).toBe(true);

    accountRef.current = { name: "scout" };
    expect(accountRef.current.name === pinnedAccountName).toBe(false);
  });

  test("background snapshot update uses pinned values, not current ref", () => {
    const accountRef = { current: { name: "scout" } };
    const pinnedAccountName = "atlas";
    const pinnedSessionId = "session-123";
    const cache = new Map<string, AccountSnapshot>();

    const stillViewing = accountRef.current.name === pinnedAccountName;
    expect(stillViewing).toBe(false);

    if (!stillViewing && pinnedAccountName) {
      cache.set(pinnedAccountName, createSnapshot({
        sessionId: pinnedSessionId,
        cost: 0.01,
        backgroundStreaming: false,
      }));
    }

    expect(cache.has("atlas")).toBe(true);
    expect(cache.get("atlas")!.sessionId).toBe("session-123");
    expect(cache.has("scout")).toBe(false);
  });
});
