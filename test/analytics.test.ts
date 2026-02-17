import { test, expect, describe } from "bun:test";
import {
  computeAnalytics,
  formatAnalyticsSummary,
  type AnalyticsSnapshot,
} from "../src/services/analytics";
import type { TaskBoard, Task, TaskStatus } from "../src/services/tasks";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "Test task",
    status: "todo" as TaskStatus,
    createdAt: "2026-01-15T10:00:00.000Z",
    events: [],
    ...overrides,
  };
}

function makeBoard(tasks: Task[]): TaskBoard {
  return { tasks };
}

describe("computeAnalytics", () => {
  test("empty board returns zeros", () => {
    const snap = computeAnalytics(makeBoard([]));

    expect(snap.totalTasks).toBe(0);
    expect(snap.totalAccepted).toBe(0);
    expect(snap.totalRejected).toBe(0);
    expect(snap.overallAcceptRate).toBe(0);
    expect(snap.avgCycleTimeMs).toBe(0);
    expect(snap.perAccount).toHaveLength(0);
    expect(snap.slaViolations.total).toBe(0);
    expect(snap.generatedAt).toBeTruthy();
  });

  test("single accepted task computes correct cycle time", () => {
    const createdAt = "2026-01-15T10:00:00.000Z";
    const acceptedAt = "2026-01-15T12:00:00.000Z";
    const expectedCycleMs = 2 * 60 * 60 * 1000;

    const task = makeTask({
      status: "accepted",
      assignee: "alice",
      createdAt,
      events: [
        { type: "status_changed", timestamp: acceptedAt, from: "ready_for_review", to: "accepted" },
        { type: "review_accepted", timestamp: acceptedAt, from: "ready_for_review", to: "accepted" },
      ],
    });

    const snap = computeAnalytics(makeBoard([task]));

    expect(snap.totalTasks).toBe(1);
    expect(snap.totalAccepted).toBe(1);
    expect(snap.avgCycleTimeMs).toBe(expectedCycleMs);
    expect(snap.perAccount).toHaveLength(1);
    expect(snap.perAccount[0].accountName).toBe("alice");
    expect(snap.perAccount[0].avgCycleTimeMs).toBe(expectedCycleMs);
    expect(snap.perAccount[0].accepted).toBe(1);
    expect(snap.perAccount[0].assigned).toBe(1);
  });

  test("multiple assignees computed correctly", () => {
    const tasks = [
      makeTask({ assignee: "alice", status: "accepted", events: [
        { type: "status_changed", timestamp: "2026-01-15T11:00:00.000Z", from: "ready_for_review", to: "accepted" },
      ]}),
      makeTask({ assignee: "alice", status: "rejected", events: [] }),
      makeTask({ assignee: "bob", status: "in_progress", events: [] }),
      makeTask({ assignee: "bob", status: "accepted", events: [
        { type: "status_changed", timestamp: "2026-01-15T14:00:00.000Z", from: "ready_for_review", to: "accepted" },
      ]}),
    ];

    const snap = computeAnalytics(makeBoard(tasks));

    expect(snap.totalTasks).toBe(4);
    expect(snap.totalAccepted).toBe(2);
    expect(snap.totalRejected).toBe(1);
    expect(snap.perAccount).toHaveLength(2);

    const alice = snap.perAccount.find((m) => m.accountName === "alice")!;
    expect(alice.assigned).toBe(2);
    expect(alice.accepted).toBe(1);
    expect(alice.rejected).toBe(1);
    expect(alice.acceptRate).toBe(0.5);

    const bob = snap.perAccount.find((m) => m.accountName === "bob")!;
    expect(bob.assigned).toBe(2);
    expect(bob.accepted).toBe(1);
    expect(bob.rejected).toBe(0);
    expect(bob.acceptRate).toBe(1);
    expect(bob.currentWip).toBe(1);
  });

  test("accept rate handles division by zero", () => {
    const task = makeTask({ assignee: "charlie", status: "in_progress" });
    const snap = computeAnalytics(makeBoard([task]));

    const charlie = snap.perAccount.find((m) => m.accountName === "charlie")!;
    expect(charlie.acceptRate).toBe(0);
    expect(charlie.assigned).toBe(1);
    expect(snap.overallAcceptRate).toBe(0);
  });

  test("date range filtering works", () => {
    const tasks = [
      makeTask({ createdAt: "2026-01-10T10:00:00.000Z", assignee: "alice", status: "accepted", events: [
        { type: "status_changed", timestamp: "2026-01-10T12:00:00.000Z", from: "ready_for_review", to: "accepted" },
      ]}),
      makeTask({ createdAt: "2026-01-20T10:00:00.000Z", assignee: "alice", status: "accepted", events: [
        { type: "status_changed", timestamp: "2026-01-20T12:00:00.000Z", from: "ready_for_review", to: "accepted" },
      ]}),
      makeTask({ createdAt: "2026-02-05T10:00:00.000Z", assignee: "bob", status: "todo" }),
    ];

    const snap = computeAnalytics(makeBoard(tasks), { fromDate: "2026-01-15T00:00:00.000Z" });

    expect(snap.totalTasks).toBe(2);
    expect(snap.fromDate).toBe("2026-01-15T00:00:00.000Z");

    const snap2 = computeAnalytics(makeBoard(tasks), { toDate: "2026-01-15T00:00:00.000Z" });
    expect(snap2.totalTasks).toBe(1);

    const snap3 = computeAnalytics(makeBoard(tasks), {
      fromDate: "2026-01-15T00:00:00.000Z",
      toDate: "2026-01-25T00:00:00.000Z",
    });
    expect(snap3.totalTasks).toBe(1);
  });

  test("SLA violation counting", () => {
    const task = makeTask({
      assignee: "alice",
      status: "in_progress",
      events: [
        { type: "status_changed", timestamp: "2026-01-15T10:30:00.000Z", from: "todo", to: "in_progress" },
        { type: "status_changed", timestamp: "2026-01-15T11:00:00.000Z", from: "in_progress", to: "ready_for_review", reason: "sla_breach: exceeded 1h limit" },
        { type: "review_rejected", timestamp: "2026-01-15T11:30:00.000Z", from: "ready_for_review", to: "rejected", reason: "SLA violation - response too slow" },
      ],
    });

    const snap = computeAnalytics(makeBoard([task]));

    expect(snap.slaViolations.total).toBe(2);
    expect(snap.slaViolations.byAction["status_changed"]).toBe(1);
    expect(snap.slaViolations.byAction["review_rejected"]).toBe(1);
  });

  test("unassigned tasks grouped under (unassigned)", () => {
    const task = makeTask({ status: "todo" });
    const snap = computeAnalytics(makeBoard([task]));

    expect(snap.perAccount).toHaveLength(1);
    expect(snap.perAccount[0].accountName).toBe("(unassigned)");
    expect(snap.perAccount[0].assigned).toBe(1);
  });
});

