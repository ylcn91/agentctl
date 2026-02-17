import { describe, test, expect } from "bun:test";
import type { TaskBoard, Task, TaskEvent, TaskStatus } from "../src/services/tasks";
import { computeWorkloadSnapshots, computeWorkloadModifier } from "../src/services/workload-metrics";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "Test task",
    status: "todo" as TaskStatus,
    createdAt: new Date().toISOString(),
    events: [],
    ...overrides,
  };
}

function acceptedEvent(minutesAgo: number): TaskEvent {
  const ts = new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
  return { type: "status_changed", timestamp: ts, from: "ready_for_review", to: "accepted" };
}

describe("computeWorkloadSnapshots", () => {
  test("empty board returns empty map", () => {
    const board: TaskBoard = { tasks: [] };
    const result = computeWorkloadSnapshots(board);
    expect(result.size).toBe(0);
  });

  test("single in_progress task counts as WIP and open", () => {
    const board: TaskBoard = {
      tasks: [makeTask({ assignee: "alice", status: "in_progress" })],
    };
    const result = computeWorkloadSnapshots(board);
    const snap = result.get("alice")!;
    expect(snap.wipCount).toBe(1);
    expect(snap.openCount).toBe(1);
    expect(snap.recentThroughput).toBe(0);
  });

  test("tasks with no assignee are skipped", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({ status: "in_progress" }),
        makeTask({ assignee: undefined, status: "todo" }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    expect(result.size).toBe(0);
  });

  test("multiple assignees tracked separately", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({ assignee: "alice", status: "in_progress" }),
        makeTask({ assignee: "alice", status: "todo" }),
        makeTask({ assignee: "bob", status: "in_progress" }),
        makeTask({ assignee: "bob", status: "in_progress" }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    expect(result.get("alice")!.wipCount).toBe(1);
    expect(result.get("alice")!.openCount).toBe(2);
    expect(result.get("bob")!.wipCount).toBe(2);
    expect(result.get("bob")!.openCount).toBe(2);
  });

  test("terminal statuses (accepted, rejected) are not counted as open", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({ assignee: "alice", status: "accepted" }),
        makeTask({ assignee: "alice", status: "rejected" }),
        makeTask({ assignee: "alice", status: "todo" }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    const snap = result.get("alice")!;
    expect(snap.openCount).toBe(1);
    expect(snap.wipCount).toBe(0);
  });

  test("recent throughput counts tasks with accepted event in last 60 minutes", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({
          assignee: "alice",
          status: "accepted",
          events: [acceptedEvent(30)],
        }),
        makeTask({
          assignee: "alice",
          status: "accepted",
          events: [acceptedEvent(59)],
        }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    expect(result.get("alice")!.recentThroughput).toBe(2);
  });

  test("old accepted events are not counted for throughput", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({
          assignee: "alice",
          status: "accepted",
          events: [acceptedEvent(61)],
        }),
        makeTask({
          assignee: "alice",
          status: "accepted",
          events: [acceptedEvent(120)],
        }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    expect(result.get("alice")!.recentThroughput).toBe(0);
  });

  test("mixed recent and old events counted correctly", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({
          assignee: "bob",
          status: "accepted",
          events: [acceptedEvent(10)],
        }),
        makeTask({
          assignee: "bob",
          status: "accepted",
          events: [acceptedEvent(90)],
        }),
        makeTask({
          assignee: "bob",
          status: "in_progress",
        }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    const snap = result.get("bob")!;
    expect(snap.recentThroughput).toBe(1);
    expect(snap.wipCount).toBe(1);
    expect(snap.openCount).toBe(1);
  });

  test("all non-terminal statuses counted as open", () => {
    const board: TaskBoard = {
      tasks: [
        makeTask({ assignee: "alice", status: "todo" }),
        makeTask({ assignee: "alice", status: "in_progress" }),
        makeTask({ assignee: "alice", status: "ready_for_review" }),
      ],
    };
    const result = computeWorkloadSnapshots(board);
    expect(result.get("alice")!.openCount).toBe(3);
  });
});

describe("computeWorkloadModifier", () => {
  test("zero snapshot returns 0", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 0,
      openCount: 0,
      recentThroughput: 0,
    });
    expect(result).toBe(0);
  });

  test("WIP penalty applies at -5 per task", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 2,
      openCount: 0,
      recentThroughput: 0,
    });
    expect(result).toBe(-10);
  });

  test("WIP penalty capped at -15", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 10,
      openCount: 0,
      recentThroughput: 0,
    });
    expect(result).toBe(-15);
  });

  test("open penalty applies at -2 per task", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 0,
      openCount: 3,
      recentThroughput: 0,
    });
    expect(result).toBe(-6);
  });

  test("open penalty capped at -10", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 0,
      openCount: 20,
      recentThroughput: 0,
    });
    expect(result).toBe(-10);
  });

  test("throughput bonus applies at +5 per task", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 0,
      openCount: 0,
      recentThroughput: 2,
    });
    expect(result).toBe(10);
  });

  test("throughput bonus capped at +15", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 0,
      openCount: 0,
      recentThroughput: 10,
    });
    expect(result).toBe(15);
  });

  test("all penalties maxed out", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 10,
      openCount: 20,
      recentThroughput: 0,
    });
    expect(result).toBe(-25);
  });

  test("mixed scenario: penalties and bonus", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 1,
      openCount: 2,
      recentThroughput: 1,
    });
    expect(result).toBe(-4);
  });

  test("throughput bonus can offset penalties", () => {
    const result = computeWorkloadModifier({
      accountName: "alice",
      wipCount: 1,
      openCount: 1,
      recentThroughput: 3,
    });
    expect(result).toBe(8);
  });
});
