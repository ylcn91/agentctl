import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { SubscriptionRegistry } from "../src/daemon/subscription-registry";
import { EventEmitter } from "events";

function createMockSocket(opts?: { destroyed?: boolean; writable?: boolean }) {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    destroyed: opts?.destroyed ?? false,
    writable: opts?.writable ?? true,
    write: (_data: string) => true,
    destroy() { (this as any).destroyed = true; },
  }) as any;
}

describe("SubscriptionRegistry", () => {
  let registry: SubscriptionRegistry;

  beforeEach(() => {
    registry = new SubscriptionRegistry();
  });

  afterEach(() => {
    registry.destroy();
  });

  test("subscribe adds a subscription", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test-account", ["*"]);
    expect(registry.getSubscriptionCount()).toBe(1);
  });

  test("subscribe merges patterns for same socket", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test-account", ["TASK_*"]);
    registry.subscribe(socket, "test-account", ["AGENT_*"]);
    expect(registry.getSubscriptionCount()).toBe(1);
  });

  test("unsubscribe removes all patterns when no patterns specified", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test-account", ["*"]);
    registry.unsubscribe(socket);
    expect(registry.getSubscriptionCount()).toBe(0);
  });

  test("unsubscribe removes specific patterns", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test-account", ["TASK_*", "AGENT_*"]);
    registry.unsubscribe(socket, ["TASK_*"]);
    expect(registry.getSubscriptionCount()).toBe(1);
  });

  test("unsubscribe removes subscription when all patterns removed", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test-account", ["TASK_*"]);
    registry.unsubscribe(socket, ["TASK_*"]);
    expect(registry.getSubscriptionCount()).toBe(0);
  });

  test("removeSocket removes subscription", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test-account", ["*"]);
    registry.removeSocket(socket);
    expect(registry.getSubscriptionCount()).toBe(0);
  });

  test("broadcast sends events to wildcard subscribers", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "test-account", ["*"]);
    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0].trim());
    expect(parsed.type).toBe("stream_event");
    expect(parsed.event.type).toBe("TASK_CREATED");
  });

  test("broadcast sends events matching type patterns", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "test-account", ["TASK_CREATED"]);
    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });
    registry.broadcast({
      type: "TASK_COMPLETED",
      taskId: "t1",
      agent: "worker",
      result: "success",
      id: "evt2",
      timestamp: new Date().toISOString(),
    });

    expect(written.length).toBe(1);
  });

  test("broadcast matches prefix patterns", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "test-account", ["AGENT_STREAM_*"]);
    registry.broadcast({
      type: "AGENT_STREAM_CHUNK",
      sessionId: "s1",
      account: "acct",
      chunkType: "text",
      content: "hello",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(written.length).toBe(1);
  });

  test("broadcast skips destroyed sockets and cleans them up", () => {
    const liveSocket = createMockSocket();
    const deadSocket = createMockSocket({ destroyed: true });
    const liveWritten: string[] = [];
    liveSocket.write = (data: string) => { liveWritten.push(data); return true; };

    registry.subscribe(liveSocket, "live", ["*"]);
    registry.subscribe(deadSocket, "dead", ["*"]);
    expect(registry.getSubscriptionCount()).toBe(2);

    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(liveWritten.length).toBe(1);
    expect(registry.getSubscriptionCount()).toBe(1);
  });

  test("broadcast skips non-writable sockets", () => {
    const socket = createMockSocket({ writable: false });
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "test", ["*"]);
    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(written.length).toBe(0);
  });

  test("multiple sockets receive broadcasts independently", () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();
    const written1: string[] = [];
    const written2: string[] = [];
    socket1.write = (data: string) => { written1.push(data); return true; };
    socket2.write = (data: string) => { written2.push(data); return true; };

    registry.subscribe(socket1, "acct1", ["TASK_*"]);
    registry.subscribe(socket2, "acct2", ["AGENT_STREAM_*"]);

    registry.broadcast({
      type: "AGENT_STREAM_START",
      sessionId: "s1",
      account: "acct",
      provider: "claude-code",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(written1.length).toBe(0);
    expect(written2.length).toBe(1);
  });

  test("broadcast handles write returning false (buffer full)", () => {
    const socket = createMockSocket();
    socket.write = () => false;

    registry.subscribe(socket, "test-account", ["*"]);
    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(socket.listenerCount("drain")).toBe(1);
  });

  test("drain timeout removes stuck socket", async () => {
    const socket = createMockSocket();
    socket.write = () => false;

    registry.subscribe(socket, "stuck-account", ["*"]);
    expect(registry.getSubscriptionCount()).toBe(1);

    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    await new Promise((r) => setTimeout(r, 1200));

    expect(socket.destroyed).toBe(true);
    expect(registry.getSubscriptionCount()).toBe(0);
  });

  test("drain event decrements pending writes", () => {
    const socket = createMockSocket();
    const emitter = socket as EventEmitter;
    let writeCount = 0;
    socket.write = () => {
      writeCount++;
      return false;
    };

    registry.subscribe(socket, "test-account", ["*"]);
    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t1",
      delegator: "admin",
      id: "evt1",
      timestamp: new Date().toISOString(),
    });

    expect(writeCount).toBe(1);

    emitter.emit("drain");

    socket.write = () => true;
    registry.broadcast({
      type: "TASK_CREATED",
      taskId: "t2",
      delegator: "admin",
      id: "evt2",
      timestamp: new Date().toISOString(),
    });
  });

  test("broadcast drops events when pending writes exceed limit", () => {
    const socket = createMockSocket();
    socket.setMaxListeners(0);
    let writeCallCount = 0;
    socket.write = () => { writeCallCount++; return false; };

    registry.subscribe(socket, "overflow-account", ["*"]);

    for (let i = 0; i < 510; i++) {
      registry.broadcast({
        type: "TASK_CREATED",
        taskId: `t${i}`,
        delegator: "admin",
        id: `evt${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    expect(writeCallCount).toBe(500);
  });

  // ── destroy() ──

  test("destroy clears all subscriptions", () => {
    const s1 = createMockSocket();
    const s2 = createMockSocket();
    registry.subscribe(s1, "a1", ["*"]);
    registry.subscribe(s2, "a2", ["*"]);
    expect(registry.getSubscriptionCount()).toBe(2);

    registry.destroy();
    expect(registry.getSubscriptionCount()).toBe(0);
  });

  test("destroy is safe to call multiple times", () => {
    const socket = createMockSocket();
    registry.subscribe(socket, "test", ["*"]);
    registry.destroy();
    registry.destroy(); // should not throw
    expect(registry.getSubscriptionCount()).toBe(0);
  });
});
