import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { DaemonState } from "../src/daemon/state";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".test-daemon");
process.env.CLAUDE_HUB_DIR = TEST_DIR;

beforeEach(() => mkdirSync(TEST_DIR, { recursive: true }));
afterEach(() => rmSync(TEST_DIR, { recursive: true, force: true }));

describe("DaemonState", () => {
  test("manages connected accounts", () => {
    const state = new DaemonState();
    state.connectAccount("claude", "token-abc");
    expect(state.getConnectedAccounts()).toEqual(["claude"]);
    state.disconnectAccount("claude");
    expect(state.getConnectedAccounts()).toEqual([]);
  });

  test("stores and retrieves messages", () => {
    const state = new DaemonState();
    state.addMessage({ from: "claude", to: "claude-admin", type: "message", content: "hello", timestamp: new Date().toISOString() });
    const msgs = state.getMessages("claude-admin");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe("hello");
  });

  test("marks messages as read", () => {
    const state = new DaemonState();
    state.addMessage({ from: "claude", to: "claude-admin", type: "message", content: "hello", timestamp: new Date().toISOString() });
    const unread = state.getUnreadMessages("claude-admin");
    expect(unread).toHaveLength(1);
    state.markAllRead("claude-admin");
    expect(state.getUnreadMessages("claude-admin")).toHaveLength(0);
  });

  test("verifies tokens for connected accounts", () => {
    const state = new DaemonState();
    state.connectAccount("claude", "secret-token");
    expect(state.verifyToken("claude", "secret-token")).toBe(true);
    expect(state.verifyToken("claude", "wrong-token")).toBe(false);
    expect(state.verifyToken("nonexistent", "any")).toBe(false);
  });

  test("isConnected returns correct status", () => {
    const state = new DaemonState();
    expect(state.isConnected("claude")).toBe(false);
    state.connectAccount("claude", "tok");
    expect(state.isConnected("claude")).toBe(true);
    state.disconnectAccount("claude");
    expect(state.isConnected("claude")).toBe(false);
  });

  test("messages have auto-generated ids", () => {
    const state = new DaemonState();
    state.addMessage({ from: "a", to: "b", type: "message", content: "test", timestamp: new Date().toISOString() });
    const msgs = state.getMessages("b");
    expect(msgs[0].id).toBeDefined();
    expect(typeof msgs[0].id).toBe("string");
    expect(msgs[0].id!.length).toBeGreaterThan(0);
  });

  test("getMessages returns only messages for the specified recipient", () => {
    const state = new DaemonState();
    state.addMessage({ from: "a", to: "b", type: "message", content: "for b", timestamp: new Date().toISOString() });
    state.addMessage({ from: "a", to: "c", type: "message", content: "for c", timestamp: new Date().toISOString() });
    expect(state.getMessages("b")).toHaveLength(1);
    expect(state.getMessages("c")).toHaveLength(1);
    expect(state.getMessages("b")[0].content).toBe("for b");
  });
});
