import { describe, test, expect, beforeEach } from "bun:test";
import { SharedSessionManager } from "../../src/daemon/shared-session";

describe("SharedSessionManager", () => {
  let manager: SharedSessionManager;

  beforeEach(() => {
    manager = new SharedSessionManager();
  });

  describe("createSession", () => {
    test("creates a session with correct fields", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(session.id).toBeTruthy();
      expect(session.initiator).toBe("alice");
      expect(session.participant).toBe("bob");
      expect(session.workspace).toBe("/project");
      expect(session.active).toBe(true);
      expect(session.joined).toBe(false);
      expect(session.startedAt).toBeTruthy();
      expect(session.lastPing["alice"]).toBeGreaterThan(0);
    });

    test("generates unique session IDs", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("alice", "charlie", "/proj2");
      expect(s1.id).not.toBe(s2.id);
    });

    test("throws error when initiator === participant", () => {
      expect(() => manager.createSession("alice", "alice", "/project")).toThrow(
        "Cannot create session with yourself"
      );
    });
  });

  describe("joinSession", () => {
    test("allows participant to join", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.joinSession(session.id, "bob");
      expect(result).toBe(true);
      const updated = manager.getSession(session.id)!;
      expect(updated.joined).toBe(true);
      expect(updated.lastPing["bob"]).toBeGreaterThan(0);
    });

    test("rejects non-participant from joining", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.joinSession(session.id, "charlie");
      expect(result).toBe(false);
    });

    test("rejects join on invalid session", () => {
      const result = manager.joinSession("nonexistent", "bob");
      expect(result).toBe(false);
    });

    test("rejects join on inactive session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const result = manager.joinSession(session.id, "bob");
      expect(result).toBe(false);
    });
  });

  describe("isMember", () => {
    test("returns true for initiator", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.isMember(session.id, "alice")).toBe(true);
    });

    test("returns true for participant", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.isMember(session.id, "bob")).toBe(true);
    });

    test("returns false for non-member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.isMember(session.id, "charlie")).toBe(false);
    });

    test("returns false for nonexistent session", () => {
      expect(manager.isMember("nonexistent", "alice")).toBe(false);
    });
  });

  describe("addUpdate and getUpdates", () => {
    test("stores and retrieves updates", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.addUpdate(session.id, "alice", { type: "file_change", path: "/foo.ts" });
      manager.addUpdate(session.id, "alice", { type: "message", text: "hello" });

      const updates = manager.getUpdates(session.id, "bob");
      expect(updates).toHaveLength(2);
      expect(updates[0].from).toBe("alice");
      expect(updates[0].data).toEqual({ type: "file_change", path: "/foo.ts" });
      expect(updates[0].timestamp).toBeTruthy();
      expect(updates[1].data).toEqual({ type: "message", text: "hello" });
    });

    test("read cursors track unread updates per account", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.addUpdate(session.id, "alice", "update1");
      manager.addUpdate(session.id, "alice", "update2");

      const first = manager.getUpdates(session.id, "bob");
      expect(first).toHaveLength(2);

      const second = manager.getUpdates(session.id, "bob");
      expect(second).toHaveLength(0);

      manager.addUpdate(session.id, "bob", "update3");

      const aliceUpdates = manager.getUpdates(session.id, "alice");
      expect(aliceUpdates).toHaveLength(3);

      const bobNew = manager.getUpdates(session.id, "bob");
      expect(bobNew).toHaveLength(1);
      expect(bobNew[0].data).toBe("update3");
    });

    test("does not add updates to inactive session and returns false", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const result = manager.addUpdate(session.id, "alice", "should-not-appear");
      expect(result).toBe(false);
      const updates = manager.getUpdates(session.id, "bob");
      expect(updates).toHaveLength(0);
    });

    test("returns empty array for nonexistent session", () => {
      const updates = manager.getUpdates("nonexistent", "bob");
      expect(updates).toHaveLength(0);
    });

    test("non-member cannot addUpdate to a session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.addUpdate(session.id, "charlie", { type: "hack" });
      expect(result).toBe(false);
      const updates = manager.getUpdates(session.id, "alice");
      expect(updates).toHaveLength(0);
    });

    test("non-member cannot getUpdates from a session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.addUpdate(session.id, "alice", "secret data");
      const updates = manager.getUpdates(session.id, "charlie");
      expect(updates).toHaveLength(0);
    });

    test("addUpdate returns false for non-member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.addUpdate(session.id, "charlie", "data")).toBe(false);
    });

    test("addUpdate returns true for valid member and active session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.addUpdate(session.id, "alice", "data")).toBe(true);
      expect(manager.addUpdate(session.id, "bob", "reply")).toBe(true);
    });
  });

  describe("recordPing", () => {
    test("updates lastPing for account", () => {
      const session = manager.createSession("alice", "bob", "/project");

      const before = Date.now();
      manager.recordPing(session.id, "alice");
      const updated = manager.getSession(session.id)!;
      expect(updated.lastPing["alice"]).toBeGreaterThanOrEqual(before);
    });

    test("does not crash on nonexistent session", () => {
      const result = manager.recordPing("nonexistent", "alice");
      expect(result).toBe(false);
    });

    test("does not update ping on inactive session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const before = session.lastPing["alice"];
      const result = manager.recordPing(session.id, "alice");
      expect(result).toBe(false);
      expect(manager.getSession(session.id)!.lastPing["alice"]).toBe(before);
    });

    test("non-member cannot recordPing", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.recordPing(session.id, "charlie");
      expect(result).toBe(false);
      expect(manager.getSession(session.id)!.lastPing["charlie"]).toBeUndefined();
    });

    test("recordPing returns true for valid member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      expect(manager.recordPing(session.id, "alice")).toBe(true);
    });
  });

  describe("endSession", () => {
    test("marks session as inactive and returns true for member", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.endSession(session.id, "alice");
      expect(result).toBe(true);
      const updated = manager.getSession(session.id)!;
      expect(updated.active).toBe(false);
    });

    test("participant can also end session", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.endSession(session.id, "bob");
      expect(result).toBe(true);
      expect(manager.getSession(session.id)!.active).toBe(false);
    });

    test("returns false for nonexistent session", () => {
      const result = manager.endSession("nonexistent", "alice");
      expect(result).toBe(false);
    });

    test("non-member cannot end session and returns false", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const result = manager.endSession(session.id, "charlie");
      expect(result).toBe(false);
      expect(manager.getSession(session.id)!.active).toBe(true);
    });
  });

  describe("getSession", () => {
    test("returns session by ID", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const found = manager.getSession(session.id);
      expect(found).toBeTruthy();
      expect(found!.id).toBe(session.id);
    });

    test("returns null for nonexistent session", () => {
      expect(manager.getSession("nonexistent")).toBeNull();
    });
  });

  describe("getActiveSessionsForAccount", () => {
    test("finds active session for initiator", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(session.id);
    });

    test("finds active session for participant", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const found = manager.getActiveSessionsForAccount("bob");
      expect(found).toHaveLength(1);
      expect(found[0].id).toBe(session.id);
    });

    test("returns empty array when no active session", () => {
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(0);
    });

    test("does not find inactive sessions", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(0);
    });

    test("returns all active sessions for account", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("alice", "charlie", "/proj2");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(2);
      const ids = found.map((s) => s.id);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
    });

    test("account with multiple active sessions as both initiator and participant", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("charlie", "alice", "/proj2");
      const found = manager.getActiveSessionsForAccount("alice");
      expect(found).toHaveLength(2);
      const ids = found.map((s) => s.id);
      expect(ids).toContain(s1.id);
      expect(ids).toContain(s2.id);
    });
  });

  describe("cleanupStale", () => {
    test("marks sessions with all stale pings as inactive", () => {
      const session = manager.createSession("alice", "bob", "/project");
      session.lastPing["alice"] = Date.now() - 100_000;
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(false);
    });

    test("keeps sessions with recent pings active", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.joinSession(session.id, "bob");
      session.lastPing["alice"] = Date.now() - 100_000;
      session.lastPing["bob"] = Date.now();
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(true);
    });

    test("does not affect already inactive sessions", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(false);
    });

    test("handles sessions with no pings", () => {
      const session = manager.createSession("alice", "bob", "/project");
      session.lastPing = {};
      manager.cleanupStale();
      expect(manager.getSession(session.id)!.active).toBe(false);
    });
  });

  describe("purgeInactive", () => {
    test("removes old inactive sessions from all Maps", () => {
      const session = manager.createSession("alice", "bob", "/project");
      const sessionId = session.id;

      manager.addUpdate(sessionId, "alice", "data");
      manager.getUpdates(sessionId, "bob");

      manager.endSession(sessionId, "alice");

      session.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(1);

      expect(manager.getSession(sessionId)).toBeNull();

      const updates = manager.getUpdates(sessionId, "bob");
      expect(updates).toHaveLength(0);
    });

    test("preserves active sessions", () => {
      const session = manager.createSession("alice", "bob", "/project");
      session.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(0);
      expect(manager.getSession(session.id)).not.toBeNull();
    });

    test("preserves recently-ended sessions within threshold", () => {
      const session = manager.createSession("alice", "bob", "/project");
      manager.endSession(session.id, "alice");
      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(0);
      expect(manager.getSession(session.id)).not.toBeNull();
    });

    test("purges multiple old inactive sessions", () => {
      const s1 = manager.createSession("alice", "bob", "/proj1");
      const s2 = manager.createSession("alice", "charlie", "/proj2");
      const s3 = manager.createSession("bob", "charlie", "/proj3");

      manager.endSession(s1.id, "alice");
      manager.endSession(s2.id, "alice");

      s1.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();
      s2.startedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString();

      const purged = manager.purgeInactive(60 * 60_000);
      expect(purged).toBe(2);
      expect(manager.getSession(s1.id)).toBeNull();
      expect(manager.getSession(s2.id)).toBeNull();
      expect(manager.getSession(s3.id)).not.toBeNull();
    });
  });
});
