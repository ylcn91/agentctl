import { test, expect, describe, beforeEach } from "bun:test";
import { EventBus, type DelegationEvent, type EventHandler } from "../src/services/event-bus";

describe("EventBus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  test("emit returns event ID", () => {
    const id = bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  test("subscribers receive emitted events", () => {
    const received: DelegationEvent[] = [];
    bus.on("TASK_CREATED", (event) => received.push(event));

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "bob" });

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("TASK_CREATED");
    expect((received[0] as any).taskId).toBe("t1");
  });

  test("type-specific subscribers only get their event type", () => {
    const created: DelegationEvent[] = [];
    const completed: DelegationEvent[] = [];

    bus.on("TASK_CREATED", (e) => created.push(e));
    bus.on("TASK_COMPLETED", (e) => completed.push(e));

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "bob", result: "success" });
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "carol" });

    expect(created).toHaveLength(2);
    expect(completed).toHaveLength(1);
  });

  test("wildcard subscribers receive all events", () => {
    const all: DelegationEvent[] = [];
    bus.on("*", (e) => all.push(e));

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "bob", result: "success" });
    bus.emit({ type: "TRUST_UPDATE", agent: "bob", delta: 5, reason: "task_completed" });

    expect(all).toHaveLength(3);
  });

  test("unsubscribe stops delivery", () => {
    const received: DelegationEvent[] = [];
    const unsub = bus.on("TASK_CREATED", (e) => received.push(e));

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    expect(received).toHaveLength(1);

    unsub();
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "bob" });
    expect(received).toHaveLength(1);
  });

  test("emitted events have id and timestamp", () => {
    let captured: any;
    bus.on("TASK_STARTED", (e) => { captured = e; });

    bus.emit({ type: "TASK_STARTED", taskId: "t1", agent: "alice" });

    expect(captured.id).toBeDefined();
    expect(captured.timestamp).toBeDefined();
    expect(new Date(captured.timestamp).getTime()).toBeGreaterThan(0);
  });

  test("getRecent returns recent events", () => {
    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_STARTED", taskId: "t1", agent: "bob" });
    bus.emit({ type: "TASK_COMPLETED", taskId: "t1", agent: "bob", result: "success" });

    const recent = bus.getRecent();
    expect(recent).toHaveLength(3);
  });

  test("getRecent filters by type", () => {
    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_STARTED", taskId: "t1", agent: "bob" });
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "carol" });

    const created = bus.getRecent({ type: "TASK_CREATED" });
    expect(created).toHaveLength(2);
  });

  test("getRecent filters by taskId", () => {
    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    bus.emit({ type: "TASK_STARTED", taskId: "t1", agent: "bob" });
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "carol" });

    const t1Events = bus.getRecent({ taskId: "t1" });
    expect(t1Events).toHaveLength(2);
  });

  test("getRecent respects limit", () => {
    for (let i = 0; i < 10; i++) {
      bus.emit({ type: "TASK_CREATED", taskId: `t${i}`, delegator: "alice" });
    }

    const limited = bus.getRecent({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  test("event buffer respects maxRecent", () => {
    const smallBus = new EventBus({ maxRecent: 5 });
    for (let i = 0; i < 10; i++) {
      smallBus.emit({ type: "TASK_CREATED", taskId: `t${i}`, delegator: "alice" });
    }

    const recent = smallBus.getRecent({ limit: 100 });
    expect(recent).toHaveLength(5);
    // Should keep the latest 5
    expect((recent[0] as any).taskId).toBe("t5");
  });

  test("handler errors don't break other handlers", () => {
    const received: string[] = [];

    bus.on("TASK_CREATED", () => { throw new Error("handler exploded"); });
    bus.on("TASK_CREATED", (e) => { received.push((e as any).taskId); });

    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    expect(received).toEqual(["t1"]);
  });

  test("clear removes all events and handlers", () => {
    const received: DelegationEvent[] = [];
    bus.on("TASK_CREATED", (e) => received.push(e));
    bus.emit({ type: "TASK_CREATED", taskId: "t1", delegator: "alice" });
    expect(received).toHaveLength(1);

    bus.clear();
    expect(bus.getRecent()).toHaveLength(0);

    // After clear, handler is removed — new events should not be received
    bus.emit({ type: "TASK_CREATED", taskId: "t2", delegator: "bob" });
    expect(received).toHaveLength(1);
    // But the event is in the buffer since we emitted after clear
    expect(bus.getRecent()).toHaveLength(1);
  });

  test("all delegation event types can be emitted", () => {
    const events: DelegationEvent[] = [
      { type: "TASK_CREATED", taskId: "t1", delegator: "a" },
      { type: "TASK_ASSIGNED", taskId: "t1", delegator: "a", delegatee: "b", reason: "skill match" },
      { type: "TASK_STARTED", taskId: "t1", agent: "b" },
      { type: "CHECKPOINT_REACHED", taskId: "t1", agent: "b", percent: 50, step: "testing" },
      { type: "RESOURCE_WARNING", taskId: "t1", agent: "b", warning: "high memory" },
      { type: "PROGRESS_UPDATE", taskId: "t1", agent: "b", data: { percent: 75, currentStep: "reviewing" } },
      { type: "SLA_WARNING", taskId: "t1", threshold: "30min", elapsed: 1800 },
      { type: "SLA_BREACH", taskId: "t1", threshold: "60min", elapsed: 3600 },
      { type: "TASK_COMPLETED", taskId: "t1", agent: "b", result: "success" },
      { type: "TASK_VERIFIED", taskId: "t1", verifier: "a", passed: true },
      { type: "REASSIGNMENT", taskId: "t1", from: "b", to: "c", trigger: "sla_breach" },
      { type: "DELEGATION_CHAIN", taskId: "t1", chain: ["a", "b", "c"] },
      { type: "TRUST_UPDATE", agent: "b", delta: 5, reason: "task_completed" },
    ];

    for (const event of events) {
      const id = bus.emit(event);
      expect(typeof id).toBe("string");
    }

    expect(bus.getRecent()).toHaveLength(13);
  });
});
