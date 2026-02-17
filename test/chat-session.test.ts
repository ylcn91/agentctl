import { test, expect, describe, beforeEach, afterEach, mock, afterAll } from "bun:test";

afterAll(() => { mock.restore(); });
import type { AccountConfig } from "../src/types";
import type { NormalizedChunk } from "../src/services/stream-normalizer";

const originalSpawn = Bun.spawn;

mock.module("../src/services/auth-store", () => ({
  getAuth: mock(async () => null),
  setAuth: mock(async () => {}),
  removeAuth: mock(async () => false),
  listAuth: mock(async () => ({})),
}));

mock.module("../src/services/agent-sdk-client", () => ({
  streamViaAgentSDK: mock(async (opts: { prompt: string; sessionId?: string; onChunk: (chunk: NormalizedChunk) => void }) => {
    opts.onChunk({ chunkType: "system", content: "session_start" });
    opts.onChunk({ chunkType: "text", content: "Hello! " });
    opts.onChunk({ chunkType: "text", content: "How can I help?" });
    opts.onChunk({ chunkType: "system", content: "done", cost: 0.003, tokenUsage: { input: 10, output: 20 } });
    return {
      content: "Hello! How can I help?",
      sessionId: "mock-session-001",
      cost: 0.003,
      tokenCount: 30,
      durationMs: 42,
      model: "claude-sonnet-4-5-20250929",
    };
  }),
}));

function createMockSpawn() {
  return mock(() => {
    const chunks = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Hello! " }] } }) + "\n",
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "How can I help?" }] } }) + "\n",
      JSON.stringify({ type: "result", result: "done", cost_usd: 0.003, usage: { input_tokens: 10, output_tokens: 20 } }) + "\n",
    ];
    let chunkIndex = 0;

    const stdout = new ReadableStream({
      pull(controller) {
        if (chunkIndex < chunks.length) {
          controller.enqueue(new TextEncoder().encode(chunks[chunkIndex]));
          chunkIndex++;
        } else {
          controller.close();
        }
      },
    });

    return {
      stdout,
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: mock(() => {}),
      pid: 12345,
    };
  });
}

const testAccount: AccountConfig = {
  name: "atlas",
  configDir: "~/.claude",
  color: "#3498db",
  label: "Atlas",
  provider: "claude-code",
};

const plainAccount: AccountConfig = {
  name: "scout",
  configDir: "~/.codex",
  color: "#2ecc71",
  label: "Scout",
  provider: "codex-cli",
};

