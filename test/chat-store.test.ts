import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "path";
import { tmpdir } from "os";

let testDir: string;

describe("chat-store", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agentctl-chat-store-"));
    process.env.AGENTCTL_DIR = testDir;
  });

  afterEach(async () => {
    delete process.env.AGENTCTL_DIR;
    await rm(testDir, { recursive: true, force: true });
  });

  test("saveSession and loadSession round-trip", async () => {
    const { saveSession, loadSession } = await import("../src/services/chat-store");

    const session = {
      id: "test-session-1",
      accountName: "atlas",
      title: "Test chat",
      messages: [
        { id: "m1", role: "user" as const, content: "Hello", timestamp: "2026-02-14T10:00:00Z" },
        { id: "m2", role: "assistant" as const, content: "Hi there!", timestamp: "2026-02-14T10:00:01Z", cost: 0.001, durationMs: 500 },
      ],
      createdAt: "2026-02-14T10:00:00Z",
      updatedAt: "2026-02-14T10:00:01Z",
    };

    await saveSession(session);
    const loaded = await loadSession("test-session-1");

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe("test-session-1");
    expect(loaded!.accountName).toBe("atlas");
    expect(loaded!.title).toBe("Test chat");
    expect(loaded!.messages.length).toBe(2);
    expect(loaded!.messages[0].content).toBe("Hello");
    expect(loaded!.messages[1].content).toBe("Hi there!");
  });

  test("loadSession returns null for missing session", async () => {
    const { loadSession } = await import("../src/services/chat-store");

    const result = await loadSession("nonexistent");
    expect(result).toBeNull();
  });

  test("listSessions returns sorted by updatedAt", async () => {
    const { saveSession, listSessions } = await import("../src/services/chat-store");

    await saveSession({
      id: "older",
      accountName: "atlas",
      title: "Old chat",
      messages: [],
      createdAt: "2026-02-14T08:00:00Z",
      updatedAt: "2026-02-14T08:00:00Z",
    });

    await saveSession({
      id: "newer",
      accountName: "pioneer",
      title: "New chat",
      messages: [],
      createdAt: "2026-02-14T10:00:00Z",
      updatedAt: "2026-02-14T10:00:00Z",
    });

    const sessions = await listSessions();
    expect(sessions.length).toBe(2);
    expect(sessions[0].id).toBe("newer");
    expect(sessions[1].id).toBe("older");
  });

  test("listSessions filters by accountName", async () => {
    const { saveSession, listSessions } = await import("../src/services/chat-store");

    await saveSession({
      id: "s1",
      accountName: "atlas",
      title: "Atlas chat",
      messages: [],
      createdAt: "2026-02-14T10:00:00Z",
      updatedAt: "2026-02-14T10:00:00Z",
    });

    await saveSession({
      id: "s2",
      accountName: "pioneer",
      title: "Pioneer chat",
      messages: [],
      createdAt: "2026-02-14T10:00:00Z",
      updatedAt: "2026-02-14T10:00:00Z",
    });

    const atlasSessions = await listSessions({ accountName: "atlas" });
    expect(atlasSessions.length).toBe(1);
    expect(atlasSessions[0].accountName).toBe("atlas");
  });

  test("listSessions respects limit", async () => {
    const { saveSession, listSessions } = await import("../src/services/chat-store");

    for (let i = 0; i < 5; i++) {
      await saveSession({
        id: `session-${i}`,
        accountName: "atlas",
        title: `Chat ${i}`,
        messages: [],
        createdAt: `2026-02-14T${10 + i}:00:00Z`,
        updatedAt: `2026-02-14T${10 + i}:00:00Z`,
      });
    }

    const limited = await listSessions({ limit: 3 });
    expect(limited.length).toBe(3);
  });

  test("deleteSession removes the session file", async () => {
    const { saveSession, loadSession, deleteSession } = await import("../src/services/chat-store");

    await saveSession({
      id: "to-delete",
      accountName: "atlas",
      title: "Delete me",
      messages: [],
      createdAt: "2026-02-14T10:00:00Z",
      updatedAt: "2026-02-14T10:00:00Z",
    });

    expect(await loadSession("to-delete")).not.toBeNull();

    await deleteSession("to-delete");
    expect(await loadSession("to-delete")).toBeNull();
  });

  test("deleteSession is safe for nonexistent session", async () => {
    const { deleteSession } = await import("../src/services/chat-store");
    // Should not throw
    await deleteSession("doesnt-exist");
  });

  test("listSessions returns empty array for missing directory", async () => {
    const { listSessions } = await import("../src/services/chat-store");
    // testDir/chat-sessions/ doesn't exist yet
    const sessions = await listSessions();
    expect(sessions).toEqual([]);
  });
});
