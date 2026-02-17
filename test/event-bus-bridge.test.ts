
import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { EventBus } from "../src/services/event-bus";
import { SubscriptionRegistry } from "../src/daemon/subscription-registry";
import { EventEmitter } from "events";

function createMockSocket() {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    destroyed: false,
    writable: true,
    write: (_data: string) => true,
    destroy() { (this as any).destroyed = true; },
  }) as any;
}

describe("EventBus -> SubscriptionRegistry bridge", () => {
  let eventBus: EventBus;
  let registry: SubscriptionRegistry;
  let unsub: () => void;

  beforeEach(() => {
    eventBus = new EventBus();
    registry = new SubscriptionRegistry();

    unsub = eventBus.on("*", (event) => {
      registry.broadcast(event);
    });
  });

  afterEach(() => {
    unsub();
    registry.destroy();
    eventBus.clear();
  });

  test("TASK_CREATED event reaches subscribed socket", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["*"]);

    eventBus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "admin" });

    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0].trim());
    expect(parsed.type).toBe("stream_event");
    expect(parsed.event.type).toBe("TASK_CREATED");
    expect(parsed.event.taskId).toBe("t1");
    expect(parsed.event.id).toBeDefined();
    expect(parsed.event.timestamp).toBeDefined();
  });

  test("AGENT_STREAM_CHUNK event reaches socket with pattern match", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["AGENT_STREAM_*"]);

    eventBus.emit({
      type: "AGENT_STREAM_CHUNK",
      sessionId: "s1", account: "alice",
      chunkType: "text", content: "hello",
    });

    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0].trim());
    expect(parsed.event.type).toBe("AGENT_STREAM_CHUNK");
    expect(parsed.event.content).toBe("hello");
  });

  test("events with non-matching patterns are filtered", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["TASK_*"]);

    eventBus.emit({
      type: "AGENT_STREAM_START",
      sessionId: "s1", account: "alice", provider: "claude-code",
    });

    expect(written.length).toBe(0);
  });

  test("multiple events flow through bridge in order", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["*"]);

    eventBus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "admin" });
    eventBus.emit({ type: "TASK_ASSIGNED", taskId: "t1", delegator: "admin", delegatee: "bob", reason: "best fit" });
    eventBus.emit({ type: "TASK_STARTED", taskId: "t1", agent: "bob" });

    expect(written.length).toBe(3);
    const types = written.map((w) => JSON.parse(w.trim()).event.type);
    expect(types).toEqual(["TASK_CREATED", "TASK_ASSIGNED", "TASK_STARTED"]);
  });

  test("TDD events reach subscribers", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["TDD_*"]);

    eventBus.emit({ type: "TDD_CYCLE_START", testFile: "test/foo.test.ts", phase: "red" });
    eventBus.emit({ type: "TDD_TEST_PASS", testFile: "test/foo.test.ts", passCount: 5, duration: 100 });

    expect(written.length).toBe(2);
  });

  test("COUNCIL events reach subscribers", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["COUNCIL_*"]);

    eventBus.emit({
      type: "COUNCIL_DISCUSSION_START",
      sessionId: "c1", goal: "review code", members: ["a", "b"], chairman: "a",
    });

    expect(written.length).toBe(1);
    const parsed = JSON.parse(written[0].trim());
    expect(parsed.event.goal).toBe("review code");
  });

  test("bridge unsub stops event flow", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["*"]);

    eventBus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "admin" });
    expect(written.length).toBe(1);

    unsub();

    eventBus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "admin" });
    expect(written.length).toBe(1);
  });

  test("events include id and timestamp from EventBus", () => {
    const socket = createMockSocket();
    const written: string[] = [];
    socket.write = (data: string) => { written.push(data); return true; };

    registry.subscribe(socket, "tui-client", ["*"]);

    const before = new Date().toISOString();
    eventBus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "admin" });

    const parsed = JSON.parse(written[0].trim());
    expect(parsed.event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(parsed.event.timestamp).toBeDefined();
    expect(new Date(parsed.event.timestamp).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });
});