describe("formatAnalyticsSummary", () => {
  test("returns string with key info", () => {
    const snapshot: AnalyticsSnapshot = {
      generatedAt: "2026-01-15T12:00:00.000Z",
      totalTasks: 10,
      totalAccepted: 6,
      totalRejected: 2,
      overallAcceptRate: 0.75,
      avgCycleTimeMs: 7200000,
      perAccount: [
        {
          accountName: "alice",
          assigned: 5,
          accepted: 3,
          rejected: 1,
          acceptRate: 0.75,
          avgCycleTimeMs: 3600000,
          currentWip: 1,
        },
        {
          accountName: "bob",
          assigned: 5,
          accepted: 3,
          rejected: 1,
          acceptRate: 0.75,
          avgCycleTimeMs: 10800000,
          currentWip: 0,
        },
      ],
      slaViolations: { total: 2, byAction: { status_changed: 1, review_rejected: 1 } },
    };

    const output = formatAnalyticsSummary(snapshot);

    expect(output).toContain("Analytics Summary");
    expect(output).toContain("Total Tasks:    10");
    expect(output).toContain("Accepted:       6");
    expect(output).toContain("Rejected:       2");
    expect(output).toContain("75.0%");
    expect(output).toContain("2.0h");
    expect(output).toContain("alice");
    expect(output).toContain("bob");
    expect(output).toContain("SLA Violations: 2");
    expect(output).toContain("status_changed: 1");
    expect(output).toContain("review_rejected: 1");
  });

  test("omits SLA section when no violations", () => {
    const snapshot: AnalyticsSnapshot = {
      generatedAt: "2026-01-15T12:00:00.000Z",
      totalTasks: 0,
      totalAccepted: 0,
      totalRejected: 0,
      overallAcceptRate: 0,
      avgCycleTimeMs: 0,
      perAccount: [],
      slaViolations: { total: 0, byAction: {} },
    };

    const output = formatAnalyticsSummary(snapshot);

    expect(output).not.toContain("SLA Violations");
  });

  test("includes date range when provided", () => {
    const snapshot: AnalyticsSnapshot = {
      generatedAt: "2026-01-15T12:00:00.000Z",
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      totalTasks: 0,
      totalAccepted: 0,
      totalRejected: 0,
      overallAcceptRate: 0,
      avgCycleTimeMs: 0,
      perAccount: [],
      slaViolations: { total: 0, byAction: {} },
    };

    const output = formatAnalyticsSummary(snapshot);

    expect(output).toContain("2026-01-01");
    expect(output).toContain("2026-01-31");
  });
});