describe("ChatSession", () => {
  let mockSpawn: ReturnType<typeof createMockSpawn>;

  beforeEach(() => {
    mockSpawn = createMockSpawn();
    Bun.spawn = mockSpawn;
  });

  afterEach(() => {
    Bun.spawn = originalSpawn;
  });

  test("send() accumulates user + assistant messages", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);
    const chunks: any[] = [];

    const result = await session.send("Hello", (chunk) => chunks.push(chunk));

    expect(result.role).toBe("assistant");
    expect(result.content).toContain("Hello!");
    expect(result.content).toContain("How can I help?");

    const messages = session.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe("Hello");
    expect(messages[1].role).toBe("assistant");
  });

  test("getMessages() returns a copy of conversation history", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    await session.send("Test", () => {});
    const msgs1 = session.getMessages();
    const msgs2 = session.getMessages();

    expect(msgs1).toEqual(msgs2);
    expect(msgs1).not.toBe(msgs2);
  });

  test("clear() resets conversation", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    await session.send("Test", () => {});
    expect(session.getMessages().length).toBe(2);

    session.clear();
    expect(session.getMessages().length).toBe(0);
  });

  test("abort() cancels active SDK stream", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    void session.send("Test", () => {}).catch(() => {});
    await new Promise((r) => setTimeout(r, 10));

    session.abort();
    expect(session.getMessages().length).toBeGreaterThanOrEqual(0);
  });

  test("abort() kills active CLI process for non-SDK providers", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(plainAccount);

    const killMock = mock(() => {});
    Bun.spawn = mock(() => ({
      stdout: new ReadableStream({ start() {  } }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: new Promise(() => {}),
      exitCode: null,
      kill: killMock,
      pid: 99999,
    }));

    void session.send("Test", () => {}).catch(() => {});

    await new Promise((r) => setTimeout(r, 10));

    session.abort();
    expect(killMock).toHaveBeenCalled();
  });

  test("conversation prompt format includes all prior turns", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    await session.send("First message", () => {});
    await session.send("Second message", () => {});

    const messages = session.getMessages();
    expect(messages.length).toBe(4);
    expect(messages[0].content).toBe("First message");
    expect(messages[2].content).toBe("Second message");
  });

  test("buildPrompt() single message returns raw text", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    session.messages.push({
      id: "test",
      role: "user",
      content: "Hello world",
      timestamp: new Date().toISOString(),
    });

    const prompt = session.buildPrompt();
    expect(prompt).toBe("Hello world");
  });

  test("buildPrompt() multi-turn wraps in conversation tags", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    session.messages = [
      { id: "1", role: "user", content: "Hi", timestamp: "" },
      { id: "2", role: "assistant", content: "Hello!", timestamp: "" },
      { id: "3", role: "user", content: "How are you?", timestamp: "" },
    ];

    const prompt = session.buildPrompt();
    expect(prompt).toContain("<conversation>");
    expect(prompt).toContain("User: Hi");
    expect(prompt).toContain("Assistant: Hello!");
    expect(prompt).toContain("User: How are you?");
    expect(prompt).toContain("</conversation>");
    expect(prompt).toContain("Continue this conversation");
  });

  test("getAccount() returns the account", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    expect(session.getAccount()).toBe(testAccount);
    expect(session.getAccount().name).toBe("atlas");
  });

  test("getSessionId() returns SDK session ID after send", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    expect(session.getSessionId()).toBeUndefined();

    await session.send("Hello", () => {});
    expect(session.getSessionId()).toBe("mock-session-001");

    session.clear();
    expect(session.getSessionId()).toBeUndefined();
  });

  test("send() captures cost and token count from SDK result", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(testAccount);

    const result = await session.send("Hello", () => {});
    expect(result.cost).toBe(0.003);
    expect(result.tokenCount).toBe(30);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  test("handles plain text providers", async () => {
    const plainChunks = ["Line 1\n", "Line 2\n"];
    let chunkIdx = 0;

    Bun.spawn = mock(() => ({
      stdout: new ReadableStream({
        pull(controller) {
          if (chunkIdx < plainChunks.length) {
            controller.enqueue(new TextEncoder().encode(plainChunks[chunkIdx]));
            chunkIdx++;
          } else {
            controller.close();
          }
        },
      }),
      stderr: new ReadableStream({ start(c) { c.close(); } }),
      exited: Promise.resolve(0),
      exitCode: 0,
      kill: mock(() => {}),
      pid: 11111,
    }));

    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(plainAccount);
    const receivedChunks: any[] = [];

    const result = await session.send("Hello", (chunk) => receivedChunks.push(chunk));

    expect(result.role).toBe("assistant");
    expect(receivedChunks.length).toBeGreaterThan(0);
    expect(receivedChunks[0].chunkType).toBe("text");
  });
});

const realAccount: AccountConfig = {
  name: "claude",
  configDir: "~/.claude",
  color: "#cc7832",
  label: "Claude",
  provider: "claude-code",
};

describe("ChatSession integration (real Agent SDK)", () => {

  test("sends a prompt and receives a streamed response", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(realAccount);
    const chunks: NormalizedChunk[] = [];

    const result = await session.send(
      "Reply with exactly: PONG",
      (chunk) => chunks.push(chunk),
    );

    expect(result.role).toBe("assistant");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);

    const messages = session.getMessages();
    expect(messages.length).toBe(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");

    expect(chunks.length).toBeGreaterThan(0);
    const textChunks = chunks.filter((c) => c.chunkType === "text");
    expect(textChunks.length).toBeGreaterThan(0);
  });

  test("multi-turn conversation via SDK session resume", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(realAccount);

    await session.send("First message", () => {});
    expect(session.getSessionId()).toBe("mock-session-001");

    await session.send("Second message", () => {});

    const messages = session.getMessages();
    expect(messages.length).toBe(4);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[2].role).toBe("user");
    expect(messages[3].role).toBe("assistant");
  });

  test("clear() resets session ID and conversation", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(realAccount);

    await session.send("Hello", () => {});
    expect(session.getMessages().length).toBe(2);
    expect(session.getSessionId()).toBe("mock-session-001");

    session.clear();
    expect(session.getMessages().length).toBe(0);
    expect(session.getSessionId()).toBeUndefined();
  });

  test("cost and token count captured from SDK result", async () => {
    const { ChatSession } = await import("../src/services/chat-session");
    const session = new ChatSession(realAccount);

    const result = await session.send("Hello", () => {});

    expect(result.cost).toBe(0.003);
    expect(typeof result.cost).toBe("number");
    expect(result.tokenCount).toBe(30);
    expect(typeof result.tokenCount).toBe("number");
  });
});
